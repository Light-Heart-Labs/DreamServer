# P2P GPU Deploy — DreamServer on Peer-to-Peer GPU Marketplaces

Production-hardened deployment of the full DreamServer AI stack on rented GPU instances from peer-to-peer compute marketplaces (Vast.ai tested; architecture is provider-agnostic).

**One command. All 17+ services. Any NVIDIA/AMD GPU or CPU-only instance.**

Automatically handles 28 known P2P GPU environment issues: root user rejection, Docker socket permissions, CPU limit overflow, /tmp permissions, NVIDIA toolkit setup, multi-GPU support, SSH tunneling, package manager locks, and more. Includes built-in recovery commands, health checks, and model auto-swap capabilities.

## What It Solves

**The Problem:** Deploying DreamServer on rented GPU instances is fragile. Root-only environments, non-standard filesystem permissions, held package locks, missing GPU drivers, and provider-specific quirks cause silent failures during setup.

**The Solution:** `setup.sh` is a battle-tested orchestrator that detects and fixes 28 known issues automatically. It handles permission escalation, creates a non-root `dream` user, manages Docker group access, installs missing NVIDIA/AMD toolkits, applies POSIX ACLs for multi-container file sharing, and starts all 17+ services with health checks. If setup partially completes, recovery commands bring the stack back online without reinstall.

## Quick Start

```bash
# On your GPU instance (as root):
bash setup.sh              # Full install (~10 min)
bash setup.sh --status     # Health check
bash setup.sh --info       # Show connection URLs and SSH tunnel commands
bash setup.sh --teardown   # Stop all services
```

## Setup Guide

- [Setup PDF](https://drive.google.com/file/d/1SrBooRJwP24OTWXZH-TOlk4q6tK44DUR/view?usp=sharing)
- [Setup presentation slides](https://docs.google.com/presentation/d/16TusAdo0-o3lOTeUwRaJa16foELvFSH4/edit?usp=sharing&ouid=109193555106212685513&rtpof=true&sd=true)

## Quick Recovery (If Phase 9 Fails)

If setup reached "Starting services" but URLs are unreachable:

```bash
bash setup.sh --fix
bash setup.sh --status
bash setup.sh --info
```

This re-applies CPU caps, permissions, network fixes, restarts compose, and
prints fresh access commands.

On Windows, use the all-port tunnel from `--info` (it uses a safe local alias
`58080 -> dashboard` plus direct localhost forwards for service ports).

`--fix` regenerates reconnect scripts:
- `connect-tunnel.sh` (Linux/macOS/WSL)
- `connect-tunnel.ps1` (Windows PowerShell)

## What It Does

The setup script handles 28 known issues with P2P GPU environments:

| # | Issue | Fix |
|---|-------|-----|
| 01 | Root user rejection | Creates non-root `dream` user |
| 02 | Docker socket denied | Adds dream to docker group |
| 03 | /tmp broken | Fixes permissions to 1777 |
| 04 | CPU limit overflow | Auto-caps to actual core count |
| 05 | n8n uid mismatch | Dynamic UID from compose.yaml |
| 06 | dashboard-api write | ACL-based permission system |
| 07 | comfyui models write | AMD/NVIDIA layout detection |
| 08 | WEBUI_SECRET missing | Auto-generated secrets |
| 09 | Dual directory confusion | Smart directory discovery |
| 10 | Dashboard stuck Created | Auto-nudge on startup |
| 11 | HuggingFace throttle | aria2c multi-threaded download |
| 12 | NVIDIA toolkit missing | Auto-installs + configures |
| 13 | Disk space insufficient | Pre-flight validation |
| 14 | Compose v1 syntax | Auto-detects v1 vs v2 |
| 15 | .env duplicates | Idempotent env_set() |
| 16 | Port conflicts | Dynamic port discovery |
| 17 | DNS resolution failure | Google DNS fallback |
| 18 | Shared memory too small | Remount /dev/shm to 4GB |
| 19 | Bootstrap model missing | Auto-downloads Qwen3-0.6B |
| 20 | llama-server infinite hang | 45s diagnosis + OOM recovery |
| 21 | No systemd | Host-agent background start |
| 22 | OpenCode crash-loop | Auto-disable non-essential |
| 23 | CUDA OOM on large models | Swap to smallest model |
| 24 | /dev/shm too small | Remount attempt |
| 25 | ComfyUI infinite hang | Background download, don't block |
| 26 | Installer timeout | 10min cap per phase |
| 27 | AMD GPU support | ROCm detection + compose overlay |
| 28 | CPU-only fallback | Works without any GPU |

## Architecture

```
p2p-gpu/
├── setup.sh                    # Orchestrator — sources libs, runs phases
├── lib/                        # Pure function libraries (no side effects)
│   ├── constants.sh            # Paths, versions, colors, thresholds
│   ├── logging.sh              # log/warn/err/step, cleanup trap, flock
│   ├── environment.sh          # .env management, GPU detection, HTTP polling
│   ├── permissions.sh          # POSIX ACLs, setgid, UID-specific fixes
│   ├── services.sh             # Manifest discovery, compose, startup
│   ├── networking.sh           # Caddy proxy, SSH tunnel, Cloudflare
│   ├── models.sh               # Model download, URL resolution, swap watcher
│   └── compatibility.sh        # Whisper/TTS/ComfyUI/OpenClaw fixes
├── phases/                     # Sequential install steps
│   ├── 00-preflight.sh         # GPU/disk/Docker/DNS validation
│   ├── 01-dependencies.sh      # System package installation
│   ├── 02-user-setup.sh        # Create dream user + groups
│   ├── 03-repository.sh        # Clone DreamServer repo
│   ├── 04-installer.sh         # Run DreamServer installer (with timeout)
│   ├── 05-post-install.sh      # Apply fixes, locate working directory
│   ├── 06-bootstrap-model.sh   # Ensure usable GGUF model exists
│   ├── 07-model-optimize.sh    # Resume/restart downloads with aria2c
│   ├── 08-vastai-quirks.sh     # Provider-specific environment fixes
│   ├── 09-services.sh          # Start containers + health monitoring
│   ├── 10-voice-stack.sh       # TTS/STT model readiness gates
│   ├── 11-access-layer.sh      # Caddy proxy + Cloudflare tunnel + SSH
│   └── 12-summary.sh           # Print access info
└── subcommands/                # Alternative entry points
    ├── teardown.sh             # Stop all services
    ├── status.sh               # Health check dashboard
    ├── resume.sh               # Quick restart after SSH drop
    ├── fix.sh                  # Apply fixes without reinstall
    └── info.sh                 # Show connection URLs
```

## Design Principles

Aligned with DreamServer's [CLAUDE.md](../../CLAUDE.md):

- **Let It Crash** — `set -euo pipefail` everywhere; errors crash unless explicitly marked non-fatal with `|| warn` (per CLAUDE.md). On rented GPU instances, a working dashboard with a broken ComfyUI beats a dead stack the user is paying for.
- **KISS** — readable over clever; one function, one job
- **Pure Functions** — libs have no side effects; phases are the imperative shell
- **Manifest-Driven** — services auto-discovered from extension manifests (no hardcoded lists)
- **PID-file tracking** — background processes tracked safely (no `pkill -f`)
- **ACL-primary permissions** — setgid + POSIX ACLs required (hard fail if unavailable; no world-writable fallback)

## Commands

| Command | Purpose |
|---------|---------|
| `bash setup.sh` | Full install (first time or re-install) |
| `bash setup.sh --resume` | Quick restart — re-apply fixes + start services |
| `bash setup.sh --status` | Health check — GPU, containers, ports |
| `bash setup.sh --info` | Show connection URLs and SSH tunnel commands |
| `bash setup.sh --fix` | Apply latest fixes without full reinstall |
| `bash setup.sh --teardown` | Stop all services |
| `bash setup.sh --dry-run` | Preview what would happen without making changes |

## Model Download and Auto-Swap

- Setup starts quickly on a small model, downloads the GPU-tier model in background, then auto-swaps when ready.
- Swap updates both `GGUF_FILE` and `LLM_MODEL`, then restarts dependent services.
- Dashboard model downloads (`/models` page) require the Dream host agent; setup now auto-starts it during service startup.

```bash
MODEL="Qwen3-30B-A3B-Q4_K_M.gguf"; DS_DIR="${DS_DIR:-/home/dream/dream-server}"; LLM_MODEL="$(echo "$MODEL" | sed -E 's/\.(gguf|GGUF)$//' | sed -E 's/-Q[0-9]+([._][A-Za-z0-9]+)*$//' | tr '[:upper:]' '[:lower:]')"; cd "$DS_DIR" && sed -i "s|^GGUF_FILE=.*|GGUF_FILE=${MODEL}|" .env && { grep -q '^LLM_MODEL=' .env && sed -i "s|^LLM_MODEL=.*|LLM_MODEL=${LLM_MODEL}|" .env || echo "LLM_MODEL=${LLM_MODEL}" >> .env; } && docker compose $(cat .compose-flags 2>/dev/null) up -d llama-server && for c in dream-dreamforge dream-openclaw dream-dashboard-api dream-webui; do docker ps --format '{{.Names}}' | grep -qx "$c" && docker restart "$c" >/dev/null || echo "[warn] ${c} restart failed (non-fatal)" >&2; done
```

```bash
tail -f /home/dream/dream-server/logs/aria2c-download.log
```

```bash
# If Dashboard shows "Failed to start download"
su - dream -c 'cd /home/dream/dream-server && DREAM_HOME=/home/dream/dream-server ./dream-cli agent start'
```

## Provider Support

Currently tested on **Vast.ai**. The architecture is provider-agnostic:
- GPU detection works for any NVIDIA/AMD/CPU-only instance
- Docker + compose requirements are standard
- Provider-specific quirks isolated in `phases/08-vastai-quirks.sh`

To add a new provider, create `phases/08-<provider>-quirks.sh` with
provider-specific fixes.

## Security

- `.env` files created with `0600` mode (secrets protected)
- Background process PIDs tracked in `/var/run/dreamserver-p2p-gpu/`
- Cloudflare tokens passed via environment variables (not CLI args)
- Binary downloads (cloudflared) verified via SHA256 checksums
- POSIX ACLs required; world-writable permissions are never used
- Multi-UID directories documented with reasons for broader access

## Related
