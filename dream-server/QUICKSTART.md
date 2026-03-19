# Dream Server Quick Start

One command to a fully running local AI stack. No manual config, no dependency hell.

> **This quickstart covers Linux, Windows, and macOS.** For Windows, see the [Windows install section](#windows) below. For macOS, see the [macOS Quickstart](docs/MACOS-QUICKSTART.md).

## Prerequisites

**Linux (NVIDIA GPU):**
- Docker with Compose v2+ ([Install](https://docs.docker.com/get-docker/))
- NVIDIA GPU with 8GB+ VRAM (16GB+ recommended)
- NVIDIA Container Toolkit ([Install](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html))
- 40GB+ disk space (for models)

**Linux (AMD Strix Halo):**
- Docker with Compose v2+ ([Install](https://docs.docker.com/get-docker/))
- AMD Ryzen AI MAX+ APU with 64GB+ unified memory
- ROCm-compatible kernel (6.17+ recommended, 6.18.4+ ideal)
- `/dev/kfd` and `/dev/dri` accessible (user in `video` + `render` groups)
- 60GB+ disk space (for GGUF model files)

**Windows:** See [Windows section](#windows) below.

## Step 1: Run the Installer (Linux)

```bash
./install.sh
```

The installer will:
1. **Detect your GPU** and auto-select the right tier:
   - **AMD Strix Halo (unified memory)**:
     - SH_LARGE (90GB+): qwen3-coder-next (80B MoE), 128K context
     - SH_COMPACT (64-89GB): qwen3-30b-a3b (30B MoE), 128K context
   - **NVIDIA (discrete GPU)**:
     - Tier 1 (Entry): <12GB VRAM → qwen2.5-7b-instruct (GGUF Q4_K_M), 16K context
     - Tier 2 (Prosumer): 12-20GB VRAM → qwen2.5-14b-instruct (GGUF Q4_K_M), 16K context
     - Tier 3 (Pro): 20-40GB VRAM → qwen2.5-32b-instruct (GGUF Q4_K_M), 32K context
     - Tier 4 (Enterprise): 40GB+ VRAM → qwen2.5-72b-instruct (GGUF Q4_K_M), 32K context
2. Check Docker and GPU toolkit (NVIDIA Container Toolkit or ROCm devices)
3. Ask which optional components to enable (voice, workflows, RAG)
4. Generate secure passwords and configuration
5. Apply system tuning (AMD: sysctl, amdgpu modprobe, etc.)
6. Start all services

**Override tier manually:** `./install.sh --tier 3`

**Time Estimate:** 5-10 minutes interactive setup, plus 10-30 minutes for first model download.

## Step 2: Wait for Model Download

**NVIDIA:** First run downloads the LLM (~20GB for 32B GGUF). Watch progress:

```bash
docker compose logs -f llama-server
```

When you see `server is listening on`, you're ready!

**AMD Strix Halo:** The GGUF model downloads in the background (~25-52GB). Watch progress:

```bash
tail -f ~/dream-server/logs/model-download.log

# Or check llama-server readiness:
docker compose -f docker-compose.base.yml -f docker-compose.amd.yml logs -f llama-server
```

When you see `server is listening on`, the model is loaded and ready.

## Step 3: Validate Installation

Verify everything is working:

```bash
./scripts/dream-preflight.sh
```

This tests all services and confirms Dream Server is ready. You should see green checkmarks for each test.

**For comprehensive testing:**
```bash
./scripts/dream-test.sh
```

This runs the full validation suite including load tests.

## Step 4: Open Chat UI

Visit: **http://localhost:3000**

1. Create an account (first user becomes admin)
2. Select a model from the dropdown
3. Start chatting!

## Step 5: Test the API

**NVIDIA:**
```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5-32b-instruct",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**AMD Strix Halo:**
```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-next",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Hardware Tiers

The installer auto-detects your GPU and selects the optimal configuration:

**AMD Strix Halo:**

| Tier | Unified VRAM | Model | Hardware |
|------|-------------|-------|----------|
| SH_LARGE | 90GB+ | qwen3-coder-next (80B MoE) | Ryzen AI MAX+ (96GB config) |
| SH_COMPACT | 64-89GB | qwen3:30b-a3b (30B MoE) | Ryzen AI MAX+ (64GB config) |

**NVIDIA:**

| Tier | VRAM | Model | Example GPUs |
|------|------|-------|--------------|
| 1 (Entry) | <12GB | Qwen2.5-7B | RTX 3080, RTX 4070 |
| 2 (Prosumer) | 12-20GB | Qwen2.5-14B (GGUF Q4_K_M) | RTX 3090, RTX 4080 |
| 3 (Pro) | 20-40GB | Qwen2.5-32B (GGUF Q4_K_M) | RTX 4090, A6000 |
| 4 (Enterprise) | 40GB+ | Qwen2.5-72B (GGUF Q4_K_M) | A100, H100 |

To check what tier you'd get without installing:

```bash
./scripts/detect-hardware.sh
```

---

## Common Issues

### "OOM" or "CUDA out of memory" (NVIDIA)

Reduce context window in `.env`:
```
CTX_SIZE=4096  # or even 2048
```

Or switch to a smaller model:
```
LLM_MODEL=qwen2.5-7b-instruct
```

### AMD: llama-server crash loop

Check logs: `docker compose -f docker-compose.base.yml -f docker-compose.amd.yml logs llama-server`

Common causes:
- GGUF file not found: ensure `data/models/*.gguf` exists
- Wrong GGUF format: use upstream llama.cpp GGUFs (NOT Ollama blobs)
- Missing ROCm env vars: `HSA_OVERRIDE_GFX_VERSION=11.5.1` must be set

### Model download fails

1. Check disk space: `df -h`
2. **NVIDIA:** Try again: `docker compose restart llama-server`
3. **AMD:** Resume download: `wget -c -O data/models/<model>.gguf <url>`

### WebUI shows "No models available"

The inference engine is still loading.
- **NVIDIA:** Check: `docker compose logs llama-server`
- **AMD:** Check: `docker compose -f docker-compose.base.yml -f docker-compose.amd.yml logs llama-server`

### Port conflicts

Edit `.env` to change ports:
```
WEBUI_PORT=3001
OLLAMA_PORT=8081          # LLM inference port
```

---

## Next Steps

- **Add workflows**: Open n8n at http://localhost:5678 to create custom automation workflows
- **Connect OpenClaw**: Use this as your local inference backend at http://localhost:7860
- **Dashboard**: Monitor services, GPU, and health at http://localhost:3001

---

## Windows

### Prerequisites

- Windows 10/11 with [Docker Desktop](https://docs.docker.com/desktop/install/windows-install/) (WSL2 backend enabled)
- NVIDIA GPU with 8GB+ VRAM, or AMD Strix Halo APU
- 40GB+ free disk space

### Install

```powershell
git clone https://github.com/Light-Heart-Labs/DreamServer.git
cd DreamServer
.\install.ps1
```

The installer handles everything — GPU detection, tier selection, Docker setup, credential generation, service startup, and Desktop/Start Menu shortcuts.

### Manage

```powershell
.\dream-server\installers\windows\dream.ps1 status           # Health checks + GPU status
.\dream-server\installers\windows\dream.ps1 start            # Start all services
.\dream-server\installers\windows\dream.ps1 stop             # Stop all services
.\dream-server\installers\windows\dream.ps1 restart           # Restart all services
.\dream-server\installers\windows\dream.ps1 logs llm          # Tail LLM logs
```

### Common Windows Issues

**Ollama conflict:** If you set `OLLAMA_PORT=11434` and Ollama Desktop is running, ports will conflict. Keep `OLLAMA_PORT=8080` (default) or stop Ollama.

**Docker Desktop not running:** Start Docker Desktop from the Start Menu before running the installer.

**WSL2 backend not enabled:** Open Docker Desktop > Settings > General > check "Use WSL 2 based engine".

---

## Stopping

```bash
# NVIDIA
docker compose down

# AMD Strix Halo
docker compose -f docker-compose.base.yml -f docker-compose.amd.yml down
```

```powershell
# Windows
.\dream-server\installers\windows\dream.ps1 stop
```

## Updating

```bash
# NVIDIA
docker compose pull
docker compose up -d

# AMD Strix Halo
docker compose -f docker-compose.base.yml -f docker-compose.amd.yml pull
docker compose -f docker-compose.base.yml -f docker-compose.amd.yml up -d --build
```

```powershell
# Windows
.\dream-server\installers\windows\dream.ps1 update
```

---

Built by The Collective • [DreamServer](https://github.com/Light-Heart-Labs/DreamServer)
