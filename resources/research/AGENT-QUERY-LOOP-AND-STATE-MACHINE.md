# Agent Query Loop and State Machine

The beating heart of an autonomous AI agent — the generator-based query loop that orchestrates model calls, tool execution, error recovery, and turn termination. This is the engine that wires every other component together. Derived from production analysis of agentic systems processing millions of multi-turn conversations with 11 recovery transitions and 9 terminal conditions.

*Last updated: 2026-03-31*

---

## Why This Matters

Every other document describes a component. This document describes how they connect into a running system. The query loop is the main loop — the thing that makes an agent an agent instead of a chatbot. It calls the model, dispatches tools, handles errors, recovers from failures, and decides when to stop. Without understanding this, you have parts but no machine.

---

## 1. Why Async Generators

### The Problem

An agentic loop needs to:
- Stream model output as tokens arrive (5-30 seconds per response)
- Execute tools concurrently while streaming continues
- Yield recovery messages mid-turn without blocking consumers
- Support clean exit paths (user abort, error, graceful shutdown)

A simple `while (true)` loop can't do this. You'd need threads, callbacks, or complex state management.

### The Solution: Async Generators

```
async function* queryLoop(params):
  while (true):
    // Yield streaming events as they arrive
    for await (chunk of modelStream):
      yield StreamEvent(chunk)

    // Yield tool results as they complete
    for (result of toolResults):
      yield Message(result)

    // Recovery: continue for retry, return for exit
    if (shouldRetry):
      continue  // re-enter loop, call model again
    else:
      return terminalReason  // exit generator
```

**Why this works:**
- `yield` sends data to the consumer without blocking the loop
- `continue` re-enters the loop for recovery without restarting the generator
- `return` cleanly exits the generator with a terminal reason
- The consumer can call `.return()` to abort from outside
- Error propagation via `throw` works naturally

### The Two-Layer Structure

```
query(params):
  // Thin wrapper — delegates to queryLoop, handles lifecycle
  consumedCommandUuids = []
  terminal = yield* queryLoop(params, consumedCommandUuids)

  // Only runs on clean exit (not throw or .return())
  for uuid in consumedCommandUuids:
    notifyCommandLifecycle(uuid, 'completed')

  return terminal

queryLoop(params, consumedCommandUuids):
  // The actual state machine — 1700+ lines
  state = initializeState()

  while (true):
    // ... model call, tool execution, recovery ...
```

`yield*` delegates — all yields from `queryLoop` pass through `query` transparently. `query` only runs its cleanup code after `queryLoop` returns normally.

---

## 2. The State Object

State carries mutable context across loop iterations:

| Field | Type | Purpose |
|-------|------|---------|
| `messages` | Message[] | Full conversation history (grows each iteration) |
| `toolUseContext` | ToolUseContext | Tool definitions, permissions, abort signals, file cache |
| `autoCompactTracking` | object | Compaction metrics: turnId, turnCounter, failureCount |
| `maxOutputTokensRecoveryCount` | number | How many times we've retried on max-output-tokens |
| `hasAttemptedReactiveCompact` | boolean | Guard: prevent re-trying reactive compact on same turn |
| `maxOutputTokensOverride` | number | Escalated output token limit (8K → 64K) |
| `pendingToolUseSummary` | Promise | Async tool use summary from smaller model |
| `stopHookActive` | boolean | Stop hooks currently running |
| `turnCount` | number | Iteration counter |
| `transition` | string | Why the previous iteration continued (for debugging/testing) |

### State Mutation Pattern

State is destructured at the top of each iteration for convenient access. All cross-iteration mutations use explicit `state = { ...state, field: newValue }` so continue sites are searchable in the codebase.

---

## 3. The Main Loop Flow

Each iteration follows this structure:

```
┌─────────────────────────────────────────┐
│ 1. PRE-CALL CHECKS                     │
│    - Check blocking limit               │
│    - Check auto-compact threshold        │
│    - Prepare messages for API            │
│    - Start memory/skill prefetch         │
├─────────────────────────────────────────┤
│ 2. CALL MODEL (streaming)               │
│    - Stream tokens, yield StreamEvents   │
│    - Detect tool_use blocks → set        │
│      needsFollowUp = true               │
│    - Handle streaming errors             │
├─────────────────────────────────────────┤
│ 3. ERROR RECOVERY (if model call failed)│
│    - Fallback model retry                │
│    - Context collapse drain              │
│    - Reactive compact                    │
│    - Max output tokens escalation        │
│    → continue (retry) or return (fail)   │
├─────────────────────────────────────────┤
│ 4. TOOL EXECUTION (if needsFollowUp)    │
│    - Partition tools (concurrent/serial) │
│    - Execute via StreamingToolExecutor   │
│    - Collect results                     │
│    - Run stop hooks                      │
├─────────────────────────────────────────┤
│ 5. ATTACHMENT COLLECTION                │
│    - Drain queued commands               │
│    - Collect memory prefetch results     │
│    - Collect skill discovery results     │
├─────────────────────────────────────────┤
│ 6. STATE UPDATE                         │
│    - Roll tool results into messages     │
│    - Increment turn counter              │
│    - continue → next iteration           │
│    (or return if needsFollowUp = false)  │
└─────────────────────────────────────────┘
```

---

## 4. The needsFollowUp Exit Signal

This is the **sole mechanism** that determines whether the loop continues or exits:

```
needsFollowUp = false  // default: stop after this turn

// During streaming, scan assistant message content:
for block in assistantMessage.content:
  if block.type == "tool_use":
    toolUseBlocks.push(block)
    needsFollowUp = true  // agent called a tool → must continue

// After model call:
if needsFollowUp == false:
  // No tools called → agent is done responding
  return "completed"  // exit the loop

// needsFollowUp == true:
// Execute tools, collect results, continue loop
```

### Why Not Use stop_reason?

The API returns a `stop_reason` field on each response. In theory, `stop_reason === 'tool_use'` means the model wants to call tools. In practice:

**stop_reason is unreliable.** It's not always set correctly by the API. The production system learned this the hard way and switched to direct content scanning:

```
// DON'T DO THIS:
if (response.stop_reason === 'tool_use') { ... }  // unreliable

// DO THIS:
if (response.content.some(block => block.type === 'tool_use')) { ... }  // reliable
```

The content blocks are the source of truth. If tool_use blocks exist, the agent needs to execute them regardless of what stop_reason says.

---

## 5. The 11 Recovery Transitions

When something goes wrong, the loop doesn't exit — it `continue`s with a recovery strategy. Each continue path represents a specific failure mode and its fix:

### 5.1 Fallback Model Retry

**Trigger:** FallbackTriggeredError during streaming (primary model failed)
**Recovery:** Discard orphaned async messages, clear tool executor, switch to fallback model, retry API call
**When:** Model-specific errors that another model might handle

### 5.2 Context Collapse Drain Retry

**Trigger:** API returns "prompt_too_long" error + staged context-collapse messages are queued
**Recovery:** Drain lowest-priority collapsed messages (removes verbose search results, old tool outputs), retry API
**When:** Context is over limit but can be reduced by removing collapsed content

### 5.3 Reactive Compact Retry

**Trigger:** prompt_too_long persists after collapse drain fails + reactive compact hasn't been attempted
**Recovery:** Run full summarization compaction (forked agent), discard microcompact state, retry API
**When:** Context is critically oversized, needs aggressive summarization

### 5.4 Max Output Tokens Escalation

**Trigger:** Model hit the 8K output token cap on the first turn
**Recovery:** Escalate maxOutputTokens override to 64K, retry without nudging the model
**When:** First-turn responses that are naturally long (large code generation)

### 5.5 Max Output Tokens Recovery

**Trigger:** Model hit token cap again (recovery count < 3)
**Recovery:** Append nudge message ("break work into smaller pieces"), increment recovery counter, retry
**When:** Model is generating very long output and needs guidance to chunk

### 5.6 Stop Hook Blocking

**Trigger:** Stop hooks inject blocking error messages into the conversation
**Recovery:** Add hook error messages to history, reset recovery counters, retry API call
**When:** Post-tool hooks detected problems that need model attention

### 5.7 Token Budget Continuation

**Trigger:** Experimental token budget system allows continuation
**Recovery:** Append budget nudge message, update budget tracking, retry
**When:** Feature-gated experimental continuation mode

---

## 6. Terminal Conditions

When the loop exits (no more continues), it returns one of these reasons:

| Terminal | Condition | Normal? |
|----------|-----------|---------|
| `completed` | needsFollowUp=false, no errors | Yes — agent finished |
| `aborted_streaming` | User interrupted during model streaming | Yes — user chose to stop |
| `aborted_tools` | User interrupted during tool execution | Yes — user chose to stop |
| `prompt_too_long` | All recovery paths exhausted | Error — context unrecoverable |
| `image_error` | Image too large even after stripping | Error — media issue |
| `model_error` | Uncaught exception during API call | Error — API failure |
| `blocking_limit` | Hard token limit hit before API call | Error — context too large |
| `hook_stopped` | Hook verdict prevents continuation | Controlled — hook blocked |
| `max_turns` | Turn counter hit configured limit | Safety — prevent runaway |

---

## 7. Tool Result Integration Points

Tool results flow back into the loop through three phases:

### Phase 1: Streaming (concurrent with model output)

While the model is still streaming, the StreamingToolExecutor can start executing tools:

```
Model streams: "I'll read the file..." [tool_use: file_read]

StreamingToolExecutor:
  → Detects tool_use block
  → Starts file_read execution immediately
  → Model continues streaming: "...and then modify it"
  → file_read completes, result buffered
  → Model finishes streaming
```

This overlap saves latency — tool execution starts before the model finishes its response.

### Phase 2: Post-Streaming Execution

After streaming completes, remaining tools (not started during streaming) execute:

```
toolResults = []

for batch in partitionToolCalls(toolUseBlocks):
  if batch.isConcurrent:
    results = await runToolsConcurrently(batch, semaphore: 10)
  else:
    results = await runToolsSerially(batch)
  toolResults.push(...results)
```

### Phase 3: Attachment Collection

After tools complete, additional context is collected:

```
// Drain queued commands (user typed while agent was working)
queuedCommands = commandQueue.dequeueAll()
toolResults.push(...convertToAttachments(queuedCommands))

// Collect async prefetch results (memory, skill discovery)
if memoryPrefetch.settled:
  toolResults.push(...memoryPrefetch.results)
if skillPrefetch.settled:
  toolResults.push(...skillPrefetch.results)
```

### State Update (Loop Continuation)

All results roll into the next iteration:

```
state = {
  ...state,
  messages: [...state.messages, ...assistantMessages, ...toolResults],
  turnCount: state.turnCount + 1
}
continue  // → next iteration with updated messages
```

---

## 8. Pre-Call Checks

Before each model call, the loop performs several checks:

### Blocking Limit Check

```
if totalTokens > blockingLimit:
  return "blocking_limit"  // can't even make the API call
```

### Auto-Compact Check

```
if totalTokens > autoCompactThreshold:
  compactResult = await runAutoCompact(messages)
  if compactResult.success:
    state.messages = compactResult.compactedMessages
  else:
    state.autoCompactTracking.failureCount++
    if failureCount >= 3:
      disableAutoCompact()  // circuit breaker
```

### Message Preparation

```
messagesForApi = normalizeMessagesForAPI(state.messages)
  // Filter virtual messages
  // Strip problematic media on error
  // Merge consecutive user messages (provider compatibility)
  // Apply tool result budget (size limits, persistence)
```

### Prefetch Initiation

```
memoryPrefetch = startRelevantMemoryPrefetch(lastUserMessage)
skillPrefetch = startSkillDiscoveryPrefetch()
// Both run async, collected in Phase 3 after tools
```

---

## 9. Implementation Checklist

### Minimum Viable Query Loop

- [ ] Async generator structure (query wraps queryLoop)
- [ ] State object with messages, toolUseContext, turnCount
- [ ] Model call with streaming
- [ ] needsFollowUp detection via content block scanning (NOT stop_reason)
- [ ] Tool execution after model response
- [ ] Tool results rolled into next iteration messages
- [ ] Turn counter with max_turns safety limit
- [ ] User abort handling (streaming + tools)
- [ ] Clean terminal return with reason

### Production-Grade Query Loop

- [ ] All of the above, plus:
- [ ] 7+ recovery transitions (fallback model, collapse drain, reactive compact, max tokens escalation, max tokens recovery, stop hook blocking, token budget continuation)
- [ ] 9 terminal conditions with distinct reasons
- [ ] Auto-compact check before each model call
- [ ] Blocking limit check before each model call
- [ ] Message normalization pipeline (virtual filtering, media stripping, user message merging)
- [ ] Tool result budget enforcement (size thresholds, disk persistence, XML wrapping)
- [ ] Streaming tool execution (start tools during model streaming)
- [ ] Memory prefetch at iteration boundary (async, collected after tools)
- [ ] Skill discovery prefetch (feature-gated, concurrent)
- [ ] Queued command drain between iterations
- [ ] Stop hook execution after tools with blocking retry
- [ ] Max output tokens escalation (8K → 64K on first turn)
- [ ] Recovery nudge messages for max tokens
- [ ] Circuit breaker for auto-compact failures
- [ ] Transition tracking for debugging/testing
- [ ] Command lifecycle notifications on clean exit

---

## Related Documents

- [AGENT-STREAMING-TOOL-EXECUTION.md](AGENT-STREAMING-TOOL-EXECUTION.md) — StreamingToolExecutor and tool orchestration
- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Tool definitions and validation pipeline
- [AGENT-CONTEXT-COMPACTION-ADVANCED.md](AGENT-CONTEXT-COMPACTION-ADVANCED.md) — Reactive and auto-compact triggered by this loop
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — Model call, streaming, retry logic
- [AGENT-MESSAGE-PIPELINE.md](AGENT-MESSAGE-PIPELINE.md) — Message types flowing through the loop
- [AGENT-ERROR-HANDLING-AND-HOOKS.md](AGENT-ERROR-HANDLING-AND-HOOKS.md) — Stop hooks that influence loop continuation
- [AGENT-MEMORY-AND-CONSOLIDATION.md](AGENT-MEMORY-AND-CONSOLIDATION.md) — Memory prefetch initiated by the loop
- [AGENT-INITIALIZATION-AND-WIRING.md](AGENT-INITIALIZATION-AND-WIRING.md) — How the loop is bootstrapped and launched
