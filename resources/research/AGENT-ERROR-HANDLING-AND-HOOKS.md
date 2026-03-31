# Agent Error Handling and Hook Framework

Best practices for error classification, safe error access, and event-driven hook execution in autonomous AI agent systems. Derived from production analysis of agentic systems handling millions of tool executions with robust error recovery and extensible lifecycle hooks.

*Last updated: 2026-03-31*

---

## Why This Matters

Agents fail constantly — files don't exist, commands return non-zero, APIs timeout, permissions are denied, users cancel mid-operation. Without proper error classification, every failure looks the same, and the agent can't make intelligent recovery decisions. Without hooks, the system can't be extended without modifying core code.

This document covers the error type hierarchy, safe error access utilities, the event-driven hook lifecycle, and HTTP hook security.

---

## Part 1: Error Classification

### 1.1 The Problem with Generic Errors

```
BAD: catch (error) { return "Something went wrong" }
```

The agent can't distinguish between:
- A file that doesn't exist (create it?)
- A permission denial (ask the user?)
- A user cancellation (stop gracefully?)
- A network timeout (retry?)
- A security violation (never retry)

### 1.2 Error Type Hierarchy

Define error types by **what the agent should do about them**:

| Error Type | Agent Response | Example |
|-----------|---------------|---------|
| **AbortError** | Stop gracefully, don't report as failure | User pressed Ctrl+C, timeout |
| **ShellError** | Analyze output, maybe fix and retry | Command exited with non-zero, build failed |
| **PermissionError** | Ask user or change approach | Write to protected file denied |
| **ConfigError** | Report to user, can't self-fix | Invalid configuration file |
| **NetworkError** | Retry with backoff, or report | API timeout, DNS failure |
| **SecurityError** | Never retry, report violation | Injection attempt detected |
| **TelemetrySafeError** | Safe to log to telemetry service | Verified to not contain PII or file paths |

### 1.3 ShellError Structure

Shell command failures need rich context for the agent to diagnose:

```
ShellError:
  command: string        (what was run)
  exitCode: number       (process exit code)
  stdout: string         (standard output)
  stderr: string         (standard error)
  interrupted: boolean   (was the process killed/signaled?)
  duration: number       (how long it ran before failing)
```

**Why structured:** An agent can read `stderr` to understand a build failure, check `exitCode` to distinguish between "not found" (127) and "permission denied" (126), and use `interrupted` to know if it was a timeout vs a real error.

### 1.4 Telemetry-Safe Errors

**The risk:** Error messages often contain file paths, user names, API keys, or code snippets. Sending these to telemetry services leaks sensitive data.

**The pattern:** Create a separate error type that *requires* the developer to verify the message is safe:

```
TelemetrySafeError:
  message: string   (verified to not contain PII, paths, or code)

  // The long name is intentional — it forces developers to think
  // before creating one. A function named "safe_error" gets misused.
  // A function named "telemetry_safe_error_i_verified_this_is_not_code_or_filepaths"
  // makes you stop and check.
```

**Key Insight:** Make the safe path harder than the unsafe path, and developers will only use it when they've actually verified safety.

### 1.5 Abort Error Detection

User cancellation can come from multiple sources. Detect all of them:

| Source | Detection Method |
|--------|-----------------|
| Custom AbortError class | `instanceof AbortError` |
| DOM AbortSignal | `error.name === 'AbortError'` |
| SDK abort | `instanceof APIUserAbortError` |
| Process signal | `process.exitCode` or signal handler |

**Implementation:** Create an `isAbortError()` utility that checks all sources:

```
isAbortError(error):
  if error instanceof AbortError: return true
  if error.name === 'AbortError': return true
  if error instanceof APIUserAbortError: return true
  return false
```

---

## Part 2: Safe Error Access

### 2.1 The Problem

In most languages, `catch` gives you an untyped value. Accessing `.message`, `.code`, or `.path` without type checking causes secondary errors that mask the original problem.

### 2.2 Utility Functions

| Function | Purpose | Behavior |
|----------|---------|----------|
| `toError(e: unknown)` | Normalize any caught value into an Error | Wraps strings, numbers, objects into Error instances |
| `errorMessage(e: unknown)` | Extract message safely | Returns `.message` if Error, `String(e)` otherwise |
| `getErrnoCode(e: unknown)` | Extract OS error code | Returns `ENOENT`, `EACCES`, etc. or undefined |
| `getErrnoPath(e: unknown)` | Extract file path from OS error | Returns the path that caused the error, or undefined |
| `isENOENT(e: unknown)` | Check for "file not found" | Boolean without type casting |
| `isEACCES(e: unknown)` | Check for "permission denied" | Boolean without type casting |

### 2.3 Recovery Strategy by Error Type

```
catch (error):
  if isAbortError(error):
    // User cancelled — stop gracefully, don't report as failure
    return { cancelled: true }

  if isENOENT(error):
    // File not found — agent can create it or try alternative
    path = getErrnoPath(error)
    return { error: "file_not_found", path, recoverable: true }

  if isEACCES(error):
    // Permission denied — ask user or escalate
    path = getErrnoPath(error)
    return { error: "permission_denied", path, recoverable: true }

  if error instanceof ShellError:
    // Command failed — return stderr for agent to analyze
    return { error: "command_failed", stderr: error.stderr, exitCode: error.exitCode }

  if error instanceof SecurityError:
    // Security violation — never retry
    return { error: "security_violation", message: error.message, recoverable: false }

  // Unknown error — return message, let agent decide
  return { error: "unknown", message: errorMessage(error) }
```

---

## Part 3: Event-Driven Hook Framework

### 3.1 What Hooks Solve

Hooks let users and plugins inject custom logic at lifecycle points without modifying core tool code:

- **Validation:** Check tool inputs before execution (pre-hook)
- **Logging:** Record tool executions for audit (post-hook)
- **Blocking:** Prevent certain actions based on custom rules (pre-hook)
- **Notification:** Alert external systems about events (post-hook)
- **Modification:** Transform tool inputs before they reach the tool (pre-hook)

### 3.2 Hook Lifecycle Events

| Event | When It Fires | Common Use |
|-------|--------------|------------|
| `PreToolUse` | Before permission check and execution | Validate, modify, or block tool calls |
| `PostToolUse` | After successful execution | Log results, trigger follow-ups |
| `PostToolUseFailure` | After failed execution | Error logging, alerting |
| `PermissionDenied` | After a permission denial | Audit logging |
| `SessionStart` | When a new session begins | Initialize state, load config |
| `SessionStop` | When a session ends | Cleanup, summary generation |
| `Notification` | When the system emits a notification | Routing to external systems |

### 3.3 Hook Types

| Type | Execution Method | Best For |
|------|-----------------|----------|
| **Process hook** | Shell command subprocess | Running external scripts, CLI tools |
| **HTTP hook** | HTTP request to URL | Webhooks, external APIs, cloud functions |
| **Prompt hook** | Inline code execution | Quick validation, transformation |

### 3.4 Hook Matching

Hooks are matched against events using patterns:

```yaml
hooks:
  - event: PreToolUse
    match: "bash"           # Only for bash tool
    type: process
    command: "/usr/local/bin/validate-command.sh"

  - event: PostToolUse
    match: "*"              # All tools
    type: http
    url: "https://audit.example.com/log"

  - event: PreToolUse
    match: "file_write"     # Only for file writes
    type: process
    command: "/usr/local/bin/check-file-policy.sh"
```

### 3.5 Hook Input/Output Protocol

**Input to hook:** JSON object with event context:

```json
{
  "event": "PreToolUse",
  "tool": "bash",
  "input": { "command": "git push origin main" },
  "sessionId": "abc-123",
  "timestamp": "2026-03-31T12:00:00Z"
}
```

**Output from hook:**

| Exit Code | Meaning | Behavior |
|-----------|---------|----------|
| 0 | Success/pass | Continue execution; stdout shown if non-empty |
| 2 | Soft block | stderr shown to model or user; action may be modified |
| Other | Hard block | stderr shown to user only; action blocked |

### 3.6 Async Hook Registry

For process-based hooks that take time:

```
AsyncHookRegistry:
  pending: Map<hookId, { process, startTime, timeout, progressInterval }>

  register(hook, timeout = 15000):
    spawn process with JSON input on stdin
    start progress interval (report "waiting for hook..." periodically)
    set timeout (kill process if too slow)
    store in pending map

  checkResponses():
    for each pending hook:
      if process exited:
        collect stdout/stderr
        clear timeout and progress interval
        remove from pending
        return result
    return null (nothing ready yet)
```

**Timeout handling:** Hooks that exceed their timeout are killed. The tool call proceeds as if the hook returned "pass" (fail-open) or "block" (fail-closed) depending on configuration.

### 3.7 HTTP Hook Security

HTTP hooks introduce network-based attack surface. Secure them:

**SSRF Protection:**
- Apply the same SSRF guard used for agent network requests (see AGENT-SECURITY-NETWORK-AND-INJECTION.md)
- Block requests to private networks, cloud metadata, CGNAT ranges
- Validate at socket connect time

**Header Injection Prevention:**
Strip these characters from HTTP header values:
- `\r` (Carriage Return) — enables HTTP response splitting
- `\n` (Line Feed) — enables header injection
- `\0` (Null byte) — enables string truncation

**URL Allowlist:**
Support patterns for allowed hook URLs:

```yaml
allowed_hook_urls:
  - "https://audit.example.com/*"
  - "https://hooks.internal.company.com/*"
```

**Environment Variable Interpolation:**
Hook configs may reference environment variables. Sanitize after interpolation — a variable containing `\r\n` in its value can inject headers.

```
url: "https://hooks.example.com/api?token=${HOOK_TOKEN}"
# After interpolation, re-validate the full URL
```

### 3.8 Hook Priority and Short-Circuiting

When multiple hooks match the same event:

```
PreToolUse hooks (in order of registration):
  Hook A: returns PASS
  Hook B: returns BLOCK  <- short-circuit, tool call blocked
  Hook C: never runs
```

**Rule:** If any pre-hook blocks, the action is blocked. All hooks must pass for the action to proceed.

For post-hooks, all hooks run regardless of individual results (logging shouldn't be skipped because one logger failed).

---

## 4. Combining Errors and Hooks

### Pre-Hook Error → Permission Error

```
PreToolUse hook blocks tool call
  -> Agent receives: { error: "hook_blocked", hook: "validate-command", message: "..." }
  -> Agent can: modify input and retry, or inform user
```

### Tool Error → Post-Hook Notification

```
Tool execution fails with ShellError
  -> PostToolUseFailure hook fires
  -> Hook sends alert to monitoring system
  -> Agent receives: original ShellError (hook doesn't modify it)
  -> Agent can: analyze stderr, fix, retry
```

### Abort → No Hooks

```
User cancels with Ctrl+C
  -> AbortError detected
  -> No post-hooks fire (cancellation is not a failure)
  -> Session cleanup runs (SessionStop event still fires)
```

---

## 5. Implementation Checklist

### Minimum Viable Error Handling

- [ ] Error type hierarchy (at least: Abort, Shell, Permission, Security)
- [ ] `toError()` and `errorMessage()` utility functions
- [ ] Abort detection from multiple sources
- [ ] Structured ShellError with stdout/stderr/exitCode
- [ ] Recovery strategy mapping (error type → agent response)

### Minimum Viable Hook Framework

- [ ] PreToolUse and PostToolUse events
- [ ] Process-based hook execution
- [ ] JSON input/output protocol
- [ ] Exit code semantics (0 = pass, 2 = soft block, other = hard block)
- [ ] Hook timeout (default 15s)

### Production-Grade

- [ ] All of the above, plus:
- [ ] TelemetrySafeError with verified-safe naming convention
- [ ] Errno code and path extraction utilities
- [ ] Full lifecycle events (SessionStart, Stop, Notification, PermissionDenied)
- [ ] HTTP hooks with SSRF protection
- [ ] Header injection prevention on HTTP hooks
- [ ] URL allowlist for hook destinations
- [ ] Async hook registry with progress reporting
- [ ] Environment variable interpolation with post-interpolation validation
- [ ] Hook matching with wildcard patterns
- [ ] Short-circuit on pre-hook block
- [ ] All-hooks-run for post-hooks
- [ ] Fail-open vs fail-closed configuration per hook

---

## Related Documents

- [AGENT-SECURITY-COMMAND-EXECUTION.md](AGENT-SECURITY-COMMAND-EXECUTION.md) — Security validation that generates errors fed to this system
- [AGENT-SECURITY-NETWORK-AND-INJECTION.md](AGENT-SECURITY-NETWORK-AND-INJECTION.md) — SSRF protection reused for HTTP hooks
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Permission system that hooks extend
- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Tool pipeline where hooks and errors integrate
- [AGENT-COORDINATION-PATTERNS.md](AGENT-COORDINATION-PATTERNS.md) — Worker failure recovery uses these error patterns
