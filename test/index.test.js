import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { formatRecommendations, loadRecommendations, recommendModels, detectRuntimeEnvironment } from "../src/index.js";
import { createCliReporter, formatModelResults, formatProfileBlock, formatStatusMessage, formatHelpMenu } from "../src/cli-ui.js";
import { detectGpus } from "../src/gpu.js";
import {
  fetchLiveRegistry,
  getCacheFilePath,
  inferRamRequirements,
  normalizeRemoteModel,
  parseParameterCount,
  estimateModelSizeGb,
  extractSizeGb
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
  assert.equal(normalized?.sizeGb, 2.2);
  assert.deepEqual(normalized?.runtimeTags, ["gguf", "llama.cpp", "ollama", "lm-studio"]);
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

test("detectGpus parses nvidia-smi correctly", async () => {
  const mockExec = async (cmd) => {
    if (cmd.startsWith("nvidia-smi")) {
      return { stdout: "NVIDIA GeForce RTX 4090, 24576\nNVIDIA GeForce RTX 3080, 10240\n" };
    }
    throw new Error("command not found");
  };
  const gpus = await detectGpus({ platform: "linux", execImpl: mockExec });
  assert.equal(gpus.length, 2);
  assert.equal(gpus[0].model, "NVIDIA GeForce RTX 4090");
  assert.equal(gpus[0].vramGb, 24);
  assert.equal(gpus[1].model, "NVIDIA GeForce RTX 3080");
  assert.equal(gpus[1].vramGb, 10);
});

test("detectGpus parses Windows PowerShell CIM output", async () => {
  const mockExec = async (cmd) => {
    if (cmd.startsWith("nvidia-smi")) {
      throw new Error("command not found");
    }
    if (cmd.includes("Get-CimInstance")) {
      return {
        stdout: JSON.stringify([
          { Name: "Intel(R) Iris(R) Xe Graphics", AdapterRAM: 1073741824 },
          { Name: "NVIDIA GeForce GTX 1650", AdapterRAM: 4294967295 }
        ])
      };
    }
    throw new Error("unexpected command");
  };
  const gpus = await detectGpus({ platform: "win32", execImpl: mockExec });
  assert.equal(gpus.length, 2);
  assert.equal(gpus[0].model, "Intel(R) Iris(R) Xe Graphics");
  assert.equal(gpus[0].vramGb, 1);
  assert.equal(gpus[1].model, "NVIDIA GeForce GTX 1650");
  assert.equal(gpus[1].vramGb, null);
});

test("detectGpus parses macOS system_profiler output", async () => {
  const mockExec = async (cmd) => {
    if (cmd.startsWith("nvidia-smi")) {
      throw new Error("command not found");
    }
    if (cmd.includes("system_profiler")) {
      return {
        stdout: JSON.stringify({
          SPDisplaysDataType: [
            { sppci_model: "Apple M2 Max", spdisplays_vram_shared: "96 GB" },
            { _name: "External Radeon RX 580", spdisplays_vram: "8 GB" }
          ]
        })
      };
    }
    throw new Error("unexpected command");
  };
  const gpus = await detectGpus({ platform: "darwin", execImpl: mockExec });
  assert.equal(gpus.length, 2);
  assert.equal(gpus[0].model, "Apple M2 Max");
  assert.equal(gpus[0].vramGb, 96);
  assert.equal(gpus[1].model, "External Radeon RX 580");
  assert.equal(gpus[1].vramGb, 8);
});

test("detectGpus parses Linux lspci -mm output", async () => {
  const mockExec = async (cmd) => {
    if (cmd.startsWith("nvidia-smi")) {
      throw new Error("command not found");
    }
    if (cmd.includes("lspci")) {
      return {
        stdout: '00:02.0 "VGA compatible controller" "Intel Corporation" "UHD Graphics" -r02 "Dell" "Device 09a6"\n' +
                '01:00.0 "3D controller" "NVIDIA Corporation" "GA106M [GeForce RTX 3060 Mobile]" -ra1\n'
      };
    }
    throw new Error("unexpected command");
  };
  const gpus = await detectGpus({ platform: "linux", execImpl: mockExec });
  assert.equal(gpus.length, 2);
  assert.equal(gpus[0].model, "Intel Corporation UHD Graphics");
  assert.equal(gpus[0].vramGb, null);
  assert.equal(gpus[1].model, "NVIDIA Corporation GA106M [GeForce RTX 3060 Mobile]");
  assert.equal(gpus[1].vramGb, null);
});

test("formatRecommendations includes GPU information", () => {
  const outputSingle = formatRecommendations(
    {
      platform: "win32",
      arch: "x64",
      cpuModel: "Test CPU",
      cpuThreads: 8,
      totalRamGb: 16,
      freeRamGb: 10,
      environmentNotes: [],
      gpus: [{ model: "Intel(R) Iris(R) Xe Graphics", vramGb: 1 }]
    },
    [],
    { source: "live" }
  );
  assert.match(outputSingle, /GPU: Intel\(R\) Iris\(R\) Xe Graphics \(1 GB VRAM\)/);

  const outputNone = formatRecommendations(
    {
      platform: "win32",
      arch: "x64",
      cpuModel: "Test CPU",
      cpuThreads: 8,
      totalRamGb: 16,
      freeRamGb: 10,
      environmentNotes: [],
      gpus: []
    },
    [],
    { source: "live" }
  );
  assert.match(outputNone, /GPU: None detected/);

  const outputMultiple = formatRecommendations(
    {
      platform: "win32",
      arch: "x64",
      cpuModel: "Test CPU",
      cpuThreads: 8,
      totalRamGb: 16,
      freeRamGb: 10,
      environmentNotes: [],
      gpus: [
        { model: "Intel GPU", vramGb: 1 },
        { model: "NVIDIA GPU", vramGb: 16 }
      ]
    },
    [],
    { source: "live" }
  );
  assert.match(outputMultiple, /GPU 1: Intel GPU \(1 GB VRAM\)/);
  assert.match(outputMultiple, /GPU 2: NVIDIA GPU \(16 GB VRAM\)/);
});

test("formatProfileBlock includes colorized/non-colorized GPU details", () => {
  const outputNoColor = formatProfileBlock({
    platform: "win32",
    arch: "x64",
    cpuModel: "Test CPU",
    cpuThreads: 8,
    totalRamGb: 16,
    freeRamGb: 10,
    environmentNotes: [],
    gpus: [{ model: "NVIDIA RTX 4090", vramGb: 24 }]
  }, { colorEnabled: false });

  assert.match(outputNoColor, /GPU: NVIDIA RTX 4090 \(24 GB VRAM\)/);

  const outputColor = formatProfileBlock({
    platform: "win32",
    arch: "x64",
    cpuModel: "Test CPU",
    cpuThreads: 8,
    totalRamGb: 16,
    freeRamGb: 10,
    environmentNotes: [],
    gpus: [{ model: "NVIDIA RTX 4090", vramGb: 24 }]
  }, { colorEnabled: true });

  assert.match(outputColor, /GPU/);
  assert.match(outputColor, /NVIDIA RTX 4090/);
});

test("estimateModelSizeGb maps parameter bands accurately", () => {
  assert.equal(estimateModelSizeGb(0.5), 0.4);
  assert.equal(estimateModelSizeGb(1), 0.8);
  assert.equal(estimateModelSizeGb(1.5), 1.1);
  assert.equal(estimateModelSizeGb(3), 2.2);
  assert.equal(estimateModelSizeGb(8), 4.9);
  assert.equal(estimateModelSizeGb(14), 8.5);
  assert.equal(estimateModelSizeGb(20), 11.3);
});

test("extractSizeGb extracts from matching sibling", () => {
  const model = {
    siblings: [
      { rfilename: "model-Q4_K_M.gguf", size: 2147483648 },
      { rfilename: "model-Q8_0.gguf", size: 4294967296 }
    ]
  };
  assert.equal(extractSizeGb(model, "Q4_K_M"), 2.0);
  assert.equal(extractSizeGb(model, "Q8_0"), 4.0);
  assert.equal(extractSizeGb(model, "Q2_K"), 2.0);
});

test("normalizeRemoteModel parses and assigns sizes and links", () => {
  const normalized = normalizeRemoteModel({
    id: "Qwen/Qwen2.5-3B-Instruct-GGUF",
    tags: ["license:apache-2.0", "gguf"],
    siblings: [
      { rfilename: "Qwen2.5-3B-Instruct-Q4_K_M.gguf", size: 2362232012 }
    ]
  });
  assert.equal(normalized?.sizeGb, 2.2);
  assert.equal(normalized?.sourceUrl, "https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF");
});

test("formatRecommendations formatting includes size, link, and providers", () => {
  const output = formatRecommendations(
    {
      platform: "win32",
      arch: "x64",
      cpuModel: "Test CPU",
      cpuThreads: 8,
      totalRamGb: 16,
      freeRamGb: 10,
      environmentNotes: [],
      gpus: []
    },
    [
      {
        name: "Model A",
        params: "7B",
        quantization: "Q4_K_M",
        sizeGb: 4.4,
        minimumRamGb: 12,
        recommendedRamGb: 16,
        fit: "Recommended",
        runtimeTags: ["gguf", "ollama", "lm-studio"],
        sourceUrl: "https://huggingface.co/model-a",
        notes: "Example model"
      }
    ],
    { source: "live" }
  );

  assert.match(output, /Model A \(7B, Q4_K_M, 4.4 GB\)/);
  assert.match(output, /Providers: Ollama, LM Studio/);
  assert.match(output, /Link: https:\/\/huggingface\.co\/model-a/);
});

test("formatModelResults formatting includes size, link, and providers", () => {
  const output = formatModelResults(
    {},
    [
      {
        name: "Model A",
        params: "7B",
        quantization: "Q4_K_M",
        sizeGb: 4.4,
        minimumRamGb: 12,
        recommendedRamGb: 16,
        fit: "Recommended",
        runtimeTags: ["gguf", "ollama", "lm-studio"],
        sourceUrl: "https://huggingface.co/model-a",
        notes: "Example model"
      }
    ],
    { source: "live" },
    { colorEnabled: false }
  );

  assert.match(output, /Model A \(7B, Q4_K_M, 4.4 GB\)/);
  assert.match(output, /Providers: Ollama, LM Studio/);
  assert.match(output, /Link: https:\/\/huggingface\.co\/model-a/);
});

test("createCliReporter in jsonMode routes status logging to stderr and skips intro/results", () => {
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

  const reporter = createCliReporter({ stdout, stderr, colorEnabled: false, jsonMode: true });

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

  assert.equal(stdoutText, "");
  assert.match(stderrText, /Checking available models/);
  assert.match(stderrText, /Found live model matches/);
});

test("formatHelpMenu outputs a formatted help menu", () => {
  const output = formatHelpMenu({ colorEnabled: false });
  assert.match(output, /Usage: llmfit \[command\] \[options\]/);
  assert.match(output, /check\s+Run local hardware diagnostics/);
  assert.match(output, /--json\s+Output response as structured JSON/);
});

test("createCliReporter.printHelp outputs help text in default mode", () => {
  let stdoutText = "";
  const stdout = {
    isTTY: false,
    write(text) {
      stdoutText += text;
    }
  };
  const reporter = createCliReporter({ stdout, colorEnabled: false, jsonMode: false });
  reporter.printHelp();

  assert.match(stdoutText, /Usage: llmfit/);
  assert.match(stdoutText, /check/);
});

test("createCliReporter.printHelp outputs JSON structure in jsonMode", () => {
  let stderrText = "";
  const stderr = {
    isTTY: false,
    write(text) {
      stderrText += text;
    }
  };
  const reporter = createCliReporter({ stderr, colorEnabled: false, jsonMode: true });
  reporter.printHelp();

  const parsed = JSON.parse(stderrText);
  assert.equal(parsed.usage, "llmfit [command] [options]");
  assert.ok(parsed.commands.check);
  assert.ok(parsed.options["--json"]);
});
