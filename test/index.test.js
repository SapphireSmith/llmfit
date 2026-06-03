import test from "node:test";
import assert from "node:assert/strict";
import { formatRecommendations, recommendModels } from "../src/index.js";

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
      freeRamGb: 10
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
    ]
  );

  assert.match(output, /LLMFit local model check/);
  assert.match(output, /Model A/);
});
