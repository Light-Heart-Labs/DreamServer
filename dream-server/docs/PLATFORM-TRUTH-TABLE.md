# Platform Truth Table

Use this file as the canonical source for launch claims.

Last updated: 2026-04-11

| Platform path | Claim | Current level | Target | Evidence required before promoting |
|---|---|---|---|---|
| Linux (native) | First-class installer/runtime path | Tier A/B (by GPU path) | — | `install-core.sh` real run on target hardware + smoke/integration + doctor report |
| Linux AMD unified (Strix) | Preferred AMD path | Tier A | — | Real install + runtime benchmarks + doctor/preflight clean |
| Linux NVIDIA | CUDA/llama-server path | Tier B | — | Real install + model load + runtime/throughput checks |
| Windows (Docker Desktop + WSL2) | Standalone installer with full runtime | Tier B | — | `.\install.ps1` real run + GPU detection + Docker compose up + health checks pass |
| Windows via WSL2 | Delegated installer flow (Docker Desktop backend) | Tier B | — | Same as above. |
| macOS Apple Silicon | Native Metal inference + Docker services | Tier B | — | `./install.sh` real run + chip detection + llama-server Metal healthy + 16/17 services online + health checks pass |
| macOS Apple Silicon (release gates) | Installer MVP / experimental in manifest | Tier C | — | CI treats as Tier C for claim checks. |
| Android / Termux | Mobile shell preview with local CLI chat | Preview | Tier C | `./install.sh` on real Termux + `llama.cpp` build succeeds + `Qwen3-0.6B` downloads + `./dream-mobile.sh prompt` returns output |
| iOS / a-Shell | CLI + Shortcut intent preview | Tier C | — | `sh ./install.sh` on real a-Shell + `sh ./dream-mobile.sh intent` returns stable JSON + Shortcut loop opens the requested app or URL |

## Release language guardrails

- Safe to claim now:
  - Linux support (AMD Strix Halo + NVIDIA).
  - Windows support (Docker Desktop + WSL2, NVIDIA/AMD GPU auto-detection).
  - macOS support (Apple Silicon with Metal acceleration).
  - Android / Termux preview for shell-only local chat with `Qwen3-0.6B`.
  - iOS / a-Shell preview for CLI + Shortcut intents.
- Not safe to claim now:
  - Full macOS runtime parity with Linux (ComfyUI not available on macOS — no GPU backend for image generation).
  - macOS Tier A (needs broader hardware validation across M1/M2/M3/M4 variants).
  - iOS / a-Shell local GGUF inference support.
  - Full Dream Server mobile parity on Android or iOS.
