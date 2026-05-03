# Third Party Notices

This directory is a source-first development tree for Dream Server DESKTOP.
Packaged desktop artifacts intentionally include only the runtime source needed
by the app, selected UI assets, and explicitly listed third-party runtime
dependencies. Large development/reference upstream trees are not vendored in
this repository unless they are required by the runtime.

## Hermes Agent

Dream Server DESKTOP uses Hermes Agent through the stdio bridge under
`runtime/hermes`. The packaged desktop app includes `vendor/hermes-agent`
because the runtime imports Hermes' own `AIAgent` and supporting Python modules
rather than reimplementing the agent loop in Electron.

License: MIT

Copyright (c) 2025 Nous Research

Full license text: `vendor/hermes-agent/LICENSE`

## Browser Harness

Dream Server DESKTOP includes `vendor/browser-harness-upstream` so Hermes'
browser tool fallback can retain the same browser-harness-compatible workbench
skill/runtime material as the current desktop build.

License: MIT

Copyright (c) 2026 Browser Use

Full license text: `vendor/browser-harness-upstream/LICENSE`

## Ghostty Shaders

The code workbench shader controls use selected GLSL shader files copied under
`src/shaders/ghostty`.

Sources:

- https://github.com/KroneCorylus/ghostty-shader-playground
- https://github.com/sahaj-b/ghostty-cursor-shaders

License: MIT, as documented in `src/shaders/ghostty/LICENSES.md`.

## JetBrains Mono

The code workbench bundles JetBrains Mono Regular under `src/fonts` for
terminal typography.

License: SIL Open Font License

Full license text: `src/fonts/OFL-JetBrainsMono.txt`
