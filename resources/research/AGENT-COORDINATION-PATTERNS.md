# Agent Coordination Patterns

Best practices for orchestrating multiple AI agents working in parallel — coordinator/worker models, state management, task distribution, and failure recovery. Derived from production analysis of agentic systems running multi-agent coordination at scale.

*Last updated: 2026-03-31*

---

## Why This Matters

A single agent hits limits: context window exhaustion, serial execution bottlenecks, and cognitive overload on complex tasks. Multi-agent coordination solves this by distributing work across specialized workers. But coordination brings its own challenges — shared state corruption, circular dependencies, conflicting file edits, and runaway workers.

This document covers the coordinator/worker pattern, parallelism strategies, state isolation, and failure recovery as implemented in production multi-agent systems.

---

## 1. The Coordinator/Worker Model

### Roles

| Role | Responsibility | Characteristics |
|------|---------------|----------------|
| **Coordinator** | Receives user messages, decomposes tasks, spawns workers, synthesizes results | Long-lived, full context, orchestration logic |
| **Worker** | Executes a focused subtask, reports results back | Short-lived, narrow context, execution-focused |

### Communication Flow

```
User -> Coordinator
  Coordinator analyzes task
  Coordinator spawns Worker A (research)
  Coordinator spawns Worker B (research)    <- parallel
  Worker A reports results
  Worker B reports results
  Coordinator synthesizes findings
  Coordinator spawns Worker C (implementation)  <- serial (depends on research)
  Worker C reports results
  Coordinator spawns Worker D (verification)
  Worker D reports results
Coordinator -> User (final result)
```

### Task Notification Protocol

Workers report results via structured notifications:

```
TaskNotification:
  taskId: string         (unique identifier for tracking)
  status: string         (completed | failed | killed)
  summary: string        (one-line description of what was done)
  result: string         (detailed output)
  usage: object          (token counts, duration — for cost tracking)
```

**Key Insight:** Use a structured format (XML, JSON) for notifications, not free text. The coordinator needs to parse results programmatically to decide next steps.

---

## 2. Parallelism Strategy

### The Core Rule

**Read operations parallelize. Write operations serialize.**

| Task Type | Parallelism | Why |
|-----------|------------|-----|
| Code search / research | Full parallel | No state changes, no conflicts |
| File reading | Full parallel | Read-only operations are safe |
| File writing (different files) | Parallel OK | No conflicts if files don't overlap |
| File writing (same file) | Serialize | Concurrent writes corrupt content |
| Shell commands (read-only) | Full parallel | `grep`, `find`, `ls` are safe |
| Shell commands (write) | Serialize by scope | `git push` conflicts with `git push` |
| Testing | Parallel by test suite | Unless tests share state |

### Parallelism Decision Matrix

```
Can tasks run in parallel?

1. Are both tasks read-only?
   YES -> Parallel
   NO -> Continue

2. Do the tasks touch different files/resources?
   YES -> Parallel (with monitoring)
   NO -> Continue

3. Is one task a dependency of the other?
   YES -> Serialize (dependency first)
   NO -> Continue

4. Could the tasks interfere via shared state (git, databases)?
   YES -> Serialize
   NO -> Parallel
```

### Practical Patterns

**Pattern: Research Fan-Out**
```
Coordinator needs to understand a codebase:
  -> Spawn Worker A: "Search for all API endpoints"
  -> Spawn Worker B: "Search for all database models"
  -> Spawn Worker C: "Search for all test files"
  All three run in parallel (read-only)
  Coordinator synthesizes results into implementation plan
```

**Pattern: Implement Then Verify**
```
Implementation Worker writes code
  -> Verification Worker runs tests
  -> If tests fail: continue Implementation Worker (it has error context)
  -> If tests pass: report success
```

**Pattern: Parallel Implementation with File Partitioning**
```
Coordinator identifies 3 independent modules to modify:
  -> Worker A: modify module_a/ files
  -> Worker B: modify module_b/ files
  -> Worker C: modify module_c/ files
  All three run in parallel (non-overlapping files)
  Coordinator runs integration tests after all complete
```

---

## 3. Continue vs Spawn Decision

When a worker finishes and there's more work, the coordinator decides: continue the existing worker or spawn a fresh one?

### Continue Existing Worker When:

| Condition | Why |
|-----------|-----|
| Next task builds on worker's context | Worker already understands the code it just read/wrote |
| Worker encountered an error | Worker has the error context; a fresh worker would need to rediscover it |
| Same file set is involved | Worker has file contents cached in context |
| Task is a refinement of what worker just did | Incremental changes are cheaper than re-understanding |

### Spawn Fresh Worker When:

| Condition | Why |
|-----------|-----|
| Completely different task domain | Old context would be noise |
| Worker's context window is nearly full | Fresh worker has full capacity |
| Previous task failed in a way suggesting bad approach | Fresh perspective avoids repeating the same dead end |
| Worker is doing exploration, next task is implementation | Different cognitive mode |

### Decision Framework

```
should_continue(existing_worker, next_task):
  context_overlap = estimate_overlap(existing_worker.context, next_task)
  context_remaining = existing_worker.max_context - existing_worker.used_context

  if context_remaining < next_task.estimated_tokens:
    return SPAWN_FRESH  (not enough room)

  if context_overlap > 0.3:  (30%+ of next task's context already loaded)
    return CONTINUE

  if existing_worker.last_status == FAILED and next_task.is_retry:
    return CONTINUE  (worker has error context)

  return SPAWN_FRESH
```

---

## 4. State Management

### Immutable State Pattern

Application state should be immutable with functional updates:

```
State:
  settings: { ... }          (read-only after init)
  permissions: { ... }       (updated by permission decisions)
  mcpClients: Map            (updated by connection events)
  uiState: { ... }           (updated by user interactions)

updateState(updater):
  currentState = getState()
  newState = updater(currentState)   <- returns new object, doesn't mutate
  setState(newState)
```

**Why immutable:** Multiple agents reading state concurrently never see partially-updated state. Each state transition is atomic — you get the old state or the new state, never something in between.

### Subagent State Isolation

| State Access | Coordinator | Worker |
|-------------|------------|--------|
| Read app state | Full access | Read-only reference to coordinator's state |
| Write app state | Full access | No-op (writes silently dropped) |
| Infrastructure state | Full access | Limited updater (for background tasks only) |
| Local state | Own context | Own context (isolated) |

**Implementation:**

```
createWorkerContext(parentContext):
  return {
    appState: parentContext.appState,          // read-only reference
    setAppState: () => {},                      // no-op
    setAppStateForTasks: parentContext.setAppStateForTasks,  // limited
    workingDirectory: parentContext.workingDirectory,
    // ... other read-only properties
  }
```

### Cross-Worker Communication

Workers shouldn't communicate directly (creates coupling). Use one of these patterns:

| Pattern | Mechanism | When to Use |
|---------|-----------|------------|
| **Via Coordinator** | Worker A reports to Coordinator, Coordinator passes to Worker B | Default — coordinator maintains overview |
| **Shared Scratchpad** | Workers read/write to a shared directory | Large data handoffs (research results, intermediate files) |
| **Task Notifications** | Structured messages through the coordinator | Status updates and results |

**Scratchpad Pattern:**
```
/tmp/agent-session-123/
  scratchpad/
    worker-a-research.md    (Worker A writes research findings)
    worker-b-analysis.md    (Worker B writes analysis)
    shared-plan.md          (Coordinator writes, workers read)
```

---

## 5. Worker Tool Access

### Capability Injection

Workers don't automatically get all tools. The coordinator defines which tools each worker can access:

```
spawnWorker({
  task: "Research the authentication module",
  availableTools: [
    "file_read",
    "code_search",
    "grep",
    "directory_list",
    // NO file_write, NO bash, NO git push
  ]
})
```

### Tool Filtering by Worker Role

| Worker Role | Allowed Tools | Denied Tools |
|-------------|--------------|-------------|
| Researcher | Read, search, list, web fetch | Write, delete, shell (write), git push |
| Implementer | Read, write, edit, shell (all), git add/commit | Git push, deploy |
| Verifier | Read, shell (test commands), search | Write, delete, git push |
| Reviewer | Read, search, list | Write, shell, delete |

**Key Insight:** Principle of least privilege. A research worker that can't write files can't accidentally corrupt the codebase, even if prompt-injected.

**Enforcement mechanism:** The tool system's validation pipeline (see [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) §3) checks each tool call against the worker's `allowedTools` list before execution. If a worker calls a denied tool, the pipeline returns a permission error — the tool never executes. This is enforced at the framework level, not by the worker's system prompt, so it can't be bypassed by prompt injection.

---

## 6. Failure Recovery

### Worker Failure Handling

```
Worker reports FAILED:
  |
  v
[1] Same worker had an error it understands?
  YES -> Continue same worker with correction instructions
         (worker has error context, understands what went wrong)
  NO -> Continue to [2]
  |
  v
[2] First failure on this task?
  YES -> Continue same worker, suggest different approach
  NO -> Continue to [3]
  |
  v
[3] Multiple failures on same approach?
  YES -> Spawn fresh worker with different strategy
  NO -> Continue to [4]
  |
  v
[4] Task fundamentally impossible?
  YES -> Report to user, ask for guidance
```

### Failure Categories

| Category | Recovery Strategy |
|----------|-----------------|
| Test failure | Continue worker — it has the failing test output |
| Build error | Continue worker — it knows what it just changed |
| Permission denied | Report to coordinator — may need user approval |
| File conflict | Serialize — another worker is editing the same file |
| Context overflow | Spawn fresh worker with summary of progress so far |
| Network error | Retry with backoff (worker or coordinator level) |
| Timeout | Kill worker, spawn fresh with shorter task scope |

### Worker Kill Protocol

When a worker needs to be terminated:

```
1. Send abort signal (cooperative cancellation)
2. Wait for graceful shutdown (5-10 seconds)
3. If still running: force kill
4. Collect any partial results
5. Clean up worker resources (temp files, locks)
6. Report status to coordinator
```

---

## 7. Coordination Anti-Patterns

### Don't: Deep Worker Hierarchies

```
BAD:
  Coordinator -> Worker A -> Sub-Worker A1 -> Sub-Sub-Worker A1a
```

Deep hierarchies create:
- Context dilution (each level summarizes, losing detail)
- Slow feedback loops
- Hard-to-debug failure chains

**Instead:** Flat structure. Coordinator spawns all workers directly. Maximum depth: 2 (coordinator + workers).

### Don't: Workers Spawning Workers

Workers that spawn their own workers create uncontrolled fan-out. The coordinator loses visibility.

**Instead:** Workers report "this task should be split" back to the coordinator, which makes the spawn decision.

### Don't: Shared Mutable State

Workers writing to the same state object creates race conditions, even in single-threaded environments (async/await interleaving).

**Instead:** Immutable state with coordinator-controlled updates.

### Teammate Pattern

Beyond coordinator/worker, production systems support **teammates** — persistent in-process agents that run alongside the main agent with their own conversation context:

**Teammate Mailbox:**

| Component | Purpose |
|-----------|---------|
| Inbox queue | Messages from other agents waiting to be processed |
| Outbox queue | Messages this agent wants to send to others |
| Correlation ID | Pairs request messages with their responses |

```
Teammate A sends request to Teammate B:
  A.outbox.enqueue({ to: B, content: "What's the API schema?", correlationId: "req-1" })
  -> Routed to B.inbox
  B processes, responds:
  B.outbox.enqueue({ to: A, content: "Here's the schema...", correlationId: "req-1" })
  -> Routed to A.inbox, matched by correlationId
```

**Team Discovery:** Agents find teammates via the session registry — active sessions in the same project with compatible session kinds (interactive, daemon-worker).

**Session Kind Affects Coordination:**
- `interactive` sessions: full coordination, user can mediate
- `bg` (background) sessions: coordinate via mailbox only, no user prompts
- `daemon-worker` sessions: report to parent daemon, minimal autonomy

See [AGENT-REMOTE-AND-TEAM-COLLABORATION.md](AGENT-REMOTE-AND-TEAM-COLLABORATION.md) for the full teammate system.

### Don't: Fire-and-Forget Workers

Workers that don't report back leave the coordinator blind.

**Instead:** All workers must send a completion notification (success or failure). Implement timeouts for workers that go silent.

---

## 8. Implementation Checklist

### Minimum Viable Coordination

- [ ] Coordinator/worker role separation
- [ ] Task notification protocol (structured format)
- [ ] Parallel read operations, serial write operations
- [ ] Worker context isolation (read-only state access)
- [ ] Worker timeout and kill protocol
- [ ] Failure reporting back to coordinator

### Production-Grade Coordination

- [ ] All of the above, plus:
- [ ] Continue vs spawn decision framework
- [ ] Worker tool filtering by role
- [ ] Shared scratchpad for cross-worker data
- [ ] Immutable state with functional updates
- [ ] Denial tracking across workers
- [ ] Context window monitoring for workers
- [ ] Worker capability injection
- [ ] Flat coordination hierarchy (max depth 2)
- [ ] Graceful shutdown with partial result collection
- [ ] Cost tracking per worker (token usage)

---

## Related Documents

- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Tool system that workers execute against
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Permission system shared across workers
- [AGENT-ERROR-HANDLING-AND-HOOKS.md](AGENT-ERROR-HANDLING-AND-HOOKS.md) — Error handling patterns for worker failures
