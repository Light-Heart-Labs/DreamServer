# Patterns for Autonomous Agent Systems

These patterns were extracted from operating a multi-agent system in production. They are not theoretical. Each was learned through failure, tuned through iteration, and validated with real output (3,464 commits from 3 AI agents over 8 days).

**The patterns are framework-agnostic.** You do not need OpenClaw, vLLM, or any specific tool to apply them. The implementations in this repo are one way to do it. The principles apply to LangChain, AutoGen, CrewAI, custom agent loops, or anything else.

For the specific system these patterns were extracted from, see [COLLECTIVE.md](../architecture/COLLECTIVE.md). For the rationale behind specific parameter choices, see [DESIGN-DECISIONS.md](../architecture/DESIGN-DECISIONS.md).

---

## Pattern 1: Deterministic Supervision

### What It Is

A non-LLM process that monitors LLM agents and intervenes when they stall, drift, or break.

### Why It Works

LLM agents cannot reliably self-monitor. They confabulate about their own state, lose track of time, and can be manipulated by their own outputs. An external, deterministic process — even something as simple as a cron job that checks git activity — provides ground truth that no amount of prompt engineering can corrupt.

The supervisor doesn't need to be smart. It needs to be incorruptible.

### Implementation Levels

**Level 1 — Stall Detection:**
A cron job that checks "has the agent committed/responded in the last N minutes?" and alerts if not. Takes 10 minutes to build. Catches the most common failure mode (agents going silent).

**Level 2 — Active Monitoring:**
A bot that reads agent status files, detects stalls, and posts corrective instructions to a shared communication channel. Adds accountability — agents know they're being watched and must explain what they're doing.

**Level 3 — Full Supervision:**
A supervisor on a timer that generates situation reports, creates prioritized punch lists, detects coordination collisions between agents, forces periodic session resets, and has authority to reprioritize work. This is what Android-18 does in the Collective.

### Watch Out For

- **The supervisor must run in a context agents cannot modify.** A separate process, separate permissions, ideally a separate machine. If agents can kill or reconfigure the supervisor, it's not supervision.
- **Report facts, not judgments.** "Agent A has not committed in 45 minutes" is actionable. "Agent A seems unproductive" is a hallucination waiting to happen.
- **Keep intervals long enough for meaningful work.** 15-20 minutes works for most agent tasks. Under 10 minutes and agents spend too much time reporting.

### This Toolkit's Implementation

- [Guardian](../../products/guardian/) — root systemd service that monitors processes, services, containers, and file integrity
- Android-18 pattern — a Python cron bot with a timer loop, Discord output, and rotating prompts (described in [COLLECTIVE.md](../architecture/COLLECTIVE.md))

---

## Pattern 2: Workspace-as-Brain

### What It Is

A set of files loaded at the start of every agent session that define the agent's identity, rules, capabilities, and working memory. The agent "becomes itself" by reading its own constitution.

### Why It Works

LLM sessions are stateless. Without persistent bootstrap files, every session starts from zero — the agent doesn't know who it is, what it's working on, or what rules it should follow. Workspace files create continuity without requiring the agent to have actual persistent memory.

This is fundamentally different from RAG (retrieval-augmented generation). RAG retrieves relevant context for a query. The workspace is loaded unconditionally every session — it's not responsive context, it's identity.

### The File Structure

| File | Purpose | Stability |
|------|---------|-----------|
| `SOUL.md` | Core personality and principles — who you are | Very stable (changes rarely) |
| `IDENTITY.md` | Name, role, model, strengths — what you are | Stable |
| `TOOLS.md` | Available tools and environment — what you can do | Updated when environment changes |
| `MEMORY.md` | Working memory — what you know and what you're doing | Split: stable above `---`, ephemeral below |

### The Key Insight: Pointers Over Content

Baselines should point to information, not contain it. A 15KB baseline that says "architecture docs are at /docs/ARCHITECTURE.md" is better than a 50KB baseline that pastes the architecture docs inline.

Why: the baseline is loaded into every session. Every kilobyte of baseline eats a kilobyte of context window that could be used for the current task. Pointers let the agent pull detailed information on demand. Identity should be in the baseline. Reference material should be in files the agent can read when needed.

### Watch Out For

- **Agents WILL try to modify their own identity files.** They'll "optimize" their rules, remove constraints that seem redundant, or rewrite their personality to be more efficient. This is why you need Memory Shepherd or equivalent — periodic resets to a known-good baseline.
- **Too small (< 5KB):** Agent wastes the first several turns of every session rediscovering basic context.
- **Too large (> 25KB):** You're duplicating content that belongs in separate files. The baseline should be a constitution, not an encyclopedia.
- **The 12-20KB sweet spot** was tested across multiple agent configurations. See [Design Decisions](DESIGN-DECISIONS.md#why-12-20kb-baselines) for the breakdown.

### This Toolkit's Implementation

- [workspace/](../governance/) — starter templates for SOUL.md, IDENTITY.md, TOOLS.md, MEMORY.md
- [Memory Shepherd](../../products/memory-shepherd/) — periodic reset to baseline with scratch archival
- [Guardian](../../products/guardian/) file-integrity checks — detects unauthorized modification of identity files

---

## Pattern 3: Mission-Based Governance

### What It Is

A set of north-star objectives that constrain all agent activity. Every task the agent undertakes must connect to a mission. If it doesn't connect, the agent should ask itself why it's doing it.

### Why It Works

Without mission alignment, agents wander. They follow their own curiosity, optimize for local metrics (lines of code written, tasks completed) rather than strategic outcomes, or get trapped in rabbit holes ("let me research every possible approach before implementing anything").

Missions provide direction without micromanagement. They say "here is WHY we are building" and let agents figure out WHAT to build and HOW to build it. This scales — you can add agents without adding proportional human oversight, because every agent can independently check its own alignment.

### The Structure

Each mission should have:

- **Problem statement** — what's wrong with the current state
- **"Ships as"** — how the work becomes real for users (connects R&D to product)
- **"Done when"** — objective completion criteria (prevents infinite polishing)
- **Priority guidance** — what to do when missions conflict

The "ships as" line is critical. Without it, agents do research forever. "Ships as: Dream Server's offline mode toggle" means the work isn't done until it's in the product. Research documents and benchmarks are intermediate artifacts, not deliverables.

### The Work Board Pattern

A shared PROJECTS.md file serves as a Kanban board:

```markdown
| Owner | Project | Status | Mission |
|-------|---------|--------|---------|
| @17   | Token Spy Phase 2 | [x] Complete | M12 |
| @16   | Dream Server mode switch | [~] In Progress | M5 |
| Todd  | Integration testing | [!] Blocked | M8 |
```

Anyone can add projects to the backlog. Anyone can claim unclaimed work. Status updates happen in the file itself, not in chat (so they persist across sessions). Every project links to a mission.

### Watch Out For

- **Too many missions (> 15) dilutes focus.** Agents context-switch between too many priorities and make progress on none.
- **Missions without "done when" become permanent busywork.** "Improve performance" is not a mission. "Run a usable stack on 8GB VRAM" is.
- **Agents need permission to deprioritize.** An 80/20 split (80% product missions, 20% support) gives agents explicit license to say "this supporting task can wait."
- **Standing orders complement missions.** Rules like "ship then document," "no stubs without flesh," "one commit per logical change" — these constrain how work gets done regardless of which mission it serves.

### This Toolkit's Implementation

- Android-Labs `MISSIONS.md` (private) — the live reference example with 12 missions
- Android-Labs `PROJECTS.md` (private) — the live work board

---

## Pattern 4: Session Lifecycle Management

### What It Is

Automated monitoring and cleanup of agent conversation sessions to prevent context overflow and quality degradation.

### Why It Works

Every LLM has a finite context window. Agents that run continuously accumulate history until they hit the ceiling. But before they hit the ceiling — typically around 80% utilization — response quality degrades as relevant context gets pushed out by irrelevant history.

Automated lifecycle management catches this before the agent or the user notices.

### The Lifecycle

```
1. Agent starts session → clean context
2. Agent works → history accumulates
3. Monitor checks session size at intervals
4. Session exceeds threshold → kill session file
5. Gateway detects missing session → creates fresh one
6. Agent loads workspace files → productive from turn 1
7. Agent does not notice the swap
```

Step 6 is why this works. The agent doesn't lose its identity, goals, or context when a session resets — those live in the workspace files, not in the conversation history. The conversation is ephemeral. The workspace is persistent.

### Key Parameters

| Parameter | Formula | Rationale |
|-----------|---------|-----------|
| Threshold | 80% of model context window (in bytes) | Quality degrades before overflow |
| Check interval | Proportional to context window size | Small windows need more frequent checks |
| Measurement | Characters, not tokens | Available pre-request, provider-agnostic |

### Watch Out For

- **Threshold too high:** Quality degrades before the cleanup fires. The agent produces bad output for N minutes before the session is killed.
- **Threshold too low:** Unnecessary session churn. Each reset costs the agent a few turns of re-orientation (minimized by good workspace files, but not zero).
- **The agent should not know about the cleanup.** Transparent operation. If the agent starts "preparing for session reset," it's wasting context on meta-work.

### This Toolkit's Implementation

- [Session Watchdog](../../tools/) — file-size-based cleanup on a systemd timer
- [Token Spy](../../products/token-spy/) — character-count-based cleanup with API-level visibility

---

## Pattern 5: Memory Stratification

### What It Is

Separating agent memory into tiers with different persistence levels, access patterns, and reset cycles. Not all knowledge has the same lifecycle.

### Why It Works

Identity (permanent) should not be mixed with scratch notes (ephemeral). The agent's name doesn't change. What it's working on right now changes every hour. Treating these the same — either by locking everything down or by leaving everything open — creates problems in both directions.

Stratification lets each tier have the appropriate level of stability, access control, and maintenance.

### The Tiers

| Tier | Content | Persistence | Who Controls | Reset |
|------|---------|-------------|--------------|-------|
| 1. Identity | SOUL.md, IDENTITY.md | Permanent | Operator | Manual only |
| 2. Working Memory | MEMORY.md above `---` | Persistent | Operator | Updated as needed |
| 3. Scratch Notes | MEMORY.md below `---` | Ephemeral | Agent | Archived every 2-3 hours |
| 4. Daily Logs | memory/YYYY-MM-DD.md | Append-only | Agent | Aged out over weeks |
| 5. Repository | Git history | Permanent | Shared | Never |

The separation between Tier 2 (working memory) and Tier 3 (scratch notes) via the `---` separator is the critical innovation. The operator controls what persists. The agent controls what it needs right now. Neither interferes with the other.

### The Archive Cycle

Scratch notes below `---` are not deleted — they're archived to timestamped files. This serves two purposes:

1. **Nothing is lost.** The agent can write freely knowing its notes will be preserved, just not in the active file.
2. **Audit trail.** Archived scratch notes show what the agent was thinking between resets. Invaluable for debugging unexpected behavior.

### Watch Out For

- **Agents must know about the reset cycle.** Include an explanation in the baseline: "Everything below --- gets archived every few hours." An agent that doesn't know about resets will be confused when its notes disappear.
- **Archives must be preserved.** They are the audit trail. Don't auto-delete them.
- **The operator should review baselines periodically.** Rules that agents consistently ignore should be rewritten or removed — they're wasting context window on instructions that aren't working.
- **Daily log discipline matters.** Without guidelines, agents either write nothing (no operational record) or write everything (memory directory bloats). A good heuristic: log decisions, blockers, and lessons. Skip routine status.

### This Toolkit's Implementation

- [Memory Shepherd](../../products/memory-shepherd/) — the reset cycle with archival
- [workspace/MEMORY.md](../governance/MEMORY.md) — template with `---` separator convention
- [Writing Baselines](../../products/memory-shepherd/docs/WRITING-BASELINES.md) — guide to authoring effective baselines

---

## Pattern 6: Self-Healing Infrastructure

### What It Is

A watchdog process that monitors agent infrastructure, detects failures, and automatically restores from known-good state — without human intervention.

### Why It Works

Agents break things. They modify configs to "optimize" them. They crash services by sending malformed requests. They corrupt files by writing partial updates during network interruptions. They kill processes they think are unnecessary.

A watchdog that runs at a higher privilege level, maintains immutable backups, and follows a deterministic recovery cascade can restore the system faster than a human can be paged.

### The Recovery Cascade

```
1. Detect unhealthy state
   └── Port check, process match, HTTP health endpoint, custom command

2. Soft restart
   └── systemctl restart, docker restart, kill + respawn

3. If soft restart fails N times → restore from backup
   └── Copy known-good config from immutable backup
   └── Restart service with restored config

4. If still failing → alert human
   └── The problem is beyond automated recovery
```

Each step is more invasive than the last. Soft restart fixes transient failures (OOM kills, network hiccups). Backup restore fixes corruption (agent-modified configs, truncated files). Human escalation handles everything else (hardware failure, upstream service changes).

### Key Design Choices

- **The watchdog MUST run at higher privilege than agents.** If the agent can kill the watchdog, the watchdog is useless. Root ownership, systemd management, separate user context.
- **Backups MUST be immutable.** Agents cannot delete their own safety net. `chattr +i` on Linux, or equivalent on other platforms.
- **Generational backups provide time depth.** A single backup can be corrupted by the same event that corrupted the original. 5 generations means you have history to fall back on.
- **Config-driven, not hardcoded.** The watchdog should monitor whatever you tell it to via a config file. Adding a new service to monitor should be a config change, not a code change.
- **Log everything.** Every health check, every restart, every restore. Post-incident review depends on knowing exactly what happened and when.

### Watch Out For

- **Restoration is not a fix.** It's a bandaid. When the watchdog restores a config, log why it was needed. Repeated restorations of the same file means something is systematically wrong.
- **The watchdog must self-monitor.** Check its own immutable flags, verify its config hasn't been tampered with, validate its backup integrity. If the watchdog is compromised, nothing else matters.
- **Tiered monitoring helps prioritize.** Not all services are equally critical. The agent's gateway is tier 1 (without it, the agent is dead). A metrics dashboard is tier 3 (nice to have). Recovery resources should match criticality.

### This Toolkit's Implementation

- [Guardian](../../products/guardian/) — full implementation with INI config, tiered health checks, recovery cascade, generational backups, and immutable flags
- [guardian/docs/HEALTH-CHECKS.md](../../products/guardian/docs/HEALTH-CHECKS.md) — detailed reference for monitoring types and recovery cascade

---

## Applying These Patterns

You don't need all six. Start with what hurts most:

- **Agents keep crashing?** Start with Pattern 6 (Self-Healing) and Pattern 4 (Session Lifecycle).
- **Agents lose context between sessions?** Start with Pattern 2 (Workspace-as-Brain) and Pattern 5 (Memory Stratification).
- **Agents wander off task?** Start with Pattern 3 (Mission Governance) and Pattern 1 (Supervision).
- **Building a multi-agent system?** Start with Pattern 1 (Supervision) and Pattern 3 (Mission Governance), then layer in the rest.

The patterns compose well. Each addresses a different failure mode, and each is independent — you can implement Pattern 2 without Pattern 1, or Pattern 6 without Pattern 3. But together, they form a complete safety stack for autonomous agent operations.

---

*These patterns will evolve. If you discover improvements, [open an issue](https://github.com/Light-Heart-Labs/Lighthouse-AI/issues).*
