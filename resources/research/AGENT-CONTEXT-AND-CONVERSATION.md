# Agent Context and Conversation Management

Best practices for managing context windows, token budgets, conversation history, and message formatting in autonomous AI agent systems. Derived from production analysis of agentic systems that maintain coherent sessions across hundreds of tool calls and tens of thousands of tokens.

*Last updated: 2026-03-31*

---

## Why This Matters

Every LLM has a finite context window. An agentic coding tool that reads files, runs commands, and manages multi-step tasks fills that window fast. Without active context management, the agent loses track of early instructions, forgets what it already tried, and eventually chokes on its own history.

Production systems treat context as a scarce resource — budgeted, compacted, and strategically pruned.

---

## 1. Context Window Budget

### Token Allocation

Divide the context window into budgeted regions:

| Region | Typical Allocation | Contents |
|--------|-------------------|----------|
| **System prompt** | 10-20% | Identity, safety, tools, environment, memory |
| **Conversation history** | 50-65% | User messages, agent responses, tool results |
| **Current turn** | 15-25% | Active tool calls, in-progress reasoning |
| **Output reserve** | 5-10% | Space for the model's response |

**Example for 200K token window:**

```
System prompt:     20,000 tokens (10%)
History:          130,000 tokens (65%)
Current turn:      30,000 tokens (15%)
Output reserve:    20,000 tokens (10%)
```

### Dynamic Budgeting

Budgets shift based on task phase:

| Phase | System Prompt | History | Current Turn | Output |
|-------|--------------|---------|-------------|--------|
| **Exploration** (reading code) | 15% | 55% | 20% | 10% |
| **Implementation** (writing code) | 10% | 50% | 25% | 15% |
| **Debugging** (analyzing errors) | 10% | 60% | 20% | 10% |
| **Planning** (designing approach) | 20% | 40% | 20% | 20% |

### Budget Monitoring

Track usage continuously:

```
checkBudget():
  systemTokens = countTokens(systemPrompt)
  historyTokens = countTokens(conversationHistory)
  currentTokens = countTokens(currentTurn)
  totalUsed = systemTokens + historyTokens + currentTokens
  remaining = contextWindowSize - totalUsed

  if remaining < outputReserve:
    triggerCompaction()
  elif remaining < outputReserve * 2:
    warn("Context window 80%+ full, consider compaction")
```

---

## 2. Message Types and Formatting

### Message Roles

| Role | Source | Purpose |
|------|--------|---------|
| `system` | Application | System prompt (instructions, tools, context) |
| `user` | Human user | Questions, instructions, feedback |
| `assistant` | Agent | Responses, reasoning, tool calls |
| `tool_result` | Tool execution | Command output, file contents, API responses |

### Tool Call / Tool Result Pairing

Every tool call must pair with a tool result:

```
Message: assistant
  content: "I'll read the file to understand the structure"
  tool_calls: [{ id: "tc_1", name: "file_read", input: { path: "/src/main.ts" } }]

Message: tool_result
  tool_call_id: "tc_1"
  content: "// file contents here..."
```

**Critical rule:** Never leave an unpaired tool call. The LLM API expects every tool call to have a matching result. Missing results cause API errors or hallucinated continuations.

### Multi-Tool Calls

Agents often call multiple tools in a single turn:

```
Message: assistant
  tool_calls: [
    { id: "tc_1", name: "file_read", input: { path: "/src/a.ts" } },
    { id: "tc_2", name: "file_read", input: { path: "/src/b.ts" } },
    { id: "tc_3", name: "bash", input: { command: "git status" } }
  ]

Message: tool_result (tc_1)
  content: "// contents of a.ts..."

Message: tool_result (tc_2)
  content: "// contents of b.ts..."

Message: tool_result (tc_3)
  content: "On branch main\nnothing to commit"
```

**Ordering:** Tool results should be returned in the same order as the tool calls for consistency, but most APIs accept any order as long as IDs match.

---

## 3. Tool Result Management

### The Problem: Large Tool Results

A single `file_read` can return thousands of lines. A `bash` command might produce megabytes of output. Including full results in conversation history fills the context window in a few turns.

### Truncation Strategy

| Tool | Max Result Size | Truncation Method |
|------|----------------|-------------------|
| File read | ~2,000 lines | Head truncation with "... truncated" marker |
| Shell output | ~500 lines | Tail-preference (last N lines most useful for errors) |
| Web fetch | ~10,000 chars | Summarization via smaller model |
| Search results | ~50 matches | Top-N by relevance |
| Directory listing | ~200 entries | Alphabetical with truncation |

### Result Compression Over Time

Recent tool results: keep full content
Older tool results: compress to summaries

```
compressOldResults(history, threshold):
  for message in history:
    if message.age > threshold and message.type == "tool_result":
      if message.tokenCount > MAX_OLD_RESULT_TOKENS:
        message.content = summarize(message.content)
        message.metadata.compressed = true
```

### Deferred Results

For very large outputs, store the full result externally and include a reference:

```
tool_result:
  content: "Build output (847 lines). First 50 lines shown below:\n..."
  metadata:
    full_result_path: "/tmp/agent-session/build-output-tc_42.txt"
    total_lines: 847
    truncated: true
```

The agent can request the full output via another tool call if needed.

---

## 4. Conversation History Management

### Sliding Window

The simplest approach: keep the last N messages, drop older ones.

**Problem:** Loses important early context (initial instructions, project setup, key decisions).

### Smart Truncation

Better approach: preserve important messages, compress or drop unimportant ones.

**Keep always:**
- System prompt
- First user message (often contains the main task)
- Messages containing key decisions or approvals
- Most recent N messages (the active working context)

**Compress:**
- Tool results older than N turns (replace with summaries)
- Long assistant reasoning (replace with conclusion)
- Intermediate search results (replace with "searched for X, found Y")

**Drop:**
- Duplicate file reads (keep most recent version)
- Redundant status checks
- Failed attempts that were superseded by successful ones

### Importance Scoring

Score each message for retention priority:

| Signal | Score Boost |
|--------|------------|
| Contains user instruction | +5 |
| Contains decision/approval | +4 |
| Contains error that led to fix | +3 |
| Contains code that was written | +3 |
| Contains file read (recent) | +2 |
| Contains file read (old, same file read again later) | -3 |
| Contains intermediate search | +1 |
| Contains status check | -1 |

### Compaction Trigger

```
shouldCompact():
  usedPercent = totalTokens / contextWindowSize
  if usedPercent > 0.80:
    return COMPACT_AGGRESSIVE  (summarize + drop)
  elif usedPercent > 0.65:
    return COMPACT_MODERATE    (summarize old results)
  else:
    return NO_COMPACT
```

---

## 5. Context Window Strategies by Task Type

### Short Tasks (< 10 turns)

No management needed. The full conversation fits easily.

### Medium Tasks (10-50 turns)

Compress old tool results. Keep all user messages and decisions.

```
Strategy: COMPRESS_OLD_RESULTS
  - Keep full content for last 10 turns
  - Summarize tool results older than 10 turns
  - Keep all user messages verbatim
  - Keep all assistant decisions/conclusions
```

### Long Tasks (50-200 turns)

Active truncation required. Consider session splitting.

```
Strategy: ACTIVE_TRUNCATION
  - Keep full content for last 20 turns
  - Summarize everything older than 20 turns into a "session summary"
  - Session summary: what was accomplished, what's in progress, key decisions
  - Keep the summary as a pseudo-message at the start of history
  - Drop individual old messages
```

### Strategy Transition Triggers

```
selectStrategy(sessionState):
  usedPercent = sessionState.totalTokens / contextWindowSize

  if usedPercent < 0.50:
    return NO_MANAGEMENT          // short task, fits easily

  if usedPercent < 0.65:
    return COMPRESS_OLD_RESULTS   // medium task, compress old tool outputs

  if usedPercent < 0.80:
    return ACTIVE_TRUNCATION      // long task, summarize + drop aggressively

  return SESSION_CONTINUATION     // very long, compact and continue fresh
```

### Very Long Tasks (200+ turns)

Session compaction or session continuation.

```
Strategy: SESSION_CONTINUATION
  - Compact entire session into a summary document
  - Save summary to session memory file
  - Optionally start a new session that loads the summary
  - "Continue" the work with a fresh context window
```

---

## 6. Multi-Turn Tool Orchestration

### Sequential Dependencies

Some tool calls depend on previous results:

```
Turn 1: Agent reads file -> learns function name
Turn 2: Agent searches for function usage -> finds 5 files
Turn 3: Agent reads each file -> understands the pattern
Turn 4: Agent edits files -> applies the fix
```

Each turn's context depends on previous turns. Aggressive truncation of turns 1-3 could lose critical context for turn 4.

**Solution:** Track dependency chains. Messages that are part of an active chain get higher retention scores.

### Parallel Tool Calls

Agents can call multiple tools simultaneously:

```
Turn 1: Agent calls [file_read(a.ts), file_read(b.ts), grep("pattern")]
  -> All three results returned in same turn
  -> Agent has all context at once
```

**Benefits:** Faster execution, fewer turns, less context consumed.

**When to encourage parallel calls:**
- Multiple independent reads
- Search + read combinations
- Status checks across multiple systems

### Tool Call Batching in the Prompt

Encourage the agent to batch independent operations:

```
system prompt section:
  "When you need information from multiple independent sources, call all
   tools in a single turn rather than making sequential calls. This is
   faster and uses less context.

   Example: If you need to read 3 files, call file_read 3 times in one
   turn, not across 3 separate turns."
```

---

## 7. Token Counting

### Why Accurate Counting Matters

Inaccurate token counting leads to:
- Context overflow errors (undercount)
- Wasted capacity (overcount)
- Compaction triggered too early or too late

### Counting Approaches

| Approach | Accuracy | Speed | When to Use |
|----------|----------|-------|-------------|
| **Tokenizer library** | Exact | Slow (requires model-specific tokenizer) | Budget monitoring, billing |
| **Character heuristic** | ~90% | Fast | Quick estimates, threshold checks |
| **API response headers** | Exact | Free (comes with response) | Post-hoc tracking |

### Character Heuristic

For quick estimates when exact counting is too slow:

```
estimateTokens(text):
  // English text: ~4 characters per token
  // Code: ~3.5 characters per token (more symbols)
  // Mixed: ~3.7 characters per token
  return text.length / 3.7
```

### Tracking Token Usage

```
TokenTracker:
  systemPromptTokens: number
  historyTokens: number
  currentTurnTokens: number
  totalInputTokens: number    (lifetime, for billing)
  totalOutputTokens: number   (lifetime, for billing)

  update(apiResponse):
    totalInputTokens += apiResponse.usage.input_tokens
    totalOutputTokens += apiResponse.usage.output_tokens
```

---

## 8. Conversation Persistence

### What to Persist

| Data | Format | When |
|------|--------|------|
| Full message history | JSON array | On every turn (or periodic checkpoint) |
| Token counts | Metadata | On every turn |
| Active task state | Structured data | On state change |
| Session summary | Markdown | On compaction |
| Tool result files | External files | On truncation (keep full versions externally) |

### Persistence Format

```json
{
  "sessionId": "abc-123",
  "created": "2026-03-31T10:00:00Z",
  "lastActive": "2026-03-31T12:30:00Z",
  "promptVersion": "3.2.1",
  "tokenUsage": {
    "input": 145000,
    "output": 23000
  },
  "messages": [
    {
      "role": "system",
      "content": "...",
      "tokens": 15000
    },
    {
      "role": "user",
      "content": "Help me refactor the auth module",
      "timestamp": "2026-03-31T10:00:05Z"
    }
  ]
}
```

### Resume Capability

When resuming a session:

```
resumeSession(sessionId):
  data = loadSession(sessionId)
  systemPrompt = rebuildSystemPrompt()  // fresh, not from saved data
  history = data.messages.filter(m => m.role != "system")

  // Recount tokens with current tokenizer (may have changed)
  for message in history:
    message.tokens = countTokens(message.content)

  // Check if history fits in current context window
  totalTokens = sumTokens(systemPrompt, history)
  if totalTokens > contextWindowSize * 0.8:
    history = compact(history)

  return { systemPrompt, history }
```

---

## 9. Implementation Checklist

### Minimum Viable Context Management

- [ ] Token budget allocation (system, history, current, output reserve)
- [ ] Tool result truncation (max lines/chars per tool type)
- [ ] Basic sliding window for conversation history
- [ ] Token counting (at least character heuristic)
- [ ] Paired tool calls and results

### Production-Grade Context Management

- [ ] All of the above, plus:
- [ ] Dynamic budgeting by task phase
- [ ] Smart truncation with importance scoring
- [ ] Old tool result compression/summarization
- [ ] Session compaction trigger (at 80% capacity)
- [ ] Session continuation (summary → fresh context)
- [ ] Multi-turn dependency chain tracking
- [ ] Parallel tool call encouragement in prompt
- [ ] Exact token counting via tokenizer
- [ ] Token usage tracking (input/output, per-session, lifetime)
- [ ] Conversation persistence with resume capability
- [ ] External storage for truncated tool results
- [ ] Conversation reminders at token intervals

---

## Related Documents

- [AGENT-SYSTEM-PROMPT-ENGINEERING.md](AGENT-SYSTEM-PROMPT-ENGINEERING.md) — System prompt that consumes the first budget region
- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Tools that produce the results being managed
- [AGENT-COORDINATION-PATTERNS.md](AGENT-COORDINATION-PATTERNS.md) — Worker context isolation and token budgets
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — API calls that consume and report tokens
- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — Session persistence implementation
