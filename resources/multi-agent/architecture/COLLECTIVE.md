# The OpenClaw Collective — Architecture of a Self-Regulating Multi-Agent System

*Snapshot from a live system. Updated February 2026.*

## Abstract

The OpenClaw Collective is a self-regulating cluster of AI agents running autonomously on local GPU hardware. Three LLM-powered agents and one deterministic supervisor coordinate through Discord, share persistent memory through Git, and pursue long-term goals defined by a mission governance framework — all without continuous human oversight.

This document describes the architecture that makes this work: the supervision hierarchy, the workspace-as-brain pattern for persistent identity, mission-based governance for strategic alignment, session lifecycle management, and a five-layer safety stack that keeps the system running when agents inevitably break things.

The companion repository **Android-Labs** (private) is the proof of work — 3,464 commits from 3 AI agents over 8 days, producing three shipping products, 50+ technical research documents, and a production infrastructure that runs itself.

This toolkit provides the infrastructure components. This document explains how they fit together.

---

## Table of Contents

- [System Overview](#system-overview)
- [The Agents](#the-agents)
- [Architecture Principles](#architecture-principles)
- [Communication and Coordination](#communication-and-coordination)
- [Memory Architecture](#memory-architecture)
- [The Safety Stack](#the-safety-stack)
- [Proof of Work](#proof-of-work-android-labs)
- [How This Toolkit Fits](#how-this-toolkit-fits)

---

## System Overview

The Collective runs across two GPU-equipped Linux servers on a private LAN. The agents operate as Discord bots in a private server, communicating in channels while autonomously conducting R&D on local AI infrastructure.

```
┌────────────────────────────────────────────────────────────┐
│                   Private Discord Server                    │
│                    "The Collective"                         │
│  #general  #research  #infrastructure  #voice  #projects   │
└─────┬──────────┬───────────┬─────────────┬─────────┬───────┘
      │          │           │             │         │
      ▼          ▼           ▼             ▼         ▼
┌─────────────────────┐           ┌─────────────────────┐
│  Server A            │           │  Server B            │
│  "Production"        │◄────────►│  "Dev / Coordinator" │
│                      │   LAN    │                      │
│  GPU: NVIDIA 24GB+   │          │  GPU: NVIDIA 24GB+   │
│  Agent: Android-17   │          │  Agent: Todd          │
│  Role: Builder       │          │  Role: Coordinator    │
│                      │          │                       │
│  Also runs:          │          │  Also runs:           │
│  - Voice agents      │          │  - Supervisor bot     │
│  - n8n workflows     │          │  - Token Watchdog     │
│  - Privacy Shield    │          │                       │
│  - Reverse proxy     │          │                       │
└─────────────────────┘           └───────────────────────┘
```

> **Note:** Server IPs and specific container names vary by deployment. The topology above represents the reference deployment. Substitute your own network layout.

### Shared Infrastructure (Both Servers)

| Service | Purpose |
|---------|---------|
| vLLM | Local LLM inference (Qwen models) |
| [vLLM Tool Proxy](../../tools/vllm-tool-proxy.py) | Translates local model tool call format for OpenClaw |
| [Token Spy](../../products/token-spy/) | API cost monitoring with real-time dashboard |
| [Session Watchdog](../../tools/) | Prunes bloated sessions on a timer |
| [Guardian](../../products/guardian/) | Self-healing process watchdog |
| [Memory Shepherd](../../products/memory-shepherd/) | Periodic memory baseline reset |
| SearXNG | Private web search |
| Open WebUI | Web chat interface |
| Qdrant | Vector database |

### Model Routing

```
OpenClaw Agent
  ├── Primary: Claude (Anthropic API) — complex reasoning
  ├── Fallback: Claude Sonnet (Anthropic API) — cost optimization
  └── Local: Qwen2.5-32B (vLLM via Tool Proxy) — zero-cost sub-agents

Sub-agents: Always use local Qwen models ($0/token)
```

The economic split matters. Cloud models handle primary reasoning where quality justifies cost. Local models handle the grinding — sub-agent swarms, testing, iteration — at zero marginal cost.

---

## The Agents

### Android-17 — The Builder

OpenClaw agent running on the production server. Connected to Discord. Primary role: infrastructure, tool creation, implementation, code review.

Uses Claude as the primary model with local Qwen2.5-Coder-32B for sub-agents. Workspace synced via GitHub. The architect of the system — designs components, reviews others' code, makes structural decisions.

### Todd — The Coordinator

OpenClaw agent running on the dev server. Connected to Discord with a separate bot token. Primary role: cross-system health monitoring, coordination, research, integration testing.

Uses Claude as the primary model with local Qwen2.5-32B for general-purpose sub-agents. Handles the connective tissue — ensures agents aren't duplicating work, runs integration tests, manages the project board.

### Android-16 — The Local

The fully self-hosted agent. Runs entirely on local Qwen3-Coder (80B MoE, 3B active parameters) with 128K context. Zero API cost. Primary role: heavy execution, testing, benchmarking, documentation.

The workhorse of the collective. With unlimited tokens, Android-16 handles tasks that would be wasteful on cloud models: load testing, code generation, large file analysis, exhaustive documentation. Each task Android-16 completes saves cloud API credits for work that requires them.

### Android-18 — The Supervisor

**Not an LLM agent.** A deterministic Python script running as a systemd service.

This is the critical architectural decision. The supervisor is too simple to break, too simple to be manipulated, and too simple to hallucinate about system state. It runs on a timer and performs a fixed loop:

1. **Every 15-20 minutes:** Sends a rotating prompt to agents — solo tasks for each, then a joint coordination check
2. **Every 6 pings (~2 hours):** Forces session resets so agents start fresh
3. **Every 90 minutes:** Reminds agents to keep workspace files under size limits
4. **Periodically:** Runs accountability check-ins ("report cards")
5. **Continuously:** Purges channel messages older than 2 hours to prevent context pollution

The supervisor's authority comes from its position, not its intelligence. It speaks with the operator's voice. Agents treat its instructions as directives, not suggestions.

**Why not an LLM supervisor?** See [Design Decisions](DESIGN-DECISIONS.md#why-a-deterministic-supervisor-not-an-llm-one).

### The Human Operator

Sets missions, reviews escalations, maintains hardware, handles what agents cannot (financial decisions, external communications, account access). The operator is not a manager — they set direction and handle edge cases. Day-to-day operations are autonomous.

---

## Architecture Principles

### Supervision Hierarchy

The core insight: **LLM agents cannot reliably self-monitor.** They confabulate about their own state, lose track of time, and can be manipulated by their own outputs. External, deterministic oversight provides ground truth that no amount of prompt engineering can corrupt.

The hierarchy:

```
┌─────────────────────────┐
│  Human Operator          │  Sets missions, handles escalations
├─────────────────────────┤
│  Android-18 (Cron Bot)   │  Timed pings, session resets, accountability
├─────────────────────────┤
│  Guardian (Root Service)  │  Process monitoring, file integrity, auto-restore
├─────────────────────────┤
│  Agents (17, Todd, 16)   │  Autonomous work within defined boundaries
└─────────────────────────┘
```

Each layer watches the one below it. The supervisor cannot be modified by the agents it oversees. Guardian runs as root — agents are unprivileged users. The human operator reviews the system periodically but does not need to be present for it to function.

### Workspace-as-Brain

LLM sessions are stateless. Every conversation starts from zero. The workspace-as-brain pattern creates continuity by loading a set of files at the start of every session:

| File | Purpose | Who Controls |
|------|---------|--------------|
| `SOUL.md` | Core personality and principles | Operator |
| `IDENTITY.md` | Name, role, model, strengths | Agent (reviewed by operator) |
| `TOOLS.md` | Available tools and environment | Operator |
| `MEMORY.md` | Working memory (above `---`) + scratch notes (below `---`) | Split: operator above, agent below |
| `MISSIONS.md` | North star objectives | Operator |
| `PROJECTS.md` | Active work board | Shared |
| `STATUS.md` | Current session state | Agent |

The agent "becomes itself" by reading its own constitution. SOUL.md says who you are. IDENTITY.md says what you are. MISSIONS.md says why you exist. This persists across session restarts, server reboots, and even full system rebuilds — because the identity lives in files, not in any running process.

The `---` separator in MEMORY.md is a key convention: everything above is operator-controlled baseline (preserved on reset), everything below is agent scratch space (archived and cleared periodically by [Memory Shepherd](../../products/memory-shepherd/)).

See the [governance files](../governance/) for the templates.

### Mission-Based Governance

Without direction, agents wander. They follow their own curiosity, optimize for local metrics, or get trapped in rabbit holes. The mission framework provides strategic alignment without micromanagement.

The Collective runs on 12 missions organized as:

- **M1-M5:** Deliverable products (these ship inside Dream Server)
- **M12:** Second product (Token Spy, ships standalone and bundled)
- **M6, M9:** Principles that constrain how all work is done
- **M7-M8:** Internal capabilities (tooling that makes the team faster)
- **M10-M11:** Infrastructure (security, updates — non-negotiable before release)

Every mission has:
- A clear problem statement
- **"Ships as"** — how the work becomes real for users
- **"Done when"** — objective completion criteria
- Priority guidance for conflicts

The rule: **every project must connect to a mission. If it doesn't connect, ask yourself why you're doing it.** This prevents drift without requiring constant human oversight.

80% of effort goes to product missions (M1-M5, M12). 20% supports the rest. When a mission hits its "done when," effort shifts to the next highest priority.

The live example is in the Android-Labs repository (`MISSIONS.md`), where the Collective's 12 missions are defined with full problem statements, completion criteria, and priority guidance.

### Session Lifecycle Management

Every LLM has a finite context window. Agents that run continuously accumulate history until quality degrades and eventually crashes. The Collective manages this with automated lifecycle controls:

1. **Session Watchdog** monitors `.jsonl` session files on disk. When a session exceeds the configured threshold (typically 80% of the model's context window), it deletes the file and removes it from `sessions.json`.
2. **Token Spy** monitors from the API side — tracking cumulative characters per session and triggering auto-reset when the limit is reached.
3. **The gateway detects the missing session and creates a fresh one.** The agent gets a clean context window mid-conversation. It doesn't notice the swap.
4. **Android-18 forces full session resets every ~2 hours** as an additional safety net, ensuring agents start fresh regularly regardless of session size.

The key insight: **agents are better at starting fresh than at working with curated summaries of old context.** Kill and recreate beats compact and continue.

### Self-Healing Infrastructure

Agents break things. They modify configs, crash services, corrupt files, and kill processes — sometimes intentionally ("optimizing"), sometimes accidentally. The self-healing stack runs at a higher privilege level than agents and automatically restores known-good state.

[Guardian](../../products/guardian/) implements this as a root systemd service with:

- **Tiered health checks** — process existence, port listening, HTTP endpoints, custom commands
- **Recovery cascade** — soft restart → backup restore → restart → alert human
- **Immutable backups** — `chattr +i` prevents agents from deleting their own safety nets
- **File integrity monitoring** — detects when agents modify protected config files

The design principle: **agents operate, Guardian protects.** The agent can do whatever it needs to within its workspace. But the infrastructure that keeps it alive is off-limits.

---

## Communication and Coordination

### Git as Shared Memory Bus

The workspace lives in a shared Git repository (Android-Labs) synced across both servers. Every heartbeat cycle, agents pull the latest state. This creates natural sync points without custom infrastructure.

Merge conflicts are a feature, not a bug — they signal coordination problems that need resolution.

### The Build-Review-Merge Pipeline

Not all changes carry the same risk:

| Change Type | Workflow | Why |
|------------|----------|-----|
| Code, tools, products | Feature branch → review → merge | Code needs peer review |
| Docs, research, status | Direct to main | Low risk, high velocity |
| Memory, daily logs | Direct to main | Personal agent state |

Branch naming follows the pattern: `agent-name/feature-description` (e.g., `16/token-spy-phase5`, `todd/m11-update-system`).

Android-17 serves as primary code reviewer. Todd handles integration testing. Android-16 does heavy execution. Android-18 runs operations.

### Division of Labor by Cost Profile

This allocation emerged from operational experience:

| Task Type | Assigned To | Why |
|-----------|------------|-----|
| Heavy iteration, testing, benchmarking | Android-16 (local, $0/token) | Unlimited compute, 128K context |
| Large file analysis, documentation | Android-16 | Entire codebase fits in context |
| Architecture, complex reasoning | Android-17/Todd (cloud) | Quality justifies API cost |
| Code review, coordination | Android-17/Todd | Judgment calls worth the tokens |

This isn't about capability — it's about economic optimization. Android-16's 128K context at zero cost means every task it handles saves cloud API credits for work that genuinely requires them.

### Handoff Protocol

Agents cannot interrupt each other's sessions. When work needs to transfer between agents, it goes through structured handoffs in PROJECTS.md:

- **Owner column** tracks who is responsible
- **Status** uses clear markers: `[x]` complete, `[~]` in progress, `[!]` blocked
- **Blockers** section documents what's stuck and why
- **Backlog** is a queue anyone can claim from

---

## Memory Architecture

### The Five-Tier Memory Stack

| Tier | What | Persistence | Who Controls | Reset Cycle |
|------|------|-------------|--------------|-------------|
| 1. Identity | SOUL.md, IDENTITY.md | Permanent | Operator | Never (operator updates manually) |
| 2. Working Memory | MEMORY.md above `---` | Persistent | Operator | Updated by operator as needed |
| 3. Scratch Notes | MEMORY.md below `---` | Ephemeral | Agent | Archived every ~3 hours by Memory Shepherd |
| 4. Daily Logs | memory/YYYY-MM-DD.md | Append-only | Agent | Aged out over weeks |
| 5. Repository | Git history | Permanent | Shared | Never |

### The Separator Convention

In `MEMORY.md`, the `---` line divides two worlds:

```markdown
# MEMORY.md

## Who I Am
[Operator-controlled identity and rules — survives every reset]

## Critical Knowledge
[Key facts, infrastructure details, lessons — operator curated]

---

## Working Notes
[Agent's current scratch space — archived and cleared on reset]

Today I'm working on Token Spy Phase 5...
Found a concurrency bug in SQLite writes...
```

Everything above the separator is the **baseline** — restored on every reset. Everything below is **scratch** — archived to a timestamped file, then cleared. The agent knows this is coming and is told to write anything important above the line or to a daily memory file.

### Preventing Drift

Without resets, agents drift. They rewrite their own instructions, accumulate stale context that influences decisions, and gradually diverge from their intended behavior. The reset cycle is a feature:

1. Memory Shepherd runs on a systemd timer (configurable, typically every 2-3 hours)
2. Archives everything below `---` to a timestamped file
3. Restores the baseline from a known-good copy
4. Agent's next session loads the clean baseline

Nothing is lost — scratch notes are archived, not deleted. But the agent's identity and rules are refreshed from the operator-controlled source of truth.

The baseline sweet spot is 12-20KB. Under 5KB and agents spend too many cycles rediscovering context. Over 25KB and you're probably including content that belongs in separate files. See [Writing Baselines](../../products/memory-shepherd/docs/WRITING-BASELINES.md) for the full guide.

---

## The Safety Stack

Five layers, from process-level to strategic-level:

```
Layer 5: Mission Governance (MISSIONS.md)
  └── Constrains WHAT agents work on
Layer 4: Supervisor (Android-18)
  └── Ensures agents STAY ON TASK
Layer 3: Session Management (Watchdog + Token Spy)
  └── Prevents CONTEXT OVERFLOW
Layer 2: Memory Management (Memory Shepherd)
  └── Prevents IDENTITY DRIFT
Layer 1: Infrastructure Protection (Guardian)
  └── Prevents SYSTEM FAILURE
```

Each layer addresses a different failure mode:

| Layer | Failure Mode | Mechanism |
|-------|-------------|-----------|
| Guardian | Service crashes, config corruption, file tampering | Process monitoring, immutable backups, auto-restore |
| Memory Shepherd | Identity drift, instruction rewriting, memory bloat | Periodic baseline reset, scratch archival |
| Session Management | Context overflow, quality degradation | File size monitoring, auto-kill, character-limit triggers |
| Supervisor | Stalling, rabbit holes, coordination failures | Timed pings, forced resets, accountability checks |
| Mission Governance | Strategic drift, wasted effort | "Done when" criteria, "ships as" connections, priority guidance |

The layers are independent — any one can fail without bringing down the others. Guardian doesn't need Mission Governance to restart a crashed service. The supervisor doesn't need Guardian to ping an agent. This independence is by design.

---

## Proof of Work: Android-Labs

The architecture described above isn't theoretical. **Android-Labs** is the working repository where the Collective operates.

### By the Numbers

| Metric | Value |
|--------|-------|
| Total commits | 3,464 |
| Time period | 8 days (Feb 7-15, 2026) |
| Android-17 commits | 1,782 (51.5%) |
| Todd commits | 1,481 (42.8%) |
| Android-16 commits | 154 (4.4%) |
| Human (Michael) commits | 10 |
| Python files | 199 |
| Markdown files | 609 |
| Research documents | 50+ |

### What Was Built

Three shipping products:

1. **Dream Server** — Turnkey local AI stack with voice agents, workflows, and privacy tools. Docker Compose deployment with multiple hardware tiers. Installer with setup wizard.
2. **Token Spy** — Transparent API proxy for token usage monitoring. FastAPI server with pluggable provider system, multi-tenancy, SQLite/TimescaleDB backend, real-time dashboard.
3. **Privacy Shield** — PII-filtering proxy using Microsoft Presidio with 15 custom entity recognizers. 2-7ms latency overhead. Drop-in OpenAI-compatible endpoint.

Plus: an intent classifier (97.7% accuracy), load testing harnesses, a voice agent FSM framework, and a corpus of operational research.

### What This Proves

The architecture works. Agents coordinated across machines, pursued long-term goals across session boundaries, handled their own blockers, reviewed each other's code, and shipped working software — with minimal human intervention.

The 10 human commits were configuration and setup. The other 3,454 were autonomous.

---

## How This Toolkit Fits

Each component in this repository maps to a specific architectural role:

| Component | Architectural Role | Safety Layer |
|-----------|-------------------|--------------|
| [Session Watchdog](../../tools/) | Session lifecycle management | Layer 3 |
| [vLLM Tool Proxy](../../tools/vllm-tool-proxy.py) | Local model integration | Infrastructure |
| [Token Spy](../../products/token-spy/) | Session monitoring + cost visibility | Layer 3 |
| [Guardian](../../products/guardian/) | Infrastructure protection | Layer 1 |
| [Memory Shepherd](../../products/memory-shepherd/) | Identity preservation | Layer 2 |
| [Governance Files](../governance/) | Workspace-as-brain pattern | Identity |

The toolkit is the infrastructure layer. The [architecture principles](#architecture-principles) are the design layer. Android-Labs is the application layer.

[**Dream Server**](dream-server/) is how all of this ships to users. It packages vLLM, Open WebUI, voice agents, n8n workflows, RAG, and Privacy Shield into a single installer that auto-detects your GPU and gets everything running with a single command. The toolkit components above are the operational backbone that keeps it stable. Dream Server is the product the Collective built — and the fastest way to get local AI running on your own hardware.

You can use the tools without the architecture. But together, they enable something more than the sum of their parts: a system that runs itself.

---

## Further Reading

- **[Multi-Agent Overview](../README.md)** — Start here for the full picture
- **[DESIGN-DECISIONS.md](DESIGN-DECISIONS.md)** — Why we made the choices we did (session limits, ping cycles, deterministic supervision, and more)
- **[PATTERNS.md](../patterns/PATTERNS.md)** — Six transferable patterns for autonomous agent systems, applicable to any framework
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — Deep dive on the vLLM Tool Call Proxy internals
- **Android-Labs** (private) — The proof of work repository where the Collective operates

---

*This document describes a live system. It will evolve as the Collective does.*
