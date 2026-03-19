# Dream Server Windows Quickstart

> **Status: Coming Soon — Preflight Checks Only (target: end of March 2026)**
>
> The Windows installer currently runs **system diagnostics and preflight checks only** — it verifies WSL2, Docker Desktop, and GPU readiness but **does not yet produce a running AI stack.** Full Windows runtime support is in active development.
>
> **For a working setup today, use Linux.** See the [Support Matrix](SUPPORT-MATRIX.md) for current platform status.

---

## What Works Today

The Windows installer (`install.ps1`) checks your system readiness and generates a preflight report:

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Light-Heart-Labs/DreamServer/v2.1.0/install.ps1" -OutFile install.ps1; .\install.ps1
```

**Prerequisites:** Windows 10 2004+ or Windows 11. NVIDIA GPU recommended but not required (CPU-only works with smaller models). 4GB+ RAM minimum, 16GB+ recommended.

This will verify:
- WSL2 is installed and set to version 2
- Docker Desktop is running with WSL2 backend
- Docker CLI is available inside your WSL distro
- NVIDIA GPU is visible from both Windows and WSL

The preflight report is saved to `%TEMP%\dream-server-windows-preflight.json`.

---

## What's Coming

When full Windows support ships (target: end of March 2026), the installer will:

1. **Check your system** — WSL2, Docker Desktop, NVIDIA GPU
2. **Auto-fix issues** — enable WSL2, prompt for Docker install
3. **Detect GPU** — pick right model tier automatically
4. **Download model** — 7B to 72B based on your VRAM (~10-40GB)
5. **Start services** — llama-server, Open WebUI, search, database

**Estimated time (when available):** 10-30 minutes depending on download speed.

---

## Planned: Quick Commands (not yet functional)

The following commands describe the intended Windows experience once full support ships:

```powershell
# Start after install
cd $env:LOCALAPPDATA\DreamServer
docker compose up -d

# Stop
docker compose down

# View logs
docker compose logs -f

# Check status
docker compose ps

# Update
docker compose pull && docker compose up -d
```

---

## Planned: Open the UI

Visit **http://localhost:3000** (once full runtime support is available).

First user becomes admin. Start chatting immediately.

---

## Planned: Bootstrap Mode (Faster Start)

Start with a tiny 1.5B model, upgrade later:

```powershell
.\install.ps1 -Bootstrap
```

Chat in 2 minutes while full model downloads in background.

---

## Planned: Installer Flags

These flags describe the intended installer interface once full support ships:

| Flag | What It Does |
|------|--------------|
| `-Bootstrap` | Quick start with small model |
| `-Tier 2` | Force specific tier (1-4) |
| `-Voice` | Enable Whisper + TTS |
| `-Workflows` | Enable n8n automation |
| `-Rag` | Enable Qdrant vector DB |
| `-All` | Everything enabled |
| `-Diagnose` | Check system only |

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Docker not running" | Start Docker Desktop, wait for whale icon |
| "WSL2 not found" | `wsl --install` then restart |
| "nvidia-smi fails" | Update NVIDIA drivers; restart Docker Desktop |
| "Port in use" | Edit `.env`, change `WEBUI_PORT=3001` |
| Out of memory | Lower tier: `.\install.ps1 -Tier 1` |

Full guide: [WINDOWS-INSTALL-WALKTHROUGH.md](WINDOWS-INSTALL-WALKTHROUGH.md)

---

## System Requirements by Tier

| Tier | VRAM | Model | Use Case |
|------|------|-------|----------|
| 1 | 8-12GB | 7B Qwen | Basic chat, coding help |
| 2 | 12-20GB | 14B AWQ | Daily driver, good reasoning |
| 3 | 20-40GB | 32B AWQ | Power user, complex tasks |
| 4 | 40GB+ | 72B AWQ | Maximum capability |

---

## Architecture

```
Windows Host
  ├── Docker Desktop (WSL2 backend)
  │     ├── llama-server container (GPU accelerated)
  │     ├── Open WebUI (port 3000)
  │     ├── SearXNG search
  │     └── PostgreSQL + Qdrant
  └── WSL2 Ubuntu (file system, networking)
```

GPU access: Windows driver → WSL2 → Docker Container Toolkit → llama-server

---

## Files & Locations

| What | Where |
|------|-------|
| Install directory | `%LOCALAPPDATA%\DreamServer` |
| Config | `.env` file in install directory |
| Models | Docker volume `dream-server_model-cache` |
| Logs | `docker compose logs` |
| Data | Docker volumes (auto-managed) |

---

## Updating

```powershell
cd $env:LOCALAPPDATA\DreamServer
# Get latest
git pull
# Update containers
docker compose pull
# Restart
docker compose up -d
```

---

## Need Help?

- Full walkthrough: [WINDOWS-INSTALL-WALKTHROUGH.md](WINDOWS-INSTALL-WALKTHROUGH.md)
- GPU issues: [WSL2-GPU-TROUBLESHOOTING.md](WSL2-GPU-TROUBLESHOOTING.md)
- Docker tuning: [DOCKER-DESKTOP-OPTIMIZATION.md](DOCKER-DESKTOP-OPTIMIZATION.md)
- General FAQ: [FAQ.md](../FAQ.md)

---

*Last updated: 2026-03-04*
