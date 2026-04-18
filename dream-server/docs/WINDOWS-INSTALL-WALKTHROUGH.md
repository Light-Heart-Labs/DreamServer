# Dream Server Windows Installation Walkthrough

Step-by-step guide for installing Dream Server on Windows 10/11 through Docker Desktop + WSL2.

---

## Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Windows | 10 version 2004+ (build 19041) | Windows 11 |
| GPU | NVIDIA with 8GB VRAM or AMD Strix Halo | RTX 3060 12GB+, RTX 4090, or Ryzen AI MAX+ 395 |
| RAM | 16GB | 32GB+ |
| Disk | 30GB free SSD | 100GB+ NVMe |
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

## Step 2: Install GPU Drivers

### NVIDIA

1. Download latest drivers: https://www.nvidia.com/drivers
2. Install on Windows (do NOT install in WSL2)
3. Verify:
   ```powershell
   nvidia-smi
   # Should show GPU name, driver version, VRAM
   ```

**Note:** Windows drivers automatically provide GPU access to WSL2. No separate WSL driver needed.

### AMD Strix Halo

1. Install the latest AMD Windows graphics drivers
2. Reboot if prompted
3. Continue with the normal installer flow

**Note:** On the supported AMD Windows path, `llama-server` runs natively on the host and the rest of the stack runs in Docker.

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
docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi
```

---

## Step 4: Run Dream Server Installer

Open **PowerShell** (not as admin) and run:

```powershell
# Download installer
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Light-Heart-Labs/DreamServer/v2.4.0/install.ps1" -OutFile install.ps1

# Run installer
.\install.ps1
```

The installer will:
- Detect your GPU and pick the right model tier
- Check prerequisites (WSL2, Docker, GPU, disk, ports)
- Create installation directory at `$env:USERPROFILE\dream-server`
- Download and start all services
- Install the `dream.ps1` management CLI

**First run takes 10-30 minutes** (downloads ~20GB model).

### Installer Options

```powershell
# Validate prerequisites and planned actions without installing
.\install.ps1 -DryRun

# Specific tier with voice
.\install.ps1 -Tier 2 -Voice

# Cloud-only mode
.\install.ps1 -Cloud

# Full stack with everything
.\install.ps1 -All

# Expose services on your LAN
.\install.ps1 -Lan
```

---

## Step 5: Verify Installation

### Check Services Are Running

```powershell
# In PowerShell
cd $env:USERPROFILE\dream-server
.\dream.ps1 status
```

You should see core services such as `llama-server`, `open-webui`, and `dashboard` reported as healthy.

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

## Step 6: Validate the Setup Plan

```powershell
# Dry-run the installer to re-check prerequisites without changing the install
.\install.ps1 -DryRun
```

This verifies:
- WSL2 version and kernel
- Docker Desktop WSL2 backend
- GPU visibility and tier selection
- Disk and port readiness
- Planned installer actions

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
**Fix:** Edit `$env:USERPROFILE\dream-server\.env`:
```
WEBUI_PORT=3001
```
Then run: `.\dream.ps1 restart`

### Model download stuck
**Fix:** Check disk space. Cancel with Ctrl+C, then restart installer — it resumes downloads.

---

## Next Steps

| Task | Command |
|------|---------|
| Stop Dream Server | `.\dream.ps1 stop` |
| Start Dream Server | `.\dream.ps1 start` |
| View logs | `.\dream.ps1 logs llama-server` |
| Update | `.\dream.ps1 update` |
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
cd $env:USERPROFILE\dream-server
.\dream.ps1 stop

# Remove installation directory
Remove-Item -Recurse -Force $env:USERPROFILE\dream-server
```

---

*Last updated: 2026-04-15*
