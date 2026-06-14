#!/usr/bin/env node

import { formatRecommendations, getSystemProfile, loadRecommendations } from "../src/index.js";
import { createCliReporter } from "../src/cli-ui.js";
import { detectGpus } from "../src/gpu.js";

const command = process.argv[2] ?? "check";

if (!["check", "run"].includes(command)) {
  console.error(`Unknown command "${command}". Use "llmfit check" or "llmfit run".`);
  process.exit(1);
}

const hasJsonFlag = process.argv.includes("--json");
const reporter = createCliReporter({ jsonMode: hasJsonFlag });

try {
  if (command === "run") {
    const profile = getSystemProfile();
    profile.gpus = await detectGpus({ platform: profile.platform });
    reporter.printIntro(profile);

    const { registryInfo, recommendations } = await loadRecommendations({
      profile,
      registryOptions: {
        onStatus(status) {
          if (status.type.endsWith("-ready")) {
            reporter.finishStatus(status);
            return;
          }

          reporter.startStatus(status);
        }
      }
    });

    if (hasJsonFlag) {
      const output = {
        profile,
        registry: {
          source: registryInfo.source,
          fetchedAt: registryInfo.fetchedAt
        },
        recommendations
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      reporter.printResults(profile, recommendations, registryInfo);
    }
  } else {
    const { profile, registryInfo, recommendations } = await loadRecommendations();
    if (hasJsonFlag) {
      const output = {
        profile,
        registry: {
          source: registryInfo.source,
          fetchedAt: registryInfo.fetchedAt
        },
        recommendations
      };
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(formatRecommendations(profile, recommendations, registryInfo));
    }
  }
} catch (error) {
  reporter.printError(`Unable to load model recommendations: ${error.message}`);
  process.exit(1);
}
