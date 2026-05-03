# Third Party Notices

This directory is a source-first development tree for Dream Server DESKTOP.
Packaged desktop artifacts intentionally include only the runtime source needed
by the app, selected UI assets, and explicitly listed third-party runtime
dependencies. Development-only reference snapshots remain in `vendor/` for
provenance and maintainer review, but broad vendor trees are not packaged unless
the `package.json` build allowlist names them.

## Hermes Agent

Dream Server DESKTOP uses Hermes Agent through the stdio bridge under
`runtime/hermes`. The packaged desktop app includes `vendor/hermes-agent`
because the runtime imports Hermes' own `AIAgent` and supporting Python modules
rather than reimplementing the agent loop in Electron.

License: MIT

Copyright (c) 2025 Nous Research

Full license text: `vendor/hermes-agent/LICENSE`

## Desktop Workbench Reference Snapshot

The source tree includes `vendor/aperant-upstream` as a development reference
snapshot for the multiagent workbench visual model: Kanban layout, agent lanes,
review surfaces, and project-workbench interaction patterns. Dream Server
DESKTOP does not use that tree as its runtime base; the runtime path is Hermes
Agent plus the local Dream Server DESKTOP Electron/Node implementation.

License: GNU Affero General Public License v3.0

Full license text: `vendor/aperant-upstream/LICENSE`

Packaging note: `vendor/aperant-upstream` is intentionally excluded from
Electron packaged artifacts by the `build.files` allowlist in `package.json`.

## Browser Harness Reference

The source tree includes browser harness reference snapshots under `vendor/`
for development comparison with the internal Workbench browser-control runtime.
The packaged app uses the local runtime implementation under `runtime/` and does
not package the broad browser-harness vendor snapshots.

Full license texts:

- `vendor/browser-harness/LICENSE`
- `vendor/browser-harness-upstream/LICENSE`

## Ghostty Shaders

The code workbench shader controls use selected GLSL shader files copied under
`src/shaders/ghostty`.

Sources:

- `vendor/ghostty-shader-playground` / https://github.com/KroneCorylus/ghostty-shader-playground
- https://github.com/sahaj-b/ghostty-cursor-shaders

License: MIT, as documented in `src/shaders/ghostty/LICENSES.md`.

## JetBrains Mono

The code workbench bundles JetBrains Mono Regular under `src/fonts` for
terminal typography.

License: SIL Open Font License

Full license text: `src/fonts/OFL-JetBrainsMono.txt`
