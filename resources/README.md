# DreamServer Resources

Production-tested tools, frameworks, research, and recipes from building a local AI stack. Everything here was built by the Light Heart Labs team (4 AI agents + humans) while developing DreamServer.

**459 files. Zero fluff.**

---

## What's Inside

### [`multi-agent/`](multi-agent/) — How We Ran a Self-Organizing AI Team

**Start here if you're interested in multi-agent systems.** Complete documentation of the OpenClaw Collective — 4 AI agents that self-organized on consumer GPUs, producing 3,464 commits in 8 days with 10 human commits. Covers architecture, six transferable patterns (deterministic supervision, workspace-as-brain, mission governance, session lifecycle, memory stratification, self-healing infrastructure), the governance files loaded into every agent session, operational lessons from 24/7 production, swarm playbooks with reliability math, and design decisions with full rationale. Framework-agnostic — the patterns apply to any multi-agent setup.

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

Technical analysis from real deployments, not theory.

**Hardware & Capacity** — GPU buying guide, VRAM multi-service limits, consumer GPU benchmarks, single-GPU full-stack configs, Mac Mini and Raspberry Pi 5 guides, cluster benchmarks.

**Models & Tool Calling** — Open-source model landscape (Feb 2026), local vs cloud quality comparison, per-model tool calling guides (Qwen, Llama, DeepSeek, Mistral, Phi, Command-R), vLLM tool calling setup, STT/TTS engine comparisons.

**Voice & Agents** — Voice latency optimization (<2s round-trip), scaling architecture, agent swarm patterns and operational playbook, LiveKit self-hosting deep dive, deterministic vs LLM call handling.

**Security & Privacy** — Ship-readiness audit (217 findings, 42 critical), security audit methodology, PII detection library comparison, privacy strategies analysis.

**Architecture & Market** — Edge AI market trends, competitive landscape, unsolved local AI problems, model hot-swapping, Windows-specific challenges.

### [`cookbooks/`](cookbooks/) — 21 Step-by-Step Recipes

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

### [`blog/`](blog/) — 10 Draft Articles

Ready-to-polish content: "Why Self-Host AI in 2026", "Dream Server vs Cloud AI", "Running 32B Models on Consumer Hardware", "The Hidden Costs of Cloud AI", "Privacy-First AI", and more.

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

### [`legacy/`](legacy/) — Historical Files

Old compose files, systemd units, and configs from earlier DreamServer iterations. Kept for reference.

---

## Quick Start

**Want to strip PII from your API calls?** → [`products/privacy-shield/`](products/privacy-shield/)

**Building a voice agent?** → [`frameworks/voice-agent/`](frameworks/voice-agent/) + [`cookbooks/07-grace-voice-agent.md`](cookbooks/07-grace-voice-agent.md)

**Planning your hardware?** → [`research/`](research/) — start with the GPU hardware guide and VRAM limits docs

**Running a multi-agent team?** → [`multi-agent/`](multi-agent/) — architecture, patterns, governance, swarm playbooks

**Need capacity numbers?** → [`research/`](research/) — look for the capacity baseline and cluster benchmark docs

**Want to see what's coming?** → [`dev/`](dev/) — pre-production builds you can test today

---

## Origin

This content was extracted from three Light Heart Labs repositories:

- **[GLO](https://github.com/Light-Heart-Labs/GLO)** — Multi-voice agent framework (→ `frameworks/voice-agent/`)
- **[Android Labs](https://github.com/Light-Heart-Labs/Android-Labs)** — AI agent collective workspace (→ `multi-agent/`, `products/`, `research/`, `cookbooks/`, `tools/`, `blog/`)
- **DreamServer development** — Infrastructure and operational tools (→ `docs/`, `legacy/`)

All content was produced by local AI agents running on consumer GPU hardware as part of DreamServer development.
