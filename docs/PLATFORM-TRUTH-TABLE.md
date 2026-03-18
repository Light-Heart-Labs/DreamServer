# Platform Truth Table

Use this file as the canonical source for launch claims.

Last updated: 2026-03-05

| Platform path | Claim | Current level | Target | Evidence required before promoting |
|---|---|---|---|---|
| Linux (native) | First-class installer/runtime path | Tier A/B (by GPU path) | — | `install-core.sh` real run on target hardware + smoke/integration + doctor report |
| Linux AMD unified (Strix) | Preferred AMD path | Tier A | — | Real install + runtime benchmarks + doctor/preflight clean |
| Linux NVIDIA | CUDA/llama-server path | Tier B | — | Real install + model load + runtime/throughput checks |
| Windows (Docker Desktop + WSL2) | Standalone installer with full runtime | Tier B | — | `.\install.ps1` real run + GPU detection + Docker compose up + health checks pass |
| Windows via WSL2 | Delegated installer flow (Docker Desktop backend) | Tier B | — | Same as above. |
| macOS Apple Silicon | Native Metal inference + Docker services | Tier B | — | `./install.sh` real run + chip detection + llama-server Metal healthy + 16/17 services online + health checks pass |
| macOS Apple Silicon (release gates) | Installer MVP / experimental in manifest | Tier C | — | CI treats as Tier C for claim checks. |

## Release language guardrails

- Safe to claim now:
  - Linux support (AMD Strix Halo + NVIDIA).
  - Windows support (Docker Desktop + WSL2, NVIDIA/AMD GPU auto-detection).
  - macOS support (Apple Silicon with Metal acceleration).
- Not safe to claim now:
  - Full macOS runtime parity with Linux (ComfyUI not available on macOS — no GPU backend for image generation).
  - macOS Tier A (needs broader hardware validation across M1/M2/M3/M4 variants).
