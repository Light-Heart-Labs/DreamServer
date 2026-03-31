# Agent Remote and Team Collaboration

Best practices for remote agent sessions, real-time permission delegation, teammate agents, session teleportation, and multi-device collaboration in autonomous AI agent systems. Derived from production analysis of agentic systems running across networks with WebSocket transport, reconnection resilience, and team-scale coordination.

*Last updated: 2026-03-31*

---

## Why This Matters

A local-only agent is a single-user tool. Remote sessions make it a platform — agents running on powerful servers, accessible from any device, with real-time permission flows that keep users in control. Team collaboration lets multiple agents share knowledge and coordinate across a project. Without these, you have a prototype. With them, you have infrastructure.

---

## 1. Remote Session Architecture

### Transport: WebSocket + HTTP Hybrid

| Channel | Protocol | Purpose |
|---------|----------|---------|
| **Subscribe** | WebSocket (`wss://`) | Receive agent messages, control requests, status updates in real-time |
| **Send** | HTTP POST | Send user messages, command submissions |
| **Control** | Over WebSocket | Permission requests/responses, cancel requests |

**Why hybrid:** WebSocket is optimal for streaming (low latency, server push). HTTP POST is simpler and more reliable for user-initiated messages (no stream state to maintain).

### Connection Setup

```
connectRemoteSession(sessionId, authToken):
  ws = new WebSocket(
    "wss://api.example.com/v1/sessions/ws/{sessionId}/subscribe",
    headers: { "Authorization": "Bearer {authToken}" }
  )

  ws.onMessage = routeMessage
  ws.onClose = handleDisconnect
  ws.onError = handleError

  // Start keepalive
  startPingInterval(30_000)  // 30-second pings
```

### Message Types

| Type | Direction | Content |
|------|-----------|---------|
| `assistant` | Server → Client | Agent's response (text, tool calls) |
| `user` | Server → Client | Echo of submitted user message |
| `stream_event` | Server → Client | Streaming token chunks |
| `result` | Server → Client | Final execution result |
| `system` | Server → Client | Status changes, compact boundaries |
| `tool_progress` | Server → Client | Tool execution progress updates |
| `auth_status` | Server → Client | Authentication state changes |
| `rate_limit_event` | Server → Client | Rate limit notifications |
| `tool_use_summary` | Server → Client | Summary of tool execution |
| `control_request` | Server → Client | Permission request from agent |
| `control_response` | Client → Server | User's permission decision |
| `control_cancel_request` | Client → Server | Cancel a pending permission request |

---

## 2. Remote Permission Flow

### The Challenge

The agent runs on a remote server but needs user approval for sensitive actions (file writes, shell commands, etc.). The permission dialog must appear on the user's local device, not on the server.

### Control Message Protocol

```
Control Request (Server → Client):
  type: "control_request"
  request_id: string         // unique, for matching response
  subtype: "can_use_tool"
  payload:
    tool_name: string        // e.g., "bash", "file_write"
    tool_use_id: string      // specific invocation
    input: object            // tool input parameters

Control Response (Client → Server):
  type: "control_response"
  request_id: string         // matches the request
  payload:
    behavior: "allow" | "deny"
    updatedInput: object | null  // optionally modify the input

Control Cancel (Client → Server):
  type: "control_cancel_request"
  request_id: string
```

### Permission Flow

```
1. Remote agent wants to call "bash" with command "git push"
2. Server sends control_request to client via WebSocket
3. Client creates synthetic AssistantMessage (for UI rendering)
4. Client shows permission dialog to user
5. User approves or denies
6. Client sends control_response with behavior + optional updatedInput
7. Server receives response, continues or blocks execution
```

### Unrecognized Requests

If the client receives a control request with an unknown subtype:

```
if request.subtype not in KNOWN_SUBTYPES:
  respond({
    request_id: request.request_id,
    error: "Unrecognized control request subtype: {request.subtype}"
  })
```

**Always respond**, even for unknown requests. An unanswered control request blocks the remote agent indefinitely.

---

## 3. Reconnection and Resilience

### Reconnection Strategy

```
ReconnectionManager:
  maxAttempts: 5
  currentAttempt: 0
  baseDelay: 2000  // 2 seconds

  onDisconnect(closeCode):
    // Permanent close codes — don't retry
    if closeCode == 4003:  // unauthorized
      terminate("Session unauthorized")
      return

    // Special handling for session-not-found
    if closeCode == 4001:
      // Transient during compaction — limited retries
      reconnectWithLimit(maxAttempts: 3, staggeredDelays: true)
      return

    // General disconnects
    reconnect()

  reconnect():
    currentAttempt++
    if currentAttempt > maxAttempts:
      terminate("Max reconnection attempts exceeded")
      return

    delay = baseDelay * currentAttempt  // linear backoff
    setTimeout(delay, () => {
      connect()
      if success:
        currentAttempt = 0  // reset on success
    })

  forceReconnect():
    currentAttempt = 0  // reset counters
    setTimeout(500, connect)  // short delay
```

### Connection State Machine

```
States: CONNECTING → CONNECTED → CLOSED

Transitions:
  CONNECTING → CONNECTED   (WebSocket open event)
  CONNECTED → CLOSED       (WebSocket close event, permanent)
  CONNECTED → CONNECTING   (disconnect + reconnect, transient)
  CONNECTING → CLOSED      (max attempts exceeded)
```

### Keepalive

```
startPingInterval():
  setInterval(30_000, () => {
    if ws.readyState == OPEN:
      ws.ping()
    else:
      clearInterval(pingInterval)
  })
```

Dead connections (no pong response) detected by the WebSocket library's built-in timeout.

---

## 4. Teammate System

### What Teammates Are

Teammates are in-process agents that run alongside the main agent, each with their own conversation context but sharing the same process and resources.

### Teammate Mailbox

Inter-agent communication uses a mailbox pattern:

```
TeammateMailbox:
  inbox: Queue<TeammateMessage>
  outbox: Queue<TeammateMessage>

  send(to: agentId, message: TeammateMessage):
    recipient = getTeammate(to)
    recipient.mailbox.inbox.enqueue(message)

  receive(): TeammateMessage | null
    return inbox.dequeue()

  peek(): TeammateMessage | null
    return inbox.peek()
```

### Teammate Message Structure

```
TeammateMessage:
  from: agentId
  to: agentId
  type: "request" | "response" | "notification"
  content: string
  timestamp: ISO8601
  correlationId: string | null  // for request-response pairing
```

### Team Discovery

```
discoverTeammates():
  // Find active teammates in the same session
  teammates = sessionRegistry.listActive()
    .filter(s => s.kind == "daemon-worker" or s.kind == "interactive")
    .filter(s => s.projectRoot == currentProject)
    .filter(s => s.id != currentSession.id)

  return teammates.map(t => ({
    id: t.id,
    status: t.status,
    capabilities: t.capabilities
  }))
```

### Direct Member Messaging

For targeted communication between specific agents:

```
sendDirectMessage(targetId, content):
  message = TeammateMessage({
    from: currentAgent.id,
    to: targetId,
    type: "request",
    content: content,
    correlationId: generateId()
  })

  targetMailbox = getMailbox(targetId)
  targetMailbox.inbox.enqueue(message)

  // Optionally wait for response
  response = await waitForCorrelatedResponse(message.correlationId, timeout: 30_000)
  return response
```

---

## 5. Session Teleportation

### What It Does

Transfers a complete session from one environment to another — including conversation history, file state, plan state, and memory.

### Teleportation Flow

```
1. Source environment packages session state:
   - Conversation history (messages)
   - File modification history
   - Active plan (if any)
   - Working directory context
   - Permission state

2. Package is serialized and transmitted:
   - Via shared storage (cloud sync)
   - Via direct connection (WebSocket)
   - Via export file (manual transfer)

3. Target environment receives and restores:
   - Rebuild system prompt (fresh, for target environment)
   - Import conversation history
   - Restore file state (verify files exist in target)
   - Restore plan state
   - Re-execute session-start hooks
```

### State Validation on Restore

```
validateTeleportedState(state, targetEnv):
  // Working directory must exist in target
  if not exists(state.workingDirectory):
    state.workingDirectory = detectWorkingDirectory()

  // Auth may differ between environments
  if state.authContext.expiresAt < now():
    refreshAuth()

  // File paths may differ (Windows vs Linux)
  state.fileHistory = remapPaths(state.fileHistory, targetEnv.platform)
```

---

## 6. Direct Connect

### What It Is

A same-network WebSocket connection for low-latency agent interaction without going through a cloud server.

```
DirectConnectManager:
  server: WebSocketServer

  start(port):
    server = new WebSocketServer({ port })
    server.on("connection", handleNewClient)

  handleNewClient(ws):
    session = createAgentSession()
    ws.on("message", (msg) => routeToSession(session, msg))
    session.on("output", (msg) => ws.send(msg))
```

### When to Use Direct Connect vs Remote

| Factor | Direct Connect | Remote (Cloud) |
|--------|---------------|----------------|
| Latency | Minimal (LAN) | Higher (internet) |
| Availability | Same network only | Anywhere |
| Auth | Optional (trusted network) | Required (OAuth) |
| Scaling | Single machine | Server-side scaling |
| Use case | IDE integration, local tools | Mobile, cross-network |

---

## 7. Implementation Checklist

### Minimum Viable Remote Sessions

- [ ] WebSocket connection with auth header
- [ ] Message routing (assistant, user, system types)
- [ ] Permission control request/response flow
- [ ] Basic reconnection on disconnect (3 attempts)
- [ ] Keepalive ping (30-second interval)

### Production-Grade Remote + Team

- [ ] All of the above, plus:
- [ ] HTTP POST for user messages (hybrid transport)
- [ ] Control message protocol (request/response/cancel)
- [ ] Synthetic AssistantMessage wrapping for permission UI
- [ ] Reconnection with close code handling (permanent vs transient)
- [ ] Session-not-found special handling (transient during compaction)
- [ ] Connection state machine (connecting/connected/closed)
- [ ] Force reconnect with counter reset
- [ ] Teammate mailbox (inbox/outbox queues)
- [ ] Teammate message types (request/response/notification)
- [ ] Team discovery (active teammates in same project)
- [ ] Direct member messaging with correlation IDs
- [ ] Session teleportation (package/transmit/restore)
- [ ] State validation on teleport restore
- [ ] Direct connect server for same-network use
- [ ] Session kind handling (bg sessions detach vs exit)

---

## Related Documents

- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — OAuth tokens for remote session auth
- [AGENT-TASK-AND-BACKGROUND-EXECUTION.md](AGENT-TASK-AND-BACKGROUND-EXECUTION.md) — RemoteAgentTask and InProcessTeammateTask types
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Permission decisions delegated to remote client
- [AGENT-COORDINATION-PATTERNS.md](AGENT-COORDINATION-PATTERNS.md) — Multi-agent coordination via teammates
- [AGENT-MEMORY-AND-CONSOLIDATION.md](AGENT-MEMORY-AND-CONSOLIDATION.md) — Team memory sync across remote sessions
- [AGENT-LIFECYCLE-AND-PROCESS.md](AGENT-LIFECYCLE-AND-PROCESS.md) — Session kinds affect shutdown behavior
