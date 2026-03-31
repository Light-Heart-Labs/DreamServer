# Agent SDK Bridge

How an autonomous agent connects to the outside world — the bridge layer that translates between internal message formats and SDK wire protocols, routes permission callbacks across process boundaries, and manages session spawning for local and remote execution. Derived from production analysis of agentic systems with 600KB+ of bridge infrastructure serving both direct API and SDK-mediated paths.

*Last updated: 2026-03-31*

---

## Why This Matters

An agent has two faces: its internal REPL (rich message types, virtual messages, progress events, file attachments) and the external SDK (standardized wire format, permission protocols, session management). The bridge translates between them. Without it, the agent can talk to itself but not to the world.

The bridge is also where local execution diverges from remote execution, where permissions flow across process boundaries, and where sessions are spawned and managed.

---

## 1. Architecture Overview

The bridge consists of 8 interconnected modules:

| Module | Size | Responsibility |
|--------|------|---------------|
| **replBridge** | ~100KB | Core event loop, message routing, WebSocket transport |
| **bridgeMain** | ~115KB | Session spawning, process management, backoff/retry |
| **remoteBridgeCore** | ~40KB | Env-less bridge initialization (SDK path) |
| **sessionRunner** | ~19KB | Subprocess spawning, STDIO capture, permission routing |
| **initReplBridge** | ~24KB | REPL bootstrap, directory state capture |
| **bridgeMessaging** | ~16KB | Pure message parsing, ingress routing, control handling |
| **replBridgeTransport** | ~16KB | WebSocket wrapper, heartbeat, reconnection |
| **bridgeUI** | ~17KB | Status display, logging |

### When the Bridge Is Active

| Execution Mode | Bridge Active? | Why |
|---------------|---------------|-----|
| Direct CLI (local) | **No** | Agent calls API directly, no translation needed |
| SDK-mediated (local) | **Yes** | SDK expects standard message format |
| Remote session | **Yes** | Messages flow over WebSocket to remote server |
| Agent SDK consumer | **Yes** | Third-party app embedding the agent |

---

## 2. Message Flow Architecture

### Three Communication Channels

```
┌──────────┐     STDIO (NDJSON)     ┌──────────┐    WebSocket    ┌──────────┐
│   CLI    │ ───────────────────→  │  Bridge  │ ──────────────→ │  Server  │
│  (REPL)  │ ←───────────────────  │          │ ←────────────── │  (SDK)   │
└──────────┘                       └──────────┘                 └──────────┘
    stdout → NDJSON messages            Parse + convert              SDKMessage
    stdin  ← forwarded messages         Route + filter               wire format
```

### Ingress Flow (Server → Client)

```
1. WebSocket receives SDKMessage JSON
2. bridgeMessaging.handleIngressMessage() parses type discriminant
3. Routes to handler:
   - SDKAssistantMessage → convert to internal AssistantMessage → forward to REPL stdin
   - SDKControlRequest → extract permission request → forward to permission UI
   - SDKStatusMessage → convert to SystemMessage → forward to REPL
   - Unknown type → log and ignore (don't crash)
```

### Egress Flow (Client → Server)

```
1. REPL prints NDJSON message to stdout
2. Bridge captures via stdio reader
3. isEligibleBridgeMessage() filters:
   - PASS: user, assistant, system/local_command messages
   - BLOCK: tool_results, progress, attachments, virtual, other system subtypes
4. Convert internal Message → SDKMessage format
5. Serialize to JSON → send via WebSocket
```

### Visibility Filter

Only three message types are eligible for bridge forwarding:

| Type | Eligible | Why |
|------|----------|-----|
| User messages | Yes | User's input must reach the server |
| Assistant messages | Yes | Agent's response must reach the client |
| System (local_command) | Yes | Slash commands need routing |
| Tool results | **No** | Internal — server doesn't need them |
| Progress updates | **No** | Internal — UI only |
| Attachments | **No** | Internal — context injection |
| Virtual messages | **No** | REPL-only markers |

---

## 3. Message Conversion

### Internal → SDK Format

```
convertToSDK(message):
  switch message.type:
    case "assistant":
      return SDKAssistantMessage({
        content: message.content,       // preserve content blocks
        model: message.model,
        stopReason: message.stopReason,
        usage: message.usage
        // Strip: isVirtual, internalMetadata
      })

    case "user":
      return SDKUserMessage({
        content: message.content
        // Strip: pastedContents, origin, toolResults
      })

    case "system":
      return SDKSystemMessage({
        subtype: message.subtype,
        content: message.content
      })
```

### SDK → Internal Format

```
convertFromSDK(sdkMessage):
  switch sdkMessage.type:
    case "assistant":
      return AssistantMessage({
        uuid: generateUUID(),
        timestamp: now(),
        content: sdkMessage.content,
        stopReason: sdkMessage.stop_reason,
        usage: sdkMessage.usage,
        model: sdkMessage.model
      })

    case "stream_event":
      return StreamEvent(sdkMessage.delta)

    case "result":
      if sdkMessage.is_error:
        return SystemMessage({ subtype: "error", content: sdkMessage.error })
      return null  // success results are noise

    case "compact_boundary":
      return SystemMessage({
        subtype: "compact_boundary",
        metadata: sdkMessage.compactMetadata
      })
```

---

## 4. Permission Callback Protocol

### The Cross-Process Permission Problem

The agent runs in a subprocess. Permission decisions require user interaction in the parent process. The bridge routes permission requests across this boundary.

### Protocol

```
Permission Request (Agent → Bridge → UI):
  {
    type: "control_request"
    request_id: "req-abc123"        // unique, for response matching
    subtype: "can_use_tool"
    payload: {
      tool_name: "bash"
      tool_use_id: "tu-xyz789"
      input: { command: "git push origin main" }
      description: "Push to remote"    // human-readable
      suggestions: [...]               // suggested permission rules
      blocked_path: "/path/to/file"    // if path-based denial
    }
  }

Permission Response (UI → Bridge → Agent):
  {
    type: "control_response"
    request_id: "req-abc123"        // matches request
    payload: {
      behavior: "allow" | "deny"
      updatedInput: { ... } | null  // optional: modify tool input
      updatedPermissions: [...]     // optional: update permission rules
      message: "User approved"      // optional: human-readable reason
    }
  }

Permission Cancel (UI → Bridge → Agent):
  {
    type: "control_cancel_request"
    request_id: "req-abc123"
  }
```

### Async Request/Response Matching

```
PendingPermissions:
  pending: Map<requestId, { resolve, reject, timeout }>

  sendRequest(requestId, toolName, input):
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject })

      // Timeout after 5 minutes (user walked away)
      timeout = setTimeout(300_000, () => {
        pending.delete(requestId)
        reject(TimeoutError("Permission request timed out"))
      })
    })

  onResponse(requestId, response):
    entry = pending.get(requestId)
    if entry:
      clearTimeout(entry.timeout)
      pending.delete(requestId)
      entry.resolve(response)
```

### Always Respond to Control Requests

Even for unrecognized subtypes, always send a response. An unanswered control request blocks the agent indefinitely:

```
handleControlRequest(request):
  if request.subtype not in KNOWN_SUBTYPES:
    sendResponse(request.request_id, {
      error: "Unrecognized subtype: " + request.subtype
    })
    return

  // Route to appropriate handler
  ...
```

---

## 5. Session Runner

### Subprocess Spawning

The bridge spawns the agent CLI as a child process:

```
spawnAgentProcess(config):
  child = spawn(agentBinary, agentArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],   // stdin, stdout, stderr
    env: buildAgentEnv(config),         // sanitized environment
    cwd: config.workingDirectory
  })

  // Parse NDJSON from stdout
  child.stdout.on('data', (data) => {
    for line in data.split('\n'):
      if line.trim():
        message = JSON.parse(line)
        routeMessage(message)
  })

  // Capture stderr for debugging
  child.stderr.on('data', (data) => {
    log.debug("Agent stderr:", data)
  })

  return child
```

### NDJSON Protocol

Messages are encoded as newline-delimited JSON (one JSON object per line):

```
{"type":"assistant","content":[{"type":"text","text":"I'll read the file..."}]}
{"type":"assistant","content":[{"type":"tool_use","id":"tu-1","name":"file_read","input":{"path":"/src/main.ts"}}]}
{"type":"control_request","request_id":"req-1","subtype":"can_use_tool","payload":{...}}
```

**Why NDJSON:** Simple, streamable, language-agnostic. Each line is a complete JSON object — no framing, no length prefixes, no binary encoding.

### Tool Activity Display

The bridge shows the user what the agent is doing:

```
TOOL_DISPLAY_VERBS = {
  "file_read": "Reading",
  "bash": "Running",
  "file_edit": "Editing",
  "file_write": "Writing",
  "grep": "Searching",
  "glob": "Finding",
  "web_search": "Searching web",
  "web_fetch": "Fetching",
  "agent": "Spawning agent"
}

displayToolActivity(toolCall):
  verb = TOOL_DISPLAY_VERBS[toolCall.name] or "Using"
  detail = extractDisplayDetail(toolCall)  // file_path, command, pattern, url
  show("{verb}: {detail}")
```

---

## 6. Bridge Core Parameters

Static contract established at session initialization:

```
BridgeCoreParams:
  dir: string              // working directory
  machineName: string      // hostname for display
  branch: string           // git branch
  gitRepoUrl: string       // repository URL (for team features)
  title: string            // session title
  baseUrl: string          // API base URL
  sessionIngressUrl: string // session management endpoint
```

These are captured once and never change during the bridge session lifetime.

---

## 7. Local vs Remote Execution Paths

### Local Execution (No Bridge)

```
User Input → REPL → Query Loop → Model API → Tool Execution → REPL → User
```

The agent calls the LLM API directly. No bridge, no message conversion, no WebSocket.

### SDK/Remote Execution (Bridge Active)

```
User Input → SDK Client → WebSocket → Bridge → REPL (subprocess)
                                                    ↓
                                              Query Loop → Tools
                                                    ↓
                                              REPL → stdout (NDJSON)
                                                    ↓
                                        Bridge → WebSocket → SDK Client → User
```

The bridge acts as a translation layer between the SDK's wire format and the REPL's internal format.

### Choosing the Path

```
determineExecutionMode(config):
  if config.sdkMode or config.remoteSession:
    return BRIDGE_MODE  // start bridge, spawn REPL as subprocess

  return DIRECT_MODE  // start REPL directly, no bridge
```

---

## 8. Implementation Checklist

### Minimum Viable Bridge

- [ ] NDJSON stdout parsing from subprocess
- [ ] Message type filtering (eligible vs internal)
- [ ] Basic message conversion (internal ↔ SDK format)
- [ ] Permission request/response routing with request ID matching
- [ ] Session subprocess spawning
- [ ] Tool activity display

### Production-Grade Bridge

- [ ] All of the above, plus:
- [ ] WebSocket transport with heartbeat and reconnection
- [ ] Event-driven state machine (ready/connected/reconnecting/failed)
- [ ] Ingress routing by message type
- [ ] Egress visibility filter (only user/assistant/local_command)
- [ ] Control request protocol (request/response/cancel)
- [ ] Async permission matching with timeout (5 minutes)
- [ ] Always-respond guarantee for control requests
- [ ] Bridge core params contract (static per session)
- [ ] SDK → internal conversion for all message types
- [ ] Internal → SDK conversion with metadata stripping
- [ ] Stream event passthrough
- [ ] Error-only result conversion (success results filtered)
- [ ] Compact boundary conversion with metadata
- [ ] STDERR capture for debugging
- [ ] Tool verb mapping for display
- [ ] Local vs remote execution path selection
- [ ] Session runner with NDJSON protocol

---

## Related Documents

- [AGENT-QUERY-LOOP-AND-STATE-MACHINE.md](AGENT-QUERY-LOOP-AND-STATE-MACHINE.md) — The loop running inside the REPL subprocess
- [AGENT-MESSAGE-PIPELINE.md](AGENT-MESSAGE-PIPELINE.md) — Internal message types that the bridge converts
- [AGENT-REMOTE-AND-TEAM-COLLABORATION.md](AGENT-REMOTE-AND-TEAM-COLLABORATION.md) — Remote sessions using the bridge
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Permission decisions routed through the bridge
- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — Session management and auth for bridge connections
- [AGENT-INITIALIZATION-AND-WIRING.md](AGENT-INITIALIZATION-AND-WIRING.md) — Bridge initialization during bootstrap
