# llmfit

`llmfit` is a tiny npm library and CLI that checks a user's machine specs and suggests open-source LLMs that are likely to run locally.

## Why this name

- Repo name: `llmfit`
- Folder name: `llmfit`
- CLI: `llmfit check`

It is short, easy to remember, and matches the main idea: find the right model fit for a machine.

## What it does right now

- Reads OS, CPU, thread count, and RAM
- Uses a small built-in catalog of free/open-source models
- Recommends models using simple RAM-based rules
- Supports `check` and `run` as starter CLI commands

## Install locally while developing

```bash
npm link
llmfit check
```

Or run it directly:

```bash
npm run check
```

## Example output

```text
LLMFit local model check

Platform: win32 (x64)
CPU: Example CPU
Threads: 8
RAM: 16 GB total, 9.4 GB free

Suggested open-source models:

- Llama 3.1 8B Instruct (8B, Q4_K_M)
  Fit: Recommended
  Needs: 12-16+ GB RAM
  Notes: Popular balance of quality and local usability for many laptops and desktops.
```

## Next good steps TODO

1. Add GPU and VRAM detection.
2. Expand the model catalog with source links and sizes.
3. Add output formats like JSON for app integrations.
4. Add provider-specific recommendations for Ollama, LM Studio, or llama.cpp.
