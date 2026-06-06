import os from "node:os";
import { BUILT_IN_MODEL_CATALOG } from "./catalog.js";
import { loadModelRegistry } from "./registry.js";

function bytesToGb(bytes) {
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}

export function detectRuntimeEnvironment({
  platform = os.platform(),
  release = os.release(),
  env = process.env
} = {}) {
  const isWsl = platform === "linux"
    && (
      typeof env.WSL_DISTRO_NAME === "string"
      || typeof env.WSL_INTEROP === "string"
      || /microsoft/i.test(release)
    );

  return {
    isWsl,
    environmentNotes: isWsl
      ? ["Running in WSL, so RAM reflects the Linux VM rather than the full Windows host."]
      : []
  };
}

export function getSystemProfile({
  platform = os.platform(),
  arch = os.arch(),
  cpuList = os.cpus(),
  totalMemoryBytes = os.totalmem(),
  freeMemoryBytes = os.freemem(),
  env = process.env,
  release = os.release()
} = {}) {
  const runtime = detectRuntimeEnvironment({ platform, release, env });

  return {
    platform,
    arch,
    cpuModel: cpuList[0]?.model ?? "Unknown CPU",
    cpuThreads: cpuList.length,
    totalRamGb: bytesToGb(totalMemoryBytes),
    freeRamGb: bytesToGb(freeMemoryBytes),
    isWsl: runtime.isWsl,
    environmentNotes: runtime.environmentNotes
  };
}

function getFitLabel(model, totalRamGb) {
  if (totalRamGb >= model.recommendedRamGb) {
    return "Recommended";
  }

  if (totalRamGb >= model.minimumRamGb) {
    return "Possible";
  }

  return "Too large";
}

export function recommendModels(profile, models = BUILT_IN_MODEL_CATALOG) {
  return models
    .map((model) => ({
      ...model,
      fit: getFitLabel(model, profile.totalRamGb)
    }))
    .filter((model) => model.fit !== "Too large")
    .sort((left, right) =>
      left.minimumRamGb - right.minimumRamGb
      || left.recommendedRamGb - right.recommendedRamGb
      || left.name.localeCompare(right.name)
    );
}

function formatSourceLine(registryInfo) {
  if (registryInfo.source === "live") {
    return "live registry";
  }

  if (registryInfo.source === "cache") {
    const stamp = typeof registryInfo.fetchedAt === "string"
      ? registryInfo.fetchedAt.slice(0, 10)
      : "unknown date";

    return `cached registry (last updated ${stamp})`;
  }

  return "built-in fallback catalog";
}

function getNoMatchMessage(registryInfo) {
  if (registryInfo.source === "builtin") {
    return "No matches found in the starter catalog for this machine.";
  }

  return "No matches found in the available model registry for this machine.";
}

export function formatRecommendations(profile, recommendations, registryInfo = { source: "builtin" }) {
  const lines = [
    "LLMFit local model check",
    "",
    `Platform: ${profile.platform} (${profile.arch})`,
    `CPU: ${profile.cpuModel}`,
    `Threads: ${profile.cpuThreads}`,
    `RAM: ${profile.totalRamGb} GB total, ${profile.freeRamGb} GB free`,
    `Source: ${formatSourceLine(registryInfo)}`
  ];

  for (const note of profile.environmentNotes ?? []) {
    lines.push(`Note: ${note}`);
  }

  lines.push("");

  if (recommendations.length === 0) {
    lines.push(getNoMatchMessage(registryInfo));
    lines.push("Next step: add smaller models or consider cloud-hosted options.");
    return lines.join("\n");
  }

  lines.push("Suggested open-source models:");
  lines.push("");

  for (const model of recommendations) {
    lines.push(
      `- ${model.name} (${model.params}, ${model.quantization})`,
      `  Fit: ${model.fit}`,
      `  Needs: ${model.minimumRamGb}-${model.recommendedRamGb}+ GB RAM`,
      `  Notes: ${model.notes}`,
      ""
    );
  }

  return lines.join("\n").trimEnd();
}

export async function loadRecommendations(options = {}) {
  const profile = getSystemProfile(options.profileOverrides);
  const registryInfo = await loadModelRegistry(options.registryOptions);
  const recommendations = recommendModels(profile, registryInfo.models);

  return {
    profile,
    registryInfo,
    recommendations
  };
}
