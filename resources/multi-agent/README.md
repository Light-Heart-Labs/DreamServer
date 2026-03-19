# How We Ran a Self-Organizing AI Team on Consumer Hardware

In February 2026, Light Heart Labs ran an experiment: could a team of AI agents — running on local GPUs, coordinating through Discord and Git — ship production software without continuous human oversight?

Over 8 days, 3 AI agents produced 3,464 commits, shipped 3 products (Dream Server, Token Spy, Privacy Shield), wrote 50+ research documents, and built the operational infrastructure to manage themselves. The human operator made 10 commits. The rest was autonomous.

This directory contains everything we learned.

---

## Start Here

**If you have 10 minutes:** Read [The Architecture](architecture/COLLECTIVE.md) — a complete overview of how the system works, from the supervision hierarchy to the five-layer safety stack.

**If you have 30 minutes:** Add [Design Decisions](architecture/DESIGN-DECISIONS.md) — the rationale behind every non-obvious choice (why kill sessions instead of compacting, why deterministic supervisors instead of LLM ones, why 15-minute ping cycles).

**If you want to build your own:** Start with [Patterns](patterns/PATTERNS.md) — six framework-agnostic patterns extracted from production. You don't need our stack to use them.

---

## What's Inside

### [`architecture/`](architecture/) — How It Works

The system architecture and the reasoning behind it.

| Document | What You'll Learn |
|----------|-------------------|
| [COLLECTIVE.md](architecture/COLLECTIVE.md) | **Start here.** Full architecture: 4 agents, 2 servers, supervision hierarchy, workspace-as-brain, mission governance, 5-layer safety stack, proof-of-work metrics |
| [DESIGN-DECISIONS.md](architecture/DESIGN-DECISIONS.md) | Why 150-256KB session limits. Why characters not tokens. Why kill not compact. Why deterministic supervisors. Why 15-minute ping cycles. Every decision with the problem, alternatives considered, and rationale |
| [ARCHITECTURE.md](architecture/ARCHITECTURE.md) | Deep dive on the vLLM Tool Call Proxy — the translation layer that makes local models work with OpenClaw's tool calling |

### [`patterns/`](patterns/) — Transferable Principles

Framework-agnostic patterns you can apply to any multi-agent system.

| Document | What You'll Learn |
|----------|-------------------|
| [PATTERNS.md](patterns/PATTERNS.md) | **Six core patterns:** Deterministic Supervision, Workspace-as-Brain, Mission-Based Governance, Session Lifecycle Management, Memory Stratification, Self-Healing Infrastructure. Each with implementation levels, watch-out-fors, and links to our implementations |
| [MULTI-AGENT-PATTERNS.md](patterns/MULTI-AGENT-PATTERNS.md) | Coordination protocols, reliability math (1 agent = 77%, 2 agents = 95%, 5 agents = 97%), sub-agent spawning, echo chamber prevention, division of labor, the supervisor pattern, and a concrete timeline of "a typical hour" |

### [`governance/`](governance/) — The Agent Operating System

The actual files loaded into every agent session. This is the "workspace-as-brain" pattern in practice.

| File | Purpose |
|------|---------|
| [SOUL.md](governance/SOUL.md) | Core personality and ethical principles — who the agent is |
| [IDENTITY.md](governance/IDENTITY.md) | Name, role, model, capabilities — what the agent is (example: Android-16) |
| [MEMORY.md](governance/MEMORY.md) | Working memory with the `---` separator convention — operator-controlled above, agent scratch below |
| [MISSIONS.md](governance/MISSIONS.md) | 12 north-star objectives with problem statements, "ships as," and "done when" criteria |
| [PROJECTS.md](governance/PROJECTS.md) | Live work board — status markers, ownership, blockers, handoff format, backlog |
| [SYNC-PROTOCOL.md](governance/SYNC-PROTOCOL.md) | Git-based coordination: branch naming, review pipeline, heartbeat sync, role summary |
| [AGENTS.md](governance/AGENTS.md) | Operational manual: session startup, memory persistence, group chat rules, heartbeat protocol |
| [TOOLS.md](governance/TOOLS.md) | Tool environment reference: architecture diagram, ports, critical configuration |

### [`operations/`](operations/) — Running It in Production

What goes wrong and how to fix it.

| Document | What You'll Learn |
|----------|-------------------|
| [OPERATIONAL-LESSONS.md](operations/OPERATIONAL-LESSONS.md) | Silent failures (parser mismatch, compat flags), session management tricks, tool calling reliability, the "text > brain" rule, atomic chains for multi-step tasks |

### [`swarms/`](swarms/) — Scaling with Sub-Agent Swarms

Running many small agents in parallel for throughput and reliability.

| Document | What You'll Learn |
|----------|-------------------|
| [SWARM-PLAYBOOK.md](swarms/SWARM-PLAYBOOK.md) | **Complete operating manual.** Task sizing, reliability math, 5 task templates with success rates, 5 swarm patterns (parallel, redundant, pipeline, map-reduce, hierarchical), concurrency guidelines, cost comparison vs cloud, integration examples |
| [LOCAL-AGENT-SWARM-LESSONS.md](swarms/LOCAL-AGENT-SWARM-LESSONS.md) | What made agents succeed (explicit SSH commands, numbered steps, absolute paths) vs what made them struggle (indirect instructions, ambiguous scope). Optimal task template. 6-8 concurrent agents on single GPU |
| [AGENT-SWARM-PATTERNS.md](swarms/AGENT-SWARM-PATTERNS.md) | Fan-out research, divide-and-conquer code review, A/B prompt testing, data generation. Real experiment results comparing vLLM vs llama.cpp vs mlx-lm |

---

## The Tools

The patterns above are supported by production tools, all available in this repo:

| Tool | What It Does | Location |
|------|-------------|----------|
| **Guardian** | Self-healing watchdog — monitors processes, restores from immutable backups | [`../products/guardian/`](../products/guardian/) |
| **Memory Shepherd** | Periodic memory reset — archives scratch, restores baseline | [`../products/memory-shepherd/`](../products/memory-shepherd/) |
| **Token Spy** | API cost analytics — tracks every token, triggers session resets | [`../products/token-spy/`](../products/token-spy/) |
| **Privacy Shield** | PII-filtering proxy — strips sensitive data before it hits any model | [`../products/privacy-shield/`](../products/privacy-shield/) |
| **Voice Classifier** | Deterministic intent detection — 97.7% accuracy, 2-7ms, no LLM needed | [`../products/voice-classifier/`](../products/voice-classifier/) |

---

## The Proof

3,464 commits. 8 days. 3 shipping products. 50+ research documents. 10 human commits.

| Agent | Role | Model | Commits | Share |
|-------|------|-------|---------|-------|
| Android-17 | Builder | Claude + local Qwen sub-agents | 1,782 | 51.5% |
| Todd | Coordinator | Claude + local Qwen sub-agents | 1,481 | 42.8% |
| Android-16 | Local Workhorse | Qwen3-Coder 80B (fully local) | 154 | 4.4% |
| Android-18 | Supervisor | Deterministic Python script | — | — |
| Michael (human) | Operator | — | 10 | 0.3% |

The companion repository **Android-Labs** (private) contains the full commit history, agent outputs, and operational logs.

---

## How to Use This

**Building a multi-agent system?** Read the [patterns](patterns/PATTERNS.md) first, then study the [governance files](governance/) as templates.

**Running agents 24/7?** Start with [operational lessons](operations/OPERATIONAL-LESSONS.md) and [Guardian](../products/guardian/).

**Want parallel execution?** The [swarm playbook](swarms/SWARM-PLAYBOOK.md) has task templates you can copy directly.

**Evaluating whether this approach works?** Read the [architecture](architecture/COLLECTIVE.md) for the full picture, then [design decisions](architecture/DESIGN-DECISIONS.md) for the honest tradeoffs.

---

*This work was produced by AI agents running on consumer GPU hardware. The patterns are framework-agnostic. The tools are open source. The results are reproducible.*
