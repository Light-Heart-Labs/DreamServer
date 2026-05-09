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

## Snapshot Source

This tree was refreshed from the local Dream Server Hermes workspace at
`C:\Users\Gabriel\Documents\Playground\dream-server-hermes` on 2026-05-09.

The vendored directories below are source snapshots used by this desktop
runtime. Their original `.git` metadata is not committed. Reference upstream
HEADs checked during this refresh:

- `https://github.com/NousResearch/hermes-agent.git`:
  `f1f42a7b9ffa83749f725cfdf76b121779859914`
- `https://github.com/browser-use/browser-harness.git`:
  `0e679e2c56bdc4add10befaada4674b85882e3a6`
- `https://github.com/sahaj-b/ghostty-cursor-shaders.git`:
  `06d4e90fb5410e9c4d0b3131584060adddf89406`
- `https://github.com/KroneCorylus/ghostty-shader-playground.git`:
  `7295ebf717f236f114912ec5de0d8ce91661448f`

If maintainers want byte-for-byte upstream traceability, this directory should
move to a submodule/subtree or artifact repository decision instead of a copied
snapshot.

## Vendored Source Records

### Hermes Agent

- Path: `vendor/hermes-agent`
- Upstream: `https://github.com/NousResearch/hermes-agent.git`
- License: MIT
- Role: local agent runtime and tool/provider reference used by `runtime/hermes`
- Packaging: included by the Electron build allowlist
- Notice: `THIRD_PARTY_NOTICES.md`

### Browser Harness

- Path: `vendor/browser-harness-upstream`
- Upstream: `https://github.com/browser-use/browser-harness.git`
- License: MIT
- Role: browser-harness-compatible support material for Workbench browser tooling
- Packaging: included by the Electron build allowlist
- Notice: `THIRD_PARTY_NOTICES.md`

### Hermes iOS Panel Plugin

- Path: `vendor/hermes-ios-panel-plugin`
- Source: local Dream Server Hermes plugin snapshot
- License: local plugin source
- Role: optional local plugin material used during desktop development
- Packaging: included by the Electron build allowlist

### Ghostty Shader References

- Sources: `https://github.com/sahaj-b/ghostty-cursor-shaders` and
  `https://github.com/KroneCorylus/ghostty-shader-playground`
- Role: provenance for selected shader files copied under `src/shaders/ghostty`
- Packaging: only selected shader files under `src/shaders/ghostty`
- Notice: `THIRD_PARTY_NOTICES.md` and `src/shaders/ghostty/LICENSES.md`
