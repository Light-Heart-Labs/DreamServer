# llama-server

Core LLM inference engine for Dream Server

## Overview

llama-server is the local LLM inference backend, powered by [llama.cpp](https://github.com/ggml-org/llama.cpp). It loads GGUF-format models and exposes an OpenAI-compatible HTTP API on port 8080. GPU acceleration is provided via CUDA (NVIDIA) or ROCm (AMD); CPU fallback is available for systems without a supported GPU.

All other services that perform AI inference — Open WebUI, LiteLLM, Privacy Shield, and the dashboard chat endpoint — connect to llama-server internally.

## Features

- **OpenAI-compatible API**: Drop-in replacement for the OpenAI Chat Completions and Completions endpoints
- **GGUF model support**: Load any GGUF-quantized model from `data/models/`
- **GPU acceleration**: CUDA (NVIDIA) and ROCm/HIP (AMD) backends
- **Configurable context window**: Token limit tunable via `CTX_SIZE`
- **Prometheus metrics**: `/metrics` endpoint for throughput and token stats
- **Multi-GPU offload**: All GPU layers offloaded with `--n-gpu-layers 999`
- **Hardware-tier model selection**: Installer auto-selects model size based on detected VRAM

## Configuration

Environment variables (set in `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `GGUF_FILE` | `Qwen3-8B-Q4_K_M.gguf` | Model filename inside `data/models/` |
| `CTX_SIZE` | `16384` | Context window size in tokens |
| `OLLAMA_PORT` | `11434` | External port (maps to internal 8080) |
| `GPU_BACKEND` | `nvidia` | GPU backend: `nvidia` or `amd` |
| `LLAMA_SERVER_MEMORY_LIMIT` | `64G` | Docker memory limit for the container |

### AMD-specific variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VIDEO_GID` | `44` | GID of the `video` group (`getent group video \| cut -d: -f3`) |
| `RENDER_GID` | `992` | GID of the `render` group (`getent group render \| cut -d: -f3`) |

## API Endpoints

llama-server exposes an OpenAI-compatible REST API:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/metrics` | Prometheus inference metrics |
| `POST` | `/v1/chat/completions` | Chat completions (OpenAI format) |
| `POST` | `/v1/completions` | Text completions |
| `GET` | `/v1/models` | List loaded models |

### Example

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "default",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  docker-compose.base.yml  (GPU-agnostic command + ports) │
│        +                                                  │
│  docker-compose.nvidia.yml  OR  docker-compose.amd.yml   │
│        (image + GPU device passthrough)                   │
└──────────────────────────┬──────────────────────────────┘
                           │
                    ┌──────▼──────────┐
                    │  llama-server   │
                    │  (llama.cpp)    │
                    │  :8080 (int)    │
                    │  :11434 (ext)   │
                    └──────┬──────────┘
                           │  OpenAI-compatible API
          ┌────────────────┼──────────────────┐
          │                │                  │
    ┌─────▼─────┐   ┌──────▼───────┐  ┌──────▼──────┐
    │ Open WebUI│   │   LiteLLM    │  │Privacy Shield│
    └───────────┘   └──────────────┘  └─────────────┘
```

## Files

- `manifest.yaml` — Service metadata and feature definitions

## Troubleshooting

**Container not starting:**
```bash
docker compose ps llama-server
docker compose logs llama-server
```

**Model not found:**
- Confirm the GGUF file exists: `ls dream-server/data/models/`
- Check `GGUF_FILE` in `.env` matches the filename exactly

**Out of VRAM:**
- Reduce `CTX_SIZE` in `.env` (try `8192` or `4096`)
- Use a smaller quantized model (Q4 instead of Q8)

**AMD GPU not detected:**
- Verify group IDs: `getent group video | cut -d: -f3` and `getent group render | cut -d: -f3`
- Update `VIDEO_GID` and `RENDER_GID` in `.env`
- Confirm `/dev/kfd` and `/dev/dri` exist on the host

**Check inference metrics:**
```bash
curl http://localhost:11434/metrics
```

## License

Part of Dream Server — Local AI Infrastructure
