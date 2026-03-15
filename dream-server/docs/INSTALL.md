# Dream Server Installation Guide

This guide covers installing Dream Server on Linux, macOS, and Windows. The goal is **rock-solid, easy installs** that work on everything from a high-end server to an older laptop or desktop.

## Table of Contents

1. [Quick start](#quick-start)
2. [Prerequisites](#prerequisites)
3. [Linux install](#linux-install)
4. [macOS install](#macos-install)
5. [Windows install](#windows-install)
6. [Install phases (what runs under the hood)](#install-phases-what-runs-under-the-hood)
7. [Optional features](#optional-features)
8. [Non-interactive and dry-run](#non-interactive-and-dry-run)
9. [Troubleshooting](#troubleshooting)

---

## Quick start

**Linux / WSL:**

```bash
curl -fsSL https://raw.githubusercontent.com/Light-Heart-Labs/DreamServer/main/get-dream-server.sh | bash
# or clone and run from repo:
git clone --depth 1 https://github.com/Light-Heart-Labs/DreamServer.git
cd DreamServer/dream-server
./install.sh
```

**macOS (Apple Silicon):**

```bash
cd DreamServer/dream-server
./install.sh
# Installer detects Apple Silicon and uses Metal-native inference.
```

**Windows:**

```powershell
# From PowerShell in the repo:
cd DreamServer\dream-server
.\install.ps1
# Uses Docker Desktop with WSL2 backend; GPU auto-detection for NVIDIA/AMD.
```

After install, the installer prints URLs for the Chat UI, Dashboard, and optional services. Default Chat UI: **http://localhost:3000**.

---

## Prerequisites

### All platforms

- **Docker** — Required. The installer can install Docker on Linux; on macOS and Windows use Docker Desktop.
- **Network** — Internet access for image pulls and model download (unless using offline/air-gapped mode).
- **Disk** — At least 30 GB free recommended; more for large models and optional services.
- **RAM** — Minimum 8 GB; 16 GB+ recommended for comfortable use. Tier and model selection adapt to your hardware.

### Linux

- **curl** — Required (install with your package manager if missing).
- **Non-root user** — Run the installer as a normal user with sudo access; do not run as root.
- **Supported distros** — Ubuntu, Debian, Fedora, Arch, openSUSE, and derivatives. See [COMPATIBILITY-MATRIX.md](COMPATIBILITY-MATRIX.md) for details.
- **Optional:** **jq** and **rsync** — Used by update/backup scripts and by `scripts/validate-manifests.sh` and `dream config validate`. Install if you want full validation and scripting.

### macOS

- **Apple Silicon (M1/M2/M3/M4)** — Required for the current macOS path; Metal 3 (macOS 13 Ventura or later).
- **Docker Desktop** — Installed and running before you run the installer.

### Windows

- **Docker Desktop** — With WSL2 backend.
- **WSL2** — Used by Docker Desktop for Linux containers; GPU passthrough for NVIDIA/AMD when configured.

---

## Linux install

1. **Get the repo** (if not using the one-line curl script):

   ```bash
   git clone --depth 1 https://github.com/Light-Heart-Labs/DreamServer.git
   cd DreamServer/dream-server
   ```

2. **Run the installer:**

   ```bash
   ./install.sh
   ```

3. The installer will:
   - Run pre-flight checks (OS, curl, compose files).
   - Detect hardware (CPU, RAM, GPU) and assign a tier (1–4).
   - Let you choose optional features (voice, workflows, RAG, etc.).
   - Check RAM, disk, and port availability.
   - Install Docker and Docker Compose if missing (or prompt you to install).
   - Create the install directory, copy files, generate `.env`.
   - Pull Docker images and start the stack.
   - Run health checks and print a summary with URLs.

4. **Default install location:** `~/dream-server`. Override with:

   ```bash
   INSTALL_DIR=/opt/dream-server ./install.sh
   ```

5. **Use the CLI** (from the install directory or with `DREAM_HOME` set):

   ```bash
   ./dream-cli status
   ./dream-cli list
   ```

---

## macOS install

1. **Prerequisites:** macOS 13+ (Ventura), Apple Silicon, Docker Desktop installed and running.

2. **From the repo:**

   ```bash
   cd DreamServer/dream-server
   ./install.sh
   ```

3. The installer detects Apple Silicon and uses the macOS path:
   - Native Metal inference for the LLM (no Docker for the main model).
   - Docker for Open WebUI, n8n, Qdrant, and other services.
   - LaunchAgent can be set up for auto-start.

4. See [MACOS-QUICKSTART.md](MACOS-QUICKSTART.md) and [DOCKER-DESKTOP-OPTIMIZATION.md](DOCKER-DESKTOP-OPTIMIZATION.md) for tuning.

---

## Windows install

1. **Prerequisites:** Docker Desktop with WSL2 backend, optional GPU support (NVIDIA/AMD) if you have a supported GPU.

2. **From PowerShell in the repo:**

   ```powershell
   cd DreamServer\dream-server
   .\install.ps1
   ```

3. The Windows installer:
   - Checks Docker Desktop and WSL2.
   - Detects GPU (NVIDIA/AMD) when available.
   - Creates the install directory and config.
   - Pulls images and starts the stack via Docker Desktop.

4. See [WINDOWS-QUICKSTART.md](WINDOWS-QUICKSTART.md) and [WINDOWS-INSTALL-WALKTHROUGH.md](WINDOWS-INSTALL-WALKTHROUGH.md) for details.

---

## Install phases (what runs under the hood)

On Linux, the installer runs 13 phases in order. Understanding them helps with troubleshooting and custom installs.

| Phase | Name              | What it does |
|-------|-------------------|--------------|
| 01    | Pre-flight        | Root/OS/tools checks, existing install detection |
| 02    | Detection         | Hardware detection → tier → compose overlay selection |
| 03    | Features          | Interactive menu for optional features (voice, workflows, RAG, etc.) |
| 04    | Requirements      | RAM, disk, GPU, port availability checks |
| 05    | Docker            | Install Docker / Docker Compose / NVIDIA Container Toolkit if needed |
| 06    | Directories       | Create install dir, copy files, generate `.env` |
| 07    | Dev tools         | Optional: Claude Code, Codex CLI, OpenCode |
| 08    | Images            | Pull all Docker images for the selected stack |
| 09    | Offline           | Optional: configure offline/air-gapped operation |
| 10    | AMD tuning        | Optional: AMD APU sysctl/modprobe/GRUB tuning |
| 11    | Services          | Download GGUF model, generate models.ini, start stack |
| 12    | Health            | Verify services respond, configure Perplexica, pre-download STT |
| 13    | Summary           | Print URLs, desktop shortcut, sidebar pin, summary JSON |

See [INSTALLER-ARCHITECTURE.md](INSTALLER-ARCHITECTURE.md) for the full map of libraries and phases.

---

## Optional features

During phase 03 (or via flags), you can enable:

- **Voice** — Whisper (STT) and TTS (Kokoro or Piper); requires extra ports and images.
- **Workflows** — n8n for automation; requires n8n port (default 5678).
- **RAG** — Qdrant for vector search; requires Qdrant port (default 6333).
- **Images** — ComfyUI for image generation (FLUX); GPU recommended.
- **OpenClaw** — Agent with tools; optional.
- **Perplexica** — Deep research UI; optional.
- **SearXNG / Perplexica** — Metasearch and research; optional.

Ports are documented in `.env.example`. The installer checks port conflicts in phase 04 and warns you.

---

## Non-interactive and dry-run

**Dry-run (no install, no Docker pulls):**

```bash
./install.sh --dry-run
```

**Non-interactive (no prompts, use defaults or env):**

```bash
./install.sh --non-interactive
```

**Force a tier (e.g. for testing):**

```bash
./install.sh --tier 2 --dry-run
```

**Skip Docker install (already have Docker):**

```bash
./install.sh --skip-docker --non-interactive
```

Use these for CI, scripting, or testing on headless machines.

---

## Troubleshooting

- **"Do not run as root"** — Run as a normal user with sudo. The installer will call sudo only when needed (e.g. Docker install).
- **"curl is required"** — Install curl with your package manager (e.g. `sudo apt install curl`).
- **"No compose files found"** — Run the installer from the `dream-server` directory (the one that contains `install.sh` and `docker-compose.base.yml`).
- **Port already in use** — Phase 04 reports which port is in use. Stop the conflicting process or change the port in `.env` (see `.env.example`).
- **Docker not installed / not running** — On Linux the installer can install Docker; on macOS/Windows start Docker Desktop first.
- **GPU not detected** — See [HARDWARE-GUIDE.md](HARDWARE-GUIDE.md) and [COMPATIBILITY-MATRIX.md](COMPATIBILITY-MATRIX.md). CPU-only (no GPU) is supported; the installer will select an appropriate tier and backend.
- **Extension or config validation** — Run `./dream-cli config validate` from the install directory, or `bash scripts/validate-manifests.sh` from the repo. See [INSTALL-TROUBLESHOOTING.md](INSTALL-TROUBLESHOOTING.md).

For more issues and fixes, see [INSTALL-TROUBLESHOOTING.md](INSTALL-TROUBLESHOOTING.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
