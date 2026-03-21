# Dream Server Windows Installation Walkthrough

Step-by-step guide for installing Dream Server on Windows 10/11 with WSL2, Docker Desktop, and NVIDIA GPU support.

---

## Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Windows | 10 version 2004+ (build 19041) | Windows 11 |
| GPU | NVIDIA with 8GB VRAM | RTX 3060 12GB+ or RTX 4090 |
| RAM | 16GB | 32GB+ |
| Disk | 100GB free SSD | 200GB+ NVMe |
| WSL2 | Enabled | Latest kernel |
| Docker | Docker Desktop | Latest stable |

---

## Step 1: Enable WSL2

Open **PowerShell as Administrator** and run:

```powershell
wsl --install
```

This installs WSL2 and Ubuntu automatically.

**Verify:**
```powershell
wsl --status
# Should show: Default Version: 2
```

**Restart your computer** when prompted.

---

## Step 2: Install NVIDIA Drivers

1. Download latest drivers: https://www.nvidia.com/drivers
2. Install on Windows (do NOT install in WSL2)
3. Verify:
   ```powershell
   nvidia-smi
   # Should show GPU name, driver version, VRAM
   ```

**Note:** Windows drivers automatically provide GPU access to WSL2. No separate WSL driver needed.

---

## Step 3: Install Docker Desktop

1. Download: https://docker.com/products/docker-desktop
2. During install, **check "Use WSL2 instead of Hyper-V"**
3. After install, open Docker Desktop → Settings → General
4. Confirm **"Use the WSL 2 based engine"** is checked
5. Go to Settings → Resources → WSL Integration
6. Enable integration for **Ubuntu**

**Verify GPU in Docker:**
```powershell
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

---

## Step 4: Run Dream Server Installer

Open **PowerShell** (not as admin) and run:

```powershell
# Download installer
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Light-Heart-Labs/DreamServer/v2.1.0/install.ps1" -OutFile install.ps1

# Run installer
.\install.ps1
```

The installer will:
- Detect your GPU and pick the right model tier
- Check prerequisites (WSL2, Docker, NVIDIA)
- Create installation directory at `%LOCALAPPDATA%\DreamServer`
- Download and start all services

**First run takes 10-30 minutes** (downloads ~20GB model).

### Installer Options

```powershell
# Quick start with small model (upgrades later)
.\install.ps1 -Bootstrap

# Specific tier with voice
.\install.ps1 -Tier 2 -Voice

# Full stack with everything
.\install.ps1 -All

# Just check system compatibility
.\install.ps1 -Diagnose
```

---

## Step 5: Verify Installation

### Check Services Are Running

```powershell
# In PowerShell
cd $env:LOCALAPPDATA\DreamServer
docker compose ps
```

You should see containers: `llama-server`, `open-webui`, `searxng`, etc.

### Test GPU Access

```powershell
# Test inside llama-server container
docker exec -it dream-server-llama-server-1 nvidia-smi
```

### Open Web UI

Visit: **http://localhost:3000**

1. Create first account (becomes admin)
2. Select model from dropdown
3. Start chatting!

---

## Step 6: Run Diagnostics

```powershell
# Full system check
.\install.ps1 -Diagnose
```

This verifies:
- WSL2 version and kernel
- Docker Desktop WSL2 backend
- NVIDIA GPU visibility at all layers
- Container health
- Model loading status

---

## Common First-Run Issues

### "Docker Desktop not running"
**Fix:** Start Docker Desktop from Start menu. Wait for whale icon to stabilize.

### "WSL2 not detected"
**Fix:** 
```powershell
wsl --update
wsl --shutdown
```
Then restart Docker Desktop.

### "nvidia-smi fails in Docker"
**Fix:** Ensure Docker Desktop WSL2 backend is enabled. Restart Docker Desktop after enabling.

### "Port 3000 already in use"
**Fix:** Edit `%LOCALAPPDATA%\DreamServer\.env`:
```
WEBUI_PORT=3001
```
Then: `docker compose up -d`

### Model download stuck
**Fix:** Check disk space. Cancel with Ctrl+C, then restart installer — it resumes downloads.

---

## Next Steps

| Task | Command |
|------|---------|
| Stop Dream Server | `docker compose down` |
| Start Dream Server | `docker compose up -d` |
| View logs | `docker compose logs -f` |
| Update | `docker compose pull && docker compose up -d` |
| Enable voice | Add `-Voice` flag or edit `.env` |
| Enable workflows | Add `-Workflows` flag |
| Full test suite | `.\scripts\test-stack.ps1` |

---

## Getting Help

- **Troubleshooting:** See [WSL2-GPU-TROUBLESHOOTING.md](WSL2-GPU-TROUBLESHOOTING.md)
- **Docker optimization:** See [DOCKER-DESKTOP-OPTIMIZATION.md](DOCKER-DESKTOP-OPTIMIZATION.md)
- **FAQ:** See [FAQ.md](../FAQ.md)

---

## Uninstall

```powershell
# Stop and remove containers
cd $env:LOCALAPPDATA\DreamServer
docker compose down -v

# Remove installation directory
Remove-Item -Recurse -Force $env:LOCALAPPDATA\DreamServer
```

---

*Last updated: 2026-02-13*
