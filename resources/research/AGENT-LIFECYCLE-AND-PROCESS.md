# Agent Lifecycle and Process Management

Best practices for graceful startup, shutdown, crash recovery, idle detection, concurrent session safety, and process management in autonomous AI agent systems. Derived from production analysis of agentic systems that start in under 500ms, survive crashes without data loss, and manage concurrent sessions safely.

*Last updated: 2026-03-31*

---

## Why This Matters

An agent that crashes loses work. An agent that doesn't shut down cleanly corrupts terminal state, leaks file handles, and leaves orphaned processes. An agent that can't recover from a crash forces users to re-explain everything. An agent that doesn't handle concurrent sessions lets two agents clobber each other's file edits.

Production systems treat lifecycle as infrastructure — every phase handled, every edge case covered.

---

## 1. Graceful Shutdown

### Shutdown Triggers

| Trigger | Source | Urgency |
|---------|--------|---------|
| SIGINT (Ctrl+C) | User | Normal — run full cleanup |
| SIGTERM | System/orchestrator | Normal — run full cleanup |
| `/exit` command | User | Normal — run full cleanup |
| Permission rejection | Security check | Normal — run full cleanup with exit code 1 |
| Uncaught exception | Application error | Urgent — best-effort cleanup |
| SIGKILL | System | Immediate — no cleanup possible |

### Shutdown Sequence

Order matters. Terminal state must be restored BEFORE process exit, or the user's terminal is corrupted.

```
gracefulShutdown(reason):
  // Phase 1: Terminal restoration (SYNCHRONOUS — must complete)
  disableMouseTracking()       // send escape sequences
  exitAltScreen()              // restore normal terminal mode
  restoreCursorVisibility()    // ensure cursor is shown
  restoreKeyboardModes()       // reset terminal input modes

  // Phase 2: Run cleanup handlers (ASYNC — best effort)
  await runCleanupFunctions()  // registered by services

  // Phase 3: Flush data (ASYNC — best effort)
  logExitEvent(reason)         // analytics
  await flushAnalytics()       // ensure events are sent
  drainPendingExtractions()    // wait for memory extraction

  // Phase 4: Exit
  process.exit(exitCode)
```

**Critical:** Phase 1 must use synchronous writes (`writeSync`) because the process may be killed before async operations complete. Never use `console.log` or `process.stdout.write` (async) for terminal restoration.

### Mouse Tracking Cleanup

Mouse tracking escape sequences must be sent before exit, or the terminal stays in mouse mode:

```
disableMouseTracking():
  // Send disable sequences — must arrive before process exits
  writeSync(stdout, "\x1b[?1000l")  // disable basic tracking
  writeSync(stdout, "\x1b[?1002l")  // disable button-event tracking
  writeSync(stdout, "\x1b[?1003l")  // disable all-event tracking
  writeSync(stdout, "\x1b[?1006l")  // disable SGR extended format
```

---

## 2. Cleanup Registry

### Pattern

Services register cleanup functions during initialization. All are called during shutdown.

```
CleanupRegistry:
  handlers: (() => Promise<void>)[]

  register(handler):
    handlers.push(handler)

  async runAll():
    // Run all handlers, don't let one failure block others
    results = await Promise.allSettled(
      handlers.map(h => h())
    )

    for result in results:
      if result.status == "rejected":
        log.warn("Cleanup handler failed:", result.reason)
```

### Common Cleanup Handlers

| Service | Cleanup Action |
|---------|---------------|
| Remote managed settings | Stop background polling |
| Policy limits | Stop background polling |
| Terminal/Ink | Unmount React component tree |
| Settings | Flush pending writes to disk |
| Memory extraction | Drain in-flight extractions (60s timeout) |
| File watchers | Close all watchers |
| MCP connections | Disconnect from servers |
| LSP servers | Send shutdown + exit notifications |
| Tmux sessions | Detach or kill |
| Session registry | Update status to "stopped" |

---

## 3. Session Cleanup (Housekeeping)

### Periodic Cleanup of Old Files

```
cleanupOldFiles():
  retentionDays = 30  // configurable

  // Old session logs
  deleteFilesOlderThan(sessionsDir, retentionDays)

  // Old error files
  deleteFilesOlderThan(errorsDir, retentionDays)

  // Stale image caches (converted screenshots, resized images)
  deleteFilesOlderThan(imageCacheDir, 7)  // shorter retention

  // Stale paste buffer files
  cleanPasteStore()

  // Orphaned agent worktrees (from crashed sessions)
  cleanStaleWorktrees()
```

### Worktree Cleanup

```
cleanStaleWorktrees():
  worktrees = listWorktrees()

  for wt in worktrees:
    session = findSessionForWorktree(wt)
    if session == null or not processIsAlive(session.pid):
      // Orphaned — session that created this is dead
      log.info("Cleaning orphaned worktree: {wt.path}")
      git worktree remove --force {wt.path}
      git branch -D {wt.branch}
```

---

## 4. Crash Recovery

### Detection

On startup, check for signs of a previous crash:

```
detectCrashRecovery():
  lastSession = loadLastSessionLog()
  if lastSession == null:
    return null  // clean start

  if lastSession.exitReason == "normal":
    return null  // clean exit, no recovery needed

  // Crash detected — session didn't exit cleanly
  return lastSession
```

### Recovery Flow

```
recoverFromCrash(lastSession):
  // 1. Rebuild message chain
  messages = buildConversationChain(lastSession.log)

  // 2. Filter broken states
  messages = messages.filter(msg => {
    // Remove orphaned thinking-only messages (no content after thinking)
    if isThinkingOnly(msg): return false

    // Remove unresolved tool uses (tool called but no result)
    if hasUnresolvedToolUse(msg): return false

    // Remove whitespace-only assistant messages
    if isWhitespaceOnly(msg): return false

    return true
  })

  // 3. Normalize legacy data
  messages = messages.map(msg => {
    // Map old tool names to current names
    msg.toolCalls = msg.toolCalls?.map(normalizeToolName)

    // Migrate legacy attachment types
    msg.attachments = msg.attachments?.map(migrateAttachmentType)

    return msg
  })

  // 4. Restore auxiliary state
  fileHistory = lastSession.fileHistorySnapshot  // what files were modified
  planState = lastSession.planState              // active plan if any

  // 5. Re-execute session-start hooks
  executeSessionStartHooks()

  return { messages, fileHistory, planState }
```

### Legacy Normalization

Tool names and attachment types change across versions. Normalize on recovery:

```
normalizeToolName(toolCall):
  LEGACY_NAMES = {
    "Read": "file_read",       // old brevity name
    "Write": "file_write",
    "Bash": "bash",
    "Search": "grep",
    // ... etc
  }
  toolCall.name = LEGACY_NAMES[toolCall.name] or toolCall.name
  return toolCall

migrateAttachmentType(attachment):
  LEGACY_TYPES = {
    "new_file": "file",
    "new_directory": "directory"
  }
  attachment.type = LEGACY_TYPES[attachment.type] or attachment.type
  return attachment
```

---

## 5. Idle Timeout

### Use Case

In automated/CI environments, the agent should exit after a period of inactivity to free resources.

### Implementation

```
IdleTimeoutManager:
  exitDelay: number | null      // from env var, in milliseconds
  lastActiveTime: timestamp
  timer: Timer | null

  create():
    delay = parseInt(env.EXIT_AFTER_STOP_DELAY)
    if isNaN(delay) or delay <= 0:
      return null  // no timeout configured

    return new IdleTimeoutManager(delay)

  start():
    if exitDelay == null: return
    lastActiveTime = now()
    timer = setTimeout(exitDelay, checkIdle)

  onActivity():
    lastActiveTime = now()
    if timer: clearTimeout(timer)
    timer = setTimeout(exitDelay, checkIdle)

  checkIdle():
    elapsed = now() - lastActiveTime
    if elapsed >= exitDelay:
      gracefulShutdown("idle_timeout")
    else:
      // Not idle long enough (activity happened during timer)
      remaining = exitDelay - elapsed
      timer = setTimeout(remaining, checkIdle)

  stop():
    if timer: clearTimeout(timer)
```

---

## 6. Concurrent Session Safety

### Session Kinds

| Kind | Description | Exit Behavior |
|------|-------------|--------------|
| `interactive` | Normal terminal session | Process exit |
| `bg` | Background (tmux/detached) | Client detach, process continues |
| `daemon` | Long-running service | Clean shutdown on signal |
| `daemon-worker` | Worker within daemon | Report to parent, then exit |

### Session Registry

```
SessionRegistry:
  directory: ~/.agent/sessions/

  register(sessionId, pid, kind):
    data = { pid, kind, status: "idle", startedAt: now(), projectRoot }
    writeFile(directory / sessionId + ".json", data, { mode: 0o600 })

  updateStatus(sessionId, status):
    // "busy" = actively executing tools
    // "idle" = waiting for user input
    // "waiting" = waiting for external response
    data = readFile(directory / sessionId + ".json")
    data.status = status
    writeFile(directory / sessionId + ".json", data)

  listActive():
    files = glob(directory / "*.json")
    return files
      .map(readAndParse)
      .filter(s => processIsAlive(s.pid))

  cleanupDead():
    for file in glob(directory / "*.json"):
      data = readAndParse(file)
      if not processIsAlive(data.pid):
        deleteFile(file)
```

### Concurrent Write Protection

```
warnConcurrentActivity(filePath):
  otherSessions = sessionRegistry.listActive()
    .filter(s => s.id != currentSession.id)
    .filter(s => s.status == "busy")
    .filter(s => s.projectRoot == currentProject)

  if otherSessions.length > 0:
    warn("Another agent session is active in this project. File edits may conflict.")
```

---

## 7. Startup Profiling

### Checkpoint-Based Profiling

```
StartupProfiler:
  checkpoints: Map<string, timestamp>

  checkpoint(name):
    checkpoints.set(name, now())

  report():
    entries = Array.from(checkpoints.entries())
    for i in 1..entries.length:
      duration = entries[i].timestamp - entries[i-1].timestamp
      log("{entries[i].name}: {duration}ms")

    total = entries.last.timestamp - entries.first.timestamp
    log("Total startup: {total}ms")
```

### Standard Checkpoints

| Checkpoint | What Completes | Typical Time |
|-----------|----------------|-------------|
| `cli_parse` | CLI arguments parsed | <10ms |
| `config_load` | All config sources loaded and merged | 20-50ms |
| `auth_complete` | API keys loaded, tokens refreshed | 30-100ms |
| `tools_registered` | Built-in and plugin tools ready | 20-50ms |
| `mcp_connected` | MCP servers connected | 50-200ms |
| `prompt_built` | System prompt assembled | 10-30ms |
| `session_ready` | Session loaded or created | 20-100ms |
| `ready` | Accepting user input | 0ms |

### Memory Baseline

Record memory usage at the `ready` checkpoint for leak detection:

```
memoryBaseline = process.memoryUsage()
// { rss, heapTotal, heapUsed, external, arrayBuffers }
```

Compare during session to detect leaks (heap growing without bound).

---

## 8. Process Management

### Subprocess Spawning

Patterns for launching child processes (LSP servers, shell commands, MCP servers):

```
spawnChild(command, args, options):
  child = spawn(command, args, {
    stdio: options.stdio or ['pipe', 'pipe', 'pipe'],
    windowsHide: true,       // don't show console on Windows
    env: buildChildEnv(),     // sanitized environment
    cwd: options.cwd,
    timeout: options.timeout
  })

  // Track for cleanup
  childProcesses.add(child)
  child.on('exit', () => childProcesses.delete(child))

  return child
```

### Tmux Integration

For background sessions that persist beyond the terminal:

```
TmuxManager:
  createSession(name, command):
    exec("tmux new-session -d -s {name} {command}")

  attachSession(name):
    exec("tmux attach-session -t {name}")

  detachSession(name):
    // Client detaches, session continues
    exec("tmux detach-client -s {name}")

  killSession(name):
    exec("tmux kill-session -t {name}")

  listSessions():
    output = exec("tmux list-sessions -F '#{session_name}'")
    return output.split('\n')
```

### Signal Handling

```
setupSignalHandlers():
  process.on('SIGINT', () => gracefulShutdown("sigint"))
  process.on('SIGTERM', () => gracefulShutdown("sigterm"))
  process.on('SIGHUP', () => gracefulShutdown("sighup"))

  // Uncaught exceptions — best-effort shutdown
  process.on('uncaughtException', (error) => {
    log.error("Uncaught exception:", error)
    gracefulShutdown("uncaught_exception")
  })

  process.on('unhandledRejection', (reason) => {
    log.error("Unhandled rejection:", reason)
    // Don't exit — log and continue (may be non-fatal)
  })
```

---

## 9. Implementation Checklist

### Minimum Viable Lifecycle

- [ ] SIGINT/SIGTERM handlers with graceful shutdown
- [ ] Terminal state restoration on exit (cursor, modes)
- [ ] Cleanup registry for service teardown
- [ ] Basic crash detection (check for unclean exit on startup)
- [ ] Session log for recovery
- [ ] Process exit with appropriate code

### Production-Grade Lifecycle

- [ ] All of the above, plus:
- [ ] Synchronous terminal restoration (writeSync, not async)
- [ ] Mouse tracking disable sequence on exit
- [ ] Alt-screen exit on shutdown
- [ ] Cleanup handler error isolation (one failure doesn't block others)
- [ ] Memory extraction drain (60s timeout before exit)
- [ ] Periodic housekeeping (old logs, images, paste files, worktrees)
- [ ] Orphaned worktree cleanup (dead PID detection)
- [ ] Full crash recovery (message chain rebuild, broken state filter)
- [ ] Legacy tool name normalization
- [ ] Legacy attachment type migration
- [ ] Session-start hook re-execution on recovery
- [ ] Idle timeout manager (env var configured)
- [ ] Continuous idle check (not just timer-based)
- [ ] Session registry (PID files, status tracking)
- [ ] Concurrent session detection and warning
- [ ] Dead session cleanup
- [ ] Startup profiling (checkpoint-based)
- [ ] Memory baseline at ready
- [ ] Subprocess tracking and cleanup
- [ ] Tmux integration for background sessions
- [ ] Signal handling (SIGINT, SIGTERM, SIGHUP)
- [ ] Uncaught exception logging with best-effort shutdown
- [ ] Unhandled rejection logging (non-fatal)

---

## Related Documents

- [AGENT-BOOTSTRAP-AND-CONFIGURATION.md](AGENT-BOOTSTRAP-AND-CONFIGURATION.md) — Startup sequence that profiling measures
- [AGENT-MEMORY-AND-CONSOLIDATION.md](AGENT-MEMORY-AND-CONSOLIDATION.md) — Extraction drain before shutdown
- [AGENT-TASK-AND-BACKGROUND-EXECUTION.md](AGENT-TASK-AND-BACKGROUND-EXECUTION.md) — Concurrent sessions and task cleanup
- [AGENT-TERMINAL-UI-ARCHITECTURE.md](AGENT-TERMINAL-UI-ARCHITECTURE.md) — Terminal state restored on shutdown
- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — Session persistence for crash recovery
- [AGENT-REMOTE-AND-TEAM-COLLABORATION.md](AGENT-REMOTE-AND-TEAM-COLLABORATION.md) — Session kind affects shutdown behavior
- [AGENT-WORKTREE-AND-ISOLATION.md](AGENT-WORKTREE-AND-ISOLATION.md) — Orphaned worktree cleanup
