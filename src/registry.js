import os from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { BUILT_IN_MODEL_CATALOG } from "./catalog.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const HUGGING_FACE_API_URL = "https://huggingface.co/api/models";
const HUGGING_FACE_QUERY = {
  filter: "text-generation",
  search: "gguf",
  sort: "downloads",
  direction: "-1",
  limit: "40",
  full: "true",
  config: "true"
};

export function parseParameterCount(input) {
  const match = input.match(/(\d+(?:\.\d+)?)\s*B\b/i);

  if (!match) {
    return null;
  }

  return Number.parseFloat(match[1]);
}

export function inferRamRequirements(parameterCountB) {
  if (parameterCountB <= 0 || Number.isNaN(parameterCountB)) {
    return null;
  }

  if (parameterCountB <= 1) {
    return { minimumRamGb: 4, recommendedRamGb: 8 };
  }

  if (parameterCountB <= 3) {
    return { minimumRamGb: 6, recommendedRamGb: 8 };
  }

  if (parameterCountB <= 8) {
    return { minimumRamGb: 12, recommendedRamGb: 16 };
  }

  if (parameterCountB <= 14) {
    return { minimumRamGb: 24, recommendedRamGb: 32 };
  }

  return null;
}

function formatParameterCount(parameterCountB) {
  return Number.isInteger(parameterCountB) ? `${parameterCountB}B` : `${parameterCountB.toFixed(1)}B`;
}

function getPathModule(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function getCacheDirectory({ platform = process.platform, env = process.env, homeDir = os.homedir() } = {}) {
  const pathModule = getPathModule(platform);

  if (platform === "win32") {
    return pathModule.join(env.LOCALAPPDATA ?? pathModule.join(homeDir, "AppData", "Local"), "llmfit");
  }

  if (platform === "darwin") {
    return pathModule.join(homeDir, "Library", "Caches", "llmfit");
  }

  return pathModule.join(env.XDG_CACHE_HOME ?? pathModule.join(homeDir, ".cache"), "llmfit");
}

export function getCacheFilePath({ platform = process.platform, ...options } = {}) {
  return getPathModule(platform).join(getCacheDirectory({ platform, ...options }), "registry.json");
}

function getModelText(model) {
  return [
    model.id,
    model.modelId,
    model.cardData?.model_name,
    ...(Array.isArray(model.tags) ? model.tags : []),
    ...(Array.isArray(model.siblings) ? model.siblings.map((sibling) => sibling.rfilename) : [])
  ]
    .filter(Boolean)
    .join(" ");
}

function isLocalRuntimeFriendly(modelText) {
  return /(gguf|llama\.cpp|mlx|ollama)/i.test(modelText);
}

function isInstructionTuned(modelText) {
  return /(instruct|chat)/i.test(modelText);
}

function extractQuantization(modelText) {
  const match = modelText.match(/\b(Q\d(?:[_-][A-Z0-9]+)*)\b/i);
  return match ? match[1].toUpperCase().replaceAll("-", "_") : "Unknown";
}

function extractLicense(model) {
  if (typeof model.cardData?.license === "string" && model.cardData.license.length > 0) {
    return model.cardData.license;
  }

  const tag = (Array.isArray(model.tags) ? model.tags : []).find((item) => item.startsWith("license:"));
  return tag ? tag.slice("license:".length) : "Unknown";
}

function toDisplayName(model) {
  const rawName = model.cardData?.model_name ?? model.id.split("/").at(-1) ?? model.id;
  return rawName
    .replace(/[-_]+/g, " ")
    .replace(/\bGGUF\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getRuntimeTags(modelText) {
  const tags = [];

  if (/gguf/i.test(modelText)) {
    tags.push("gguf");
  }

  if (/llama\.cpp/i.test(modelText) || /gguf/i.test(modelText)) {
    tags.push("llama.cpp");
  }

  if (/ollama/i.test(modelText) || /gguf/i.test(modelText)) {
    tags.push("ollama");
  }

  if (/mlx/i.test(modelText)) {
    tags.push("mlx");
  }

  return [...new Set(tags)];
}

export function normalizeRemoteModel(model) {
  const modelText = getModelText(model);

  if (!isLocalRuntimeFriendly(modelText) || !isInstructionTuned(modelText)) {
    return null;
  }

  const parameterCountB = parseParameterCount(modelText);
  const ramRequirements = parameterCountB === null ? null : inferRamRequirements(parameterCountB);

  if (parameterCountB === null || ramRequirements === null) {
    return null;
  }

  return {
    id: model.id,
    name: toDisplayName(model),
    provider: "huggingface",
    params: formatParameterCount(parameterCountB),
    quantization: extractQuantization(modelText),
    minimumRamGb: ramRequirements.minimumRamGb,
    recommendedRamGb: ramRequirements.recommendedRamGb,
    runtimeTags: getRuntimeTags(modelText),
    license: extractLicense(model),
    sourceUrl: `https://huggingface.co/${model.id}`,
    notes: "Fetched from Hugging Face Hub using local-runtime-friendly model signals."
  };
}

function dedupeAndSortModels(models) {
  const byId = new Map();

  for (const model of models) {
    if (!byId.has(model.id)) {
      byId.set(model.id, model);
    }
  }

  return [...byId.values()].sort((left, right) =>
    left.minimumRamGb - right.minimumRamGb
    || left.recommendedRamGb - right.recommendedRamGb
    || left.name.localeCompare(right.name)
  );
}

export async function fetchLiveRegistry({
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  timeoutMs = FETCH_TIMEOUT_MS,
  apiUrl = HUGGING_FACE_API_URL
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for live registry loading.");
  }

  const url = new URL(apiUrl);

  for (const [key, value] of Object.entries(HUGGING_FACE_QUERY)) {
    url.searchParams.set(key, value);
  }

  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Hugging Face API returned ${response.status}.`);
  }

  const payload = await response.json();

  if (!Array.isArray(payload)) {
    throw new Error("Hugging Face API returned an unexpected payload.");
  }

  const models = dedupeAndSortModels(payload.map(normalizeRemoteModel).filter(Boolean));

  if (models.length === 0) {
    throw new Error("Live registry returned no usable local-run models.");
  }

  return {
    source: "live",
    fetchedAt: new Date(now).toISOString(),
    models
  };
}

async function readCachedRegistry({
  cacheFilePath = getCacheFilePath(),
  now = Date.now(),
  maxAgeMs = CACHE_TTL_MS
} = {}) {
  try {
    const content = await readFile(cacheFilePath, "utf8");
    const payload = JSON.parse(content);

    if (!Array.isArray(payload.models) || typeof payload.fetchedAt !== "string") {
      return null;
    }

    const fetchedAtMs = Date.parse(payload.fetchedAt);

    if (!Number.isFinite(fetchedAtMs) || now - fetchedAtMs > maxAgeMs) {
      return null;
    }

    return {
      source: "cache",
      fetchedAt: payload.fetchedAt,
      models: payload.models
    };
  } catch {
    return null;
  }
}

async function writeCachedRegistry(registry, { cacheFilePath = getCacheFilePath() } = {}) {
  const cacheDir = path.dirname(cacheFilePath);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFilePath, JSON.stringify(registry, null, 2), "utf8");
}

export async function loadModelRegistry(options = {}) {
  const {
    builtInModels = BUILT_IN_MODEL_CATALOG,
    onStatus
  } = options;

  try {
    onStatus?.({ type: "fetching-live" });
    const liveRegistry = await fetchLiveRegistry(options);

    try {
      await writeCachedRegistry(liveRegistry, options);
    } catch {
      // Cache persistence is best-effort; a live result should still be usable.
    }

    onStatus?.({ type: "live-ready" });
    return liveRegistry;
  } catch {
    const cachedRegistry = await readCachedRegistry(options);

    if (cachedRegistry) {
      onStatus?.({ type: "using-cache" });
      onStatus?.({ type: "cache-ready" });
      return cachedRegistry;
    }
  }

  if (Array.isArray(builtInModels) && builtInModels.length > 0) {
    onStatus?.({ type: "using-builtin" });
    onStatus?.({ type: "builtin-ready" });
    return {
      source: "builtin",
      fetchedAt: null,
      models: builtInModels
    };
  }

  throw new Error("No model registry source is available.");
}
