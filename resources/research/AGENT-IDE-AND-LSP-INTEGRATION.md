# Agent IDE and LSP Integration

Best practices for integrating Language Server Protocol (LSP) into autonomous AI agents to provide real-time diagnostics, code intelligence, and IDE-quality feedback. Derived from production analysis of agentic systems that passively collect compiler errors, type checking results, and linting feedback to self-correct before the user notices.

*Last updated: 2026-03-31*

---

## Why This Matters

An agent that writes code but doesn't check for errors is like a developer who never runs the compiler. LSP integration gives the agent real-time access to the same diagnostics that an IDE shows — type errors, lint warnings, unused imports, missing dependencies. This enables the agent to detect and fix problems proactively, without waiting for the user to run a build or notice a red squiggle.

---

## 1. Architecture Overview

### The Pattern

```
Agent writes/edits code
  -> File saved to disk
  -> LSP server detects file change (via didSave notification)
  -> LSP server analyzes code (type check, lint, etc.)
  -> LSP server publishes diagnostics
  -> Agent receives diagnostics passively
  -> Agent self-corrects before responding to user
```

### Key Design Decision: Passive, Not Active

The agent doesn't explicitly request diagnostics. Instead:

1. LSP servers publish diagnostics asynchronously after file changes
2. A diagnostic registry collects them in the background
3. The agent checks for new diagnostics after each tool execution
4. If errors found, the agent can fix them in the same turn

This avoids blocking the agent's execution on slow language servers.

---

## 2. LSP Server Management

### Server Lifecycle State Machine

```
States:
  STOPPED     -> Server not running
  STARTING    -> Initialization in progress
  RUNNING     -> Healthy, accepting requests
  ERROR       -> Crashed or failed to initialize

Transitions:
  STOPPED  -> STARTING    (on first file request or explicit start)
  STARTING -> RUNNING     (initialization handshake complete)
  STARTING -> ERROR       (initialization failed)
  RUNNING  -> ERROR       (crash detected)
  ERROR    -> STARTING    (restart attempt, if under maxRestarts)
  Any      -> STOPPED     (explicit shutdown)
```

### Lazy Initialization

Don't start language servers at agent startup. Start them when the agent first interacts with a relevant file:

```
getServerForFile(filePath):
  language = detectLanguage(filePath)
  server = servers.get(language)

  if server == null:
    server = createServer(language)
    servers.set(language, server)

  if server.state == STOPPED:
    server.start()

  return server
```

**Why lazy:** A TypeScript LSP server takes 2-5 seconds to initialize. A Python server takes 1-3 seconds. Starting all of them at agent startup adds unacceptable latency for users who may not need them.

### Singleton Pattern

One LSP manager per agent session, one server instance per language:

```
LSPManager:
  servers: Map<language, LSPServer>
  state: "not-started" | "pending" | "success" | "failed"

  getServer(language): LSPServer | null
  startServer(language): Promise<LSPServer>
  shutdownAll(): Promise<void>
  isConnected(): boolean  // at least one server running and healthy
```

### Crash Recovery

```
LSPServer:
  restartCount: 0
  maxRestarts: 3

  onCrash():
    state = ERROR
    restartCount++

    if restartCount <= maxRestarts:
      // Exponential backoff: 500ms, 1s, 2s
      delay = 500 * 2^(restartCount - 1)
      setTimeout(delay, () => start())
    else:
      log.warn("LSP server exceeded max restarts, staying in ERROR state")
```

---

## 3. Transport: JSON-RPC over Stdio

### Why Stdio

| Transport | Pros | Cons |
|-----------|------|------|
| **Stdio** | Simplest, no port conflicts, works everywhere | One server per process |
| TCP | Multiple clients per server | Port allocation, firewall issues |
| WebSocket | Browser-compatible | Overhead for local use |

Stdio is the standard for local LSP servers. The agent spawns the server as a subprocess and communicates via stdin/stdout.

### Connection Setup

```
startServer(command, args):
  process = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],  // stdin, stdout, stderr
    windowsHide: true  // don't show console window on Windows
  })

  reader = StreamMessageReader(process.stdout)
  writer = StreamMessageWriter(process.stdin)
  connection = createMessageConnection(reader, writer)

  // Capture stderr for debugging
  process.stderr.on('data', (data) => log.debug("LSP stderr:", data))

  // Wait for process to actually spawn before using streams
  await waitForEvent(process, 'spawn')

  connection.listen()
  return connection
```

### Initialize Handshake

```
initialize(connection, workspacePath):
  result = await connection.sendRequest('initialize', {
    processId: process.pid,
    rootUri: filePathToUri(workspacePath),
    capabilities: CLIENT_CAPABILITIES,
    workspaceFolders: null  // simpler without multi-root
  })

  serverCapabilities = result.capabilities

  // Tell server initialization is complete
  connection.sendNotification('initialized', {})

  return serverCapabilities
```

---

## 4. Diagnostic Collection

### Passive Diagnostic Handler

Register a handler for `textDocument/publishDiagnostics` notifications:

```
connection.onNotification('textDocument/publishDiagnostics', (params) => {
  diagnosticRegistry.register({
    uri: params.uri,
    diagnostics: params.diagnostics
  })
})
```

### Diagnostic Registry

```
DiagnosticRegistry:
  pending: Map<uuid, DiagnosticSet>
  delivered: LRUCache<fileUri, Set<diagnosticHash>>  // max 500 files

  register(diagnosticSet):
    id = uuid()
    pending.set(id, diagnosticSet)

  checkForNew():
    results = []

    for id, set in pending:
      for diagnostic in set.diagnostics:
        hash = computeHash(diagnostic)

        // Skip if already delivered to agent
        if delivered.get(set.uri)?.has(hash):
          continue

        results.push({ uri: set.uri, diagnostic })
        delivered.getOrCreate(set.uri).add(hash)

    pending.clear()
    return results
```

### Deduplication

Diagnostics can repeat across turns (same error reported after each file save). Deduplicate using a hash of:

```
diagnosticHash(d):
  return hash(d.message + d.severity + d.range.start.line + d.range.start.character +
              d.range.end.line + d.range.end.character + (d.source or "") + (d.code or ""))
```

**Cache invalidation:** When the agent edits a file, clear delivered diagnostics for that file — the edit may have fixed them:

```
onAgentFileEdit(filePath):
  uri = filePathToUri(filePath)
  delivered.delete(uri)  // re-deliver any diagnostics for this file
```

### Volume Limiting

Prevent diagnostic floods from overwhelming the agent's context:

| Limit | Value | Why |
|-------|-------|-----|
| Max per file | 10 | More than 10 diagnostics per file is noise |
| Max per turn | 30 | Keep total context impact manageable |
| Sort order | Severity descending | Errors before warnings before hints |

```
limitDiagnostics(diagnostics):
  // Group by file
  byFile = groupBy(diagnostics, d => d.uri)

  results = []
  for file, fileDiags in byFile:
    // Sort by severity (Error=1 > Warning=2 > Info=3 > Hint=4)
    sorted = fileDiags.sortBy(d => d.severity)
    results.push(...sorted.slice(0, MAX_PER_FILE))

  // Global limit
  return results.slice(0, MAX_PER_TURN)
```

---

## 5. Supported LSP Capabilities

### Client Capabilities to Declare

| Capability | Why |
|-----------|-----|
| `textDocument.publishDiagnostics` | Core — receive errors and warnings |
| `textDocument.publishDiagnostics.relatedInformation` | Richer error context |
| `textDocument.publishDiagnostics.tags` | Unnecessary/Deprecated indicators |
| `textDocument.hover` | Tooltip info on symbols (markdown + plaintext) |
| `textDocument.definition` | Go-to-definition (with link support) |
| `textDocument.references` | Find all references |
| `textDocument.documentSymbol` | File outline (hierarchical) |
| `textDocument.callHierarchy` | Call graph navigation |

### Capabilities to Decline

| Capability | Why Decline |
|-----------|------------|
| `workspace.configuration` | Agent manages its own config |
| `workspace.workspaceFolders` | Simpler without multi-root |
| `textDocument.willSave` | Agent doesn't need pre-save hooks |

### Transient Error Handling

Some LSP servers return "content modified" (-32801) when the file changes during analysis. This is transient:

```
sendRequestWithRetry(method, params, maxRetries = 3):
  for attempt in 1..maxRetries:
    try:
      return await connection.sendRequest(method, params)
    catch error:
      if error.code == -32801:  // content modified
        delay = 500 * 2^(attempt - 1)
        await sleep(delay)
        continue
      throw error
  throw MaxRetriesExceeded()
```

---

## 6. File Synchronization

### Open File Tracking

LSP servers need to know which files the agent is working with:

```
FileTracker:
  openFiles: Map<serverKey, Set<fileUri>>

  ensureOpen(server, filePath):
    uri = filePathToUri(filePath)
    if not openFiles.get(server.key)?.has(uri):
      server.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: uri,
          languageId: detectLanguage(filePath),
          version: 1,
          text: readFile(filePath)
        }
      })
      openFiles.getOrCreate(server.key).add(uri)

  notifySaved(server, filePath):
    uri = filePathToUri(filePath)
    server.sendNotification('textDocument/didSave', {
      textDocument: { uri: uri }
    })
```

### Agent Tool Integration

After the agent edits a file:

```
onFileEdited(filePath):
  server = lspManager.getServerForFile(filePath)
  if server and server.state == RUNNING:
    fileTracker.ensureOpen(server, filePath)
    fileTracker.notifySaved(server, filePath)
```

After any tool execution, check for new diagnostics:

```
afterToolExecution():
  diagnostics = diagnosticRegistry.checkForNew()
  if diagnostics.length > 0:
    limited = limitDiagnostics(diagnostics)
    // Attach to the next agent turn as context
    appendToNextTurn(formatDiagnostics(limited))
```

---

## 7. Diagnostic Formatting for the Agent

Format diagnostics so the agent can understand and act on them:

```
formatDiagnostics(diagnostics):
  output = "LSP Diagnostics:\n"

  for d in diagnostics:
    severity = ["ERROR", "WARNING", "INFO", "HINT"][d.severity - 1]
    file = uriToFilePath(d.uri)
    line = d.range.start.line + 1  // LSP is 0-indexed, humans use 1-indexed

    output += "{severity}: {file}:{line} - {d.message}"

    if d.relatedInformation:
      for info in d.relatedInformation:
        output += "  Related: {info.location.uri}:{info.location.range.start.line + 1} - {info.message}"

    output += "\n"

  return output
```

---

## 8. Implementation Checklist

### Minimum Viable LSP Integration

- [ ] Spawn language server as stdio subprocess
- [ ] JSON-RPC connection with message reader/writer
- [ ] Initialize handshake (initialize + initialized)
- [ ] Register publishDiagnostics handler
- [ ] Diagnostic registry with pending queue
- [ ] Check for diagnostics after tool execution
- [ ] Format diagnostics for agent context
- [ ] Graceful shutdown (shutdown + exit notifications)

### Production-Grade LSP Integration

- [ ] All of the above, plus:
- [ ] Server lifecycle state machine (stopped/starting/running/error)
- [ ] Lazy initialization per language
- [ ] Singleton manager with per-language servers
- [ ] Crash recovery with max restarts (3) and exponential backoff
- [ ] Diagnostic deduplication via content hash
- [ ] Cross-turn deduplication with LRU cache (500 files)
- [ ] Cache invalidation on agent file edit
- [ ] Volume limiting (10 per file, 30 per turn, severity-sorted)
- [ ] File synchronization (didOpen, didSave notifications)
- [ ] Transient error retry (-32801 content modified)
- [ ] Multiple LSP capabilities (hover, definition, references, symbols)
- [ ] Windows process hiding (windowsHide: true)
- [ ] Stderr capture for debugging
- [ ] Health check method for tool gating

---

## Related Documents

- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Tool execution lifecycle where diagnostics are checked
- [AGENT-DIFF-AND-FILE-EDITING.md](AGENT-DIFF-AND-FILE-EDITING.md) — File edits that trigger LSP re-analysis
- [AGENT-ERROR-HANDLING-AND-HOOKS.md](AGENT-ERROR-HANDLING-AND-HOOKS.md) — Error handling for LSP server crashes
- [AGENT-BOOTSTRAP-AND-CONFIGURATION.md](AGENT-BOOTSTRAP-AND-CONFIGURATION.md) — LSP manager initialization during bootstrap
