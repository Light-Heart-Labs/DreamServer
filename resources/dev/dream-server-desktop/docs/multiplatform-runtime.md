# Dream Server — Multiplatform Runtime Guide

## Overview

The app bundles two types of native runtimes:

| Runtime | Used for | Directory |
|---|---|---|
| Python bootstrap + venv | Hermes Agent subprocess | `resources/python/<platform-key>/` + `.venv-hermes/` or `userData/hermes/.venv-hermes/` |
| llama.cpp server | Local LLM inference | `bin/llama/<platform-key>/` |

**Platform keys** (canonical naming):

| OS | Arch | Key |
|---|---|---|
| macOS Apple Silicon | arm64 | `darwin-arm64` |
| macOS Intel | x64 | `darwin-x64` |
| Windows | x64 | `win32-x64` |
| Linux | x64 | `linux-x64` |

---

## Runtime Resolver

**`runtime/platform/runtime-resolver.js`** is the single source of truth for
platform detection and runtime path resolution. It:

- Reads `process.platform` and `process.arch`
- Works in all three deployment modes (Electron desktop, CLI, gRPC server)
- Handles both dev mode (source tree) and packaged mode (`app.asar.unpacked`)
- Checks canonical directory names first, then falls back to legacy aliases

### API

```js
const resolver = require("./runtime/platform/runtime-resolver");

resolver.PLATFORM_KEY        // e.g. "darwin-arm64"
resolver.appRoot()           // absolute project/app root (asar-aware)
resolver.isPackaged()        // true inside a packaged Electron app

resolver.pythonCandidates()  // ordered list of Python interpreter candidates
resolver.llamaBinaryPath()   // absolute path to llama-server (or "")
resolver.llamaRuntimeDir()   // directory containing the llama binary
resolver.llamaDllDirs()      // Windows-only: dirs containing CUDA/ggml DLLs
resolver.runtimeDiagnostics() // full snapshot for logs / --doctor output
```

---

## Directory Structure

### llama.cpp binaries

```
bin/
  llama/
    mac-arm64/          ← macOS Apple Silicon (canonical: darwin-arm64)
      llama-server
      libggml*.dylib
      ...
    cuda-12.4/          ← Windows x64 CUDA (canonical: win32-x64)
      llama-server.exe
      *.dll
      ...
    linux-x86_64/       ← Linux x64 (canonical: linux-x64)  [add when available]
      llama-server
      ...
    mac-x86_64/         ← macOS Intel  [add when available]
      llama-server
      ...
```

The resolver checks for both canonical names (e.g. `darwin-arm64`) and legacy
names (e.g. `mac-arm64`). Both work — you don't need to rename existing dirs.

### Python bootstrap + venv

```
resources/
  python/
    darwin-arm64/
      python/bin/python3
    darwin-x64/
      python/bin/python3
    linux-x64/
      python/bin/python3
    win32-x64/
      python/python.exe
```

At runtime, Dream Server creates a platform-specific Hermes venv:

```text
dev:       .venv-hermes/
packaged:  <userData>/hermes/.venv-hermes/
```

---

## Building for Each Platform

### Prerequisites

| Platform | Requirement |
|---|---|
| All | `npm install` |
| Dev shells | Run `npm run download:python && npm run setup:hermes` if you want a local venv without depending on system Python |
| Packaged apps | `npm run pack` / `npm run dist:*` downloads the standalone Python automatically |

### Build commands

```bash
# Current platform (auto-detect)
npm run dist

# macOS — produces arm64 + x64 DMG and ZIP
npm run dist:mac

# macOS arm64 only
npm run dist:mac-arm64

# macOS Intel only
npm run dist:mac-x64

# Windows portable EXE
npm run dist:win

# Linux AppImage + deb
npm run dist:linux

# All platforms (requires running on each OS, or a CI matrix)
npm run dist:all
```

### What each build includes

Each platform build **excludes** the other platforms' llama binaries via
platform-specific `files` overrides in `package.json` (`build.mac.files`,
`build.win.files`, `build.linux.files`). This keeps build artifacts lean.

The Hermes venv is no longer bundled as a prebuilt directory. Instead, the app
ships a read-only standalone Python and creates the writable venv on first use.

---

## Adding a New Runtime Platform

### 1. llama.cpp for a new OS/arch

1. Download or build llama-server for the target platform.
2. Place binary and shared libraries in:
   ```
   bin/llama/<canonical-platform-key>/
   ```
   e.g. `bin/llama/linux-x64/llama-server`
3. Mark the binary as executable on Unix:
   ```bash
   chmod +x bin/llama/linux-x64/llama-server
   ```
4. Add an exclusion in `package.json` for all other platforms so the new dir
   isn't bundled into unrelated builds.
5. No resolver changes needed — it already checks canonical keys.

### 2. Python runtime for a new OS

Add a `python-build-standalone` archive mapping in
`scripts/download-python.js`, then wire the target into the build scripts if
needed. The Hermes venv will still be created lazily on first use.

---

## Dev vs Packaged Mode

| Mode | Python source | llama binary source |
|---|---|---|
| Dev (`npm start`) | `.venv-hermes/` in source tree, optionally bootstrapped from `resources/python/<platform-key>/` | `bin/llama/<platform>/` in source tree |
| Packaged | `app.asar.unpacked/resources/python/<platform-key>/` + `userData/hermes/.venv-hermes/` | `app.asar.unpacked/bin/llama/<platform>/` |

The resolver transparently handles both via `appRoot()`, which strips `app.asar`
from the path and appends `.unpacked` when necessary.

Override Python in any mode:

```bash
DREAM_HERMES_PYTHON=/path/to/python3 npm start
```

---

## Troubleshooting

### "Hermes Agent nao encontrado" / Python not detected

Run the built-in doctor:

```js
const { runtimeDiagnostics } = require("./runtime/platform/runtime-resolver");
console.log(JSON.stringify(runtimeDiagnostics(), null, 2));
```

This prints every candidate path and whether it exists.

Common fixes:
- Run `npm run download:python && npm run setup:hermes` to create the venv locally
- Set `DREAM_HERMES_PYTHON` to point to your Python interpreter

### "llama-server nao encontrado"

- Ensure `bin/llama/<your-platform>/llama-server[.exe]` exists
- Run `runtimeDiagnostics()` to see what the resolver found
- Check file permissions on Unix: `chmod +x bin/llama/linux-x64/llama-server`

### Windows: CUDA DLL load failure

The resolver's `llamaDllDirs()` returns the DLL-containing directories, which
are prepended to `PATH` before spawning `llama-server.exe`. If DLLs still can't
be found, verify the `.dll` files are in `bin/llama/cuda-12.4/` (or your
canonical `win32-x64/` dir).

### macOS: "cannot be opened because the developer cannot be verified"

After download or after running `git lfs pull`:

```bash
xattr -cr bin/llama/mac-arm64/
```

---

## CI / Automated Builds

Since Electron apps must be built on their target OS, use a matrix strategy:

```yaml
# Example GitHub Actions matrix
strategy:
  matrix:
    include:
      - os: macos-latest
        run: npm run dist:mac
      - os: windows-latest
        run: npm run dist:win
      - os: ubuntu-latest
        run: npm run dist:linux
```

Each runner only has its own platform's Python and llama binaries available, so
the resulting artifacts are automatically lean.
