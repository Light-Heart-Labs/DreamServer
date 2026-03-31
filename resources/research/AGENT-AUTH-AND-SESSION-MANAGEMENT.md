# Agent Authentication and Session Management

Best practices for authenticating agent systems, managing tokens securely, persisting sessions, and enabling crash recovery. Derived from production analysis of agentic systems handling OAuth flows, keychain integration, and team-scale session coordination.

*Last updated: 2026-03-31*

---

## Why This Matters

An agent with API access handles sensitive credentials — API keys, OAuth tokens, session identifiers. Mishandled credentials get logged, leaked, or stolen. Lost sessions waste hours of user context. No crash recovery means users fear using agents for long tasks.

Production systems treat auth and sessions as core infrastructure, not afterthoughts.

---

## Part 1: Authentication

### 1.1 Authentication Methods

Support multiple auth methods with a fallback chain:

| Method | Best For | Security Level |
|--------|---------|---------------|
| **OAuth + PKCE** | Interactive users, web-based auth | Highest (no client secret needed) |
| **API Key** | CI/CD, scripts, headless usage | High (key must be secured) |
| **Environment variable** | Quick setup, development | Medium (visible to processes) |
| **Keychain/credential store** | Desktop users, persistent auth | High (OS-level encryption) |

### Fallback Chain

```
authenticate():
  // Try methods in security order
  if oauthTokenAvailable():
    token = loadOAuthToken()
    if not expired(token):
      return token
    token = refreshOAuthToken(token)
    if token:
      return token

  if keychainAvailable():
    key = loadFromKeychain()
    if key:
      return key

  if envVar("AGENT_API_KEY"):
    return envVar("AGENT_API_KEY")

  // No auth available — prompt user
  return promptForAuth()
```

### 1.2 OAuth with PKCE

For interactive sessions, OAuth with PKCE (Proof Key for Code Exchange) is the gold standard:

**Why PKCE:** No client secret needs to be stored on the user's machine. The code verifier is generated per-session and never leaves the device.

**Flow:**

```
1. Generate random code_verifier (43-128 chars, URL-safe)
2. Compute code_challenge = BASE64URL(SHA256(code_verifier))
3. Generate random state token (CSRF protection)
4. Open browser to authorization URL:
   /authorize?
     response_type=code&
     client_id=PUBLIC_CLIENT_ID&
     redirect_uri=http://localhost:PORT/callback&
     code_challenge=CHALLENGE&
     code_challenge_method=S256&
     state=STATE_TOKEN&
     scope=REQUESTED_SCOPES

5. Start local HTTP server on PORT to receive callback
6. User authenticates in browser
7. Receive authorization code on callback:
   /callback?code=AUTH_CODE&state=STATE_TOKEN

8. Verify state matches (CSRF protection)
9. Exchange code for tokens:
   POST /token
     grant_type=authorization_code&
     code=AUTH_CODE&
     redirect_uri=REDIRECT_URI&
     code_verifier=CODE_VERIFIER

10. Receive access_token + refresh_token
11. Store tokens securely
```

### 1.3 Token Refresh

Access tokens expire. Refresh them proactively, not reactively:

```
TokenRefreshManager:
  refreshBuffer: 300_000   // 5 minutes before expiry
  maxFailures: 3
  consecutiveFailures: 0
  generationCounter: 0     // prevents orphaned timers

  scheduleRefresh(token):
    generation = ++generationCounter
    expiresIn = getExpiry(token) - now()
    refreshAt = expiresIn - refreshBuffer

    setTimeout(refreshAt, () => {
      // Check generation — if it changed, a newer token superseded us
      if generation != generationCounter:
        return  // orphaned timer, ignore

      doRefresh(token)
    })

  doRefresh(token):
    try:
      newToken = api.refreshToken(token.refreshToken)
      consecutiveFailures = 0
      store(newToken)
      scheduleRefresh(newToken)

    catch error:
      consecutiveFailures++
      if consecutiveFailures >= maxFailures:
        notifyUser("Auth expired. Please re-authenticate.")
        return

      // Retry with shorter interval
      retryDelay = min(30_000 * consecutiveFailures, 120_000)
      setTimeout(retryDelay, () => doRefresh(token))
```

### JWT Expiry Without Signature Verification

For scheduling refresh, you only need to know *when* the token expires — not whether it's valid (the API does that). Decoding the JWT payload without verifying the signature is safe for this purpose:

```
getTokenExpiry(jwt):
  // Split: header.payload.signature
  parts = jwt.split(".")
  payload = base64UrlDecode(parts[1])
  return payload.exp  // Unix timestamp
```

**Why not verify:** The token came from a trusted source (the auth server). You're not making authorization decisions based on the payload — just scheduling a refresh. Full verification would require the server's public key, adding unnecessary complexity.

### 1.4 Keychain Integration

Store credentials in the OS keychain, not in plaintext files:

| Platform | Storage | Access Method |
|----------|---------|--------------|
| macOS | Keychain Services | `security` CLI or Security framework |
| Windows | Credential Manager | `cmdkey` CLI or Win32 API |
| Linux | libsecret / GNOME Keyring / KWallet | `secret-tool` CLI or DBus |

**Keychain read pattern:**

```
readFromKeychain(service, account):
  // macOS example using security CLI
  result = exec("security find-generic-password -s {service} -a {account} -w")

  if result.exitCode == 0:
    return result.stdout.trim()

  if result.exitCode == 44:  // item not found
    return null

  throw KeychainError(result.stderr)
```

**Timeout:** Keychain reads can hang (locked keychain, daemon unresponsive). Always set a timeout:

```
readFromKeychainWithTimeout(service, account, timeoutMs = 5000):
  result = withTimeout(timeoutMs, readFromKeychain(service, account))
  if result == TIMEOUT:
    log.warn("Keychain read timed out after {timeoutMs}ms, falling back to env var")
    return env.AGENT_API_KEY or null
  return result
```

**Caching:** Keychain reads are slow (~50-100ms on macOS). Cache the result with a TTL:

```
cachedKeychainRead = memoizeWithTTL(
  readFromKeychain,
  ttl: 300_000  // 5 minutes
)
```

### 1.5 API Key Display Safety

Never display full API keys in logs, UI, or error messages:

```
truncateKey(key):
  if key.length < 10:
    return "***"
  prefix = key.slice(0, 7)   // e.g., "sk-ant-"
  return prefix + "..." + key.slice(-4)

// "sk-ant-abc123...xyz9"
```

### 1.6 Scope-Based Access Control

Different auth scopes grant different capabilities:

| Scope | Grants | Example |
|-------|--------|---------|
| `inference` | Model API access | Send messages, stream responses |
| `profile` | User profile info | Name, email, subscription tier |
| `admin` | Organization management | User management, billing |
| `mcp` | MCP server access | Connect to external tool servers |

**Gate features on scopes:**

```
canUseFeature(feature, authContext):
  requiredScope = FEATURE_SCOPES[feature]
  return requiredScope in authContext.grantedScopes
```

**Scope escalation:** When a feature needs a scope the user hasn't granted, prompt for re-authentication with the additional scope — don't fail silently.

---

## Part 2: Session Management

### 2.1 Session Lifecycle

```
Session States:
  CREATING   -> Session being initialized
  ACTIVE     -> User interacting, agent executing
  IDLE       -> No activity, session alive
  SUSPENDED  -> Saved to disk, can be resumed
  EXPIRED    -> TTL exceeded, cleanup needed
  TERMINATED -> User ended session, cleanup complete
```

### State Transitions

```
CREATING -> ACTIVE        (initialization complete)
ACTIVE -> IDLE            (no activity for N minutes)
IDLE -> ACTIVE            (user sends message)
ACTIVE -> SUSPENDED       (user closes app, or explicit save)
SUSPENDED -> ACTIVE       (user resumes session)
IDLE -> EXPIRED           (TTL exceeded while idle)
ACTIVE -> TERMINATED      (user ends session)
SUSPENDED -> EXPIRED      (TTL exceeded while suspended)
EXPIRED -> TERMINATED     (cleanup complete)
```

### 2.2 Session Persistence

#### What to Save

| Data | Storage Format | When to Save |
|------|---------------|-------------|
| Conversation history | JSON messages array | Every N turns or on suspend |
| Session metadata | JSON object | On every state change |
| Tool results (large) | External files | On truncation |
| Permission state | JSON object | On permission change |
| Working directory | String | On change |
| Active task state | Structured data | On task update |

#### Persistence Format

```json
{
  "version": 2,
  "sessionId": "sess_abc123",
  "created": "2026-03-31T10:00:00Z",
  "lastActive": "2026-03-31T12:30:00Z",
  "state": "suspended",
  "workingDirectory": "/home/user/project",
  "authContext": {
    "method": "oauth",
    "scopes": ["inference", "profile"],
    "expiresAt": "2026-03-31T18:00:00Z"
  },
  "tokenUsage": {
    "input": 145000,
    "output": 23000,
    "cost": 1.47
  },
  "history": {
    "messageCount": 47,
    "lastMessageId": "msg_xyz789",
    "compacted": false
  }
}
```

#### Checkpoint Strategy

```
SessionCheckpoint:
  interval: 30_000          // every 30 seconds while active
  onSignificantEvent: true  // also checkpoint on tool completion, permission change

  save():
    data = serializeSession()
    tempPath = sessionPath + ".tmp"
    writeFile(tempPath, data)
    rename(tempPath, sessionPath)  // atomic on most filesystems
```

**Atomic writes:** Always write to a temp file and rename. A crash during write won't corrupt the session file.

### 2.3 Crash Recovery

```
recoverSession(sessionPath):
  // Check for temp file (crash during save)
  if exists(sessionPath + ".tmp"):
    // Temp file may be incomplete — try to parse it
    try:
      data = readAndParse(sessionPath + ".tmp")
      // Valid — use it (more recent than main file)
      rename(sessionPath + ".tmp", sessionPath)
      return restoreFrom(data)
    catch:
      // Corrupted temp file — delete it, use main file
      delete(sessionPath + ".tmp")

  if exists(sessionPath):
    data = readAndParse(sessionPath)
    return restoreFrom(data)

  return null  // no session to recover

restoreFrom(data):
  // Rebuild system prompt (don't trust saved prompt — config may have changed)
  systemPrompt = buildSystemPrompt()

  // Load history
  history = data.messages or fetchHistoryFromAPI(data.sessionId)

  // Verify auth is still valid
  if data.authContext.expiresAt < now():
    refreshAuth()

  // Verify working directory still exists
  if not exists(data.workingDirectory):
    data.workingDirectory = detectWorkingDirectory()

  return buildSession(systemPrompt, history, data)
```

### 2.4 History Pagination

For sessions with long histories, don't load everything into memory:

```
SessionHistory:
  pageSize: 100

  fetchLatestPage():
    return api.getHistory(sessionId, {
      limit: pageSize,
      anchor: "latest"
    })

  fetchOlderPage(beforeId):
    return api.getHistory(sessionId, {
      limit: pageSize,
      before_id: beforeId
    })

  // Cursor-based pagination: each response includes a cursor
  // for the next page. No offset-based pagination (unreliable
  // when history is being appended concurrently).
```

### 2.5 Optimistic Concurrency

When multiple clients might access the same session (team features, multi-device):

```
sessionIngress(message, lastKnownMessageId):
  // Server checks: is lastKnownMessageId still the latest?
  if server.latestMessageId != lastKnownMessageId:
    return CONFLICT("Session modified by another client")

  // Append message and return new ID
  newId = server.appendMessage(message)
  return OK(newId)
```

**Pattern:** Similar to ETags in HTTP or CAS (Compare-And-Swap) in databases. The client sends its last-known state; the server rejects if state has changed.

### 2.6 Session Cleanup

```
cleanupExpiredSessions():
  for session in allSessions:
    if session.state == EXPIRED:
      // Archive conversation for audit trail (optional)
      archiveSession(session)

      // Delete session files
      deleteSessionFiles(session.sessionId)

      // Revoke any session-specific tokens
      revokeSessionTokens(session)

SessionExpiry:
  active_ttl: 24h        // active sessions expire after 24h inactivity
  suspended_ttl: 7d      // suspended sessions expire after 7 days
  terminated_cleanup: 1h  // terminated sessions cleaned up after 1 hour
```

---

## Part 3: Team and Multi-Device

### 3.1 Team Memory Sync

When multiple team members use the same project:

```
TeamMemory:
  // Project-level learnings shared across team
  projectMemory: "/.agent/memory.md"

  // Individual learnings that may be promoted to team
  personalMemory: "~/.agent/memory.md"

  sync():
    // Pull latest team memory
    teamData = fetchTeamMemory(projectId)

    // Merge with local (team takes precedence for conflicts)
    merged = merge(localProjectMemory, teamData, strategy: "team_wins")

    // Write merged result
    writeProjectMemory(merged)
```

### 3.2 Multi-Device Session Handoff

Users may start a session on one device and continue on another:

```
handoffSession(sessionId, fromDevice, toDevice):
  // Save full session state
  saveCheckpoint(sessionId)

  // Push to session storage (API or shared storage)
  pushSession(sessionId, checkpoint)

  // On new device:
  pullSession(sessionId)
  restoreFrom(checkpoint)
```

---

## 4. Implementation Checklist

### Minimum Viable Authentication

- [ ] API key from environment variable
- [ ] API key from config file
- [ ] Key display truncation in logs/UI
- [ ] Token expiry detection
- [ ] Basic retry on 401 (refresh once, then fail)

### Minimum Viable Session Management

- [ ] Session creation with unique ID
- [ ] Conversation history in memory
- [ ] Session save on exit (graceful)
- [ ] Session resume from saved state
- [ ] Basic crash recovery (check for saved session on startup)

### Production-Grade

- [ ] All of the above, plus:
- [ ] OAuth with PKCE flow
- [ ] Proactive token refresh (5-minute buffer)
- [ ] Generation counter for orphaned refresh timers
- [ ] Max consecutive refresh failures (3)
- [ ] Platform keychain integration (macOS/Windows/Linux)
- [ ] Cached keychain reads with TTL
- [ ] Scope-based feature gating
- [ ] Scope escalation (re-auth for new scopes)
- [ ] Atomic session writes (temp file + rename)
- [ ] Crash recovery (temp file detection, history rebuild)
- [ ] Periodic session checkpoints (every 30s while active)
- [ ] Cursor-based history pagination
- [ ] Optimistic concurrency for multi-client sessions
- [ ] Session state machine (creating/active/idle/suspended/expired)
- [ ] TTL-based session expiry with cleanup
- [ ] Team memory sync (project-level shared learnings)
- [ ] Auth fallback chain (OAuth → keychain → env var → prompt)

---

## Related Documents

- [AGENT-BOOTSTRAP-AND-CONFIGURATION.md](AGENT-BOOTSTRAP-AND-CONFIGURATION.md) — Auth loaded during bootstrap phase 2
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Permissions that gate authenticated features
- [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) — Conversation history managed within sessions
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — API calls that require authentication
- [AGENT-SPECULATION-AND-CACHING.md](AGENT-SPECULATION-AND-CACHING.md) — Caching patterns for auth tokens and session data
