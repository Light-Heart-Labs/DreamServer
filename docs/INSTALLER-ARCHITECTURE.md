# Installer Architecture

The Dream Server installer is modular — 6 libraries and 13 phases, each in its own file.
This guide is your map to understanding, using, and customizing the installer.

## Directory Tree

```
installers/
  lib/                        # Pure libraries — define functions, no side effects
    constants.sh              #   Colors, paths, VERSION, timezone detection
    logging.sh                #   log(), success(), warn(), error(), install_elapsed()
    ui.sh                     #   CRT theme: typing effects, spinners, boot splash, lore
    detection.sh              #   GPU detection, capability profiles, backend contracts, secure boot fix
    tier-map.sh               #   resolve_tier_config() — tier → model/GGUF/context
    compose-select.sh         #   resolve_compose_config() — compose overlay files + flags
  phases/                     # Sequential install steps — execute on source
    01-preflight.sh           #   Root/OS/tools checks, existing installation check
    02-detection.sh           #   Hardware detection → tier assignment → compose config
    03-features.sh            #   Interactive feature selection menu
    04-requirements.sh        #   RAM, disk, GPU, and port availability checks
    05-docker.sh              #   Install Docker, Docker Compose, NVIDIA Container Toolkit
    06-directories.sh         #   Create dirs, copy source, generate .env, configure services
    07-devtools.sh            #   Install Claude Code, Codex CLI, OpenCode
    08-images.sh              #   Build image pull list and download all Docker images
    09-offline.sh             #   Configure M1 offline/air-gapped operation
    10-amd-tuning.sh          #   AMD APU sysctl, modprobe, GRUB, and tuned setup
    11-services.sh            #   Download GGUF model, generate models.ini, launch stack
    12-health.sh              #   Verify services responding, configure Perplexica, pre-download STT
    13-summary.sh             #   URLs, desktop shortcut, sidebar pin, summary JSON
install-core.sh               # Orchestrator: trap → source libs → parse args → source phases
```

## How It Works

**Libraries are safe to source.** Every file in `lib/` defines functions only — no
side effects. Sourcing them loads function definitions and constants into the shell
without executing anything. They must be sourced in order because later libraries
depend on earlier ones (e.g., `logging.sh` uses color codes from `constants.sh`).

**Phases execute immediately when sourced.** Each file in `phases/` is a
self-contained install step that runs its logic the moment `source` evaluates it.
Phases rely on the functions defined by `lib/` and on global variables set by
earlier phases (e.g., phase 04 checks the GPU tier assigned by phase 02).

**The orchestrator is thin.** `install-core.sh` (~150 lines) does exactly three things:
set up interrupt traps, source the 6 libraries, parse CLI arguments, then source the
13 phases in order. All files share one global bash namespace — everything is sourced,
not exec'd.

## File Header Convention

Every module uses a standardized header:

```bash
#!/bin/bash
# ============================================================================
# Dream Server Installer — <Module Name>
# ============================================================================
# Part of: installers/lib/   (or installers/phases/)
# Purpose: <one-line description>
#
# Expects: <comma-separated list of globals/functions this file reads>
# Provides: <comma-separated list of globals/functions this file defines>
#
# Modder notes:
#   <when and why you'd edit this file>
# ============================================================================
```

| Field | Meaning |
|-------|---------|
| **Purpose** | What this file does in one line |
| **Expects** | Globals and functions that must already exist when this file is sourced |
| **Provides** | Globals and functions this file creates for later files to use |
| **Modder notes** | Plain-English hint for customizers |

If you add a new file, copy this template. The `Expects` / `Provides` chain is
how you trace data flow without reading every line.

## Mod Recipes

Common customizations and exactly where to make them:

| Recipe | What to edit | How |
|--------|-------------|-----|
| **Add a hardware tier** | `lib/tier-map.sh` + `lib/detection.sh` | Add a `case` in `resolve_tier_config()` (tier-map.sh) and a detection path in `detection.sh`. Also update `lib/compose-select.sh` if a new compose overlay is needed, and add the tier to `QUICKSTART.md` and `README.md` hardware tables. |
| **Swap CRT theme colors** | `lib/constants.sh` | Change the ANSI escape code variables (`GRN`, `AMB`, `RED`, etc.) near the top |
| **Change lore messages** | `lib/ui.sh` | Edit the `LORE_MESSAGES[]` array — add, remove, or reword entries |
| **Change boot splash** | `lib/ui.sh` | Edit the `show_stranger_boot()` function — it renders the CRT startup sequence |
| **Skip a phase** | `install-core.sh` | Comment out or remove the `source` line for that phase (e.g., remove phase 07 to skip dev tools) |
| **Add a new phase** | `installers/phases/` | Create a numbered `.sh` file with the standard header, then add a `source` line in `install-core.sh` in the right order |
| **Swap inference backend** | `lib/compose-select.sh` | Change the compose overlay logic in `resolve_compose_config()` to point at different compose files |
| **Change model downloads** | `phases/11-services.sh` | Edit the GGUF download logic or add new model files |
| **Add a service health check** | `phases/12-health.sh` | Add a new `check_service()` call for your service |
| **Change minimum requirements** | `phases/04-requirements.sh` | Adjust RAM/disk/VRAM thresholds per tier |

## Cross-Platform Architecture

What's shared vs platform-specific across the installer:

| Layer | Shared | Platform-specific |
|-------|--------|-------------------|
| Colors, version, paths | `lib/constants.sh` | — |
| Logging | `lib/logging.sh` | — |
| CRT UI / spinners | `lib/ui.sh` | — |
| GPU detection | `lib/detection.sh` | Backend contract JSONs (`config/backends/`) |
| Tier → model mapping | `lib/tier-map.sh` | — |
| Compose selection | `lib/compose-select.sh` | Per-backend compose overlays |
| Pre-flight checks | `phases/01-preflight.sh` | — |
| Docker setup | `phases/05-docker.sh` | NVIDIA Container Toolkit vs ROCm |
| AMD system tuning | — | `phases/10-amd-tuning.sh` (AMD only) |
| Health checks | `phases/12-health.sh` | Port/service differences per backend |

## Testing Your Mods

### Syntax check all installer files

```bash
for f in installers/lib/*.sh installers/phases/*.sh install-core.sh; do
  bash -n "$f"
done
```

If any file has a syntax error, `bash -n` will print the file name and line number.

### Dry-run (no actual installs)

```bash
bash install-core.sh --dry-run --non-interactive --skip-docker --force
```

This walks through every phase, printing what would happen without making changes.

### Smoke tests

```bash
bash tests/smoke/linux-nvidia.sh
bash tests/smoke/linux-amd.sh
bash tests/smoke/wsl-logic.sh
bash tests/smoke/macos-dispatch.sh
```

### Full validation suite

```bash
bash scripts/simulate-installers.sh
bash tests/integration-test.sh
```

## See Also

- [CONTRIBUTING.md](../CONTRIBUTING.md) — Contributor validation checklist
- [EXTENSIONS.md](EXTENSIONS.md) — Adding Docker services (not installer mods)
- [BACKEND-CONTRACT.md](BACKEND-CONTRACT.md) — Backend runtime contract format
