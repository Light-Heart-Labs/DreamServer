# ComfyUI

Node-based image generation UI and backend for Dream Server

## Overview

ComfyUI provides a powerful, node-based interface for running Stable Diffusion and FLUX.1 image generation models locally. It exposes both a visual workflow editor in the browser and a REST API, enabling programmatic image generation from other services. ComfyUI requires a GPU (NVIDIA or AMD) and is not available on CPU-only systems.

## Features

- **Node-based workflow editor**: Build and share custom generation pipelines visually
- **FLUX.1 support**: Configured for FLUX.1 image generation out of the box
- **Multiple model types**: Supports checkpoints, LoRAs, VAEs, text encoders, and diffusion models
- **Persistent model storage**: Models stored in `./data/comfyui/models` and survive container rebuilds
- **Workflow templates**: Pre-loaded workflow JSON files from `./data/comfyui/workflows`
- **REST API**: Programmatic image generation via HTTP
- **NVIDIA and AMD GPU support**: Separate optimized images for each GPU vendor

## GPU Requirements

ComfyUI is GPU-only. The service definition is split by GPU vendor:

| Backend | Compose file | Notes |
|---------|-------------|-------|
| NVIDIA (CUDA) | `compose.nvidia.yaml` | Requires NVIDIA Container Toolkit |
| AMD (ROCm) | `compose.amd.yaml` | Targets gfx1151 (RX 9000 series); uses ROCm with flash attention |

> **Apple Silicon:** ComfyUI is not currently configured for Apple Silicon (macOS ARM). Use the native ComfyUI application instead.

## Configuration

Environment variables (set in `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `COMFYUI_PORT` | 8188 | External port for the ComfyUI web UI and API |

## Volume Mounts

### NVIDIA

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `./data/comfyui/models` | `/models` | AI model files (checkpoints, LoRAs, VAEs, etc.) |
| `./data/comfyui/output` | `/output` | Generated images output directory |
| `./data/comfyui/input` | `/input` | Input images for img2img and inpainting |
| `./data/comfyui/workflows` | `/workflows` | Workflow JSON templates (read-only) |

### AMD

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `./data/comfyui/ComfyUI` | `/opt/ComfyUI` | Full ComfyUI installation (models, outputs, custom nodes) |

> **Note:** The AMD image uses a single volume containing the entire ComfyUI directory. Models go inside `./data/comfyui/ComfyUI/models/` rather than a separate `./data/comfyui/models/` mount.

### Model Subdirectories (NVIDIA)

Place model files in the appropriate subdirectory under `./data/comfyui/models/`:

| Subdirectory | Model type |
|-------------|------------|
| `checkpoints/` | Full Stable Diffusion / FLUX checkpoints |
| `diffusion_models/` | Standalone diffusion model weights |
| `text_encoders/` | CLIP and T5 text encoders |
| `vae/` | Variational Autoencoders |
| `loras/` | LoRA fine-tuned weights |
| `latent_upscale_models/` | Latent upscale models |

## Architecture

```
┌──────────┐  HTTP :8188    ┌──────────────┐
│ Browser  │───────────────▶│   ComfyUI    │
│ (Node UI)│◀───────────────│  (PyTorch)   │
└──────────┘                └──────┬───────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
              /models/       /output/        /input/
           (checkpoints,   (generated      (source
            LoRAs, VAEs)    images)         images)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /` | GET | Web UI / health check |
| `POST /prompt` | POST | Queue a generation workflow |
| `GET /queue` | GET | View current generation queue |
| `GET /history` | GET | View completed generation history |
| `GET /view` | GET | Retrieve a generated image by filename |
| `GET /system_stats` | GET | GPU memory and system resource stats |

## Files

- `manifest.yaml` — Service metadata (port, health endpoint, GPU backends, features)
- `compose.yaml` — Base stub (actual definition is in GPU overlays)
- `compose.nvidia.yaml` — NVIDIA CUDA service definition
- `compose.amd.yaml` — AMD ROCm service definition (gfx1151)
- `startup.sh` — Entrypoint script: sets up model symlinks and launches ComfyUI server
- `Dockerfile` — Container build definition (used by NVIDIA overlay)

## Troubleshooting

**ComfyUI not starting (long start period):**

The container has a 120-second start period to allow model loading. Wait for it to elapse, then check:
```bash
docker compose ps dream-comfyui
docker compose logs dream-comfyui --follow
```

**GPU not detected:**

For NVIDIA:
```bash
# Verify NVIDIA Container Toolkit is installed
docker run --rm --gpus all nvidia/cuda:12.0-base nvidia-smi
```

For AMD:
```bash
# Verify GPU device access
ls /dev/dri /dev/kfd
```

**Models not appearing in the UI:**
- Ensure model files are placed in the correct subdirectory under `./data/comfyui/models/`
- Restart ComfyUI or click **Refresh** in the model loader node

**Out of VRAM errors:**
- Use smaller or quantized model variants
- Close other GPU-intensive services before running ComfyUI
- Check VRAM usage: `nvidia-smi` (NVIDIA) or `rocm-smi` (AMD)

**Generated images not saving:**
- Verify `./data/comfyui/output` exists and is writable
- Check container logs for permission errors
