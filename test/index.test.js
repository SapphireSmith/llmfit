import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { formatRecommendations, loadRecommendations, recommendModels, detectRuntimeEnvironment } from "../src/index.js";
import { createCliReporter, formatModelResults, formatProfileBlock, formatStatusMessage } from "../src/cli-ui.js";
import {
  fetchLiveRegistry,
  getCacheFilePath,
  inferRamRequirements,
  normalizeRemoteModel,
  parseParameterCount
} from "../src/registry.js";

test("recommendModels returns models that fit available RAM", () => {
  const recommendations = recommendModels({ totalRamGb: 16 });

  assert.ok(recommendations.length > 0);
  assert.ok(recommendations.every((model) => model.minimumRamGb <= 16));
});

test("formatRecommendations prints a readable report", () => {
  const output = formatRecommendations(
    {
      platform: "win32",
      arch: "x64",
      cpuModel: "Test CPU",
      cpuThreads: 8,
      totalRamGb: 16,
      freeRamGb: 10,
      environmentNotes: []
    },
    [
      {
        name: "Model A",
        params: "7B",
        quantization: "Q4_K_M",
        minimumRamGb: 12,
        recommendedRamGb: 16,
        fit: "Recommended",
        notes: "Example model"
      }
    ],
    { source: "live" }
  );

  assert.match(output, /LLMFit local model check/);
  assert.match(output, /Model A/);
  assert.match(output, /Source: live registry/);
});

test("parseParameterCount reads common parameter sizes", () => {
  assert.equal(parseParameterCount("Qwen2.5-3B-Instruct-GGUF"), 3);
  assert.equal(parseParameterCount("Llama-3.2-0.5B-Instruct"), 0.5);
  assert.equal(parseParameterCount("No size here"), null);
});

test("inferRamRequirements maps parameter bands to RAM heuristics", () => {
  assert.deepEqual(inferRamRequirements(1), { minimumRamGb: 4, recommendedRamGb: 8 });
  assert.deepEqual(inferRamRequirements(3), { minimumRamGb: 6, recommendedRamGb: 8 });
  assert.deepEqual(inferRamRequirements(7), { minimumRamGb: 12, recommendedRamGb: 16 });
  assert.deepEqual(inferRamRequirements(14), { minimumRamGb: 24, recommendedRamGb: 32 });
  assert.equal(inferRamRequirements(20), null);
});

test("normalizeRemoteModel keeps instruct-tuned local-friendly models", () => {
  const normalized = normalizeRemoteModel({
    id: "Qwen/Qwen2.5-3B-Instruct-GGUF",
    tags: ["license:apache-2.0", "gguf"],
    siblings: [{ rfilename: "Qwen2.5-3B-Instruct-Q4_K_M.gguf" }]
  });

  assert.equal(normalized?.provider, "huggingface");
  assert.equal(normalized?.params, "3B");
  assert.equal(normalized?.quantization, "Q4_K_M");
  assert.deepEqual(normalized?.runtimeTags, ["gguf", "llama.cpp", "ollama"]);
});

test("normalizeRemoteModel skips ambiguous remote entries", () => {
  const normalized = normalizeRemoteModel({
    id: "meta-llama/Llama-3.1-8B",
    tags: ["text-generation"]
  });

  assert.equal(normalized, null);
});

test("detectRuntimeEnvironment identifies WSL", () => {
  const runtime = detectRuntimeEnvironment({
    platform: "linux",
    release: "5.15.167.4-microsoft-standard-WSL2",
    env: {}
  });

  assert.equal(runtime.isWsl, true);
  assert.match(runtime.environmentNotes[0], /Running in WSL/);
});

test("formatRecommendations prints WSL notes and no-match message for cache source", () => {
  const output = formatRecommendations(
    {
      platform: "linux",
      arch: "x64",
      cpuModel: "Test CPU",
      cpuThreads: 8,
      totalRamGb: 3.7,
      freeRamGb: 3.1,
      environmentNotes: ["Running in WSL, so RAM reflects the Linux VM rather than the full Windows host."]
    },
    [],
    { source: "cache", fetchedAt: "2026-06-04T12:00:00.000Z" }
  );

  assert.match(output, /Source: cached registry \(last updated 2026-06-04\)/);
  assert.match(output, /Note: Running in WSL/);
  assert.match(output, /No matches found in the available model registry/);
});

test("getCacheFilePath uses the expected OS-specific base directory", () => {
  assert.equal(
    getCacheFilePath({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\demo\\AppData\\Local" },
      homeDir: "C:\\Users\\demo"
    }),
    "C:\\Users\\demo\\AppData\\Local\\llmfit\\registry.json"
  );

  assert.equal(
    getCacheFilePath({
      platform: "linux",
      env: {},
      homeDir: "/home/demo"
    }),
    "/home/demo/.cache/llmfit/registry.json"
  );
});

test("loadRecommendations prefers live registry data when fetch succeeds", async () => {
  const result = await loadRecommendations({
    profileOverrides: {
      platform: "win32",
      arch: "x64",
      cpuList: [{ model: "Test CPU" }],
      totalMemoryBytes: 16 * 1024 ** 3,
      freeMemoryBytes: 10 * 1024 ** 3,
      env: {},
      release: "10.0.0"
    },
    registryOptions: {
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return [
            {
              id: "Qwen/Qwen2.5-3B-Instruct-GGUF",
              tags: ["license:apache-2.0", "gguf"],
              siblings: [{ rfilename: "Qwen2.5-3B-Instruct-Q4_K_M.gguf" }]
            }
          ];
        }
      }),
      cacheFilePath: path.join(await mkdtemp(path.join(os.tmpdir(), "llmfit-live-")), "registry.json"),
      now: Date.parse("2026-06-04T00:00:00.000Z")
    }
  });

  assert.equal(result.registryInfo.source, "live");
  assert.equal(result.recommendations[0].name, "Qwen2.5 3B Instruct");
});

test("loadRecommendations falls back to cache when live fetch fails", async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), "llmfit-cache-"));
  const cacheFilePath = path.join(cacheDir, "registry.json");

  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    cacheFilePath,
    JSON.stringify({
      fetchedAt: "2026-06-04T00:00:00.000Z",
      models: [
        {
          id: "cached/model",
          name: "Cached Model",
          provider: "huggingface",
          params: "1B",
          quantization: "Q4_K_M",
          minimumRamGb: 4,
          recommendedRamGb: 8,
          runtimeTags: ["gguf"],
          license: "apache-2.0",
          sourceUrl: "https://huggingface.co/cached/model",
          notes: "Cached entry"
        }
      ]
    }),
    "utf8"
  );

  const result = await loadRecommendations({
    profileOverrides: {
      platform: "linux",
      arch: "x64",
      cpuList: [{ model: "Test CPU" }],
      totalMemoryBytes: 8 * 1024 ** 3,
      freeMemoryBytes: 4 * 1024 ** 3,
      env: {},
      release: "6.0.0"
    },
    registryOptions: {
      fetchImpl: async () => {
        throw new Error("network down");
      },
      cacheFilePath,
      now: Date.parse("2026-06-04T06:00:00.000Z")
    }
  });

  assert.equal(result.registryInfo.source, "cache");
  assert.equal(result.recommendations[0].name, "Cached Model");
});

test("loadRecommendations falls back to built-in catalog when cache is unusable", async () => {
  const cacheFilePath = path.join(await mkdtemp(path.join(os.tmpdir(), "llmfit-builtin-")), "registry.json");

  await writeFile(cacheFilePath, "{not-valid-json", "utf8");

  const result = await loadRecommendations({
    profileOverrides: {
      platform: "win32",
      arch: "x64",
      cpuList: [{ model: "Test CPU" }],
      totalMemoryBytes: 8 * 1024 ** 3,
      freeMemoryBytes: 4 * 1024 ** 3,
      env: {},
      release: "10.0.0"
    },
    registryOptions: {
      fetchImpl: async () => {
        throw new Error("network down");
      },
      cacheFilePath,
      now: Date.parse("2026-06-04T06:00:00.000Z")
    }
  });

  assert.equal(result.registryInfo.source, "builtin");
  assert.ok(result.recommendations.length > 0);
});

test("loadRecommendations keeps live results when cache persistence fails", async () => {
  const blockedBase = path.join(await mkdtemp(path.join(os.tmpdir(), "llmfit-live-readonly-")), "blocker");
  await writeFile(blockedBase, "not a directory", "utf8");

  const result = await loadRecommendations({
    profileOverrides: {
      platform: "win32",
      arch: "x64",
      cpuList: [{ model: "Test CPU" }],
      totalMemoryBytes: 16 * 1024 ** 3,
      freeMemoryBytes: 10 * 1024 ** 3,
      env: {},
      release: "10.0.0"
    },
    registryOptions: {
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return [
            {
              id: "Qwen/Qwen2.5-3B-Instruct-GGUF",
              tags: ["license:apache-2.0", "gguf"],
              siblings: [{ rfilename: "Qwen2.5-3B-Instruct-Q4_K_M.gguf" }]
            }
          ];
        }
      }),
      cacheFilePath: path.join(blockedBase, "registry.json"),
      now: Date.parse("2026-06-04T00:00:00.000Z")
    }
  });

  assert.equal(result.registryInfo.source, "live");
  assert.equal(result.recommendations[0].name, "Qwen2.5 3B Instruct");
});

test("fetchLiveRegistry rejects non-200 API responses", async () => {
  await assert.rejects(
    () => fetchLiveRegistry({
      fetchImpl: async () => ({
        ok: false,
        status: 503
      })
    }),
    /returned 503/
  );
});

test("fetchLiveRegistry rejects malformed API payloads", async () => {
  await assert.rejects(
    () => fetchLiveRegistry({
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { message: "not an array" };
        }
      })
    }),
    /unexpected payload/
  );
});

test("formatProfileBlock prints specs for the staged CLI intro", () => {
  const output = formatProfileBlock({
    platform: "win32",
    arch: "x64",
    cpuModel: "Test CPU",
    cpuThreads: 8,
    totalRamGb: 16,
    freeRamGb: 10,
    environmentNotes: []
  });

  assert.match(output, /Platform: win32 \(x64\)/);
  assert.match(output, /RAM: 16 GB total, 10 GB free/);
});

test("formatModelResults prints a cleaner suitable models section", () => {
  const output = formatModelResults(
    {},
    [
      {
        name: "Model A",
        params: "7B",
        quantization: "Q4_K_M",
        minimumRamGb: 12,
        recommendedRamGb: 16,
        fit: "Recommended",
        notes: "Example model"
      }
    ],
    { source: "live" }
  );

  assert.match(output, /Source: Live registry/);
  assert.match(output, /Suitable models/);
  assert.match(output, /Fit: Recommended/);
});

test("formatStatusMessage returns user-friendly loader text", () => {
  assert.match(formatStatusMessage({ type: "fetching-live" }), /Checking available models/);
  assert.match(formatStatusMessage({ type: "using-cache" }), /Using cached model registry/);
  assert.match(formatStatusMessage({ type: "builtin-ready" }), /built-in catalog/);
});

test("createCliReporter prints staged output without a tty", () => {
  let stdoutText = "";
  let stderrText = "";

  const stdout = {
    isTTY: false,
    write(text) {
      stdoutText += text;
    }
  };
  const stderr = {
    isTTY: false,
    write(text) {
      stderrText += text;
    }
  };

  const reporter = createCliReporter({ stdout, stderr, colorEnabled: false });

  reporter.printIntro({
    platform: "win32",
    arch: "x64",
    cpuModel: "Test CPU",
    cpuThreads: 8,
    totalRamGb: 16,
    freeRamGb: 10,
    environmentNotes: []
  });
  reporter.startStatus({ type: "fetching-live" });
  reporter.finishStatus({ type: "live-ready" });
  reporter.printResults(
    {},
    [
      {
        name: "Model A",
        params: "7B",
        quantization: "Q4_K_M",
        minimumRamGb: 12,
        recommendedRamGb: 16,
        fit: "Recommended",
        notes: "Example model"
      }
    ],
    { source: "live" }
  );
  reporter.printError("Example error");

  assert.match(stdoutText, /LLMFit local model check/);
  assert.match(stdoutText, /Checking available models/);
  assert.match(stdoutText, /Found live model matches/);
  assert.match(stdoutText, /Suitable models/);
  assert.match(stderrText, /Example error/);
});
