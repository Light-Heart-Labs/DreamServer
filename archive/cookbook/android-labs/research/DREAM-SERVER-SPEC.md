# Dream Server Package Specification

> **Date:** 2026-02-09  
> **Author:** Todd  
> **Mission:** M5 (Clonable Dream Setup Server)  
> **Status:** Initial spec, ready for refinement

---

## Vision

A turnkey local AI server package that anyone can deploy:
- Buy hardware → Run installer → AI stack running
- All the local AI goodies pre-configured
- Easy setup wizard to connect everything

---

## Target Users

1. **AI Enthusiasts** — Want local LLMs without cloud dependency
2. **Privacy-Conscious Users** — Need data to stay on-premises
3. **Small Businesses** — Want AI capabilities without API costs
4. **Developers** — Need local inference for development/testing

---

## Hardware Tiers

### Tier 1: Entry Level ($500-800)
- Used workstation + RTX 3060 12GB
- 32GB RAM, 500GB SSD
- Runs: 7B-14B models, basic voice

### Tier 2: Prosumer ($1500-2500)
- RTX 4070 Ti Super 16GB or RTX 4080
- 64GB RAM, 1TB NVMe
- Runs: 32B models, full voice stack

### Tier 3: Pro ($3000-5000)
- RTX 4090 24GB or dual GPUs
- 128GB RAM, 2TB NVMe
- Runs: 70B+ models, multiple concurrent users

### Tier 4: Enterprise ($10000+)
- Dual RTX PRO 6000 (like our setup)
- 256GB+ RAM
- Runs: Multiple 70B+ models, production workloads

---

## Core Components

### 1. LLM Inference
| Component | Purpose | Docker Image |
|-----------|---------|--------------|
| vLLM | High-performance inference | `vllm/vllm-openai` |
| Ollama | Easy model management | `ollama/ollama` |
| LiteLLM | API gateway/proxy | `ghcr.io/berriai/litellm` |

### 2. Speech (Voice Agents)
| Component | Purpose | Docker Image |
|-----------|---------|--------------|
| Whisper | Speech-to-text | `onerahmet/openai-whisper-asr-webservice` |
| Piper | Text-to-speech | `rhasspy/piper` |
| Kokoro | Alternative TTS | Custom |

### 3. Embeddings & RAG
| Component | Purpose | Docker Image |
|-----------|---------|--------------|
| Qdrant | Vector database | `qdrant/qdrant` |
| BGE/Nomic | Embedding models | Via Ollama |

### 4. Workflows & Automation
| Component | Purpose | Docker Image |
|-----------|---------|--------------|
| n8n | Workflow automation | `n8nio/n8n` |
| OpenClaw | AI agent framework | Custom |

### 5. UI & Management
| Component | Purpose | Docker Image |
|-----------|---------|--------------|
| Open WebUI | Chat interface | `ghcr.io/open-webui/open-webui` |
| Portainer | Container management | `portainer/portainer-ce` |

### 6. Infrastructure
| Component | Purpose | Docker Image |
|-----------|---------|--------------|
| Traefik/Caddy | Reverse proxy | `traefik` / `caddy` |
| Redis | Caching | `redis` |
| PostgreSQL | Database | `postgres` |

---

## Package Structure

```
dream-server/
├── docker-compose.yml          # Main orchestration
├── docker-compose.gpu.yml      # GPU overrides
├── .env.example                # Environment template
├── setup.sh                    # One-line installer
├── config/
│   ├── litellm/               # LiteLLM config
│   ├── n8n/                   # n8n workflows
│   ├── openclaw/              # OpenClaw config
│   └── traefik/               # Reverse proxy
├── models/                     # Model storage
├── data/                       # Persistent data
└── docs/
    ├── HARDWARE-GUIDE.md      # Hardware recommendations
    ├── QUICKSTART.md          # 5-minute setup
    ├── TROUBLESHOOTING.md     # Common issues
    └── UPGRADING.md           # Version upgrades
```

---

## Installation Flow

### Phase 1: Hardware Check
```bash
./setup.sh check
# Outputs: GPU detected, VRAM, RAM, disk space
# Recommends: Tier and model sizes
```

### Phase 2: Configuration Wizard
```bash
./setup.sh configure
# Prompts: 
#   - Which services to enable?
#   - Domain/SSL setup?
#   - Default models to download?
#   - Voice agent setup?
```

### Phase 3: Deployment
```bash
./setup.sh deploy
# Downloads models
# Starts containers
# Runs health checks
# Opens Web UI
```

### Phase 4: Verification
```bash
./setup.sh test
# Tests each service
# Reports status
# Provides next steps
```

---

## Pre-Built Configurations

### Config A: Minimal (Entry Level)
- Ollama + Open WebUI
- Single 7B model
- No voice, no RAG
- RAM: 16GB, VRAM: 8GB

### Config B: Standard (Prosumer)
- vLLM + LiteLLM + Open WebUI
- 32B model + embeddings
- Basic voice (Whisper + Piper)
- n8n for workflows
- RAM: 32GB, VRAM: 16GB

### Config C: Full Stack (Pro)
- Everything in Standard, plus:
- Multiple models (Coder + General)
- Qdrant for RAG
- OpenClaw agent framework
- Full voice pipeline
- RAM: 64GB, VRAM: 24GB

### Config D: Production (Enterprise)
- Everything in Full Stack, plus:
- HA setup (multiple nodes)
- Monitoring (Prometheus + Grafana)
- Backup automation
- RAM: 128GB+, VRAM: 48GB+

---

## Default Model Recommendations

| Use Case | Entry | Prosumer | Pro |
|----------|-------|----------|-----|
| General Chat | Qwen2.5-7B | Qwen2.5-32B | Qwen2.5-72B |
| Coding | Qwen2.5-Coder-7B | Qwen2.5-Coder-32B | DeepSeek-Coder-33B |
| Embeddings | nomic-embed-text | bge-large | bge-m3 |
| STT | whisper-small | whisper-medium | whisper-large-v3 |
| TTS | piper-amy | piper-lessac | kokoro |

---

## Existing Similar Projects

| Project | Pros | Cons |
|---------|------|------|
| n8n Self-Hosted AI Kit | Well documented, includes n8n | Limited to n8n ecosystem |
| LocalAI | All-in-one binary | Less flexible |
| PrivateGPT | Privacy focused, RAG built-in | Narrow use case |
| Open WebUI + Ollama | Easy setup | No voice, limited automation |

---

## Differentiation

Our Dream Server differs by including:
1. **Voice agents** — Full STT/TTS/LLM pipeline
2. **OpenClaw integration** — Multi-agent framework
3. **Tiered configs** — Match hardware to setup
4. **Hardware guide** — Buy recommendations
5. **Production ready** — Monitoring, backups, HA options

---

## Capacity Benchmarks (Real Data)

> **Source:** M8 Agent Bench testing by Android-17 (2026-02-09)  
> **Hardware:** RTX PRO 6000 Blackwell (96GB VRAM)  
> **Model:** Qwen2.5-Coder-32B-AWQ

### Single GPU Performance

| Concurrent Users | Throughput | Avg Latency | P95 Latency | Success Rate |
|------------------|------------|-------------|-------------|--------------|
| 1                | 0.42/sec   | 2378ms      | 3562ms      | 100%         |
| 5                | 2.11/sec   | 2230ms      | 3869ms      | 100%         |
| 10               | 4.39/sec   | 2033ms      | 3771ms      | 100%         |
| 15               | 6.22/sec   | 2171ms      | 3911ms      | 100%         |
| 20               | 8.98/sec   | 1949ms      | 3527ms      | 100%         |

**Key Findings:**
- ✅ Linear throughput scaling (0.42 → 8.98 req/sec)
- ✅ Stable latency under load (~2s avg, ~4s p95)
- ✅ No degradation at 20 concurrent users
- ✅ Max temp: 70°C (safe headroom)

### Projected Capacity by Tier

| Tier | Hardware | Est. Users | Est. Throughput |
|------|----------|------------|-----------------|
| Tier 2 (Prosumer) | RTX 4080 16GB | 5-8 users | ~2-3 req/sec |
| Tier 3 (Pro) | RTX 4090 24GB | 10-15 users | ~4-6 req/sec |
| Tier 4 (Enterprise) | 2x RTX PRO 6000 | 40+ users | ~18 req/sec |

*Note: Prosumer/Pro estimates extrapolated from VRAM ratio. Real testing needed.*

---

## Development Phases

### Phase 1: Core Docker Compose
- [ ] Basic compose with vLLM + Open WebUI
- [ ] GPU detection and configuration
- [ ] Environment templating
- [ ] Basic documentation

### Phase 2: Voice Integration
- [ ] Add Whisper + TTS containers
- [ ] Voice pipeline configuration
- [ ] Test with simple voice agent

### Phase 3: Full Stack
- [ ] Add n8n, Qdrant, LiteLLM
- [ ] Pre-built workflows
- [ ] RAG configuration

### Phase 4: OpenClaw Integration
- [ ] OpenClaw container setup
- [ ] Agent configuration templates
- [ ] Multi-agent examples

### Phase 5: Polish
- [ ] Setup wizard (TUI or web)
- [ ] Hardware recommendation tool
- [ ] Monitoring dashboard
- [ ] Backup/restore scripts

---

## Success Metrics

1. **Time to first chat:** < 10 minutes
2. **Documentation coverage:** All common issues
3. **Hardware support:** 3+ GPU generations
4. **User feedback:** Usable by non-experts

---

## Next Steps

1. Create basic docker-compose.yml with vLLM + Open WebUI
2. Test on different hardware tiers
3. Add voice components
4. Write QUICKSTART.md
5. Gather feedback from test users
