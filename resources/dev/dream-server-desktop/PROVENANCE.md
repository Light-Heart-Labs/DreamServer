# Dream Server Desktop Provenance

This document records why third-party source lives under
`resources/dev/dream-server-desktop` and what is intentionally excluded from the
repository.

## Packaging Policy

The Electron app is built from the explicit `package.json` allowlist. Local
machine artifacts are excluded from Git and from the packaged app:

- `node_modules/`
- `.venv-hermes/`
- `bin/llama/`
- local models such as `*.gguf`
- generated Electron build outputs

Hermes Python dependencies are recreated with `npm run setup:hermes` after clone.
The local llama.cpp server is optional; users can place a compatible
`llama-server` under `bin/llama` or point Settings to any OpenAI-compatible
endpoint.

## Runtime Base

The desktop runtime is implemented in:

- `app-main.js`
- `preload.js`
- `src/`
- `runtime/`
- `scripts/`

The app integrates Hermes Agent through the bridge under `runtime/hermes`.

## Vendored Source Records

### Hermes Agent

- Path: `vendor/hermes-agent`
- License: MIT
- Role: local agent runtime and tool/provider reference used by `runtime/hermes`
- Packaging: included by the Electron build allowlist
- Notice: `THIRD_PARTY_NOTICES.md`

### Browser Harness

- Path: `vendor/browser-harness-upstream`
- License: MIT
- Role: browser-harness-compatible support material for Workbench browser tooling
- Packaging: included by the Electron build allowlist
- Notice: `THIRD_PARTY_NOTICES.md`

### Hermes iOS Panel Plugin

- Path: `vendor/hermes-ios-panel-plugin`
- License: upstream plugin source
- Role: optional local plugin material used during desktop development
- Packaging: included by the Electron build allowlist

### Ghostty Shader References

- Sources: `https://github.com/sahaj-b/ghostty-cursor-shaders` and
  `https://github.com/KroneCorylus/ghostty-shader-playground`
- Role: provenance for selected shader files copied under `src/shaders/ghostty`
- Packaging: only selected shader files under `src/shaders/ghostty`
- Notice: `THIRD_PARTY_NOTICES.md` and `src/shaders/ghostty/LICENSES.md`
