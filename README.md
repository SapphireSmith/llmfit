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



## TODO

- [x] Support `llmfit --help`, `llmfit -h`, and `llmfit help` to display a styled command usage guide.
- [x] Unify `check` and `run` CLI logic so that `check` (default) is the single unified diagnostics and recommendation tool.
- [ ] Support `--offline` / `--local` flags to bypass live fetches and load recommendations instantly.
- [ ] Support `--simulate-ram <gb>` and `--simulate-vram <gb>` overrides to test future hardware configurations.
- [ ] Add `llmfit system` command to output only the hardware diagnostic profile.
- [ ] Add `llmfit models` command to list all models from the catalog/registry with color-coded fit status.
- [ ] Add `llmfit explain <model-query>` to show a detailed compatibility explanation for a specific model.
