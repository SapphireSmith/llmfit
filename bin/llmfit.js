#!/usr/bin/env node

import { formatRecommendations, getSystemProfile, recommendModels } from "../src/index.js";

const command = process.argv[2] ?? "check";

if (!["check", "run"].includes(command)) {
  console.error(`Unknown command "${command}". Use "llmfit check" or "llmfit run".`);
  process.exit(1);
}

const profile = getSystemProfile();
const recommendations = recommendModels(profile);

console.log(formatRecommendations(profile, recommendations));
