#!/usr/bin/env node

import { formatRecommendations, loadRecommendations } from "../src/index.js";

const command = process.argv[2] ?? "check";

if (!["check", "run"].includes(command)) {
  console.error(`Unknown command "${command}". Use "llmfit check" or "llmfit run".`);
  process.exit(1);
}

try {
  const { profile, registryInfo, recommendations } = await loadRecommendations();
  console.log(formatRecommendations(profile, recommendations, registryInfo));
} catch (error) {
  console.error(`Unable to load model recommendations: ${error.message}`);
  process.exit(1);
}
