const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  cyan: "\u001B[36m",
  blue: "\u001B[34m",
  green: "\u001B[32m",
  yellow: "\u001B[33m",
  red: "\u001B[31m"
};

function supportsColor(stream) {
  return Boolean(stream?.isTTY) && process.env.NO_COLOR === undefined;
}

function colorize(text, color, enabled) {
  if (!enabled) {
    return text;
  }

  return `${ANSI[color]}${text}${ANSI.reset}`;
}

function emphasize(text, enabled) {
  if (!enabled) {
    return text;
  }

  return `${ANSI.bold}${text}${ANSI.reset}`;
}

function dim(text, enabled) {
  if (!enabled) {
    return text;
  }

  return `${ANSI.dim}${text}${ANSI.reset}`;
}

function formatSourceText(registryInfo) {
  if (registryInfo.source === "live") {
    return "Live registry";
  }

  if (registryInfo.source === "cache") {
    const stamp = typeof registryInfo.fetchedAt === "string"
      ? registryInfo.fetchedAt.slice(0, 10)
      : "unknown date";

    return `Cached registry (${stamp})`;
  }

  return "Built-in fallback catalog";
}

function getFitColor(fit) {
  if (fit === "Recommended") {
    return "green";
  }

  if (fit === "Possible") {
    return "yellow";
  }

  return "red";
}

export function formatProfileBlock(profile, { colorEnabled = false } = {}) {
  const lines = [
    emphasize("LLMFit local model check", colorEnabled),
    "",
    `${colorize("Platform", "cyan", colorEnabled)}: ${profile.platform} (${profile.arch})`,
    `${colorize("CPU", "cyan", colorEnabled)}: ${profile.cpuModel}`,
    `${colorize("Threads", "cyan", colorEnabled)}: ${profile.cpuThreads}`,
    `${colorize("RAM", "cyan", colorEnabled)}: ${profile.totalRamGb} GB total, ${profile.freeRamGb} GB free`
  ];

  if (Array.isArray(profile.gpus) && profile.gpus.length > 0) {
    if (profile.gpus.length === 1) {
      const gpu = profile.gpus[0];
      const vramText = gpu.vramGb !== null ? ` (${gpu.vramGb} GB VRAM)` : "";
      lines.push(`${colorize("GPU", "cyan", colorEnabled)}: ${gpu.model}${vramText}`);
    } else {
      profile.gpus.forEach((gpu, index) => {
        const vramText = gpu.vramGb !== null ? ` (${gpu.vramGb} GB VRAM)` : "";
        lines.push(`${colorize(`GPU ${index + 1}`, "cyan", colorEnabled)}: ${gpu.model}${vramText}`);
      });
    }
  } else {
    lines.push(`${colorize("GPU", "cyan", colorEnabled)}: None detected`);
  }

  for (const note of profile.environmentNotes ?? []) {
    lines.push(`${colorize("Note", "yellow", colorEnabled)}: ${note}`);
  }

  return lines.join("\n");
}

export function formatModelResults(profile, recommendations, registryInfo, { colorEnabled = false } = {}) {
  const lines = [
    `${colorize("Source", "blue", colorEnabled)}: ${formatSourceText(registryInfo)}`
  ];

  if (recommendations.length === 0) {
    lines.push("");
    lines.push("No suitable models found for this machine.");
    lines.push(dim("Try a smaller model, more memory, or a cloud-hosted option.", colorEnabled));
    return lines.join("\n");
  }

  lines.push("");
  lines.push(emphasize("Suitable models", colorEnabled));
  lines.push("");

  for (const model of recommendations) {
    const sizeText = model.sizeGb ? `, ${model.sizeGb} GB` : "";
    lines.push(
      `- ${model.name} ${dim(`(${model.params}, ${model.quantization}${sizeText})`, colorEnabled)}`,
      `  ${colorize("Fit", getFitColor(model.fit), colorEnabled)}: ${model.fit}`,
      `  ${colorize("Needs", "cyan", colorEnabled)}: ${model.minimumRamGb}-${model.recommendedRamGb}+ GB RAM`
    );
    if (model.sourceUrl) {
      lines.push(`  ${colorize("Link", "cyan", colorEnabled)}: ${model.sourceUrl}`);
    }
    lines.push(
      `  ${colorize("Notes", "cyan", colorEnabled)}: ${model.notes}`,
      ""
    );
  }

  return lines.join("\n").trimEnd();
}

export function formatStatusMessage(status, { colorEnabled = false } = {}) {
  switch (status.type) {
    case "fetching-live":
      return colorize("Checking available models from the live registry...", "blue", colorEnabled);
    case "using-cache":
      return colorize("Live fetch unavailable. Using cached model registry...", "yellow", colorEnabled);
    case "using-builtin":
      return colorize("Live and cached data unavailable. Using built-in model catalog...", "yellow", colorEnabled);
    case "live-ready":
      return colorize("Found live model matches for this machine.", "green", colorEnabled);
    case "cache-ready":
      return colorize("Loaded model matches from cache.", "green", colorEnabled);
    case "builtin-ready":
      return colorize("Loaded model matches from the built-in catalog.", "green", colorEnabled);
    default:
      return status.message ?? "";
  }
}

export function createCliReporter({
  stdout = process.stdout,
  stderr = process.stderr,
  colorEnabled = supportsColor(stdout)
} = {}) {
  const interactive = Boolean(stdout?.isTTY);
  const spinnerFrames = ["|", "/", "-", "\\"];
  let spinnerTimer = null;
  let spinnerIndex = 0;
  let spinnerText = "";

  function writeLine(text = "") {
    stdout.write(`${text}\n`);
  }

  function clearSpinner() {
    if (interactive && spinnerTimer !== null) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
      stdout.write("\r\x1b[2K");
    }
  }

  function renderSpinnerFrame() {
    const frame = spinnerFrames[spinnerIndex % spinnerFrames.length];
    spinnerIndex += 1;
    stdout.write(`\r${colorize(frame, "blue", colorEnabled)} ${spinnerText}`);
  }

  return {
    colorEnabled,
    printIntro(profile) {
      writeLine(formatProfileBlock(profile, { colorEnabled }));
      writeLine("");
    },
    startStatus(status) {
      spinnerText = formatStatusMessage(status, { colorEnabled });

      if (!interactive) {
        writeLine(spinnerText);
        return;
      }

      clearSpinner();
      renderSpinnerFrame();
      spinnerTimer = setInterval(renderSpinnerFrame, 80);
    },
    updateStatus(status) {
      const text = formatStatusMessage(status, { colorEnabled });

      if (!interactive) {
        writeLine(text);
        return;
      }

      spinnerText = text;
    },
    finishStatus(status) {
      const text = formatStatusMessage(status, { colorEnabled });
      clearSpinner();
      writeLine(text);
      writeLine("");
    },
    printResults(profile, recommendations, registryInfo) {
      writeLine(formatModelResults(profile, recommendations, registryInfo, { colorEnabled }));
    },
    printError(message) {
      clearSpinner();
      stderr.write(`${colorize(message, "red", colorEnabled)}\n`);
    }
  };
}
