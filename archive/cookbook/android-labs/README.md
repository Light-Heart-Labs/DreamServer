# Android Labs — AI Agent Collective

**Origin:** [Light-Heart-Labs/Android-Labs](https://github.com/Light-Heart-Labs/Android-Labs) (private) — A GitHub repo fully owned and operated by local AI agents

**Status:** Active development (Feb 2026)

Android Labs is the R&D workspace for four AI agents (Android-16, Android-17, Android-18, and Todd) building Light Heart Labs' products. This archive contains the most valuable outputs: agent coordination patterns, products, research, operational tools, and content — all produced by local AI agents running on consumer GPU hardware.

## What's Here

### `agent-framework/` — How AI Agents Self-Organize

The crown jewel. A production-tested framework for running autonomous AI agent teams:

| File | What It Is |
|------|-----------|
| `AGENTS.md` | Complete agent lifecycle — memory management, autonomy tiers, group chat etiquette, heartbeat system |
| `SYNC-PROTOCOL.md` | How 4 agents coordinate without chaos — branch pipeline, division of labor, conflict resolution |
| `SOUL.md` | Agent identity philosophy — values, personality, guardrails |
| `IDENTITY.md` | Template for defining agent personas |
| `MISSIONS.md` | 12 north stars that all work ladders into — mission-driven development framework |
| `MEMORY.md` | Long-term memory template — how agents persist knowledge across sessions using GitHub |
| `PROJECTS.md` | Work board pattern — active tasks, owners, status tracking |

**Key pattern:** Agents wake up fresh each session. GitHub IS their memory. Daily logs capture raw events; `MEMORY.md` holds curated wisdom. The autonomy tier system (Just Do It → Peer Review → Escalate) lets agents work without constant supervision.

### `products/privacy-shield/` — PII Detection Proxy

Drop-in privacy layer for API calls. Strips personally identifiable information before sending to any LLM provider.

| File | What It Does |
|------|-------------|
| `proxy.py` | Flask HTTP proxy — OpenAI-compatible API, session-based PII mapping for multi-turn conversations |
| `shield.py` | Presidio-based detection engine |
| `custom_recognizers.py` | 15+ custom entity recognizers (SSNs, API keys, cloud credentials, internal IPs, etc.) |
| `benchmark.py` | Latency testing — confirms <10ms overhead |
| `test_shield.py` | Test suite |
| `Dockerfile` | Container build |
| `docker-compose.yml` | Deployment config |

**Integration:** Works as a transparent proxy between your app and any OpenAI-compatible API. Point your app at the proxy instead of the provider — PII gets stripped on the way out and restored on the way back.

### `products/token-spy/` — AI Cost Analytics Platform

Complete observability for AI API usage. Track costs, compare models, set budgets.

| Component | Files | What It Does |
|-----------|-------|-------------|
| **Core** | `config_loader.py`, `db_backend.py` | YAML-based provider plugin system, dual SQLite/PostgreSQL backend |
| **API** | `sidecar/*.py` (16 files) | FastAPI proxy with auth, rate limiting, cost tracking, audit logging, multi-tenancy |
| **Schema** | `schema/*.sql` (4 files) | TimescaleDB schema with time-series hypertables, row-level security |
| **Dashboard** | `dashboard/` | React frontend for analytics visualization |
| **Config** | `config/providers.yaml` | Pre-configured for 7 providers (Anthropic, OpenAI, Groq, DeepSeek, vLLM, etc.) |
| **Architecture** | `PHASE1-ARCHITECTURE.md`, `PRODUCT-SCOPE.md` | Full technical design and product vision |

### `products/voice-classifier/` — Deterministic Intent Classification

DistilBERT-based intent classifier achieving 97.7% accuracy with 2-7ms latency:

| File | What It Does |
|------|-------------|
| `classifier.py` | DistilBERT intent classification |
| `extractors.py` | Entity extraction (names, phones, addresses, equipment) |
| `fsm.py` | Finite state machine for call flow execution |
| `router.py` | Request routing based on classification |
| `livekit_adapter.py` | LiveKit voice integration |
| `voice-agent.py` | Main voice agent implementation |
| `flows/` | Call flow definitions |

### `research/` — 53 Research Documents

Deep technical analysis from real deployments. Organized by theme:

**Hardware & Capacity**
- `gpu-hardware-guide-2026.md` — GPU buying guide with price/performance analysis
- `HARDWARE-TIERING-RESEARCH.md` — Entry ($500) to Enterprise ($10K+) tier definitions
- `M6-CONSUMER-GPU-BENCHMARKS-2026-02-09.md` — Real benchmarks on consumer GPUs
- `M6-VRAM-MULTI-SERVICE-LIMITS.md` — How many services fit in your VRAM
- `SINGLE-GPU-MULTI-SERVICE.md` — Running full AI stack on one GPU
- `M6-MINIMUM-HARDWARE.md` — Absolute minimum specs
- `M8-CAPACITY-BASELINE-2026-02-09.md` — Realistic capacity numbers (10-20 voice agents/GPU)
- `CLUSTER-BENCHMARKS-2026-02-10.md` — Multi-node cluster benchmarks
- `MAC-MINI-AI-GUIDE-2026.md` — Running AI on Mac Mini
- `PI5-AI-GUIDE-2026.md` — Running AI on Raspberry Pi 5

**Models & Tool Calling**
- `M9-OSS-MODEL-LANDSCAPE-2026-02.md` — Complete open-source model survey
- `M9-LOCAL-VS-CLOUD-BENCHMARK.md` — Local vs cloud quality comparison
- `TOOL-CALLING-SURVEY.md` — Which models support tool calling
- `tool-calling-{qwen,llama,deepseek,mistral,phi,command-r}.md` — Per-model tool calling guides
- `vllm-tool-calling.md` — vLLM tool calling setup
- `M9-STT-ENGINES.md` — Speech-to-text engine comparison
- `M9-TTS-ENGINES.md` — Text-to-speech engine comparison
- `GPU-TTS-BENCHMARK.md` — TTS performance benchmarks

**Voice & Agents**
- `VOICE-LATENCY-OPTIMIZATION.md` — Achieving <2s voice round-trip
- `voice-agent-scaling-architecture.md` — Scaling voice agents horizontally
- `voice-agent-latency-benchmarks.md` — Real latency measurements
- `DETERMINISTIC-CALL-FLOWS.md` — Deterministic vs LLM-based call handling
- `LOCAL-AGENT-SWARM-LESSONS.md` — Lessons from running agent swarms locally
- `M6-AGENT-SWARM-PATTERNS.md` — Multi-agent swarm patterns
- `SWARM-PLAYBOOK.md` — Operational playbook for agent swarms
- `LIVEKIT-AGENTS-ARCHITECTURE.md` — LiveKit agents deep dive
- `LIVEKIT-SELF-HOSTING.md` — Self-hosting LiveKit

**Security & Privacy**
- `DREAM-SERVER-AUDIT-2026-02-13.md` — Ship-readiness audit (217 findings, 42 critical)
- `M10-SECURITY-AUDIT-2026-02-11.md` — Security audit methodology and findings
- `M3-PRIVACY-SHIELD-STRATEGIES.md` — PII detection approaches compared
- `M3-PII-DETECTION-LIBS.md` — Library comparison for PII detection

**Architecture & Market**
- `DREAM-SERVER-SPEC.md` — Full product specification
- `EDGE-AI-MARKET-TRENDS-2025.md` — Edge AI market analysis
- `competitor-analysis-2026-02-11.md` — Competitive landscape
- `LOCAL-AI-BEST-PRACTICES.md` — Best practices for local AI deployments
- `UNSOLVED-LOCAL-AI-PROBLEMS-2026.md` — Open problems in local AI
- `HOT-SWAP-BEST-PRACTICES.md` — Model hot-swapping without downtime
- `WINDOWS-LOCAL-AI-CHALLENGES-2026.md` — Windows-specific challenges

### `cookbooks/` — 21 Production Recipes

Ready-to-follow guides:

| Recipe | What You'll Build |
|--------|------------------|
| `01-voice-agent-setup.md` | Voice agent with Whisper + TTS + LLM |
| `02-document-qa-setup.md` | RAG document Q&A system |
| `03-code-assistant-setup.md` | Local code assistant |
| `04-privacy-proxy-setup.md` | Privacy Shield deployment |
| `05-multi-gpu-cluster.md` | Multi-GPU inference cluster |
| `06-swarm-patterns.md` | Multi-agent swarm coordination |
| `07-grace-voice-agent.md` | Production HVAC voice agent |
| `08-n8n-local-llm.md` | n8n workflows with local LLM |
| `agent-template-*.md` | 11 agent task templates (code review, testing, research, migration, etc.) |

### `tools/` — 16 Operational Tools

| Tool | What It Does |
|------|-------------|
| `gpu_temp_monitor.py` | GPU temperature and health monitoring (10K LOC) |
| `ai-health-monitor.sh` | Service health monitoring (12K LOC) |
| `bench-test-concurrent.py` | Concurrency testing (12K LOC) |
| `livekit-concurrent-test.py` | LiveKit concurrency testing (18K LOC) |
| `vllm-tool-proxy.py` | vLLM proxy with tool calling support (13K LOC) |
| `m8-conversation-stress-test.py` | Multi-turn conversation stress test |
| `m8-tool-calling-test.py` | Tool calling reliability test |
| `m8-voice-latency-test.py` | Voice latency benchmarking |
| `local_spawner.py` | Sub-agent spawning framework |
| `m2-voice-pipeline-wired.py` | Complete wired voice pipeline example |
| `SUBAGENT-TASK-TEMPLATE.md` | Template for delegating tasks to sub-agents |

### `docs/` — 9 Infrastructure Guides

| Guide | What It Covers |
|-------|---------------|
| `INFRASTRUCTURE.md` | GPU cluster setup, routing, failover patterns |
| `DEPLOY-RUNBOOK.md` | Step-by-step deployment procedures |
| `GOLDEN-BUILD.md` | Reference build configuration (known-good state) |
| `LIVEKIT-DEPLOYMENT-GUIDE.md` | LiveKit self-hosting and configuration |
| `AUDIT-2026-02-13-SHIP-READINESS.md` | Comprehensive ship-readiness audit (learn from 217 findings) |
| `M1-ZERO-CLOUD-RECIPE.md` | Running fully offline with zero cloud dependencies |

### `blog/` — 15 Content Pieces

Draft blog posts and lead magnets written by the agent team:

- "Why Self-Host AI in 2026" — Market case for local AI
- "Dream Server vs Cloud AI" — Cost and privacy comparison
- "Local GPT-4 Tutorial" — Running GPT-4 class models locally
- "Privacy-First AI" — Building privacy-respecting AI systems
- "32B Models on Consumer Hardware" — What's possible in 2026
- "Bootstrap Model Pattern" — Instant UX with progressive model loading
- "Hidden Costs of Cloud AI" — TCO analysis
- Plus 8 more content pieces

## The Four Agents

| Agent | Role | Strengths |
|-------|------|-----------|
| **Android-16** | Heavy Executor | All coding, testing, benchmarking. Zero-cost grinding on local GPU |
| **Android-17** | Architect & Reviewer | Code review, design decisions, complex debugging |
| **Todd** | Integration Tester | E2E validation, Docker testing, coordination |
| **Android-18** | Ops Controller | Audits, punch lists, situation reports. Runs on Claude Opus |

## How to Use This

**For agent developers:** Start with `agent-framework/` — the coordination system, memory patterns, and autonomy tiers are directly applicable to any multi-agent setup running on DreamServer.

**For privacy-conscious users:** Deploy `products/privacy-shield/` as a proxy between your apps and cloud APIs. Zero-config PII stripping.

**For capacity planning:** Read `research/M8-CAPACITY-BASELINE-2026-02-09.md` and `research/M6-VRAM-MULTI-SERVICE-LIMITS.md` to understand what your hardware can handle.

**For voice agents:** Combine `products/voice-classifier/` with `cookbooks/01-voice-agent-setup.md` and the GLO voice agent framework (see `archive/cookbook/voice-agent-framework/`).

**For content creators:** The `blog/` directory has ready-to-polish articles about local AI.
