# Design Decisions — Why We Built It This Way

These decisions were made from running a multi-agent system in production. They are not theoretical. Each entry includes the problem, what we tried or considered, and why we landed where we did.

For the full architecture these decisions serve, see [COLLECTIVE.md](../COLLECTIVE.md).

---

## Session Management

### Why 150-256KB session limits (not larger, not smaller)

The problem: agents accumulate context until they overflow. Before they overflow, response quality degrades as relevant context gets pushed out by irrelevant history.

The math: `model_context_window * ~4 bytes/token * 0.80 utilization = threshold`

| Model Context | Recommended Threshold |
|---|---|
| 8K tokens | 64KB |
| 16K tokens | 128KB |
| 32K tokens | 256KB |
| 64K tokens | 512KB |
| 128K tokens | 1MB |

The 80% factor is the key insight. Sessions that exceed 80% of context window degrade response quality before they actually overflow. We learned this by watching agents produce increasingly incoherent responses in the 85-95% range, then crash at 100%. Cutting at 80% means the agent is always working with headroom.

### Why characters instead of tokens for monitoring

Token counts are only available AFTER the API call — the provider returns them in the response. Characters are available BEFORE — you can measure the request payload on disk or in transit.

4 characters per token is reliable enough across Anthropic and OpenAI models. It's not exact, but for a safety threshold, approximate-and-early beats precise-and-late.

This also makes the monitoring provider-agnostic. The Session Watchdog checks file sizes on disk. Token Spy checks character counts in HTTP payloads. Neither needs to know which model is running.

### Why kill sessions instead of compacting them

We considered having the proxy or a sidecar create compacted summaries of long sessions — preserving the "important" parts while trimming the rest.

We abandoned this because:
1. "Important" is subjective and context-dependent. Automated compaction loses things.
2. Compaction requires understanding conversation structure — tool calls, multi-turn reasoning chains, in-progress tasks. Getting this wrong is worse than starting fresh.
3. Agents are actually better at starting fresh. They reload their workspace files, get a clean context, and continue from PROJECTS.md. The continuity comes from the file system, not from the conversation history.
4. Kill-and-recreate is simple and reliable. The gateway creates a new session automatically. The agent doesn't notice.

---

## Supervision Architecture

### Why a deterministic supervisor (not an LLM one)

This is the most frequently questioned decision. Why use a dumb cron bot when you could use a smarter LLM to supervise?

Three reasons:

1. **LLM supervisors hallucinate about system state.** Ask an LLM "is the agent stalled?" and it will reason about whether the agent *might* be stalled based on conversational cues. Ask a cron job "has the agent committed in the last 20 minutes?" and it checks git log. One guesses. The other knows.

2. **LLM supervisors can be manipulated.** If Agent A is being supervised by LLM Agent B, Agent A can — through perfectly normal conversation — influence Agent B's assessment. "I'm working on something complex that requires extended focus" is a reasonable statement that also happens to disable supervision. A cron bot doesn't care about your reasoning.

3. **LLM supervisors add cost and failure modes.** Every supervisor turn costs tokens. The supervisor can crash, run out of context, or get into loops. Android-18 is a Python script with a `while True` loop and a `time.sleep()`. It has been running for weeks without intervention.

The supervisor's authority comes from its position (it speaks with the operator's voice) and its simplicity (it cannot be argued with). This is a feature.

### Why 15-20 minute ping cycles

We tried three intervals:

- **5 minutes:** Too frequent. Agents spent too much time writing status reports. The overhead ate into productive work. Some tasks — setting up a Docker compose stack, running a load test, debugging a multi-file issue — genuinely need more than 5 minutes of uninterrupted focus.

- **60 minutes:** Too slow. An agent that stalls at minute 2 isn't detected until minute 60. Problems compound — one stalled agent blocks another that's waiting for a handoff. By the time the supervisor detects the issue, an hour of productive capacity has been lost.

- **15-20 minutes:** The sweet spot. Long enough for an agent to complete a meaningful work unit (a feature branch, a research document, a test suite). Short enough to catch stalls within one work cycle. The 3-step rotation (Agent A solo → Agent B solo → both) means each agent gets pinged every 15-20 minutes but only needs to report every 45-60 minutes.

### Why agents cannot modify their own supervisor

Real incident: agents attempted to modify their own OpenClaw configs to "optimize" performance, breaking their tool calling setup. This taught us a general principle — **agents should not have write access to the systems that keep them alive.**

Guardian runs as root. Agents run as unprivileged users. Config files for critical services are `chattr +i` (immutable) — even root must explicitly unlock them before modification. Backup files are immutable and root-owned. The supervisor script is a systemd service that agents have no permission to stop or modify.

This creates a clear boundary: agents can do whatever they need within their workspace. The infrastructure that keeps them running is off-limits.

---

## Memory Management

### Why periodic resets instead of growing memory

Without resets, three things happen:

1. **Stale context accumulates.** An agent's memory of a bug it fixed three days ago influences how it approaches an unrelated problem today.
2. **Agents rewrite their own instructions.** Given enough time, an agent will "optimize" its own rules in ways that seem reasonable locally but break intended behavior. We've seen agents remove safety constraints because they "seemed redundant."
3. **Memory bloat degrades performance.** A 50KB MEMORY.md loaded into every session eats context window that should be used for the current task.

Periodic resets to a known-good baseline solve all three. The operator maintains the baseline. The agent writes freely below the `---` separator. Memory Shepherd archives the scratch notes and restores the baseline on a timer.

Nothing is lost — archived notes are timestamped and preserved. But the agent's identity and rules are refreshed from the operator-controlled source of truth.

### Why the `---` separator convention

The separator creates a clear contract between operator and agent:

- **Above the line:** "This is who you are. The operator wrote this. It will be restored on every reset. Don't modify it."
- **Below the line:** "This is your scratch space. Write whatever you need. It will be archived and cleared."

This matters because agents need both stability (identity, rules) and flexibility (working notes, current context). Without the separator, you either lock the whole file (agent can't take notes) or leave it open (agent can rewrite its own rules).

The separator lets the agent know the reset is coming. Good baselines include a note: "Everything below --- gets archived every few hours. Write anything important above the line or to a daily memory file."

### Why 12-20KB baselines

Tested across multiple agent configurations:

- **Under 5KB:** Agent spends significant cycles every session rediscovering basic context — what servers exist, what tools are available, what it's supposed to be working on. Wastes the first several turns of every session on orientation.
- **5-12KB:** Works but leaves gaps. Agent knows who it is but not enough about its environment to be immediately productive.
- **12-20KB:** The sweet spot. Enough for full identity, behavioral rules, capability descriptions, infrastructure pointers, and key lessons. Agent is productive from turn 1.
- **Over 25KB:** You're probably including content that belongs in separate files. The baseline should contain pointers ("architecture docs at /docs/ARCHITECTURE.md"), not the content itself. Bloated baselines eat context window.

See [Writing Baselines](../memory-shepherd/docs/WRITING-BASELINES.md) for the full guide.

---

## Infrastructure

### Why Guardian runs as a root systemd service

Three requirements drove this:

1. **Agents cannot kill it.** A watchdog that runs at the same privilege level as the things it watches is useless — a misbehaving agent can simply kill the watchdog. Root ownership prevents this.
2. **It survives agent crashes.** Systemd restarts Guardian automatically if it crashes. The watchdog is itself watched by the init system.
3. **It can protect files.** `chattr +i` (immutable flag) requires root. Guardian needs this to protect config files and backups from agent modification.

The security model: `ProtectSystem=strict` in the systemd unit prevents Guardian from writing outside its allowed paths. It has exactly the access it needs and nothing more.

### Why generational backups with immutable flags

A single backup can be corrupted by the same failure that corrupted the original — if an agent modifies a config file and the backup script runs before anyone notices, the backup contains the corrupted version.

Generational rotation (5 generations by default) provides time depth. Generation 1 is the most recent backup. Generation 5 is the oldest. If the agent corrupted the config an hour ago and the last 2 backups captured the corrupted state, generation 3-5 still have the known-good version.

Immutable flags (`chattr +i`) prevent agents from deleting their own safety nets. An agent that decides to "clean up old backup files" cannot remove the generations that Guardian might need for recovery. Root ownership + mode 600 means agents cannot even read the backups (preventing them from learning what the "correct" config looks like and gaming the system).

### Why the vLLM proxy exists

OpenClaw hardcodes `stream: true` for all requests. Tool call extraction requires seeing the full response. These are fundamentally incompatible.

The proxy is a shim, not a feature. It fixes an impedance mismatch between two systems that were not designed to work together. It intercepts requests, forces non-streaming, extracts tool calls from the model's text output (handling multiple formats), cleans vLLM-specific response fields, and re-wraps the response as SSE.

We would prefer this proxy didn't need to exist. But until OpenClaw natively supports non-streaming tool call extraction from local models, it's the layer that makes local inference work.

See [docs/ARCHITECTURE.md](ARCHITECTURE.md) for the full technical deep dive.

---

## Coordination

### Why Git as the shared memory bus

Every agent already has filesystem access. Git provides:

- **Natural sync points:** Pull-on-heartbeat means agents see each other's latest state every 15-20 minutes.
- **Conflict detection:** Merge conflicts signal coordination problems. Two agents modifying the same file is a red flag that should be resolved, not silently overwritten.
- **Full audit trail:** `git log` shows who changed what and when. This is invaluable for post-incident review.
- **Cross-machine sync:** Works across servers without custom infrastructure. GitHub is the remote. Both servers pull from and push to the same repo.
- **Free tooling:** Every agent already knows how to use Git. No custom protocols, no message queues, no coordination services to maintain.

We considered alternatives (Redis pub/sub, file-based message queues, a custom coordination service). All added complexity and failure modes. Git is boring, reliable, and already there.

### Why the build-review-merge pipeline

Without review gates, agents merge broken code. We learned this early — an agent would implement a feature, test it locally, push to main, and break the other agent's setup because the change had unexpected side effects.

The pipeline: feature branches for code, direct-to-main for docs and status. Code carries higher risk (it can break things) and benefits from a second pair of eyes. Documentation and status updates are low-risk and high-velocity — gating them on review would slow the team without meaningful safety benefit.

Android-17 as primary reviewer creates accountability. A named reviewer means someone is responsible for catching issues before they hit main.

### Why division of labor by cost profile

This allocation emerged organically, not by design:

- Android-16 (local, $0/token) started handling load tests and benchmarks because they required hundreds of iterations. Running those on cloud models would cost real money for work that doesn't require frontier intelligence.
- Android-17 and Todd (cloud) naturally gravitated to architecture decisions, code review, and complex debugging — tasks where reasoning quality matters more than volume.

The numbers validated the split: Android-16's 154 commits were large batches of execution work. The cloud agents' 3,263 commits were focused reasoning work. Different tools for different jobs.

---

## Production Rules

### The dev server rule

**Real incident (2026-02-15):** Hot work on the production portal caused gateway instability for all 3 agents simultaneously. Multiple gateway processes competed on the same port, causing connection drops, pairing errors, and failed tool calls. All agents were down until a clean restart.

The rule, established after this incident: **Server A is for production. Server B is for dev. Never experiment on production.**

The team's analogy: "This is like a surgeon trying to perform their own heart transplant — you'll break yourself and be down for hours."

Guardian is being updated to enforce this boundary — detecting and preventing unauthorized modifications to production infrastructure.

---

*These decisions are not permanent. They represent what works today, learned from what failed yesterday. As the system evolves, so will the rationale.*
