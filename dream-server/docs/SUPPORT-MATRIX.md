# Dream Server Support Matrix

Last updated: 2026-03-05

## What Works Today

**Linux, Windows, and macOS are fully supported.**

| Platform | Status | What you get today |
|----------|--------|-------------------|
| **Linux + AMD Strix Halo (ROCm)** | **Fully supported** | Complete install and runtime. Primary development platform. |
| **Linux + NVIDIA (CUDA)** | **Supported** | Complete install and runtime. Broader distro test matrix still expanding. |
| **Windows (Docker Desktop + WSL2)** | **Supported** | Complete install and runtime via `.\install.ps1`. GPU auto-detection (NVIDIA/AMD). |
| **macOS (Apple Silicon)** | **Supported** | Complete install and runtime via `./install.sh`. Native Metal inference + Docker services. |

## Support Tiers

- `Tier A` — fully supported and actively tested in this repo
- `Tier B` — supported (works end-to-end, broader validation ongoing)
- `Tier C` — experimental or planned (installer diagnostics only, no runtime)

## Platform Matrix (detailed)

| Platform | GPU Path | Tier | Status |
|---|---|---|---|
| Linux (Ubuntu/Debian family) | NVIDIA (llama-server/CUDA) | Tier B | Installer path exists in `install-core.sh`; broader distro test matrix still pending |
| Linux (Strix Halo / AMD unified memory) | AMD (llama-server/ROCm) | Tier A | Primary path via `docker-compose.base.yml` + `docker-compose.amd.yml` |
| Windows (Docker Desktop + WSL2) | NVIDIA/AMD via Docker Desktop | Tier B | Standalone installer (`.\install.ps1`) with GPU auto-detection, Docker orchestration, health checks, and desktop shortcuts |
| macOS (Apple Silicon) | Metal (native llama-server) | Tier B | Standalone installer (`./install.sh`) with chip detection, native Metal inference, Docker services, and LaunchAgent auto-start |

## Current Truth

- **Linux, Windows, and macOS are fully supported.**
- Linux + NVIDIA is supported but needs broader validation and CI matrix coverage.
- Windows installs via `.\install.ps1` with Docker Desktop + WSL2 backend. Windows delegated installer flow is available via WSL2.
- Windows native installer UX is Tier B (delegated via Docker Desktop + WSL2).
- macOS installs via `./install.sh` — llama-server runs natively with Metal acceleration, all other services in Docker.
- For release gates (CI), macOS (Apple Silicon) is documented as Tier C (installer MVP) in manifest; SUPPORT-MATRIX table may show Tier B for user-facing status.
- Version baselines for triage are in `docs/KNOWN-GOOD-VERSIONS.md`.

## Roadmap

| Target | Milestone |
|--------|-----------|
| **Now** | Linux AMD + NVIDIA + Windows + macOS fully supported |
| **Ongoing** | CI smoke matrix expansion for all platforms |

## Next Milestones

1. Add CI smoke matrix for Linux NVIDIA/AMD and WSL logic checks.
2. Expand macOS test coverage across M1/M2/M3/M4 variants and RAM tiers.
3. Promote macOS from Tier B to Tier A after broader real-hardware validation.
