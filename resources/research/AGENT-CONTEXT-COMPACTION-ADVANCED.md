# Agent Context Compaction — Advanced Patterns

Best practices for multi-stage context compaction in autonomous AI agent systems — auto-compact triggers, microcompact for prompt cache efficiency, session memory compaction, full summarization, and reactive recovery from context overflow. Derived from production analysis of agentic systems managing sessions that span hundreds of turns without losing coherence.

*Last updated: 2026-03-31*

---

## Why This Matters

Basic context truncation (see [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md)) handles medium sessions. But production agents run sessions with 200+ turns, generating hundreds of thousands of tokens. These sessions need multi-stage compaction — lightweight passes that preserve prompt cache hits, medium passes that compress without losing structure, and full summarization as a last resort.

Without advanced compaction, long sessions either crash (context overflow) or degrade (agent forgets early instructions). This document covers the production patterns that prevent both.

---

## 1. Compaction Trigger Thresholds

### Threshold Calculation

```
effectiveWindow = contextWindowSize - reservedForSummary  // reserve up to 20K for summary

autoCompactThreshold = effectiveWindow - 13_000  // 13K buffer before threshold
warningThreshold = autoCompactThreshold - 20_000  // warn 20K before auto-compact
blockingLimit = effectiveWindow - 3_000           // hard stop, 3K from the edge
```

### Environment Variable Overrides

| Variable | Effect |
|----------|--------|
| `AUTO_COMPACT_WINDOW` | Override effective window size |
| `AUTOCOMPACT_PCT_OVERRIDE` | Set threshold as percentage of effective window |
| `BLOCKING_LIMIT_OVERRIDE` | Override the hard blocking limit |
| `DISABLE_COMPACT` | Disable all compaction |
| `DISABLE_AUTO_COMPACT` | Disable auto-triggered compaction only |

### When Compaction Fires

| Trigger | Condition | Response |
|---------|-----------|----------|
| **Auto-compact** | Token count exceeds autoCompactThreshold | Proactive compaction |
| **Warning** | Token count exceeds warningThreshold | Log warning, prepare for compaction |
| **Blocking** | Token count exceeds blockingLimit | Force immediate compaction |
| **Reactive** | API returns "prompt_too_long" error | Emergency compaction, then re-send |
| **Manual** | User runs `/compact` command | Always available, no gates |

### Circuit Breaker

```
CircuitBreaker:
  consecutiveFailures: 0
  maxFailures: 3

  onCompactSuccess():
    consecutiveFailures = 0

  onCompactFailure():
    consecutiveFailures++
    if consecutiveFailures >= maxFailures:
      disableAutoCompact()
      log.warn("Auto-compact disabled after {maxFailures} consecutive failures")
```

**Why a circuit breaker:** If the context is fundamentally oversized (massive tool results that can't be summarized), repeated compaction attempts waste API calls and tokens. After 3 failures, disable and let the user decide.

---

## 2. Compaction Stages

### Stage Overview

```
Context growing...
  |
  v
[Stage 1: Microcompact]
  -> Lightweight: clear old tool result content
  -> Preserves message structure
  -> Maintains prompt cache hits
  -> Runs automatically, no forked agent
  |
  v (if still over threshold)
  |
[Stage 2: Session Memory Compact]
  -> Medium: extract compressed summary from session memory service
  -> Cheaper than full compact (no summarizer fork)
  -> Truncates old messages, preserves recent
  |
  v (if still over threshold or Stage 2 disabled)
  |
[Stage 3: Full Compact]
  -> Heavy: forked agent summarizes entire conversation
  -> Replaces old messages with summary
  -> Post-compact cleanup re-injects critical context
  -> Most expensive but most effective
  |
  v (if API still rejects)
  |
[Stage 4: Reactive Compact]
  -> Emergency: triggered by API "prompt_too_long" error
  -> Re-plans after compaction
  -> Last resort before session continuation
```

---

## 3. Microcompact (Stage 1)

### What It Does

Selectively clears the content of old tool results while preserving the message structure. The model still sees *that* a tool was called and *what* it returned (via the preserved message skeleton), but the full content is removed.

### Which Tools Are Compactable

| Tool | Compactable | Why |
|------|------------|-----|
| File Read | Yes | File can be re-read if needed |
| Bash Output | Yes | Command can be re-run if needed |
| Grep Results | Yes | Search can be re-run |
| Glob Results | Yes | Pattern match can be re-run |
| Web Search | Yes | Search can be re-run |
| Web Fetch | Yes | Page can be re-fetched |
| File Edit (result) | Yes | Edit result is informational |
| Agent/MCP Results | No | External results may not be reproducible |
| User Messages | No | User intent must be preserved |

### Time-Based Clearing

```
microcompact(messages, ageThreshold):
  for message in messages:
    if message.type == "tool_result":
      if message.age > ageThreshold:
        if isCompactableTool(message.toolName):
          message.content = "[Content cleared — tool result from {message.age} ago]"
          message.images = []
          message.metadata.microcompacted = true
```

### Lazy Restoration

If the model later references a microcompacted result, restore it on demand:

```
onModelReferencesCompactedResult(messageId):
  original = toolResultCache.get(messageId)
  if original:
    message.content = original.content  // restore from cache
    message.metadata.microcompacted = false
```

**Key insight:** Microcompact is cheap (no API calls) and preserves prompt cache (message structure unchanged). It's the first line of defense.

---

## 4. Session Memory Compact (Stage 2)

### What It Does

Extracts a compressed summary from the session memory service and uses it to replace old messages. Cheaper than full compaction because it doesn't need a summarizer fork.

### Flow

```
sessionMemoryCompact(messages):
  // Extract session memory (already maintained incrementally)
  summary = sessionMemoryService.getSummary()

  // Check if truncation is worthwhile
  if summary.tokenCount < 10_000:
    return SKIP  // summary too small to help

  // Find truncation point (preserve at least 5 recent text blocks)
  truncationPoint = findTruncationPoint(messages, minTextBlocks: 5)

  // Replace old messages with compact boundary + summary
  compacted = [
    CompactBoundaryMessage(summary),
    ...messages.slice(truncationPoint)
  ]

  return compacted
```

### When to Use

- As a fast alternative to full compaction
- When session memory service has been maintaining a running summary
- When context is moderately over threshold (not critically)
- Disabled by default in some configurations (experimental)

---

## 5. Full Compact (Stage 3)

### Message Grouping

Before compaction, group messages by API round boundaries:

```
groupMessages(messages):
  groups = []
  currentGroup = null

  for message in messages:
    if message.type == "assistant" and message.id != currentGroup?.assistantId:
      // New API round — start new group
      currentGroup = { assistantId: message.id, messages: [] }
      groups.push(currentGroup)

    currentGroup.messages.push(message)

  return groups
```

**Why group by API round:** Each round represents a complete think-act cycle. Summarizing at round boundaries preserves the agent's reasoning structure.

### Summarization via Forked Agent

```
fullCompact(messages):
  groups = groupMessages(messages)

  // Fork a summarizer agent (shares parent's prompt cache)
  summary = runForkedAgent({
    cacheSafeParams: parentParams,
    promptMessages: [buildCompactPrompt(groups)],
    querySource: "compact",
    maxTurns: 3  // summarization shouldn't need many turns
  })

  // Build compact boundary message
  boundary = CompactBoundaryMessage({
    summary: summary.output,
    metadata: {
      groupsCompacted: groups.length,
      tokensRecovered: calculateTokensSaved(messages, summary)
    }
  })

  return [boundary, ...recentMessages]
```

### Post-Compact Cleanup

After compaction, critical context needs re-injection:

| Re-injected Content | Budget | Why |
|---------------------|--------|-----|
| Top 5 recently-read files | Up to 50K tokens | Agent likely needs these for current task |
| Top N active skills | Up to 25K tokens per skill | Skills define agent capabilities |
| Session-start hooks | Re-executed | Hooks may set up state the agent depends on |
| Active plan (if exists) | Attached to boundary | Don't lose the current plan |

### Recompaction Tracking

```
RecompactionState:
  consecutiveCompacts: 0
  turnsSinceLastCompact: 0

  onCompact():
    consecutiveCompacts++

    // If compacting frequently, generate higher-quality summaries
    if consecutiveCompacts > 2:
      summaryLevel = "detailed"  // more tokens for summary
    else:
      summaryLevel = "concise"

  onNewTurn():
    turnsSinceLastCompact++
    if turnsSinceLastCompact > 10:
      consecutiveCompacts = 0  // reset if we went 10+ turns without compacting
```

---

## 6. Reactive Compact (Stage 4)

### Triggered by API Error

```
onApiError(error):
  if error.type == "prompt_too_long":
    // Emergency compaction
    compactResult = fullCompact(conversation.messages)

    if compactResult.success:
      // Rebuild the request and retry
      replanAndRetry(compactResult.compactedMessages)
    else:
      // Can't compact further — offer session continuation
      offerSessionContinuation()
```

### Preventing Deadlocks

The compaction agent itself makes API calls. If those calls also exceed the context limit, you get infinite recursion.

**Prevention:**
- Skip compaction for the compaction fork itself (check querySource)
- Skip compaction for session memory forks
- Circuit breaker stops retries after 3 failures

---

## 7. Compact Boundary Message

When compaction replaces old messages, insert a boundary marker:

```
CompactBoundaryMessage:
  type: "system"
  subtype: "compact_boundary"
  content: "--- Session compacted at {timestamp} ---\n{summary}"
  metadata:
    compactType: "micro" | "session_memory" | "full" | "reactive"
    groupsCompacted: number
    tokensRecovered: number
    planAttachment: Plan | null
    fileAttachments: FileAttachment[]
```

The agent sees this as a system message and knows that earlier context has been summarized.

---

## 8. Implementation Checklist

### Minimum Viable Compaction

- [ ] Auto-compact trigger at configurable token threshold
- [ ] Full compact via forked summarizer agent
- [ ] Compact boundary message with summary
- [ ] Circuit breaker (3 failures → disable)
- [ ] Manual `/compact` command

### Production-Grade Compaction

- [ ] All of the above, plus:
- [ ] Multi-threshold system (warning, auto, blocking)
- [ ] Environment variable overrides for all thresholds
- [ ] Microcompact (time-based tool result clearing)
- [ ] Compactable tool classification
- [ ] Lazy restoration of microcompacted results
- [ ] Session memory compact (fast path, no fork)
- [ ] Message grouping by API round boundaries
- [ ] Post-compact re-injection (files, skills, hooks, plan)
- [ ] Recompaction tracking (consecutive compacts → detailed summaries)
- [ ] Reactive compact on API "prompt_too_long"
- [ ] Deadlock prevention (skip compact for compact forks)
- [ ] Dangling tool_use repair after grouping
- [ ] Compact metadata in boundary message

---

## Related Documents

- [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) — Basic context management and token budgeting
- [AGENT-TASK-AND-BACKGROUND-EXECUTION.md](AGENT-TASK-AND-BACKGROUND-EXECUTION.md) — Forked agent pattern used for summarization
- [AGENT-MEMORY-AND-CONSOLIDATION.md](AGENT-MEMORY-AND-CONSOLIDATION.md) — Session memory compaction preserves memory references
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — API error handling triggers reactive compact
- [AGENT-SYSTEM-PROMPT-ENGINEERING.md](AGENT-SYSTEM-PROMPT-ENGINEERING.md) — Prompt cache optimization via microcompact
