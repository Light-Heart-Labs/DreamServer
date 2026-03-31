# Agent Streaming Tool Execution

How tools execute concurrently while the model streams — the StreamingToolExecutor pattern, concurrency partitioning, tool result formatting, size management, and the buffering strategy that keeps everything in order. Derived from production analysis of agentic systems executing thousands of tools per session with concurrent batching and size-managed persistence.

*Last updated: 2026-03-31*

---

## Why This Matters

In a naive implementation, tool execution is sequential: model responds → parse tool calls → execute one by one → send results → model responds again. This wastes time. The model takes 5-30 seconds to generate a response, during which the system is idle.

Streaming tool execution overlaps model output with tool execution. The system starts running tools as soon as their definitions appear in the model's stream — before the model finishes responding. Combined with concurrency batching, this can cut turn latency by 50%+.

---

## 1. StreamingToolExecutor

### The Core Pattern

A stateful class that buffers tool execution as blocks arrive from the model stream:

```
StreamingToolExecutor:
  tools: TrackedTool[]          // all tools in this turn
  hasErrored: boolean           // any bash tool failed?
  siblingAbortController        // abort signal for cascade
  semaphore: Semaphore          // concurrent execution limiter

  addTool(block, assistantMessage):
    // Called when a tool_use block arrives in the stream
    tool = createTrackedTool(block, assistantMessage)
    tools.push(tool)
    tryExecuteNext()  // attempt to start execution immediately

  tryExecuteNext():
    for tool in tools where status == "queued":
      if canExecuteTool(tool.isConcurrencySafe):
        tool.status = "executing"
        tool.promise = executeTool(tool)

  getRemainingResults():
    // Yield buffered results in original tool order
    for tool in tools:
      if tool.status == "completed" and not tool.yielded:
        tool.status = "yielded"
        yield* tool.results
```

### TrackedTool Structure

```
TrackedTool:
  id: string                      // tool_use_id from API
  block: ToolUseBlock             // tool name + input from API
  assistantMessage: AssistantMessage  // parent message (for backreference)
  status: "queued" | "executing" | "completed" | "yielded"
  isConcurrencySafe: boolean      // can run alongside other tools?
  promise: Promise | null         // execution promise
  results: Message[]              // buffered tool result messages
  pendingProgress: Message[]      // progress messages (yielded immediately)
  contextModifiers: Function[]    // post-execution context updates
```

### State Machine

```
queued ──────→ executing ──────→ completed ──────→ yielded
  │                                  │
  │  (canExecuteTool check)          │  (getRemainingResults)
  │                                  │
  └── waits for concurrency slot     └── results consumed by query loop
```

**Key constraint:** Results are yielded in **original tool order**, not completion order. If Tool B completes before Tool A, B's results wait until A's results are yielded first. This preserves the API's expected tool_use → tool_result pairing order.

---

## 2. Concurrency Model

### The canExecuteTool Check

```
canExecuteTool(isConcurrencySafe):
  executingTools = tools.filter(t => t.status == "executing")

  if executingTools.length == 0:
    return true  // nothing running, start anything

  if isConcurrencySafe AND all executingTools are concurrencySafe:
    return true  // safe tools can run together

  return false  // must wait for current tools to finish
```

### Concurrency Classification

| Tool | Concurrent-Safe? | Why |
|------|------------------|-----|
| File Read | Yes | Read-only, no side effects |
| Grep / Glob | Yes | Read-only search |
| Web Search / Fetch | Yes | Read-only network |
| LSP operations | Yes | Read-only queries |
| File Write | **No** | Modifies filesystem |
| File Edit | **No** | Modifies filesystem |
| Bash | **Depends** | Read-only commands = safe, write commands = unsafe |
| MCP Tools | **Depends** | Declared by MCP server |
| Agent spawn | **No** | Creates child process with side effects |

### Dynamic Classification for Shell Commands

```
isBashConcurrencySafe(input):
  try:
    parsed = parseShellCommand(input.command)
    return isReadOnlyCommand(parsed)  // grep, find, ls = true; rm, mv = false
  catch:
    return false  // parse failure = assume unsafe
```

---

## 3. Tool Orchestration: Batching

### partitionToolCalls Algorithm

Converts a flat list of tool calls into execution batches:

```
partitionToolCalls(toolUseBlocks, tools):
  batches = []
  currentBatch = { tools: [], isConcurrent: null }

  for block in toolUseBlocks:
    isSafe = determineConcurrencySafety(block, tools)

    if currentBatch.isConcurrent == null:
      // First tool — start batch
      currentBatch.isConcurrent = isSafe
      currentBatch.tools.push(block)

    elif currentBatch.isConcurrent == isSafe AND isSafe == true:
      // Consecutive concurrent-safe tools — extend batch
      currentBatch.tools.push(block)

    else:
      // Safety changed — start new batch
      batches.push(currentBatch)
      currentBatch = { tools: [block], isConcurrent: isSafe }

  if currentBatch.tools.length > 0:
    batches.push(currentBatch)

  return batches
```

**Example:**

```
Input:  [Read₁, Read₂, Write₁, Read₃, Write₂]
Output:
  Batch 0: concurrent  → [Read₁, Read₂]    // run in parallel
  Batch 1: sequential  → [Write₁]           // run alone
  Batch 2: concurrent  → [Read₃]            // run alone (single tool)
  Batch 3: sequential  → [Write₂]           // run alone
```

### Batch Execution

```
for batch in batches:
  if batch.isConcurrent:
    results = await runToolsConcurrently(batch.tools, maxConcurrency: 10)
  else:
    results = await runToolsSerially(batch.tools)

  // Apply context modifiers after batch completes
  for modifier in batch.queuedModifiers:
    context = modifier(context)
```

**Semaphore for concurrent batches:** Maximum 10 tools run simultaneously. Prevents resource exhaustion when the model calls 30+ search tools at once.

---

## 4. Sibling Abort Cascade

### The Problem

When a bash command fails, subsequent tools in the same turn often depend on its output. Running them wastes time and produces confusing errors.

### The Solution: Selective Cascade

```
onToolError(tool, error):
  if tool.name == "bash":
    // Bash errors cascade — abort siblings
    hasErrored = true
    siblingAbortController.abort()
    // Queued tools will detect abort, produce synthetic error messages

  // Non-bash errors do NOT cascade
  // Siblings continue independently
```

**Why only bash?** File reads, web fetches, and searches are independent operations. If one search fails, the others might succeed. But bash commands often form a dependency chain (`cd dir && make && ./test`), where failure in one makes the rest meaningless.

### Synthetic Error on Abort

```
onToolAborted(tool):
  tool.results = [
    createToolResultMessage({
      tool_use_id: tool.id,
      content: "<tool_use_error>Execution aborted: a previous command failed</tool_use_error>",
      is_error: true
    })
  ]
  tool.status = "completed"
```

---

## 5. Context Modifier Queuing

### The Problem

Some tools modify the execution context when they complete (e.g., a file edit tool updates the file cache). In sequential execution, this is straightforward. In concurrent execution, modifications must be deferred.

### The Pattern

```
// Sequential execution: apply immediately
for tool in serialBatch:
  result = await executeTool(tool)
  if result.contextModifier:
    currentContext = result.contextModifier(currentContext)

// Concurrent execution: queue until batch completes
queuedModifiers = {}
for tool in concurrentBatch (in parallel):
  result = await executeTool(tool)
  if result.contextModifier:
    queuedModifiers[tool.id] = result.contextModifier

// Apply in original tool order after batch completes
for tool in concurrentBatch (in order):
  if queuedModifiers[tool.id]:
    currentContext = queuedModifiers[tool.id](currentContext)
```

**Note:** In current production systems, concurrent tools don't actually produce context modifiers (only sequential tools like file edit do). The queuing infrastructure exists for future extensibility.

---

## 6. Tool Result Size Management

### Size Thresholds

| Constant | Value | Purpose |
|----------|-------|---------|
| Per-tool result limit | 50,000 characters | Maximum inline result size per tool |
| Per-message aggregate | 10,000,000 bytes | Total content across all tool results in one user message |

### Per-Tool Threshold Resolution

```
getToolResultThreshold(toolName):
  // Feature flag override (per-tool configuration)
  override = featureFlags.getToolThreshold(toolName)
  if override:
    return override

  // Tool-declared limit
  toolLimit = tool.maxResultSizeChars
  if toolLimit:
    return min(toolLimit, 50_000)

  // Default
  return 50_000

  // Special case: some tools return Infinity (self-bounded via other means)
```

### Persistence Flow

When a tool result exceeds its threshold:

```
applyToolResultBudget(messages):
  for message in messages:
    for block in message.toolResultBlocks:
      threshold = getToolResultThreshold(block.toolName)
      if block.content.length > threshold:
        // Write to disk
        filePath = persistToDisk(block.content)

        // Replace inline content with reference
        block.content = wrapInXmlTags(filePath, preview: block.content.slice(0, 1000))
```

### XML Wrapping for Persisted Results

```
<persisted-output>
  [First 1000 chars of content as preview]
  ...
  [Reference to persisted file on disk]
</persisted-output>
```

The XML tags let the system distinguish inline vs persisted results during message normalization.

### Recovery on Resume

When resuming a session with persisted tool results:

```
restorePersistedResults(messages):
  for message in messages:
    for block in message.toolResultBlocks:
      if isPersistedReference(block.content):
        filePath = extractFilePath(block.content)
        if fileExists(filePath):
          block.content = readFile(filePath)  // restore full content
        else:
          block.content = "[Content no longer available]"
```

---

## 7. Message Normalization for API

Before sending messages to the LLM API, normalize them:

### Virtual Message Filtering

Some messages exist only in the REPL — they should never reach the API:

```
normalizeForAPI(messages):
  return messages.filter(m => !m.isVirtual)
```

Virtual messages include REPL-internal tool calls, UI-only state markers, and debug annotations.

### Problematic Media Stripping

When a previous API call failed due to oversized media:

```
if previousError.type == "image_too_large":
  // Find the offending user message
  problematicMessage = findMetaUserMessage(messages, previousError)
  // Strip all image and document blocks
  problematicMessage.content = problematicMessage.content
    .filter(b => b.type != "image" and b.type != "document")
```

### Consecutive User Message Merging

Some API providers (especially non-primary) don't support consecutive user messages. Merge them:

```
mergeConsecutiveUserMessages(messages):
  merged = []
  for message in messages:
    if message.role == "user" and merged.last?.role == "user":
      merged.last.content = concat(merged.last.content, message.content)
    else:
      merged.push(message)
  return merged
```

---

## 8. Implementation Checklist

### Minimum Viable Tool Execution

- [ ] Sequential tool execution after model response
- [ ] Tool result messages paired with tool_use IDs
- [ ] Basic size limiting on tool results
- [ ] needsFollowUp detection from content blocks

### Production-Grade Streaming Execution

- [ ] All of the above, plus:
- [ ] StreamingToolExecutor with TrackedTool state machine
- [ ] Start tool execution during model streaming
- [ ] Buffered results yielded in original order
- [ ] Concurrency classification per tool type
- [ ] Dynamic classification for shell commands
- [ ] partitionToolCalls batching algorithm
- [ ] Semaphore-limited concurrent execution (max 10)
- [ ] Sibling abort cascade (bash only)
- [ ] Synthetic error messages for aborted tools
- [ ] Context modifier queuing for concurrent batches
- [ ] Per-tool result size thresholds (50K default)
- [ ] Aggregate message size limit (10MB)
- [ ] Feature flag per-tool threshold override
- [ ] Disk persistence for oversized results
- [ ] XML wrapping for persisted references
- [ ] Recovery from disk on session resume
- [ ] Virtual message filtering before API
- [ ] Problematic media stripping on error
- [ ] Consecutive user message merging (provider compatibility)
- [ ] Progress message handling (yield immediately, don't buffer)

---

## Related Documents

- [AGENT-QUERY-LOOP-AND-STATE-MACHINE.md](AGENT-QUERY-LOOP-AND-STATE-MACHINE.md) — The loop that drives tool execution
- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Tool definitions, validation, permission checks
- [AGENT-SECURITY-COMMAND-EXECUTION.md](AGENT-SECURITY-COMMAND-EXECUTION.md) — Shell command classification (read vs write)
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Permission checks before execution
- [AGENT-ERROR-HANDLING-AND-HOOKS.md](AGENT-ERROR-HANDLING-AND-HOOKS.md) — Hook execution after tools complete
- [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) — Tool results consume context budget
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — Model streaming that tools overlap with
