import os from "node:os";
import { MODEL_CATALOG } from "./catalog.js";

function bytesToGb(bytes) {
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}

export function getSystemProfile() {
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? "Unknown CPU",
    cpuThreads: os.cpus().length,
    totalRamGb: bytesToGb(os.totalmem()),
    freeRamGb: bytesToGb(os.freemem())
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

export function recommendModels(profile) {
  const ranked = MODEL_CATALOG.map((model) => ({
    ...model,
    fit: getFitLabel(model, profile.totalRamGb)
  }))
    .filter((model) => model.fit !== "Too large")
    .sort((left, right) => left.minimumRamGb - right.minimumRamGb);

  return ranked;
}

export function formatRecommendations(profile, recommendations) {
  const lines = [
    "LLMFit local model check",
    "",
    `Platform: ${profile.platform} (${profile.arch})`,
    `CPU: ${profile.cpuModel}`,
    `Threads: ${profile.cpuThreads}`,
    `RAM: ${profile.totalRamGb} GB total, ${profile.freeRamGb} GB free`,
    ""
  ];

  if (recommendations.length === 0) {
    lines.push("No matches found in the starter catalog for this machine.");
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
