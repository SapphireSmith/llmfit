#!/usr/bin/env node

import { formatRecommendations, getSystemProfile, loadRecommendations } from "../src/index.js";
import { createCliReporter } from "../src/cli-ui.js";
import { detectGpus } from "../src/gpu.js";

const args = process.argv.slice(2);
const hasHelpFlag = args.includes("--help") || args.includes("-h") || args[0] === "help";
const hasJsonFlag = args.includes("--json");
const reporter = createCliReporter({ jsonMode: hasJsonFlag });

if (hasHelpFlag) {
  reporter.printHelp();
  process.exit(0);
}

const command = args[0] ?? "check";

if (!["check", "run"].includes(command)) {
  console.error(`Unknown command "${command}". Use "llmfit check".`);
  process.exit(1);
}

if (command === "run") {
  console.warn(`[Warning] The "run" command is deprecated. Please use "check" or run "llmfit" without arguments.`);
}

const hasStaticFlag = args.includes("--static") || args.includes("--no-interactive");

try {
  const useInteractive = !hasJsonFlag && !hasStaticFlag;

  const profile = getSystemProfile();
  profile.gpus = await detectGpus({ platform: profile.platform });

  if (useInteractive) {
    reporter.printIntro(profile);
  }

  const { registryInfo, recommendations } = await loadRecommendations({
    profile,
    registryOptions: {
      onStatus(status) {
        if (!useInteractive) return;
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
  } else if (useInteractive) {
    reporter.printResults(profile, recommendations, registryInfo);
  } else {
    console.log(formatRecommendations(profile, recommendations, registryInfo));
  }
} catch (error) {
  reporter.printError(`Unable to load model recommendations: ${error.message}`);
  process.exit(1);
}
