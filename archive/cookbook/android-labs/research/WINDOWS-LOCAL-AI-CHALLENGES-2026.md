# Windows-Specific Challenges for Local AI Deployment (2026)

*Research for Michael's Windows laptop test (mobile RTX 5090, 24GB VRAM)*
*Mission: M5 (Dream Server), M6 (Min Hardware)*

---

## Executive Summary

Windows + WSL2 + Docker Desktop + CUDA is a viable stack for local AI, but has specific friction points that Linux doesn't. This doc captures known issues and workarounds.

---

## 1. GPU Passthrough (CUDA on WSL2)

### How It Works
- Windows NVIDIA driver provides CUDA support to WSL2 via `libcuda.so` stub
- **DO NOT install NVIDIA drivers inside WSL2** — they conflict with the Windows driver passthrough
- Docker Desktop uses WSL2 backend for GPU access

### Common Issues

| Issue | Symptom | Fix |
|-------|---------|-----|
| Wrong driver in WSL | `nvidia-smi` fails or shows wrong GPU | Remove any Linux NVIDIA packages from WSL |
| Old Windows driver | CUDA version mismatch | Update Windows NVIDIA driver |
| WSL2 kernel outdated | GPU not visible | `wsl --update` |
| Container can't see GPU | `--gpus all` does nothing | Ensure Docker Desktop → Settings → WSL2 integration enabled |

### Verification Commands
```bash
# From WSL2
nvidia-smi                    # Should show Windows GPU
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

### Michael's 5090 Notes
- Mobile 5090 (24GB) is new hardware — may need latest driver
- Should run Qwen 32B-AWQ comfortably with 32K context
- Watch for power throttling on laptop (plugged in vs battery)

---

## 2. Docker Desktop vs Native Docker

### The Problem
Docker Desktop on Windows is slower than native Linux Docker, especially for:
- File I/O (bind mounts from Windows → WSL2)
- Network throughput
- Container startup time

### Performance Tips

1. **Store files in WSL2 filesystem, not Windows**
   - Bad: `/mnt/c/Users/michael/project`
   - Good: `~/project` (inside WSL2)
   - 10-20x faster file operations

2. **Use WSL2 backend** (not Hyper-V)
   - Docker Desktop → Settings → General → "Use WSL2 based engine" ✓

3. **Increase WSL2 resources**
   Create `%USERPROFILE%\.wslconfig`:
   ```ini
   [wsl2]
   memory=32GB          # Adjust based on total RAM
   processors=8         # Adjust based on CPU cores
   swap=8GB
   localhostForwarding=true
   ```

4. **Disable file watchers on Windows mounts**
   - If you must use Windows paths, disable filesystem notifications

### Docker Desktop Alternatives
- **Rancher Desktop** — similar features, sometimes better performance
- **Podman** — rootless, but less ecosystem support
- Native Docker in WSL2 (no Desktop) — fastest, but more complex setup

---

## 3. WSL2 Memory Limits

### Default Behavior
WSL2 defaults to ~50% of total RAM or 8GB (whichever is less on older versions).

### For AI Workloads
AI inference needs more memory. Configure `.wslconfig`:

```ini
[wsl2]
memory=48GB           # For 64GB system, leave 16GB for Windows
swap=16GB             # Helps with spikes
```

### Memory Symptoms
| Symptom | Cause | Fix |
|---------|-------|-----|
| OOM killer hits vLLM | WSL2 memory cap | Increase in .wslconfig |
| Windows becomes sluggish | Too much to WSL2 | Reduce memory allocation |
| Container exits code 137 | Out of memory | Check `docker stats`, increase limit |

---

## 4. CUDA Compatibility

### Version Matrix (as of 2026)
| Component | Required Version |
|-----------|-----------------|
| Windows NVIDIA Driver | 550+ for CUDA 12.x |
| CUDA Toolkit (in container) | Match driver capability |
| cuDNN | Bundled in most AI containers |

### Checking Compatibility
```bash
# Windows (PowerShell)
nvidia-smi

# WSL2
cat /usr/local/cuda/version.txt    # If CUDA toolkit installed
python -c "import torch; print(torch.cuda.get_device_capability())"
```

### Common Mismatches
- **Container built for CUDA 11.x, driver only supports 12.x** — usually works (backward compat)
- **Container built for CUDA 12.x, driver only supports 11.x** — fails, need driver update
- **PyTorch/TensorFlow version mismatch** — use containers with pinned versions

---

## 5. Common Failure Modes

### Installer Failures

| Failure | Cause | Fix |
|---------|-------|-----|
| `wsl --install` hangs | Windows feature not enabled | Enable "Virtual Machine Platform" in Windows Features |
| Docker Desktop won't start | WSL2 not default | `wsl --set-default-version 2` |
| GPU not visible in container | Docker not using WSL2 backend | Check Docker Desktop settings |
| Permission denied on bind mount | Windows path permissions | Use WSL2 paths instead |

### Runtime Failures

| Failure | Cause | Fix |
|---------|-------|-----|
| vLLM OOM on startup | Not enough GPU memory | Use quantized model (AWQ/GPTQ) |
| Whisper hangs | CPU fallback, no GPU | Verify GPU visible with `nvidia-smi` |
| TTS no audio output | Audio passthrough issues | Use file output, not direct audio |
| Slow model loading | Loading from Windows mount | Copy model to WSL2 filesystem |

### Network Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Can't reach localhost:8000 | WSL2 networking quirk | Use `host.docker.internal` or `[::1]` |
| Ports not exposed | Docker Desktop firewall | Check Windows Firewall rules |
| Slow API responses | Cross-filesystem latency | Keep everything in WSL2 |

---

## 6. Dream Server Windows-Specific Notes

### install.ps1 Should Handle
- [x] WSL2 installation/update
- [x] Docker Desktop installation
- [x] GPU detection and tier recommendation
- [ ] .wslconfig generation based on system RAM
- [ ] Windows Firewall rules for exposed ports

### Recommended Test Sequence
1. Fresh Windows install (or clean user profile)
2. Run `install.ps1` as Administrator
3. Verify GPU visible: `docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi`
4. Run Dream Server: `docker compose up -d`
5. Test each service endpoint
6. Run voice workflow end-to-end

### Expected Friction Points for Michael
1. First WSL2 install may require restart
2. Docker Desktop license agreement popup
3. NVIDIA driver update if 5090 is very new
4. Memory configuration if laptop has ≤32GB RAM

---

## References

- [NVIDIA CUDA on WSL](https://docs.nvidia.com/cuda/wsl-user-guide/)
- [Docker Desktop GPU Support](https://docs.docker.com/desktop/features/gpu/)
- [WSL2 Configuration](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)
- [Microsoft CUDA on WSL](https://learn.microsoft.com/en-us/windows/ai/directml/gpu-cuda-in-wsl)

---

*Update this doc based on Michael's actual test results.*
