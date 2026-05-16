# DreamServer Resources

DreamServer is a local-first AI platform — voice agents, tool-calling LLMs, and a full inference stack running on hardware you own. This is everything we built and learned along the way.

**~490 files** · 100% tool-calling success (150 tests) · 20-30 concurrent voice sessions per GPU · 33 service extensions · 32-document agent architecture blueprint

---

## Deployment & Operations

### [`p2p-gpu/`](p2p-gpu/) — Deploy on Peer-to-Peer GPU Marketplaces

Deploy the full DreamServer stack on rented GPU instances from Vast.ai and other peer-to-peer compute marketplaces. One command, all 17+ services, any NVIDIA/AMD GPU or CPU-only instance. Handles 28 known provider quirks (root rejection, Docker socket permissions, toolkit setup, multi-GPU support, SSH tunneling). See [`p2p-gpu/README.md`](p2p-gpu/README.md) for setup guide.

---

## What's Inside

### [`multi-agent/`](multi-agent/) — How We Ran a Self-Organizing AI Team

**Start here if you're interested in multi-agent systems.** Complete documentation of the OpenClaw Collective — 4 AI agents that self-organized on consumer GPUs, producing 3,464 commits in 8 days with 10 human commits. Covers architecture, six transferable patterns (deterministic supervision, workspace-as-brain, mission governance, session lifecycle, memory stratification, self-healing infrastructure), the governance files loaded into every agent session, operational lessons from 24/7 production, swarm playbooks with reliability math, and design decisions with full rationale. Framework-agnostic — the patterns apply to any multi-agent setup.

---

### Agent Systems Blueprint — 32 Documents, 14,384 Lines

**A complete, vendor-neutral blueprint for building a production agentic coding tool from scratch.** Extracted as open-source best practices from exhaustive analysis of production agentic systems. Zero proprietary code. Zero vendor-specific terms. Every pattern described in original writing.

> **Start here:** [`AGENT-ARCHITECTURE-OVERVIEW.md`](research/agent-systems/AGENT-ARCHITECTURE-OVERVIEW.md) — the master map with dependency graphs, error boundaries, and end-to-end walkthroughs.
>
> **For local AI:** [`AGENT-LOCAL-LLM-ADAPTATION.md`](research/agent-systems/AGENT-LOCAL-LLM-ADAPTATION.md) — bridges all cloud patterns to DreamServer's local stack (llama-server, LiteLLM, GPU VRAM budgeting, tool calling tiers).

#### Reading Order by Layer

Build from the bottom up. Each layer depends on layers below it.

| Layer | # | Document | What It Covers |
|-------|---|----------|---------------|
| **1. Security** | 1 | [`AGENT-SECURITY-COMMAND-EXECUTION.md`](research/agent-systems/AGENT-SECURITY-COMMAND-EXECUTION.md) | Multi-layer shell injection prevention, AST parsing, path validation |
| | 2 | [`AGENT-SECURITY-NETWORK-AND-INJECTION.md`](research/agent-systems/AGENT-SECURITY-NETWORK-AND-INJECTION.md) | SSRF protection, DNS rebinding, Unicode injection defense |
| **2. Architecture** | 3 | [`AGENT-PERMISSION-SYSTEM-DESIGN.md`](research/agent-systems/AGENT-PERMISSION-SYSTEM-DESIGN.md) | Declarative rule-based permissions, modes, denial tracking |
| | 4 | [`AGENT-TOOL-ARCHITECTURE.md`](research/agent-systems/AGENT-TOOL-ARCHITECTURE.md) | Unified tool interface, MCP protocol, plugins, skills system |
| | 5 | [`AGENT-COORDINATION-PATTERNS.md`](research/agent-systems/AGENT-COORDINATION-PATTERNS.md) | Coordinator/worker orchestration, teammates, parallelism |
| | 6 | [`AGENT-ERROR-HANDLING-AND-HOOKS.md`](research/agent-systems/AGENT-ERROR-HANDLING-AND-HOOKS.md) | Error classification, event-driven hooks, HTTP hook security |
| **3. Core** | 7 | [`AGENT-SYSTEM-PROMPT-ENGINEERING.md`](research/agent-systems/AGENT-SYSTEM-PROMPT-ENGINEERING.md) | Section-based prompts, caching, injection defense, versioning |
| | 8 | [`AGENT-CONTEXT-AND-CONVERSATION.md`](research/agent-systems/AGENT-CONTEXT-AND-CONVERSATION.md) | Token budgeting, history management, compaction triggers |
| | 9 | [`AGENT-LLM-API-INTEGRATION.md`](research/agent-systems/AGENT-LLM-API-INTEGRATION.md) | Streaming, retry, model selection, rate limits, cost tracking |
| | 10 | [`AGENT-BOOTSTRAP-AND-CONFIGURATION.md`](research/agent-systems/AGENT-BOOTSTRAP-AND-CONFIGURATION.md) | Startup sequence, multi-source config, enterprise polling, migrations |
| | 11 | [`AGENT-AUTH-AND-SESSION-MANAGEMENT.md`](research/agent-systems/AGENT-AUTH-AND-SESSION-MANAGEMENT.md) | OAuth/PKCE, token refresh, keychain, session persistence, crash recovery |
| | 12 | [`AGENT-SPECULATION-AND-CACHING.md`](research/agent-systems/AGENT-SPECULATION-AND-CACHING.md) | Optimistic execution, file state overlays, stale-while-refresh |
| **4. Rendering** | 13 | [`AGENT-TERMINAL-UI-ARCHITECTURE.md`](research/agent-systems/AGENT-TERMINAL-UI-ARCHITECTURE.md) | React reconciler for terminals, double buffering, keyboard, mouse |
| | 14 | [`AGENT-DIFF-AND-FILE-EDITING.md`](research/agent-systems/AGENT-DIFF-AND-FILE-EDITING.md) | Patch generation, encoding, notebooks, change attribution |
| | 15 | [`AGENT-IDE-AND-LSP-INTEGRATION.md`](research/agent-systems/AGENT-IDE-AND-LSP-INTEGRATION.md) | Language Server Protocol, passive diagnostics, crash recovery |
| **5. Operations** | 16 | [`AGENT-WORKTREE-AND-ISOLATION.md`](research/agent-systems/AGENT-WORKTREE-AND-ISOLATION.md) | Git worktrees for parallel agents, symlinks, sparse checkout |
| | 17 | [`AGENT-FEATURE-DELIVERY.md`](research/agent-systems/AGENT-FEATURE-DELIVERY.md) | Auto-update, kill switch, subscription tiers, contributor safety |
| **6. Product** | 18 | [`AGENT-MEMORY-AND-CONSOLIDATION.md`](research/agent-systems/AGENT-MEMORY-AND-CONSOLIDATION.md) | Persistent memory, 4 types, auto-dream consolidation, team sync |
| | 19 | [`AGENT-CONTEXT-COMPACTION-ADVANCED.md`](research/agent-systems/AGENT-CONTEXT-COMPACTION-ADVANCED.md) | Microcompact, session compact, full compact, reactive recovery |
| | 20 | [`AGENT-TASK-AND-BACKGROUND-EXECUTION.md`](research/agent-systems/AGENT-TASK-AND-BACKGROUND-EXECUTION.md) | Forked agent pattern, 7 task types, cache-safe params |
| | 21 | [`AGENT-REMOTE-AND-TEAM-COLLABORATION.md`](research/agent-systems/AGENT-REMOTE-AND-TEAM-COLLABORATION.md) | WebSocket sessions, permission routing, teammates, teleportation |
| | 22 | [`AGENT-ENTERPRISE-AND-POLICY.md`](research/agent-systems/AGENT-ENTERPRISE-AND-POLICY.md) | Managed settings, policy limits, fail-open/closed, settings sync |
| | 23 | [`AGENT-MESSAGE-PIPELINE.md`](research/agent-systems/AGENT-MESSAGE-PIPELINE.md) | Message types, command queue, priority scheduling, collapsing |
| | 24 | [`AGENT-MEDIA-AND-ATTACHMENTS.md`](research/agent-systems/AGENT-MEDIA-AND-ATTACHMENTS.md) | Images, PDFs, clipboard, notebooks, ANSI rendering |
| | 25 | [`AGENT-LIFECYCLE-AND-PROCESS.md`](research/agent-systems/AGENT-LIFECYCLE-AND-PROCESS.md) | Graceful shutdown, cleanup, crash recovery, concurrent sessions |
| **7. Engine** | 26 | [`AGENT-QUERY-LOOP-AND-STATE-MACHINE.md`](research/agent-systems/AGENT-QUERY-LOOP-AND-STATE-MACHINE.md) | The main loop — 11 recovery transitions, 9 terminal conditions |
| | 27 | [`AGENT-STREAMING-TOOL-EXECUTION.md`](research/agent-systems/AGENT-STREAMING-TOOL-EXECUTION.md) | Concurrent tool execution, batching, size management |
| | 28 | [`AGENT-SDK-BRIDGE.md`](research/agent-systems/AGENT-SDK-BRIDGE.md) | Message translation, NDJSON protocol, permission routing |
| | 29 | [`AGENT-INITIALIZATION-AND-WIRING.md`](research/agent-systems/AGENT-INITIALIZATION-AND-WIRING.md) | 6-stage bootstrap, preflight, fast mode, prefetch ordering |
| **Meta** | 30 | [`AGENT-ARCHITECTURE-OVERVIEW.md`](research/agent-systems/AGENT-ARCHITECTURE-OVERVIEW.md) | **Master map** — dependency graph, error boundaries, walkthroughs |
| | 31 | [`AGENT-BUILD-AND-DEPENDENCIES.md`](research/agent-systems/AGENT-BUILD-AND-DEPENDENCIES.md) | Technology stack, project structure, packaging, test pyramid |
| **Mission** | 32 | [`AGENT-LOCAL-LLM-ADAPTATION.md`](research/agent-systems/AGENT-LOCAL-LLM-ADAPTATION.md) | **DreamServer bridge** — GPU budgeting, tool calling tiers, small models |

---

### [`products/`](products/) — Deployable Tools (97 files)

Ready-to-run software you can drop into your stack today.

| Product | What It Does | Highlights |
|---------|-------------|------------|
| [`privacy-shield/`](products/privacy-shield/) | PII detection proxy for API calls | Strips PII before hitting any LLM provider, restores on the way back. 15+ custom recognizers (SSNs, API keys, cloud creds). <10ms overhead. |
| [`token-spy/`](products/token-spy/) | AI cost analytics platform | FastAPI proxy with auth, rate limiting, multi-tenancy. TimescaleDB time-series backend. React dashboard. YAML plugin system for 7+ providers. |
| [`voice-classifier/`](products/voice-classifier/) | Deterministic intent classification | DistilBERT-based, 97.7% accuracy, 2-7ms latency. FSM call flow engine. LiveKit voice integration. |
| [`guardian/`](products/guardian/) | System resource watchdog | Monitors GPU/CPU/memory, triggers actions on thresholds. Systemd-native. |
| [`memory-shepherd/`](products/memory-shepherd/) | Memory leak detector | Tracks service memory over time, catches slow leaks before OOM kills. Baseline comparison system. |

### [`frameworks/`](frameworks/) — Reference Architectures

| Framework | What You'll Learn |
|-----------|------------------|
| [`voice-agent/`](frameworks/voice-agent/) | **Complete multi-agent voice system** built on LiveKit. 8 specialist agents with shared state, intent-based routing, TTS filtering, transcript capture. Built for HVAC customer service but domain-agnostic. Includes 9 research docs on handoff architecture and 15 LiveKit SDK guides. |

### [`research/`](research/) — 56 Deep Dives

Technical analysis from real deployments, not theory. *(The 32 agent architecture documents listed above are also in this directory but are covered in their own section.)*

**Hardware & Capacity** — GPU buying guide, VRAM multi-service limits, consumer GPU benchmarks, single-GPU full-stack configs, Mac Mini and Raspberry Pi 5 guides, cluster benchmarks.

**Models & Tool Calling** — Open-source model landscape (Feb 2026), local vs cloud quality comparison, per-model tool calling guides (Qwen, Llama, DeepSeek, Mistral, Phi, Command-R), vLLM tool calling setup, STT/TTS engine comparisons.

**Voice & Agents** — Voice latency optimization (<2s round-trip), scaling architecture, agent swarm patterns and operational playbook, LiveKit self-hosting deep dive, deterministic vs LLM call handling.

**Security & Privacy** — Ship-readiness audit (217 findings, 42 critical), security audit methodology, PII detection library comparison, privacy strategies analysis.

**Architecture & Market** — Edge AI market trends, competitive landscape, unsolved local AI problems, model hot-swapping, Windows-specific challenges.

### [`cookbooks/`](cookbooks/) — 22 Step-by-Step Recipes

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
| `agent-template-*.md` | 11 task templates (code review, testing, research, migration, debugging, etc.) |

### [`tools/`](tools/) — 20 Operational Scripts

GPU temperature monitoring, service health checks, concurrency benchmarks, LiveKit load testing, vLLM proxy with tool calling, voice latency benchmarks, sub-agent spawning framework, and more.

### [`blog/`](blog/) — 8 Draft Articles

Ready-to-polish content: "Dream Server vs Cloud AI", "Running 32B Models on Consumer Hardware", "The Hidden Costs of Cloud AI", "Privacy-First AI", "Sub-Agent Swarms on Local GPUs", and more.

### [`docs/`](docs/) — Infrastructure Guides

GPU cluster setup, deployment runbooks, golden build reference, LiveKit deployment, zero-cloud recipes, ship-readiness audits, and product portfolio docs.

### [`dev/`](dev/) — Active Development Builds

**What we're building next — shared early so you can see it, fork it, test it.**

| Project | Status | What It Is |
|---------|--------|-----------|
| [`normie-installer/`](dev/normie-installer/) | Testing | One-click installers for Windows (.bat/.ps1/.exe), macOS (.command/Homebrew), and Linux. Handles Docker, WSL2, GPU drivers — everything a non-technical user needs. |
| [`extensions-library/`](dev/extensions-library/) | Testing | 33 service extensions (Ollama, Bark, ComfyUI, Immich, CrewAI, etc.) with manifests, compose files, workflows, and templates. The next wave of DreamServer services. |
| [`bootstrap/`](dev/bootstrap/) | Testing | Docker bootstrap image (~50MB) for running the installer in environments where installing dependencies directly isn't practical. |
| [`download-page/`](dev/download-page/) | Draft | Static landing page that auto-detects OS and shows the right install command. |

These are actively being tested and used internally but not yet cleared for production. See [`dev/README.md`](dev/README.md) for usage instructions and the full roadmap.

### [`legacy/`](legacy/) — 14 Historical Files

Old compose files, systemd units, and configs from earlier DreamServer iterations. Kept for reference.

---

## Quick Start

**Building an agentic coding tool?** → Start with [`AGENT-ARCHITECTURE-OVERVIEW.md`](research/agent-systems/AGENT-ARCHITECTURE-OVERVIEW.md), then follow the layer-by-layer reading order above. For local LLM deployment, finish with [`AGENT-LOCAL-LLM-ADAPTATION.md`](research/agent-systems/AGENT-LOCAL-LLM-ADAPTATION.md).

**Want to strip PII from your API calls?** → [`products/privacy-shield/`](products/privacy-shield/)

**Building a voice agent?** → [`frameworks/voice-agent/`](frameworks/voice-agent/) + [`cookbooks/07-grace-voice-agent.md`](cookbooks/07-grace-voice-agent.md)

**Planning your hardware?** → [`research/`](research/) — start with the GPU hardware guide and VRAM limits docs

**Running a multi-agent team?** → [`multi-agent/`](multi-agent/) — architecture, patterns, governance, swarm playbooks

**Need capacity numbers?** → [`research/`](research/) — look for the capacity baseline and cluster benchmark docs

**Want to see what's coming?** → [`dev/`](dev/) — pre-production builds you can test today

**Deploying on rented GPUs?** → [`p2p-gpu/`](p2p-gpu/) — one-command setup for Vast.ai and other P2P GPU marketplaces

---

## Origin

This content was extracted from three Light Heart Labs repositories:

- **[GLO](https://github.com/Light-Heart-Labs/GLO)** — Multi-voice agent framework (→ `frameworks/voice-agent/`)
- **[Android Labs](https://github.com/Light-Heart-Labs/Android-Labs)** — Predecessor project where the AI agent collective produced most of this content (→ `multi-agent/`, `products/`, `research/`, `cookbooks/`, `tools/`, `blog/`)
- **DreamServer development** — Infrastructure and operational tools (→ `docs/`, `legacy/`)
- **Production agentic systems analysis** — Vendor-neutral architecture extraction (→ 32 `AGENT-*.md` documents)

All content was produced by local AI agents running on consumer GPU hardware as part of DreamServer development.
