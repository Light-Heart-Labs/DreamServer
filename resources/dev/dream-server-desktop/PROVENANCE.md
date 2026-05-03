# Dream Server DESKTOP Provenance

This document records the source and packaging status for vendored or referenced
third-party material in `resources/dev/dream-server-desktop`.

## Packaging Policy

Electron artifacts are built from an explicit allowlist in `package.json`.
Vendored source trees are limited to runtime/support material used by the
desktop app and Hermes browser tooling.

Current packaged vendor allowlist:

- `vendor/browser-harness-upstream/**/*`
- `vendor/hermes-agent/**/*`

Reference-only upstream trees are not committed here. The multiagent workbench
UI was adapted into `src/` and routes through the local Dream/Hermes runtime
actions rather than executing upstream desktop code.

## Runtime Base

Dream Server DESKTOP's runtime is the local Electron/Node implementation under
`app-main.js`, `preload.js`, `src/`, and `runtime/`, plus Hermes Agent through
the bridge under `runtime/hermes`.

The workbench and Kanban views were adapted for Dream Server DESKTOP and route
through Dream/Hermes runtime actions. The desktop app does not execute from a
separate upstream desktop runtime.

## Third-Party Source Records

### Hermes Agent

- Path: `vendor/hermes-agent`
- License: MIT
- Role: packaged runtime dependency used by `runtime/hermes`
- Notice: `THIRD_PARTY_NOTICES.md`

### Browser Harness

- Path: `vendor/browser-harness-upstream`
- License: MIT
- Role: packaged browser-harness-compatible support material for Hermes'
  Workbench browser tooling
- Notice: `THIRD_PARTY_NOTICES.md`

### Ghostty Shader References

- Sources: https://github.com/sahaj-b/ghostty-cursor-shaders and
  https://github.com/KroneCorylus/ghostty-shader-playground
- Role: provenance for selected shader files copied under
  `src/shaders/ghostty`
- Packaged: selected files under `src/shaders/ghostty`
- Notice: `THIRD_PARTY_NOTICES.md` and `src/shaders/ghostty/LICENSES.md`
