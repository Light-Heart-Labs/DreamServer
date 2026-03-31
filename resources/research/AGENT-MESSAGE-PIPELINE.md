# Agent Message Pipeline

Best practices for the message handling system that forms the circulatory system of an autonomous AI agent — message types, command queuing, priority scheduling, message collapsing, remote conversion, and streaming transforms. Derived from production analysis of agentic systems processing millions of messages with priority-ordered queues, React-compatible state, and context-reducing collapsing algorithms.

*Last updated: 2026-03-31*

---

## Why This Matters

Every interaction in an agentic system flows through the message pipeline. User input, agent responses, tool results, system notifications, task completions, permission requests — all are messages. A poorly designed pipeline drops messages, misorders priorities, bloats context, or breaks streaming. A well-designed one is invisible — it just works.

---

## 1. Message Type Hierarchy

### Core Message Types

| Type | Source | Contains | Persistence |
|------|--------|----------|-------------|
| **UserMessage** | Human user | Text, images, tool results, attachments | Always persisted |
| **AssistantMessage** | Agent/model | Text, tool calls, thinking, stop reason, token usage | Always persisted |
| **SystemMessage** | Application | Informational, warnings, errors, compact boundaries, tool failures | Selectively persisted |
| **AttachmentMessage** | Context | File attachments, MCP instruction deltas | Persisted with parent |
| **ProgressMessage** | Tools | Execution progress updates | Ephemeral (not persisted) |
| **ToolUseSummaryMessage** | Tool system | Summary of tool execution | Persisted |
| **TombstoneMessage** | Compaction | Placeholder for removed messages | Persisted (marks deletion) |

### Universal Message Fields

Every message carries:

```
BaseMessage:
  uuid: string           // UUID v4, globally unique
  timestamp: string      // ISO 8601
  type: string           // discriminant for type union
```

### AssistantMessage Structure

```
AssistantMessage:
  ...BaseMessage
  content: ContentBlock[]     // text, tool_use, thinking blocks
  stopReason: string          // "end_turn", "tool_use", "max_tokens"
  usage:
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  error: ErrorInfo | null     // if the API call failed
  model: string               // which model generated this
```

### SystemMessage Subtypes

| Subtype | Purpose |
|---------|---------|
| `informational` | General status updates |
| `compact_boundary` | Marks where compaction occurred |
| `tool_failure` | Tool execution failed |
| `warning` | Non-blocking warning |
| `error` | Error notification |

---

## 2. Short Message IDs

### The Problem

UUIDs are too long to include in every message reference. But agents need stable, short identifiers to reference earlier messages across sessions.

### Solution: Derived Short IDs

```
deriveShortMessageId(uuid):
  // Hash the UUID to a 6-character base36 string
  hash = sha256(uuid)
  numeric = parseInt(hash.slice(0, 10), 16)
  shortId = numeric.toString(36).slice(0, 6)
  return shortId  // e.g., "a3f9k2"
```

### Injection into API Messages

```
formatMessageForApi(message):
  // Prepend short ID tag for stable referencing
  shortId = deriveShortMessageId(message.uuid)
  taggedContent = "[id:{shortId}] " + message.content
  return taggedContent
```

The agent can then reference earlier messages by short ID: "As noted in [id:a3f9k2], the function needs refactoring."

---

## 3. Command Queue

### Architecture

A priority-ordered queue that buffers all incoming commands (user input, task notifications, system events):

```
CommandQueue:
  commands: QueuedCommand[]    // sorted by priority
  snapshot: frozen QueuedCommand[]  // immutable snapshot for React
  subscribers: Set<() => void>      // change notification callbacks

  // React integration
  subscribe(callback): () => void   // returns unsubscribe
  getSnapshot(): QueuedCommand[]    // for useSyncExternalStore
```

### Priority System

| Priority | Level | Name | Use Case |
|----------|-------|------|----------|
| 0 | Highest | `now` | Interrupt-level (abort, critical system) |
| 1 | Normal | `next` | User input (default) |
| 2 | Low | `later` | Task notifications, background results |

### Queued Command Structure

```
QueuedCommand:
  value: string | ContentBlock[]    // text or rich content
  mode: PromptInputMode            // determines editability
  priority: QueuePriority           // 0, 1, or 2
  pastedContents: Map<id, PastedContent>  // images from clipboard
  origin: MessageOrigin | null      // for channel messages
  skipSlashCommands: boolean        // prevent slash command routing
  isMeta: boolean                   // system-generated flag
```

### Queue Operations

| Operation | Behavior |
|-----------|----------|
| `enqueue(cmd)` | Add with priority 'next' (user input) |
| `enqueuePendingNotification(cmd)` | Add with priority 'later' (background) |
| `dequeue(filter?)` | Remove and return highest-priority command |
| `dequeueAll()` | Clear entire queue, return removed |
| `peek(filter?)` | Inspect highest-priority without removing |
| `remove(refs)` | Remove specific commands by reference |
| `popAllEditable(input, cursor)` | Extract editable commands for input buffer editing |

### Dequeue Algorithm

```
dequeue(filter?):
  // Find the highest-priority (lowest number) command
  // Within same priority: FIFO order
  candidates = filter ? commands.filter(filter) : commands
  if candidates.length == 0: return null

  best = candidates.reduce((a, b) =>
    a.priority < b.priority ? a : b  // lowest priority number wins
  )

  commands.remove(best)
  notifySubscribers()
  return best
```

### Editable vs Non-Editable

| Editable | Non-Editable |
|----------|-------------|
| User-typed text | Task notifications |
| Prompt commands | Meta commands (system-generated) |
| Editable mode commands | Raw XML/structured content |

Users can edit queued commands in the input buffer. Non-editable commands bypass the editor.

---

## 4. Message Collapsing

### The Problem

Long agent sessions accumulate enormous volumes of tool results — file reads, search results, command outputs. Displaying all of them in the conversation wastes context and clutters the UI.

### Collapsing Strategies

| Strategy | What It Collapses | Token Savings |
|----------|------------------|--------------|
| **Read/Search collapse** | Multiple file reads → "Read 5 files" summary | High |
| **Hook summary collapse** | Verbose hook outputs → one-line summary | Medium |
| **Teammate shutdown collapse** | Multiple shutdown messages → single notice | Low |
| **Background bash collapse** | Background command notifications → grouped | Medium |

### Read/Search Collapse Algorithm

```
collapseReadSearch(messages):
  // Find consecutive read/search tool results
  groups = groupConsecutiveByToolType(messages, ["file_read", "grep", "glob"])

  for group in groups:
    if group.length <= 2:
      continue  // not worth collapsing

    // Replace group with summary
    summary = formatCollapseSummary(group)
    // e.g., "Read 5 files (src/main.ts, src/utils.ts, ...)"
    // or "Searched 3 patterns across 12 files"

    replaceMessages(group, CollapsedMessage(summary, expandable: true))
```

### Expandable Collapsed Messages

Collapsed messages should be expandable on demand:

```
CollapsedMessage:
  summary: string           // "Read 5 files"
  originalMessages: Message[]  // preserved for expansion
  isExpanded: boolean       // toggle state

  expand():
    isExpanded = true
    // Restore original messages in conversation view

  collapse():
    isExpanded = false
```

---

## 5. Remote Message Conversion

### The Problem

Remote sessions receive SDK-format messages that differ from the internal message format. Conversion must handle type mapping, tool result detection, and selective inclusion.

### Conversion Rules

| SDK Type | Internal Type | Notes |
|----------|--------------|-------|
| SDKAssistantMessage | AssistantMessage | Direct mapping |
| SDKPartialAssistantMessage | StreamEvent | Streaming chunk |
| SDKResultMessage | SystemMessage (error only) | Success results ignored (noise) |
| SDKSystemMessage (init) | SystemMessage (informational) | Initialization notice |
| SDKStatusMessage | SystemMessage | Status transitions |
| SDKToolProgressMessage | SystemMessage | With toolUseID reference |
| SDKCompactBoundaryMessage | SystemMessage | With compact metadata |
| Unknown types | Ignored | Debug log, no crash |

### Tool Result Detection

```
isToolResult(message):
  // Detect by content shape, NOT by parent_tool_use_id
  // (parent_tool_use_id is unreliable in some SDK versions)
  return message.content.some(block => block.type == "tool_result")
```

### Selective Conversion

| Message Type | Convert When |
|-------------|-------------|
| Tool results | `convertToolResults` option is true (direct connect mode) |
| User text messages | `convertUserTextMessages` option is true |
| Assistant messages | Always |
| System messages | Always |

**In live WebSocket mode:** User messages are ignored (already added locally when the user typed them).

---

## 6. Streaming and Buffering

### Streaming Transform Pipeline

```
API Stream -> Message Chunks -> Buffer -> UI Renderer

1. API returns stream of token deltas
2. Each delta appended to current AssistantMessage
3. Buffer aggregates deltas (batch UI updates)
4. Renderer displays buffered content (60fps cap)
```

### Buffered Writer

```
BufferedWriter:
  buffer: string
  flushInterval: 16  // ms (60fps)

  write(chunk):
    buffer += chunk
    scheduleFlush()

  scheduleFlush():
    if not flushScheduled:
      flushScheduled = true
      setTimeout(flushInterval, flush)

  flush():
    output = buffer
    buffer = ""
    flushScheduled = false
    renderer.update(output)
```

### Side Queries

Secondary queries that run alongside the main conversation without entering the message history:

```
sideQuery(prompt):
  // Run a query that doesn't affect the main conversation
  response = callApi({
    messages: [...currentContext, { role: "user", content: prompt }],
    // Response is NOT appended to conversation history
  })
  return response.content
```

**Use cases:** Context analysis, prompt categorization, memory relevance ranking.

---

## 7. Implementation Checklist

### Minimum Viable Message Pipeline

- [ ] Message type hierarchy (User, Assistant, System, ToolResult)
- [ ] UUID-based message identification
- [ ] Command queue with priority ordering
- [ ] Dequeue by priority (lowest number first, FIFO within)
- [ ] Streaming buffer for API responses
- [ ] Basic message persistence

### Production-Grade Message Pipeline

- [ ] All of the above, plus:
- [ ] Short message IDs (6-char base36 from UUID)
- [ ] ID tag injection in API messages for stable referencing
- [ ] 3-level priority system (now/next/later)
- [ ] React-compatible queue (useSyncExternalStore, frozen snapshots)
- [ ] Editable vs non-editable command classification
- [ ] Queue editing (popAllEditable for input buffer)
- [ ] Message collapsing (read/search, hooks, teammates, bash)
- [ ] Expandable collapsed messages
- [ ] Remote message conversion (SDK → internal types)
- [ ] Tool result detection by content shape
- [ ] Selective conversion flags
- [ ] Buffered writer with 60fps cap
- [ ] Side queries (don't enter main history)
- [ ] SystemMessage subtypes (informational, compact_boundary, error, warning)
- [ ] TombstoneMessage for compaction placeholders
- [ ] Attachment handling (files, MCP deltas, images)
- [ ] Message queue signal emitter for change notifications

---

## Related Documents

- [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) — Token budgeting that constrains message history
- [AGENT-CONTEXT-COMPACTION-ADVANCED.md](AGENT-CONTEXT-COMPACTION-ADVANCED.md) — Compaction that produces CompactBoundaryMessages
- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Tool results that flow through the pipeline
- [AGENT-REMOTE-AND-TEAM-COLLABORATION.md](AGENT-REMOTE-AND-TEAM-COLLABORATION.md) — Remote message conversion
- [AGENT-TERMINAL-UI-ARCHITECTURE.md](AGENT-TERMINAL-UI-ARCHITECTURE.md) — Rendering pipeline that consumes messages
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — Streaming responses that feed the buffer
