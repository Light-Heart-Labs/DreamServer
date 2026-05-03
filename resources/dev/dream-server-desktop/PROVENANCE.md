# Dream Server DESKTOP Provenance

This document records the source and packaging status for vendored or referenced
third-party material in `resources/dev/dream-server-desktop`.

## Packaging Policy

Electron artifacts are built from an explicit allowlist in `package.json`.
Development reference snapshots may be present in `vendor/`, but they are not
included in packaged builds unless the allowlist names their subtree.

Current packaged vendor allowlist:

- `vendor/hermes-agent/**/*`

Current excluded reference snapshots:

- `vendor/aperant-upstream/**/*`
- `vendor/browser-harness/**/*`
- `vendor/browser-harness-upstream/**/*`
- `vendor/ghostty-cursor-shaders/**/*`
- `vendor/ghostty-shader-playground/**/*`
- `vendor/hermes-ios-panel-plugin/**/*`

## Runtime Base

Dream Server DESKTOP's runtime is the local Electron/Node implementation under
`app-main.js`, `preload.js`, `src/`, and `runtime/`, plus Hermes Agent through
the bridge under `runtime/hermes`.

The workbench and Kanban views were adapted for Dream Server DESKTOP and route
through Dream/Hermes runtime actions. The desktop app does not execute from the
desktop workbench reference snapshot.

## Third-Party Source Records

### Hermes Agent

- Path: `vendor/hermes-agent`
- License: MIT
- Role: packaged runtime dependency used by `runtime/hermes`
- Notice: `THIRD_PARTY_NOTICES.md`

### Desktop Workbench Reference Snapshot

- Path: `vendor/aperant-upstream`
- License: AGPL-3.0
- Role: development reference snapshot for visual/product patterns only
- Packaged: no
- Notice: `THIRD_PARTY_NOTICES.md`

### Browser Harness References

- Paths: `vendor/browser-harness`, `vendor/browser-harness-upstream`
- Role: development reference snapshots for browser-control behavior
- Packaged: no
- Notice: `THIRD_PARTY_NOTICES.md`

### Ghostty Shader References

- Paths: `vendor/ghostty-cursor-shaders`, `vendor/ghostty-shader-playground`
- Role: provenance/reference for selected shader files copied under
  `src/shaders/ghostty`
- Packaged: selected files under `src/shaders/ghostty`
- Notice: `THIRD_PARTY_NOTICES.md` and `src/shaders/ghostty/LICENSES.md`
