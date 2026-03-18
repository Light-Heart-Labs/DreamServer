# Todd Capabilities Reference

Full capability documentation extracted from MEMORY.md baseline.

## AI Models
- **Primary**: Moonshot Kimi K2.5 (`kimi-k2-0711-preview`, 131K context) via `127.0.0.1:9111` (token monitor proxy)
- **Fallback**: Anthropic Claude Opus 4.5
- **Sub-agents**: Up to **20 concurrent** at **$0/token** via tool proxy `:8003` on .143
- **Model config is pinned by Guardian** — do not attempt to change it
- **Note**: API traffic goes through token monitor proxy (port 9111), which rewrites `developer` role → `system` for Moonshot compatibility

## SSH & Docker
- **SSH to .122**: `ssh michael@192.168.0.122` — production host
- **SSH to .143**: `ssh michael@192.168.0.143` — dev/test server
- Full Docker management on both nodes

## Sub-Agent Patterns
- Local models get stuck in JSON/tool-calling loops without intervention
- **Always add stop prompt**: `"Reply Done. Do not output JSON. Do not loop."`
- Simple tasks → single agent with stop prompt (~100% success)
- Complex tasks → **chained atomic steps**: one action per agent, chain sequentially
- Reliability: 1 agent 77%, 2 with any-success 95%, 3-of-3 93%
- **Dual redundancy**: Spawn 2 on same task, take first success → 100% completion
- **Templates**: `tools/agent-templates/` and `tools/SUBAGENT-TASK-TEMPLATE.md`
- **Full playbook**: `../multi-agent/swarms/SWARM-PLAYBOOK.md`

## Communication
- **Discord**: Listens to ALL messages in #todd and #general (no mention needed)
- **WhatsApp**: Enabled — can send/receive messages
- **GitHub**: Push/pull access to `Lightheartdevs/Android-Labs`
- **Brave Web Search**: Full web search API available
- **Google Calendar**: Read-only iCal access

## Services (Smart Proxy)

| Port | Service |
|------|---------|
| 9100 | vLLM round-robin (Coder + Sage) |
| 9101 | Whisper STT |
| 9102 | Kokoro TTS |
| 9103 | Embeddings (gte-base, 768-dim) |
| 9104 | Flux image generation |
| 9105 | SearXNG search engine |
| 9106 | Qdrant vector DB |
| 9107 | Coder only (.122) |
| 9108 | Sage only (.143) |
| 9199 | Cluster health status |

## Direct Services on .122

| Port | Service |
|------|---------|
| 8000 | vLLM direct (Qwen3-Coder-Next-FP8) |
| 8003 | vLLM tool proxy (USE THIS for sub-agents) |
| 8001 | Faster-Whisper (CUDA) |
| 8080 | RAG research assistant |
| 8083 | Text embeddings (HuggingFace TEI) |
| 8880 | Kokoro TTS |
| 8888 | SearXNG |
| 7860 | Flux image generation |
| 3000 | Open WebUI |
| 3001 | Dream Dashboard UI |
| 3002 | Dream Dashboard API |
| 5678 | n8n workflow automation |
| 6333 | Qdrant vector DB |
| 6379 | Valkey (Redis-compatible cache) |
| 5432 | PostgreSQL (intake) |
| 5433 | PostgreSQL (HVAC) |
| 9110 | Token monitor proxy — Android-17's traffic |
| 9111 | Token monitor proxy — Todd's traffic |

⚠️ **Never point directly at vLLM port 8000 for sub-agents. Always use the tool proxy on 8003.**

## Infrastructure Quick Facts
- **Both GPUs**: RTX PRO 6000 Blackwell, 96GB VRAM each
- **.122**: Qwen2.5-Coder-32B-Instruct-AWQ, ~90% VRAM
- **.143**: Android-16's host — runs OpenClaw gateway :18791
- **Failover**: Automatic. Health check every 3s.
- **Session cleanup**: Auto-reset at 200K chars; safety valve kills at 500K chars
- **Memory reset**: Every 3h (01:30, 04:30, 07:30…)
- **Ping cadence**: Discord bot pings every 15 min

## Infrastructure Management Scripts

| Script | Location | Schedule |
|--------|----------|----------|
| **Token Monitor** | `/home/michael/token-monitor/main.py` | Always on |
| **Session Manager** | `/home/michael/token-monitor/session-manager.sh` | Every 5 min |
| **Memory Reset** | `/home/michael/memory-reset.sh` | Every 3h |
| **Token Watchdog** | `/home/michael/todd/token-watchdog.py` | Every 10s |

**Token Monitor Dashboard**: `http://192.168.0.122:9110/dashboard`

## Semantic Memory Search
Vector-indexed RAG over workspace (44 files, 173 chunks, 768-dim vectors).
Bundled offline GGUF model (`embeddinggemma-300M`).

## Image Generation
Flux API at `:7860` (direct) or `:9104` (proxied).
