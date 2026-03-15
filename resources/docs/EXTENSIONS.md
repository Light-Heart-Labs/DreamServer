# Dream Server Extensions

## Two Kinds of Extension

| I want to... | Type | Start here |
|---|---|---|
| Add a Docker service (new container, health check, dashboard tile) | Service extension | This guide (below) |
| Change the installer itself (new tier, swap theme, add/skip phase) | Installer mod | [docs/INSTALLER-ARCHITECTURE.md](INSTALLER-ARCHITECTURE.md) |

This guide is the fastest path to extend Dream Server without editing core internals.

## Extension Directory Structure

Each extension service is a directory under `extensions/services/`:

```
extensions/services/
  my-service/
    manifest.yaml      # Service metadata (required)
    compose.yaml       # Docker Compose fragment (for extension services)
    compose.amd.yaml   # GPU overlay for AMD (optional)
    compose.nvidia.yaml # GPU overlay for NVIDIA (optional)
```

**Core services** (llama-server, open-webui, dashboard, dashboard-api) have only a `manifest.yaml` — their compose definitions live in `docker-compose.base.yml`.

**Extension services** have both `manifest.yaml` and `compose.yaml`. The compose fragment is merged into the stack automatically by `resolve-compose-stack.sh`.

## What You Can Extend

- **Docker services** via `extensions/services/<name>/compose.yaml`
- **Service metadata** (health checks, ports, aliases, categories) via `manifest.yaml`
- **Feature tiles** exposed by `GET /api/features` via manifest `features` blocks
- **Dashboard UI** via plugin registration in `dashboard/src/plugins/registry.js`

## 30-Minute Path: Add a Service

### Step 1: Create the extension directory

```bash
mkdir extensions/services/my-service
```

### Step 2: Create the manifest

```bash
cp extensions/templates/service-template.yaml extensions/services/my-service/manifest.yaml
```

Edit the manifest:
- set `service.id` to a unique kebab-case ID
- set `service.name`, `service.port`, `service.health`
- set `service.aliases` for CLI shorthand names
- set `service.container_name` (typically `dream-<id>`)
- set `service.category`: `core`, `recommended`, or `optional`
- set `service.compose_file: compose.yaml`
- set `service.depends_on` if it needs other services
- set `service.gpu_backends` (`amd`, `nvidia`, or both)
- add feature entries under `features` if the service unlocks user-visible capability

### Step 3: Create the compose fragment

Create `extensions/services/my-service/compose.yaml`:

```yaml
services:
  my-service:
    image: my-org/my-service:latest
    container_name: dream-my-service
    restart: unless-stopped
    ports:
      - "${MY_SERVICE_PORT:-9200}:8080"
    environment:
      - LLM_URL=http://llama-server:8080/v1
    depends_on:
      llama-server:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
```

The service automatically joins `dream-network` and can reach other services by Docker DNS name.

### Step 4: Validate

```bash
# Schema check
python3 -c "import yaml; yaml.safe_load(open('extensions/services/my-service/manifest.yaml'))"

# Compose merge check
docker compose -f docker-compose.base.yml -f docker-compose.amd.yml \
  -f extensions/services/my-service/compose.yaml config

# Integration/smoke checks
bash tests/integration-test.sh
bash tests/smoke/linux-amd.sh
```

### Step 5: Test it

```bash
# Enable and start
dream enable my-service
dream start my-service

# Verify healthy
dream logs my-service
curl http://localhost:9200/health

# Check it appears in the list
dream list
```

## Enable/Disable Mechanism

- `compose.yaml` present → **enabled** (included in stack)
- `compose.yaml.disabled` → **disabled** (manifest still visible to CLI/dashboard)
- Core services (`category: core`) have no compose.yaml — always on in base.yml

```bash
dream enable my-service    # Renames compose.yaml.disabled → compose.yaml
dream disable my-service   # Stops container, renames compose.yaml → compose.yaml.disabled
dream list                 # Shows all services with status
```

## Manifest Contract (v1)

Required root field:
- `schema_version: dream.services.v1`

Optional root field:
- `compatibility` — version compatibility hints:
  - `dream_min`: minimum Dream Server version this extension supports (e.g. `"2.0.0"`)
  - `dream_max`: maximum Dream Server version this extension was tested against (optional)

Service section:
- required: `id`, `name`, `port`, `health`
- recommended: `aliases`, `container_name`, `compose_file`, `category`, `depends_on`
- optional: `host_env`, `default_host`, `external_port_env`, `external_port_default`, `type`, `gpu_backends`, `env_vars`

Feature section (optional list):
- required per feature: `id`, `name`, `description`, `icon`, `category`, `requirements`, `priority`
- optional: `enabled_services_all`, `enabled_services_any`, `setup_time`, `gpu_backends`

## Service Categories

| Category | Behavior | Examples |
|----------|----------|---------|
| `core` | Always on, lives in base.yml | llama-server, open-webui, dashboard |
| `recommended` | Enabled by default | searxng, litellm, token-spy |
| `optional` | User opts in | n8n, whisper, tts, comfyui |

## GPU Overlay Patterns

If your service uses a GPU, you need overlay files alongside `compose.yaml`. The compose resolver (`resolve-compose-stack.sh`) automatically picks up `compose.nvidia.yaml` or `compose.amd.yaml` based on the detected GPU vendor. Only one overlay is active at a time.

There are two patterns. Pick the one that matches your service:

### Pattern 1: CPU-Base with GPU Tag Swap

**When to use:** Your service works on CPU but runs faster on GPU (e.g., speech-to-text, embedding generation, transcription).

The base `compose.yaml` has the full service definition with a CPU image. The GPU overlay only overrides the image tag and adds GPU device reservations. Everything else (ports, volumes, healthcheck) is inherited from the base.

**File layout:**
```
extensions/services/my-service/
  manifest.yaml
  compose.yaml            # Full definition, CPU image (e.g., :latest-cpu)
  compose.nvidia.yaml     # Swaps image to :latest-cuda, adds GPU devices
  compose.amd.yaml        # Swaps image to :latest-rocm, adds AMD devices
```

**Example** (from whisper):

`compose.yaml` — full service with CPU image:
```yaml
services:
  whisper:
    image: ghcr.io/speaches-ai/speaches:latest-cpu
    container_name: dream-whisper
    # ... ports, volumes, healthcheck, etc.
```

`compose.nvidia.yaml` — only the GPU-specific overrides:
```yaml
services:
  whisper:
    image: ghcr.io/speaches-ai/speaches:latest-cuda
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
        limits:
          cpus: '4.0'
          memory: 8G
```

### Pattern 2: Empty Base with Full GPU Overlay

**When to use:** Your service only makes sense on a GPU, with no CPU fallback (e.g., image generation, video rendering).

The base `compose.yaml` is an empty stub (`services: {}`). Each GPU overlay contains the complete service definition. The definitions often differ significantly between vendors (different images, device passthrough, environment variables, CLI flags).

**File layout:**
```
extensions/services/my-service/
  manifest.yaml
  compose.yaml            # Empty stub: services: {}
  compose.nvidia.yaml     # Complete NVIDIA definition
  compose.amd.yaml        # Complete AMD definition
```

**Example** (from comfyui):

`compose.yaml` — empty stub so the registry detects the service:
```yaml
# ComfyUI — Image Generation
# The GPU overlay provides the full service definition.
services: {}
```

`compose.nvidia.yaml` — full service definition:
```yaml
services:
  comfyui:
    build:
      context: ./comfyui
      dockerfile: Dockerfile
    container_name: dream-comfyui
    restart: unless-stopped
    ports:
      - "${COMFYUI_PORT:-8188}:8188"
    volumes:
      - ./data/comfyui/models:/models
      # ... other mounts
    shm_size: '8g'
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    healthcheck:
      test: ["CMD", "wget", "--spider", "--quiet", "http://localhost:8188"]
      interval: 30s
      timeout: 10s
      start_period: 120s
      retries: 3
```

`compose.amd.yaml` — full service with AMD-specific config:
```yaml
services:
  comfyui:
    image: ignatberesnev/comfyui-gfx1151:v0.2
    container_name: dream-comfyui
    devices:
      - /dev/dri:/dev/dri
      - /dev/kfd:/dev/kfd
    group_add:
      - "${VIDEO_GID:-44}"
      - "${RENDER_GID:-992}"
    environment:
      - HSA_OVERRIDE_GFX_VERSION=11.5.1
    # ... ports, volumes, healthcheck, deploy, etc.
```

### GPU Overlay Quick Reference

| | Pattern 1 (tag swap) | Pattern 2 (GPU-only) |
|---|---|---|
| CPU fallback? | Yes | No |
| Base compose.yaml | Full service definition | `services: {}` |
| GPU overlay contains | Image tag + deploy block | Entire service definition |
| Example service | whisper | comfyui |
| Template | `extensions/templates/compose-gpu-swap.yaml` | `extensions/templates/compose-gpu-only.yaml` |

### AMD-Specific Notes

AMD ROCm requires additional container configuration compared to NVIDIA:
- **Device passthrough:** `/dev/dri` (rendering) and `/dev/kfd` (compute)
- **Group membership:** Container user must be in the host's `video` and `render` groups
- **GFX version override:** Set `HSA_OVERRIDE_GFX_VERSION` to match your GPU (check with `rocminfo | grep gfx`)
- **Security relaxation:** `cap_add: SYS_PTRACE` and `seccomp:unconfined` may be needed for ROCm profiling

## Compatibility Checklist

- Service ID is unique and stable
- Health endpoint is cheap and deterministic
- Feature requirements use real service IDs
- AMD/NVIDIA support is explicitly declared
- Docs/examples reference canonical paths (`config/n8n`, `docker compose`)
- CI scripts pass locally (`integration-test`, smoke scripts, syntax checks)

## Testing Checklist (PR Gate)

- `bash -n` on changed shell files
- `python3 -m py_compile dashboard-api/main.py`
- `bash tests/integration-test.sh`
- relevant smoke scripts in `tests/smoke/`
- if dashboard code changed and Node is available:
```bash
cd dashboard
npm install
npm run lint
npm run build
```

## Notes

- Manifest loading is additive with safe fallback defaults.
- Unknown/malformed manifests are skipped with warnings, not fatal crashes.
- Keep extension files ASCII and small; one service per directory is preferred.
- The service registry (`lib/service-registry.sh`) provides bash functions for resolving aliases and discovering enabled services.
- **Scripts that load `.env`:** Source `lib/safe-env.sh` and use `load_env_file "<path>"`; do not use `eval` or `export $(grep ... .env | xargs)` (injection risk).
