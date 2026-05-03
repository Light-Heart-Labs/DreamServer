# Dream Server DESKTOP

Dream Server DESKTOP is the Electron desktop source tree for the local-first
Dream Server shell. It packages the renderer, Node runtime, Hermes Agent vendor
source, CLI, gRPC server, and build scripts needed to create installable desktop
artifacts.

This directory is source-first by design. It does not commit `node_modules`,
compiled Electron output, Python virtual environments, GGUF models, or
platform-specific llama.cpp binaries.

## What is included

- Electron shell: `app-main.js`, `preload.js`, `src/`
- Shared runtime: `runtime/`
- CLI entrypoint: `bin/dream.js`
- gRPC entrypoint: `runtime/grpc-server.js`
- Browser harness support: `vendor/browser-harness-upstream/`
- Hermes Agent vendor source: `vendor/hermes-agent/`
- Desktop build scripts: `scripts/`

## Requirements

- Node.js 20 or newer
- npm
- `tar` available on PATH
- Internet access when downloading standalone Python runtimes

For a fully local LLM, run an OpenAI-compatible endpoint such as llama.cpp,
Ollama, LM Studio, or the existing Dream Server local model server, then point
the app at that base URL and model in Settings. Models and llama.cpp builds are
machine-specific, so they are intentionally not versioned here.

## Development

```bash
npm install
npm start
```

The first Electron launch prepares Hermes Agent if the `.venv-hermes` virtual
environment is missing. You can also run the setup explicitly:

```bash
npm run setup:hermes
```

Useful overrides:

- `DREAM_HERMES_PYTHON`: absolute path to a Python interpreter
- `DREAM_HERMES_VENV_DIR`: absolute path for the Hermes virtual environment
- `DREAM_APP_USER_DATA`: test-only user-data directory override
- `HERMES_GIT_BASH_PATH`: Git Bash path on Windows when local shell tools need it

## Tests

```bash
npm run test:runtime
```

## Standalone Python Runtime

The desktop builds use python-build-standalone archives and extract them into
`resources/python/<platform>-<arch>/`. These files are generated locally and are
ignored by Git.

Download the runtime for the current platform:

```bash
npm run download:python
```

Download explicit targets:

```bash
npm run download:python:win
npm run download:python:linux
npm run download:python:mac
npm run download:python:all
```

The downloader verifies that the standard library contains `encodings/cp437.py`,
`zipfile.py`, `venv`, and `ensurepip`. On the current host platform it also runs
a Python smoke test. This prevents packaged builds from shipping an incomplete
Python runtime that would later fail in `pip` with errors such as
`LookupError: unknown encoding: cp437`.

## Packaging

Build the unpacked app for the current platform:

```bash
npm run pack
```

Build installable artifacts:

```bash
npm run dist:win
npm run dist:linux
npm run dist:mac
npm run dist:mac-arm64
npm run dist:mac-x64
```

Expected artifacts:

- Windows: portable `.exe`
- Linux: AppImage and `.deb`
- macOS: `.dmg` and `.zip`

`npm run dist:win`, `npm run dist:linux`, and the macOS dist commands download
the matching standalone Python runtime before invoking `electron-builder`.

The packaged desktop app includes the Dream Server DESKTOP source, runtime, UI
assets, Hermes Agent runtime source, and the browser-harness support material
used by Hermes' Workbench browser tooling. Large visual/reference upstream
trees are intentionally not vendored in this repository; provenance is recorded
in `PROVENANCE.md` and selected copied assets retain their local notices.

## Local Models and llama.cpp

This source tree does not include a bundled GGUF model or compiled llama.cpp
server. To use a local model, either:

- configure an OpenAI-compatible endpoint in the desktop Settings screen, or
- place a compatible `llama-server` build under `bin/llama/<platform>-<arch>/`.

The runtime resolver checks canonical platform directories such as
`win32-x64`, `linux-x64`, `darwin-arm64`, and `darwin-x64`, with compatibility
aliases for older local layouts.
