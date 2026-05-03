# Third Party Notices

This experimental Dream Server Hermes branch vendors Hermes Agent as an
architecture and implementation reference under `vendor/hermes-agent`.

Hermes Agent is distributed under the MIT License:

Copyright (c) 2025 Nous Research

The full license text is available at:

- `vendor/hermes-agent/LICENSE`

This branch uses Hermes through a stdio bridge under `runtime/hermes`, which
launches the vendored Python runtime and imports Hermes' own `AIAgent` rather
than reimplementing its agent loop inside the Electron renderer.

The code workbench shader controls are inspired by Ghostty shader projects:

- `vendor/ghostty-shader-playground` / https://github.com/KroneCorylus/ghostty-shader-playground
- https://github.com/sahaj-b/ghostty-cursor-shaders

Selected GLSL shader files from those MIT-licensed projects are bundled under
`src/shaders/ghostty` and are wrapped at runtime for the Electron code
workbench's WebGL renderer.

The code workbench also bundles JetBrains Mono Regular under `src/fonts` for
Ghostty-like terminal typography. JetBrains Mono is distributed under the SIL
Open Font License; the copied license is `src/fonts/OFL-JetBrainsMono.txt`.
