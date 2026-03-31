# Agent Task and Background Execution

Best practices for managing background tasks, the forked agent pattern, task type hierarchies, and concurrent session handling in autonomous AI agent systems. Derived from production analysis of agentic systems running memory extraction, consolidation, compaction, and teammate agents as background tasks with shared prompt caches.

*Last updated: 2026-03-31*

---

## Why This Matters

A production agent doesn't just respond to user messages. It extracts memories in the background, consolidates knowledge periodically, compacts context when it grows too large, runs teammate agents in parallel, and manages shell processes. All of these are background tasks that need lifecycle management, progress tracking, abort handling, and resource coordination.

The forked agent pattern — running an isolated agent that shares the parent's prompt cache — is the foundation. Without it, every background operation pays the full cost of prompt processing.

---

## 1. The Forked Agent Pattern

### The Core Idea

A forked agent is a lightweight child agent that shares the parent's prompt cache for near-zero startup cost:

```
Parent agent has:
  - System prompt (15K tokens, cached by API)
  - Conversation history (100K tokens)
  - Current turn in progress

Forked agent inherits:
  - Same system prompt (cache HIT — 0 tokens to re-process)
  - Same tool definitions (cache HIT)
  - Same user/system context (cache HIT)
  - Its OWN conversation (new messages only)
```

### Cache-Safe Parameters

For the cache to actually hit, these parameters MUST exactly match the parent's last API call:

| Parameter | What It Contains | Why It Must Match |
|-----------|-----------------|-------------------|
| `systemPrompt` | Full system prompt text | API caches from the start of the prompt |
| `userContext` | User messages key-value pairs | Part of the cached prefix |
| `systemContext` | System message key-value pairs | Part of the cached prefix |
| `toolUseContext` | Tool definitions, model, options | Tool schemas are part of the prompt |
| `forkContextMessages` | Parent's message prefix | Extends the cache hit into conversation |

### Cache-Safe Lifecycle

```
// At end of each parent turn:
saveCacheSafeParams({
  systemPrompt: currentSystemPrompt,
  userContext: currentUserContext,
  systemContext: currentSystemContext,
  toolUseContext: currentToolContext,
  forkContextMessages: currentMessages
})

// When spawning a fork:
params = getLastCacheSafeParams()
fork = runForkedAgent({
  cacheSafeParams: params,
  promptMessages: [taskSpecificPrompt],
  ...otherOptions
})
```

### Forked Agent Parameters

| Parameter | Purpose | Default |
|-----------|---------|---------|
| `promptMessages` | The task prompt (what the fork should do) | Required |
| `cacheSafeParams` | Parent's params for cache sharing | Required |
| `canUseTool` | Permission check function (restrict fork's tools) | Allow all |
| `querySource` | Tracking label ("extract_memories", "compact", etc.) | Required |
| `forkLabel` | Analytics label for telemetry | Same as querySource |
| `maxTurns` | Cap on API round-trips | Unlimited (dangerous!) |
| `maxOutputTokens` | Max response tokens | Parent's value |
| `onMessage` | Streaming callback for UI updates | None |
| `skipTranscript` | Don't write sidechain transcript | false |
| `skipCacheWrite` | Skip cache write on final message | false |

**WARNING:** Changing `maxOutputTokens` from the parent's value invalidates the prompt cache (it changes `budget_tokens` in the API request). Only change it when the cache savings are worth less than the extra cost.

### Usage Tracking

```
ForkedAgentResult:
  messages: Message[]          // all messages from the fork
  totalUsage:
    inputTokens: number
    outputTokens: number
    cacheCreationTokens: number
    cacheReadTokens: number    // should be high if cache hit worked
```

Track cache hit rate: `cacheReadTokens / inputTokens` should be >80% for well-configured forks.

---

## 2. Task Type Hierarchy

### Task Types

| Type | What It Does | Spawned By |
|------|-------------|-----------|
| **DreamTask** | Background memory consolidation | Auto-dream service |
| **LocalAgentTask** | Local agent execution (subagent) | AgentTool, coordinator |
| **LocalShellTask** | Background shell command | BashTool (background mode) |
| **RemoteAgentTask** | Agent running on remote server | Remote session manager |
| **InProcessTeammateTask** | Teammate agent in same process | Teammate system |
| **LocalWorkflowTask** | Multi-step workflow execution | Workflow/skill system |
| **MonitorMcpTask** | MCP server monitoring | MCP manager |

### Task State

```
TaskState:
  id: string                   // unique task identifier
  type: TaskType               // from hierarchy above
  status: "pending" | "running" | "completed" | "failed" | "killed"
  pillLabel: string            // display text for UI footer
  isBackgrounded: boolean      // shown in footer pill?
  createdAt: timestamp
  completedAt: timestamp | null
  error: string | null
```

### Background Task Detection

```
isBackgroundTask(task):
  return (task.status == "running" or task.status == "pending")
     and task.isBackgrounded !== false
```

Background tasks display as pills in the terminal footer. Users can inspect and abort them.

---

## 3. Task Registration and Lifecycle

### Registration

```
registerTask(taskDef):
  task = {
    id: generateId(),
    type: taskDef.type,
    status: "pending",
    pillLabel: taskDef.displayLabel,
    isBackgrounded: taskDef.background ?? true,
    createdAt: now()
  }

  addToAppState("tasks", task)
  return task
```

### State Updates

```
updateTask(taskId, updates):
  setAppState(state => ({
    ...state,
    tasks: state.tasks.map(t =>
      t.id === taskId ? { ...t, ...updates } : t
    )
  }))
```

### Completion

```
completeTask(taskId, result):
  updateTask(taskId, {
    status: "completed",
    completedAt: now(),
    result: result
  })
  // Emit task-notification for the main conversation
  emitNotification({ taskId, status: "completed", summary: result.summary })

failTask(taskId, error):
  updateTask(taskId, {
    status: "failed",
    completedAt: now(),
    error: error.message
  })
```

### Abort Protocol

```
abortTask(taskId):
  task = getTask(taskId)

  // Signal cooperative cancellation
  task.abortController.abort()

  // Wait for graceful shutdown (5-10 seconds)
  await waitForCompletion(task, timeout: 10_000)

  // If still running after timeout: force kill
  if task.status == "running":
    updateTask(taskId, { status: "killed" })
    cleanupTaskResources(task)
```

---

## 4. Consumers of the Forked Agent Pattern

### Memory Extraction

```
Source: services/extractMemories
Trigger: End of each query loop (model finishes, no pending tool calls)
Fork config:
  maxTurns: 5
  canUseTool: read anywhere, write only in memory directory
  skipTranscript: true (avoids race with main thread)
  querySource: "extract_memories"
```

### Auto-Dream Consolidation

```
Source: services/autoDream
Trigger: Time gate (24h) + session gate (5 sessions) + lock gate
Fork config:
  canUseTool: read anywhere, write only in memory directory
  querySource: "auto_dream"
  onMessage: update DreamTask UI with progress
```

### Context Compaction

```
Source: services/compact
Trigger: Token count exceeds threshold, or API error
Fork config:
  maxTurns: 3 (summarization is focused)
  querySource: "compact"
  Note: must NOT trigger compaction within compaction fork (deadlock)
```

### Prompt Suggestions

```
Source: services/PromptSuggestion
Trigger: Agent idle, user not typing
Fork config:
  canUseTool: safe read-only tools only
  querySource: "prompt_suggestion"
  maxTurns: 20
  skipCacheWrite: true (fire-and-forget)
```

---

## 5. Concurrent Session Management

### Session Kinds

| Kind | Behavior | Exit Handling |
|------|----------|--------------|
| **interactive** | Normal user session | Process exit |
| **bg** (background) | Tmux/detached session | Client detach, process continues |
| **daemon** | Long-running service | Clean shutdown on signal |
| **daemon-worker** | Worker within daemon | Report to parent, then exit |

### Session Detection

```
getSessionKind():
  return env.SESSION_KIND or "interactive"
```

### Session Registry

```
SessionRegistry:
  directory: ~/.agent/sessions/

  register(sessionId, kind, pid):
    writeFile(directory / sessionId, JSON.stringify({
      pid, kind, status: "idle", startedAt: now()
    }))

  updateStatus(sessionId, status):  // "busy", "idle", "waiting"
    updateFile(directory / sessionId, { status })

  listActive():
    return readFiles(directory)
      .filter(f => processIsAlive(f.pid))

  cleanup():
    for file in readFiles(directory):
      if not processIsAlive(file.pid):
        deleteFile(file)
```

### Concurrent Safety

Multiple sessions in the same project need coordination:

```
ensureNoConcurrentWrites(filePath):
  activeSessions = sessionRegistry.listActive()
    .filter(s => s.status == "busy")
    .filter(s => s.id != currentSession.id)

  if activeSessions.length > 0:
    warn("Another session is active — file writes may conflict")
```

---

## 6. Implementation Checklist

### Minimum Viable Task System

- [ ] Task type registration (id, type, status)
- [ ] Task state updates (running → completed/failed)
- [ ] Background task detection for UI display
- [ ] Task abort via abort controller
- [ ] Basic forked agent (share system prompt, restrict tools)

### Production-Grade Task System

- [ ] All of the above, plus:
- [ ] Cache-safe parameter management (save/restore per turn)
- [ ] Full CacheSafeParams matching (5 fields)
- [ ] Cache hit rate tracking per fork
- [ ] maxTurns enforcement (prevent runaway forks)
- [ ] skipTranscript option (avoid race conditions)
- [ ] skipCacheWrite option (fire-and-forget)
- [ ] Multiple task types (Dream, LocalAgent, Shell, Remote, Teammate, Workflow, Monitor)
- [ ] DreamTask with phase tracking (starting → updating)
- [ ] Task notification emission on completion
- [ ] Concurrent session registry (PID files)
- [ ] Session kind handling (interactive vs bg vs daemon)
- [ ] Session status tracking (busy/idle/waiting)
- [ ] Stale session cleanup (dead PID detection)
- [ ] Usage tracking per fork (input/output/cache tokens)
- [ ] Fork telemetry events (label, source, turns, usage)

---

## Related Documents

- [AGENT-MEMORY-AND-CONSOLIDATION.md](AGENT-MEMORY-AND-CONSOLIDATION.md) — Memory extraction and auto-dream use forked agents
- [AGENT-CONTEXT-COMPACTION-ADVANCED.md](AGENT-CONTEXT-COMPACTION-ADVANCED.md) — Compaction uses forked summarizer agent
- [AGENT-SPECULATION-AND-CACHING.md](AGENT-SPECULATION-AND-CACHING.md) — Speculation uses forked agent for prediction
- [AGENT-COORDINATION-PATTERNS.md](AGENT-COORDINATION-PATTERNS.md) — Worker agents vs forked agents
- [AGENT-REMOTE-AND-TEAM-COLLABORATION.md](AGENT-REMOTE-AND-TEAM-COLLABORATION.md) — Remote and teammate task types
- [AGENT-LIFECYCLE-AND-PROCESS.md](AGENT-LIFECYCLE-AND-PROCESS.md) — Task cleanup on shutdown
