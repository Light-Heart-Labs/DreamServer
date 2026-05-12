# DreamServer Resources

DreamServer is a local-first AI platform — voice agents, tool-calling LLMs, and a full inference stack running on hardware you own. This is everything we built and learned along the way.

**~490 files** · 100% tool-calling success (150 tests) · 20-30 concurrent voice sessions per GPU · 33 service extensions · 32-document agent architecture blueprint

---

## Deployment & Operations

### [`p2p-gpu/`](p2p-gpu/) — Deploy on Peer-to-Peer GPU Marketplaces

Deploy the full DreamServer stack on rented GPU instances from Vast.ai and other peer-to-peer compute marketplaces. One command, all 17+ services, any NVIDIA/AMD GPU or CPU-only instance. Handles 28 known provider quirks (root rejection, Docker socket permissions, toolkit setup, multi-GPU support, SSH tunneling).

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

---

## More Resources

### [`cookbooks/`](cookbooks/) — Implementation Guides

Practical guides for integrating DreamServer services, including voice pipeline setup, tool integration, and RAG workflows.

### [`products/`](products/) — Curated Deployments

Pre-configured setups for specific use cases (research, production deployments, edge cases).

### [`research/`](research/) — Deep Dives

Analysis of production patterns, cost optimization, infrastructure decisions, and emerging capabilities.

### [`dev/`](dev/) — Development Tools

Scripts and utilities for building, testing, and operating DreamServer.
