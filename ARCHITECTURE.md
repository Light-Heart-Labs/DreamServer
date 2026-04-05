# Dream Server Architecture

> Version 2.4.0 | Fully local AI stack deployed on user hardware with a single command

## Overview

Dream Server is a self-hosted AI platform that orchestrates 19 microservices via Docker Compose across four GPU backends (NVIDIA, AMD, Apple Silicon, Intel Arc) and CPU-only fallback. The system is structured in two layers: an **outer wrapper** (installer scripts, CI, resources) and the **core product** (`dream-server/`) containing all deployable code.

The architecture follows a **layered compose model**: a base compose file defines core services, GPU-specific overlays configure hardware acceleration, and extension compose files add optional services. A registry-driven CLI (`dream-cli`) manages the lifecycle.

### Codebase at a Glance

| Metric | Value |
|--------|-------|
| Files | 1,193 |
| Symbols | 12,331 |
| Execution Flows | 300 |
| Functional Clusters | 30 |

## System Architecture

```mermaid
graph TB
    subgraph External["User Access (localhost only)"]
        Browser["Browser"]
    end

    subgraph Core["Core Services"]
        LLAMA["llama-server<br/>:8080<br/>LLM Inference"]
        WEBUI["open-webui<br/>:3000<br/>Chat UI"]
        DASH["dashboard<br/>:3001<br/>Control Center"]
        DAPI["dashboard-api<br/>:3002<br/>System Status API"]
    end

    subgraph Gateway["API Gateway"]
        LITE["litellm<br/>:4000<br/>OpenAI-compatible proxy"]
    end

    subgraph Voice["Voice Pipeline"]
        WHISPER["whisper<br/>:9000<br/>Speech-to-Text"]
        TTS["tts / Kokoro<br/>:8880<br/>Text-to-Speech"]
    end

    subgraph Search["Search & Research"]
        SEARX["searxng<br/>:8888<br/>Metasearch"]
        PERP["perplexica<br/>:3004<br/>Deep Research"]
    end

    subgraph Agents["Agents & Automation"]
        CLAW["openclaw<br/>:7860<br/>Agent Framework"]
        APE["ape<br/>:7890<br/>Policy Engine"]
        N8N["n8n<br/>:5678<br/>Workflows"]
    end

    subgraph RAG["RAG Pipeline"]
        QDRANT["qdrant<br/>:6333<br/>Vector DB"]
        EMBED["embeddings<br/>:8090<br/>TEI Vectors"]
    end

    subgraph Media["Media Generation"]
        COMFY["comfyui<br/>:8188<br/>Image Gen"]
    end

    subgraph Privacy["Privacy & Observability"]
        SHIELD["privacy-shield<br/>:8085<br/>PII Protection"]
        SPY["token-spy<br/>:3005<br/>Usage Monitor"]
        LANG["langfuse<br/>:3006<br/>LLM Tracing"]
    end

    subgraph Dev["Development"]
        CODE["opencode<br/>:3003<br/>Web IDE"]
    end

    Browser --> WEBUI
    Browser --> DASH
    Browser --> LITE
    Browser --> CODE

    WEBUI --> LLAMA
    WEBUI --> COMFY
    WEBUI --> WHISPER
    WEBUI --> TTS
    WEBUI --> SEARX

    LITE --> LLAMA

    DASH --> DAPI
    DAPI --> LLAMA
    DAPI --> N8N
    DAPI --> SPY
    DAPI --> SHIELD

    CLAW --> LLAMA
    CLAW --> SEARX

    PERP --> LLAMA
    PERP --> SEARX

    SHIELD --> LLAMA
```

## Functional Areas

### 1. Inference Layer

The LLM inference engine (`llama-server`) is the foundation. GPU overlays select the correct container image and runtime:

| Backend | Image | Acceleration |
|---------|-------|-------------|
| NVIDIA | `llama.cpp:server-cuda-b8248` | CUDA, all GPUs reserved |
| AMD | Custom `dream-lemonade-server` | ROCm / Vulkan / NPU via Lemonade |
| Apple | `llama.cpp:server-b8248` (ARM64) | CPU in Docker (Metal on host) |
| Intel Arc | SYCL backend | Experimental |
| CPU | `llama.cpp:server-b8248` | Pure CPU fallback |

**LiteLLM** (port 4000) sits in front as an OpenAI-compatible proxy, enabling cloud fallback in hybrid mode and standardized API access for all consumers.

### 2. Chat & UI Layer

- **open-webui** (port 3000) — Primary chat interface with integrated image generation (ComfyUI/SDXL), voice I/O (Whisper + Kokoro), and web search (SearXNG)
- **dashboard** (port 3001) — React/Vite control center for feature discovery, service health, setup wizard, model management
- **dashboard-api** (port 3002) — FastAPI backend with routers for setup, features, agents, privacy, workflows, and updates

### 3. Search & Research

- **searxng** (port 8888) — Privacy-respecting metasearch engine
- **perplexica** (port 3004) — Deep research combining search results with LLM reasoning

### 4. Agents & Automation

- **openclaw** (port 7860) — AI agent framework with tool access (exec, read, write, web), up to 20 concurrent subagents
- **ape** (port 7890) — Agent Policy Engine enforcing allow/deny rules on tool access
- **n8n** (port 5678) — Visual workflow automation with a pre-built catalog

### 5. RAG Pipeline

- **qdrant** (port 6333) — Vector database for document retrieval
- **embeddings** (port 8090) — HuggingFace TEI for generating vector embeddings

### 6. Voice Pipeline

- **whisper** (port 9000) — Speech-to-text (OpenAI-compatible API)
- **tts/Kokoro** (port 8880) — Text-to-speech (OpenAI-compatible API)

### 7. Media Generation

- **comfyui** (port 8188) — Image generation with SDXL Lightning (4-step)

### 8. Privacy & Observability

- **privacy-shield** (port 8085) — PII detection and scrubbing middleware
- **token-spy** (port 3005) — Token usage and cost tracking
- **langfuse** (port 3006) — LLM observability and tracing

### 9. Development

- **opencode** (port 3003) — Web IDE (runs as host systemd service, not Docker)

## Code Clusters (GitNexus Analysis)

The codebase organizes into 30 functional clusters identified by call-graph analysis. The top clusters by symbol count:

| Cluster | Symbols | Cohesion | Primary Location | Purpose |
|---------|---------|----------|-----------------|---------|
| Tests | 659 | 69% | `tests/`, `**/test_*.py` | Shell (BATS), Python (pytest), smoke, integration |
| Sidecar | 380 | 72% | `resources/products/token-spy/sidecar/` | API proxy, rate limiting, tenant/org middleware, DB backend |
| Voice-classifier | 127 | 82% | `resources/products/voice-classifier/` | Intent classification, entity extraction, FSM routing |
| Scripts | 82 | 77% | `dream-server/scripts/` | Health checks, validation, GPU assignment, model validation |
| Privacy-shield | 81 | 87% | `resources/products/privacy-shield/` | PII detection/scrubbing with 10+ custom recognizers |
| Hooks | 74 | 83% | `*/dashboard/src/hooks/`, `*/src/lib/api.ts` | React hooks and API client for dashboards |
| Tools | 65 | 85% | `resources/tools/` | Dev tools, benchmarks, LiveKit testing |
| Token-spy | 49 | 64% | `dream-server/extensions/services/token-spy/` | Gateway config, agent polling, streaming, settings |
| Routers | 43 | 57% | `dream-server/extensions/services/dashboard-api/routers/` | FastAPI routers: workflows, extensions, privacy, updates |
| Dashboard-api | 32 | 74% | `dream-server/extensions/services/dashboard-api/` | GPU detection, service health, system metrics |
| Pages | 31 | 97% | `*/dashboard/src/pages/` | React UI pages (models, settings, provider keys) |
| Dashboard | 29 | 68% | `resources/products/token-spy/dashboard/` | Token-spy dashboard: usage, costs, sessions, orgs |
| Platform | 25 | 98% | `installer/src-tauri/src/` | Tauri GUI installer: platform detection, Docker management |
| Components | 14 | 100% | `*/dashboard/src/components/` | Shared React UI components |

### Token-spy Sidecar (Detailed)

The Sidecar is the largest non-test cluster (380 symbols). It is a full API gateway subsystem:

```mermaid
graph LR
    REQ["Incoming Request"] --> PROXY["proxy.py<br/>Chat/Message routing"]
    PROXY --> TENANT["tenant_middleware.py<br/>Tenant extraction & features"]
    PROXY --> KEYS["provider_keys.py<br/>Upstream API key lookup"]
    PROXY --> RATE["rate_limiter.py<br/>Token bucket rate limiting"]
    KEYS --> DB["db_backend.py<br/>Connection pool & queries"]
    PROXY --> AUDIT["audit_logger.py<br/>Request/response logging"]
    AUDIT --> DB
    subgraph Management
        ORG["org_api.py<br/>Organization CRUD"]
        ORGMW["org_middleware.py<br/>Org context injection"]
    end
    ORG --> DB
```

### Privacy Shield Pipeline

Privacy Shield intercepts chat requests and scrubs PII before they reach the LLM:

```mermaid
graph LR
    CHAT["chat_completions()"] --> ANON["anonymize_messages()"]
    ANON --> SHIELD["shield()"]
    SHIELD --> ENGINES["get_engines()"]
    ENGINES --> RECOG["get_custom_recognizers()"]
    RECOG --> R1["SSNRecognizer"]
    RECOG --> R2["OpenAIKeyRecognizer"]
    RECOG --> R3["AnthropicKeyRecognizer"]
    RECOG --> R4["AWSAccessKeyRecognizer"]
    RECOG --> R5["JWTRecognizer"]
    RECOG --> R6["ConnectionStringRecognizer"]
    RECOG --> R7["+ 4 more recognizers"]
```

### Voice Classifier Architecture

The voice classifier runs a finite state machine (FSM) for multi-turn voice interactions:

```mermaid
graph TB
    ENTRY["entrypoint()"] --> AGENT["DreamVoiceAgent"]
    AGENT --> CLASS["IntentClassifier / QwenClassifier"]
    AGENT --> FSM["FlowContext (FSM)"]
    FSM --> ROUTE["RoutingDecision"]
    CLASS --> EXTRACT["Entity Extractors"]
    EXTRACT --> E1["NameExtractor"]
    EXTRACT --> E2["NumberExtractor"]
    EXTRACT --> E3["DateExtractor"]
```

## Traced Execution Flows

Key cross-module execution flows identified by call-graph tracing:

### Chat Proxy → Database Pool (6 steps)

```
proxy_chat_completions (sidecar/proxy.py)
  → get_upstream_api_key (sidecar/provider_keys.py)
    → get_active_provider_key (sidecar/db_backend.py)
      → get_db_connection (sidecar/db_backend.py)
        → get_connection (sidecar/db_backend.py)
          → init_pool (sidecar/db_backend.py)
```

Every chat/message proxy request traverses this path to resolve the upstream API key from the tenant's active provider configuration.

### Chat → PII Scrubbing (6 steps)

```
chat_completions (privacy-shield/proxy.py)
  → anonymize_messages (privacy-shield/proxy.py)
    → shield (privacy-shield/shield.py)
      → get_engines (privacy-shield/shield.py)
        → get_custom_recognizers (privacy-shield/custom_recognizers.py)
          → SSNRecognizer (privacy-shield/custom_recognizers.py)
```

Privacy Shield intercepts chat completions, passes messages through the Presidio-based anonymization engine with custom recognizers for API keys, SSNs, JWTs, and internal hostnames.

### Audit Log Export → Database Pool (6 steps)

```
export_audit_logs (sidecar/api.py)
  → log (sidecar/audit_logger.py)
    → flush (sidecar/audit_logger.py)
      → get_db_connection (sidecar/db_backend.py)
        → get_connection (sidecar/db_backend.py)
          → init_pool (sidecar/db_backend.py)
```

### Validation Pipeline (6 steps)

```
main (scripts/validate-sim-summary.py)
  → validate_summary (scripts/validate-sim-summary.py)
    → _require_nonempty_string (scripts/validate-sim-summary.py)
      → _require_type (scripts/validate-sim-summary.py)
        → add (scripts/validate-sim-summary.py)
          → ValidationIssue (scripts/validate-sim-summary.py)
```

The validation pipeline verifies installer simulation summaries, ensuring all expected fields are present and correctly typed.

## Installer Architecture

The installer is a 13-phase pipeline orchestrated by `install-core.sh`. Libraries in `installers/lib/` are pure functions (no side effects); phases in `installers/phases/` execute sequentially. A Tauri-based GUI installer (`installer/src-tauri/`) provides a cross-platform graphical alternative with Rust backends for platform detection (`platform/linux.rs`, `platform/macos.rs`, `platform/windows.rs`), Docker management (`docker.rs`), and WSL2 provisioning.

```mermaid
graph LR
    subgraph Libraries["installers/lib/ (pure functions)"]
        C[constants] --> D[detection]
        D --> T[tier-map]
        T --> CS[compose-select]
        P[packaging]
        U[ui]
        L[logging]
    end

    subgraph Phases["installers/phases/ (sequential)"]
        P01["01 Preflight"] --> P02["02 Detection"]
        P02 --> P03["03 Features"]
        P03 --> P04["04 Requirements"]
        P04 --> P05["05 Docker"]
        P05 --> P06["06 Directories"]
        P06 --> P07["07 DevTools"]
        P07 --> P08["08 Images"]
        P08 --> P09["09 Offline"]
        P09 --> P10["10 AMD Tuning"]
        P10 --> P11["11 Services"]
        P11 --> P12["12 Health"]
        P12 --> P13["13 Summary"]
    end

    Libraries --> Phases
```

| Phase | Purpose |
|-------|---------|
| 01 Preflight | Root/OS/tools checks, existing install detection |
| 02 Detection | GPU hardware detection, tier assignment, compose config selection |
| 03 Features | Interactive feature selection (voice, workflows, RAG, images, etc.) |
| 04 Requirements | RAM, disk, GPU, port availability checks |
| 05 Docker | Install Docker, Compose, NVIDIA Container Toolkit |
| 06 Directories | Create dirs, copy source, generate `.env`, configure services |
| 07 DevTools | Install Claude Code, Codex CLI, OpenCode |
| 08 Images | Build image pull list, download all Docker images |
| 09 Offline | Configure air-gapped operation |
| 10 AMD Tuning | AMD APU sysctl, modprobe, GRUB, tuned setup |
| 11 Services | Download GGUF model, generate `models.ini`, launch stack |
| 12 Health | Verify all services responding, pre-download STT models |
| 13 Summary | Generate URLs, desktop shortcuts, summary JSON |

## Docker Compose Layering

The stack uses compose file merging. The resolver script dynamically discovers enabled extensions and composes the full stack:

```mermaid
graph TB
    BASE["docker-compose.base.yml<br/>(core services)"]
    GPU["docker-compose.{nvidia,amd,apple,cpu}.yml<br/>(GPU overlay)"]
    EXT1["extensions/services/comfyui/compose.yaml"]
    EXT2["extensions/services/n8n/compose.yaml"]
    EXT3["extensions/services/.../compose.yaml"]
    EXTGPU["extensions/services/.../compose.nvidia.yaml"]

    BASE --> MERGE["resolve-compose-stack.sh"]
    GPU --> MERGE
    EXT1 --> MERGE
    EXT2 --> MERGE
    EXT3 --> MERGE
    EXTGPU --> MERGE
    MERGE --> STACK["Final Docker Compose Stack"]
```

## Key Execution Flows

### 1. Installation Flow

`install.sh` → `install-core.sh` → sources `installers/lib/*.sh` → sources `installers/phases/01..13.sh` sequentially. Each phase reads state set by prior phases via exported variables. Hardware detection (phase 02) drives all downstream decisions: tier assignment selects the model GGUF, context window, batch size, and compose overlays.

### 2. Service Startup Flow

`dream-cli start` → `resolve-compose-stack.sh` reads enabled services from `.env` → assembles `docker compose -f base -f gpu-overlay -f ext1 -f ext2 ...` → `docker compose up -d`. Health checks gate dependent services (e.g., `open-webui` waits for `llama-server` healthy).

### 3. Chat Request Flow

Browser → `open-webui:3000` → `llama-server:8080/v1/chat/completions` → GPU inference → response streamed back. If hybrid mode: `open-webui` → `litellm:4000` → tries `llama-server` first, falls back to cloud API.

### 4. Agent Execution Flow

Browser → `openclaw:7860` → agent spawns with tools (exec, read, write, web) → tool calls hit `searxng:8888` for search, `llama-server:8080` for reasoning → `ape:7890` enforces policy on each tool invocation → results streamed back.

### 5. Dashboard Feature Discovery Flow

Browser → `dashboard:3001` → `dashboard-api:3002/api/features` → API reads all service manifests, checks container health via Docker socket, cross-references GPU capabilities and VRAM → returns feature list with status (`enabled`, `available`, `insufficient_vram`, `services_needed`) and recommendations.

## Configuration

### Environment Variables (Key Connections)

| Variable | Default | Controls |
|----------|---------|----------|
| `GPU_BACKEND` | detected | `nvidia`, `amd`, `apple`, `cpu` |
| `GGUF_FILE` | tier-dependent | Model file in `/data/models/` |
| `CTX_SIZE` | `16384` | Context window (tokens) |
| `DREAM_MODE` | `local` | `local`, `cloud`, `hybrid` |
| `LITELLM_KEY` | generated | API gateway authentication |
| `DASHBOARD_API_KEY` | generated | Dashboard API authentication |

### Port Map

All services bind to `127.0.0.1` (localhost only). Canonical port assignments live in `config/ports.json`.

| Port | Service | Port | Service |
|------|---------|------|---------|
| 3000 | open-webui | 6333 | qdrant |
| 3001 | dashboard | 7860 | openclaw |
| 3002 | dashboard-api | 7890 | ape |
| 3003 | opencode | 8080 | llama-server |
| 3004 | perplexica | 8085 | privacy-shield |
| 3005 | token-spy | 8090 | embeddings |
| 3006 | langfuse | 8188 | comfyui |
| 4000 | litellm | 8880 | tts |
| 5678 | n8n | 8888 | searxng |
| 9000 | whisper | | |

## Extension System

Every service is an extension under `extensions/services/<id>/` with:

- `manifest.yaml` — Service contract (id, port, health endpoint, category, GPU backends, dependencies, features)
- `compose.yaml` — Docker Compose service definition (optional; core services live in `docker-compose.base.yml`)
- `compose.{nvidia,amd}.yaml` — GPU-specific overlays
- `Dockerfile` — Custom image build (if needed)

The manifest schema is enforced by `extensions/schema/service-manifest.v1.json`. The service registry library (`lib/service-registry.sh`) provides lookup functions for the CLI and installer.

## CI/CD

| Workflow | Purpose |
|----------|---------|
| `test-linux.yml` | Integration suite: smoke, manifests, health, BATS, tier map, contracts |
| `matrix-smoke.yml` | Multi-distro smoke (Ubuntu, Debian, Fedora, Arch, openSUSE) |
| `validate-compose.yml` | Docker Compose file validation |
| `validate-env.yml` | Environment variable schema validation |
| `dashboard.yml` | Dashboard build and lint |
| `lint-shell.yml` | ShellCheck on all `.sh` files |
| `lint-python.yml` | Python linting (ruff, black) |
| `type-check-python.yml` | Python type checking (mypy) |
| `secret-scan.yml` | GitLeaks secret detection |
| `lint-powershell.yml` | PowerShell linting for Windows installer |

## Component Interaction Map

High-level view of how the major subsystems interact at the code level:

```mermaid
graph TB
    subgraph Installer["Installation"]
        BASH_INST["Bash Installer<br/>(13 phases)"]
        TAURI["Tauri GUI Installer<br/>(Rust)"]
        CLI["dream-cli<br/>(Bash, ~45K lines)"]
    end

    subgraph Runtime["Runtime Services (Docker)"]
        subgraph Core
            LLAMA["llama-server"]
            WEBUI["open-webui"]
        end

        subgraph Gateway["API Gateway"]
            LITE["litellm"]
            SIDECAR["token-spy sidecar<br/>(proxy, rate limit,<br/>tenant, audit)"]
        end

        subgraph Intelligence["AI Services"]
            VOICE["Voice Classifier<br/>(FSM + extractors)"]
            AGENTS["openclaw + ape"]
            RAG["qdrant + embeddings"]
        end

        subgraph Middleware["Middleware"]
            PRIVACY["Privacy Shield<br/>(PII scrubbing)"]
            LANG["langfuse<br/>(tracing)"]
        end

        subgraph UI["User Interfaces"]
            DASH_UI["Dashboard<br/>(React/Vite)"]
            DASH_API["Dashboard API<br/>(FastAPI)"]
            SPY_DASH["Token-spy Dashboard<br/>(React)"]
        end
    end

    subgraph Config["Configuration"]
        MANIFESTS["Service Manifests<br/>(YAML)"]
        BACKENDS["Backend Configs<br/>(JSON per GPU tier)"]
        COMPOSE["Compose Stack<br/>(base + overlays)"]
    end

    BASH_INST -->|"detects GPU,<br/>selects tier"| BACKENDS
    BASH_INST -->|"resolves stack"| COMPOSE
    CLI -->|"manages lifecycle"| Runtime
    TAURI -->|"platform checks"| BASH_INST

    SIDECAR -->|"proxies to"| LLAMA
    SIDECAR -->|"rate limits"| SIDECAR
    PRIVACY -->|"scrubs PII"| LLAMA
    WEBUI -->|"inference"| LLAMA
    LITE -->|"routes"| LLAMA
    AGENTS -->|"reasoning"| LLAMA
    VOICE -->|"classification"| LLAMA

    DASH_UI -->|"REST"| DASH_API
    DASH_API -->|"health checks"| Runtime
    DASH_API -->|"reads"| MANIFESTS
    SPY_DASH -->|"REST"| SIDECAR
```

## Design Principles

Priority when principles conflict: **Let It Crash > KISS > Pure Functions > SOLID**

- **Let It Crash**: No broad catches, no silent swallowing. Errors propagate visibly. Bash uses `set -euo pipefail` everywhere.
- **KISS**: Readable over clever. One function, one job. No premature abstraction.
- **Pure Functions**: Installer libraries (`installers/lib/`) are the pure functional core; phases are the imperative shell.
- **SOLID**: Extend via config/data (manifests, backend JSON), not code modification.
