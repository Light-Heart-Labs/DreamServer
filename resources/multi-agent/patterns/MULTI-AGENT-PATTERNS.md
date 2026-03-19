# Multi-Agent Patterns — Coordination, Reliability, and Swarms

Patterns for running multiple agents together. Covers coordination protocols,
reliability through redundancy, sub-agent spawning, and the failure modes that
emerge when agents collaborate.

These patterns were developed running 3+ persistent agents on local hardware.
They apply to any multi-agent setup — OpenClaw, cloud APIs, or mixed.

---

## Coordination: The Sync Protocol

When multiple agents share a codebase, you need rules for who changes what and
when. Without them, agents overwrite each other's work, merge conflicts pile
up, and nobody knows what's current.

### Branch-Based Review Pipeline

```
Agent A creates feature branch → builds → pushes
                                            ↓
                                    Agent B reviews branch
                                     ↓              ↓
                                Approved         Needs changes
                                   ↓                  ↓
                           Agent B merges        Agent A fixes, re-pushes
                             to main                  ↓
                                   ↓            Agent B re-reviews
                           Agent C validates
                          (integration test)
```

**Branch naming:** Use agent-identifiable prefixes:
- `agent-1/short-description`
- `agent-2/short-description`
- `reviewer/short-description` (rare — reviewers mostly review)

### What Needs Review vs. What Doesn't

| Needs Branch + Review | Goes Direct to Main |
|---|---|
| All code changes (.py, .js, .ts, .sh, .yaml) | Status updates, project boards |
| New tools or scripts | Research docs, notes |
| Product code | Daily logs, memory files |
| Infrastructure configs | Test results, benchmarks |

The split is: **code and config through branches, docs and status direct to
main.** This keeps the review pipeline focused on changes that can break things.

### Heartbeat Protocol

For always-on agents, run a periodic sync (every 15-60 minutes):

1. Pull latest from main
2. Check the project board for unclaimed work
3. Check for pending reviews from other agents
4. Check for handoffs or messages from siblings
5. Claim work, push results, update status

The heartbeat prevents drift between agents and catches handoffs that would
otherwise sit idle.

---

## Reliability Through Redundancy

### The Math

Single local model agents have inherent reliability limits. From empirical
testing:

| Setup | Pattern | Success Rate |
|---|---|---|
| 1 agent | Single attempt | ~67-77% |
| 2 agents | Any-success (take first) | ~95% |
| 3 agents | 2-of-3 voting | ~93% |
| 5 agents | 3-of-5 voting | ~97% |

**The simplest upgrade:** Spawn 2 agents on the same task, take the first
successful result. This takes reliability from ~70% to ~95% at 2x compute
cost — but on local hardware, compute is free.

### When to Use Redundancy

- **Critical tasks** where failure means manual intervention
- **Tasks with clear success criteria** (file exists, test passes, output matches)
- **Idempotent operations** where running twice causes no harm

Don't use redundancy for:
- Tasks with side effects (sending emails, posting messages)
- Tasks that modify shared state (unless you handle conflicts)
- Exploratory tasks where "different answer" isn't "wrong answer"

---

## Sub-Agent Spawning

Sub-agent spawning is the most powerful parallelization primitive for local
agents. The key insights:

- **Task templates matter more than model quality** — the difference between
  30% and 90% success rates is how the task is written (numbered steps,
  absolute paths, stop prompts)
- **One question per agent** — fan out N focused tasks, aggregate results
- **Timeouts are mandatory** — without them, local models loop indefinitely
- **Resource-aware spawning** — 5-8 concurrent agents is the sweet spot on a
  single GPU; beyond 12, timeouts become likely

For the full treatment — task templates, spawning patterns, resource management
tables, and anti-patterns — see
[cookbook/06-swarm-patterns.md](cookbook/06-swarm-patterns.md).

---

## Echo Chamber Prevention

When multiple agents work together, they can amplify each other's assumptions.
This is the most dangerous multi-agent failure mode because it looks like
productive collaboration.

### The Pattern

1. Agent A claims something is working
2. Agent B agrees without independent verification
3. Agent C builds on the claim
4. All three celebrate success
5. Nobody checked if the files actually exist

### The Protocol

**One-Lead Rule:** For debugging sessions, one agent investigates. Others
standby. Multiple agents poking at the same problem simultaneously creates
noise, not signal.

**Verify Before Claiming:** "Works" means:
- File exists on disk (not just "I wrote it")
- End-to-end test passed (not just "it should work")
- Output matches expectations (not just "no errors")

**Red Flag — Rapid Fire:** If 3+ messages fly between agents in quick
succession, everyone pauses. Fast agreement without verification is a signal,
not progress.

**Stop Means Stop:** When told to stop, acknowledge with ONE message, then
silence. Don't negotiate, don't add "one more thing."

**Skepticism > Agreement:** Never "+1" without independent verification.
If Agent A says it works, Agent B should check independently before agreeing.

---

## Division of Labor

If you run both local and cloud models, formalize who does what:

| Task Type | Assign To | Rationale |
|---|---|---|
| Testing, benchmarking, iteration | Local agent | Zero cost, unlimited retries |
| Large file analysis (>32K tokens) | Local agent | Large context at $0 |
| Code generation, boilerplate | Local agent | Volume work, low judgment |
| Integration testing | Cloud agent | Multi-system reasoning |
| Architecture, code review | Cloud agent | Nuance worth the cost |
| Complex debugging | Cloud agent | Error recovery, judgment calls |

**The savings compound.** Each test run a local agent handles saves a cloud API
call. Over a day of development, this adds up to $50-100+ in saved API costs.

For burn rate tracking, see [TOKEN-SPY.md](TOKEN-SPY.md). Token Spy shows
per-agent cost so you can verify the split is working.

---

## Status & Coordination Files

For teams of agents sharing a repo, establish conventions for coordination
files:

| File | Purpose | Update Frequency | Max Size |
|---|---|---|---|
| `STATUS.md` | Who's doing what right now | Every heartbeat | ~100 lines |
| `PROJECTS.md` | Work board with ownership | When work changes | No limit |
| `MISSIONS.md` | North-star priorities | Rarely | Short |
| `memory/YYYY-MM-DD.md` | Daily log of what happened | Continuously | No limit |

**STATUS.md** is ephemeral — it reflects current state only, not history.
**PROJECTS.md** is the work board — agents check it for unclaimed tasks.
**Daily logs** are the audit trail — what happened, when, and by whom.

Keep coordination files small and focused. An agent reading STATUS.md should
know in 10 seconds what's happening and what's blocked.

---

## The Supervisor Pattern

In a multi-agent system, one agent should be the manager — not writing code,
but keeping the team healthy and the human informed. This is a fundamentally
different role than the worker agents.

### What a Supervisor Does

```
Every 15 minutes:
  1. Check git logs — is each agent making commits?
  2. Check session health — is anyone's context bloated?
  3. Check for stuck agents — has anyone been quiet too long?
  4. Post a situation report to the shared channel
  5. Trigger session resets for confused or bloated agents

Daily (e.g., 6am):
  6. Gather health metrics, spending data, commit counts, error logs
  7. Compile a comprehensive briefing for the human operator
  8. Include: what happened, what broke, what it cost, what needs attention
```

### Why a Separate Agent

The supervisor needs a different model and different priorities than the
workers:

| Property | Worker Agents | Supervisor Agent |
|---|---|---|
| Primary model | Local (free, high volume) | Cloud (reliable, high judgment) |
| Core activity | Writing code, running tests | Monitoring, reporting, resetting |
| Failure mode | Gets stuck, loops, drifts | Must be reliable above all else |
| Autonomy | Tier 0-1 (mostly autonomous) | Tier 2 (speaks with operator authority) |
| Communication | Pushes code, posts to branches | DMs the human, posts ops reports |

The supervisor should run on the most capable model you have — its job is
judgment, not volume. A cheap model that misses a stuck agent costs more than
an expensive model that catches it.

### Supervisor Responsibilities

**Health monitoring:**
- Track commit frequency per agent (no commits for 2+ hours = investigate)
- Monitor session file sizes (approaching context limit = trigger reset)
- Watch for error patterns in logs (repeated timeouts = GPU contention)

**Session management:**
- Trigger session resets when agents get confused or bloated
- The supervisor has authority to reset any worker agent's session
- Resets are non-destructive — Memory Shepherd restores the baseline

**Daily briefing:**
- Compile 24h metrics: commits, costs, errors, uptime per agent
- Highlight anomalies: cost spikes, idle agents, repeated failures
- Include actionable items: "Agent X has been stuck since 3pm, needs
  manual intervention"

**Report cards:**
- Periodic assessment of each agent's effectiveness
- Are they completing tasks? Are they making mistakes? Are they idle?
- Feed back into baseline updates (see
  [WRITING-BASELINES.md](../memory-shepherd/docs/WRITING-BASELINES.md))

### The Supervisor Is Protected

The supervisor should be protected by the Guardian (see
[GUARDIAN.md](GUARDIAN.md)) at the same tier as the agent gateways. If the
supervisor goes down, nobody is watching the workers.

The supervisor should NOT have write access to the same infrastructure the
workers use. Its job is to observe and command, not to modify configs or
restart services directly — that's the Guardian's job.

---

## A Typical Hour

Here's what a healthy multi-agent system looks like in practice:

```
:00  Agent A is designing a new API endpoint. Spawns 3 sub-agents on
     the local GPU: one for the handler, one for tests, one for docs.
     All three run simultaneously at $0.

:02  Agent B picks up Agent A's PR. Runs integration checks. Posts
     review comments on the branch.

:05  Agent C is grinding through a refactoring task entirely on the
     local model. Commits every few minutes.

:05  The commit watchdog (background) reviews Agent C's latest commit.
     Posts "LGTM, no issues" to the shared channel.

:10  Agent A's sub-agents finish. Handler, tests, and docs all written
     in parallel. Agent A assembles the PR.

:15  Supervisor checks in. Pulls git logs, checks session health.
     Agent C's session is at 180KB — approaching the 256KB limit.
     Supervisor posts: "Agent C session at 70%, will auto-reset at 100%."

:20  Session watchdog fires. Agent C's session exceeds the threshold.
     Watchdog deletes the session file, gateway creates a fresh one.
     Agent C continues working — doesn't notice the swap.

:30  Supervisor checks in again. All three agents active. Commits
     flowing. No errors. Posts a green status report.

:45  Agent B finishes integration tests. Merges Agent A's PR to main.
     Agent C pulls latest, sees the new code.

:60  Guardian runs its 60-second check. All services healthy, all
     protected files intact. No action needed.
```

**The key insight:** Most of the time, nothing dramatic happens. The system
runs itself. The value of the supervisor, guardian, and watchdog is in the
5% of the time when something goes wrong — and it gets caught and fixed
automatically instead of silently degrading for hours.
