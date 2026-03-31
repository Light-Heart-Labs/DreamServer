# Agent Permission System Design

Best practices for building permission systems that let autonomous AI agents be useful while preventing unauthorized actions. Derived from production analysis of agentic systems managing millions of tool executions with zero known permission bypasses.

*Last updated: 2026-03-31*

---

## Why This Matters

An AI agent without a permission system is a liability. An agent with a bad permission system is worse — it gives a false sense of security. The challenge: permissions must be granular enough to be meaningful, flexible enough to be usable, and fast enough to not slow down every action.

This document covers the declarative rule-based permission model used in production agentic systems, including the full decision pipeline, mode system, denial tracking, and filesystem protection.

---

## 1. The Declarative Rule Model

### Why Declarative, Not Imperative

**Imperative approach (don't do this):**
```
if tool == "bash" and command.startswith("rm"):
    deny()
elif tool == "bash" and command.startswith("git push"):
    ask_user()
```

**Problems:** Hard to audit, hard for users to customize, hard to extend, scales poorly.

**Declarative approach (do this):**
```yaml
always_allow:
  - "bash(grep:*)"
  - "bash(git status)"
  - "bash(git diff)"
  - "file_read(*)"

always_deny:
  - "bash(rm -rf *)"
  - "bash(sudo *)"

always_ask:
  - "bash(git push *)"
  - "file_write(*.env)"
```

**Benefits:** Users can read and modify rules without code changes. Rules are auditable. New tools get permission coverage automatically via wildcards.

### Rule Structure

Each rule has two parts:

| Component | Format | Example |
|-----------|--------|---------|
| **Tool name** | String or wildcard | `bash`, `file_write`, `*` |
| **Rule content** (optional) | String with wildcards | `grep:*`, `git push *`, `*.env` |

Combined format: `tool_name(rule_content)` or just `tool_name`

### Rule Evaluation Order

Rules are evaluated in priority order. First match wins:

```
1. always_deny rules     (highest priority — safety first)
2. always_ask rules      (require user confirmation)
3. always_allow rules    (auto-approve)
4. default behavior      (depends on permission mode)
```

**Key Insight:** Deny rules take priority over allow rules. This is critical — a misconfigured allow rule can't override a safety-critical deny rule.

### Rule Sources (Priority Order)

Rules can come from multiple sources, evaluated in priority:

| Source | Priority | Who Controls | Example |
|--------|----------|-------------|---------|
| Organization policy | Highest | Admin/IT | Enterprise security requirements |
| Project settings | High | Project config | Repo-specific rules |
| User settings | Medium | Individual user | Personal preferences |
| Session overrides | Low | Current session | Temporary one-time allows |
| Tool defaults | Lowest | Tool author | Built-in safety rules |

Higher-priority sources override lower ones. Organization policies can't be overridden by user settings.

---

## 2. Permission Modes

Agents operate in different modes depending on the context. Each mode changes the default behavior when no rule matches:

| Mode | Default Behavior | Use Case |
|------|-----------------|----------|
| **Default** | Ask user for unmatched tool calls | Normal interactive use |
| **Plan** | Read-only — deny all writes | Planning/exploration phase |
| **Accept Edits** | Auto-accept file modifications | Trusted editing session |
| **Auto** | Classifier decides | Fully automated pipelines |
| **Don't Ask** | Auto-deny controversial actions | Headless/non-interactive mode |
| **Bypass** | Allow everything | Dangerous — feature-gated, internal only |

### Mode Transitions

```
Session Start -> Default mode
User enters plan command -> Plan mode
User approves plan -> Accept Edits mode (or Default)
User enables auto mode -> Auto mode
Session ends -> Modes reset
```

**Safety constraint:** Bypass mode should be gated behind feature flags or internal-only access. Never expose it to end users.

### Plan Mode (Read-Only)

In plan mode, the agent can:
- Read files
- Search code
- List directories
- Run read-only shell commands (grep, find, ls, cat, etc.)

The agent cannot:
- Write or modify files
- Run write shell commands
- Make network requests that modify state
- Execute tools marked as write operations

**Implementation:** Maintain a classification of each tool as read/write. In plan mode, deny all write-classified tools regardless of other rules.

---

## 3. Permission Decision Pipeline

For every tool execution, run this pipeline:

```
Tool call received
  |
  v
[1] Check organization policy limits
  -> If policy denies: DENY (not overridable)
  |
  v
[2] Check always_deny rules
  -> If match: DENY
  |
  v
[3] Check permission mode constraints
  -> If plan mode and tool is write: DENY
  |
  v
[4] Check always_ask rules
  -> If match: PROMPT USER
  |
  v
[5] Check always_allow rules
  -> If match: ALLOW
  |
  v
[6] Check session allowlist
  -> If previously approved this session: ALLOW
  |
  v
[7] Apply default mode behavior
  -> Default: PROMPT USER
  -> Auto: RUN CLASSIFIER
  -> Don't Ask: DENY
  -> Bypass: ALLOW
  |
  v
[8] Record decision and reason
```

### Decision Transparency

Every permission decision should include a **reason** for debugging and auditing:

| Decision | Reason Example |
|----------|---------------|
| ALLOW | `matched allow rule: bash(git status)` |
| DENY | `organization policy: no sudo` |
| ASK | `matched ask rule: bash(git push *)` |
| ALLOW | `session allowlist: user approved file_write at 14:32` |
| ASK | `default mode: no matching rule` |

**Key Insight:** Users should always be able to understand why an action was allowed or denied. This builds trust and helps debug permission issues.

---

## 4. Rule Matching

### Wildcard Matching

Support simple wildcard patterns (not full regex — regex is too powerful and error-prone for permission rules):

| Pattern | Matches | Doesn't Match |
|---------|---------|--------------|
| `bash(git *)` | `git status`, `git push`, `git log` | `grep git` |
| `bash(*)` | Any bash command | File write operations |
| `file_write(*.md)` | `README.md`, `docs/guide.md` | `config.json` |
| `*` | Everything | (nothing excluded) |

### Command Decomposition for Matching

When matching shell commands against rules, decompose first:

```
Input: "cd /project && git push origin main"
Decomposed: ["cd /project", "git push origin main"]
Match against: each segment independently
```

A rule like `bash(git push *)` should match the second segment even though it's chained.

### Prefix Matching

Support prefix patterns for command families:

| Rule | Matches |
|------|---------|
| `bash(git:*)` | All git subcommands |
| `bash(npm:*)` | All npm subcommands |
| `bash(docker:*)` | All docker subcommands |

---

## 5. Denial Tracking and Classifier Fallback

When using an automated classifier (auto mode), track denials to prevent classifier abuse:

### The Problem

A malfunctioning or adversarial classifier could deny everything, making the agent useless. Or it could approve everything, making it dangerous.

### Denial Tracking State

```
consecutive_denials: 0      (resets on any approval)
total_denials: 0            (session lifetime counter)
max_consecutive: 3          (threshold for fallback)
max_total: 20               (threshold for fallback)
```

### Fallback Behavior

```
If consecutive_denials > 3:
  -> Fall back to user prompting (bypass classifier)
  -> Log: "Classifier denied 3+ consecutive actions, falling back to user"

If total_denials > 20:
  -> Fall back to user prompting for remainder of session
  -> Log: "Classifier denied 20+ total actions, falling back to user"

On any approval:
  -> Reset consecutive_denials to 0
  -> Do NOT reset total_denials
```

**Why this matters:** Without fallback, a buggy classifier can completely block the agent. With fallback, the user always has the final say.

---

## 6. Filesystem Permission Protection

### Dangerous Files

These files should be protected with always_ask or always_deny rules by default:

| File Pattern | Risk | Default Rule |
|-------------|------|-------------|
| `.gitconfig` | Git behavior modification | always_ask |
| `.gitmodules` | Submodule injection | always_ask |
| `.bashrc`, `.bash_profile` | Code execution on shell start | always_deny |
| `.zshrc`, `.zprofile` | Code execution on shell start | always_deny |
| `.profile` | Code execution on login | always_deny |
| `.env`, `.env.*` | Credential exposure | always_ask |
| `.ssh/*` | Key exposure/modification | always_deny |
| `*.pem`, `*.key` | Certificate/key files | always_deny |

### Dangerous Directories

| Directory | Risk | Default Rule |
|-----------|------|-------------|
| `.git/` | Repository integrity | always_ask for writes |
| `.vscode/`, `.idea/` | IDE config — can execute extensions | always_ask |
| `.agent/` | Agent config — can modify agent behavior | always_ask |
| `node_modules/` | Supply chain attack vector | always_deny for writes |

### Path Validation Pipeline

Before checking permission rules, validate the path:

```
1. Reject null bytes (\0)
2. Resolve symlinks (realpath)
3. Normalize Unicode (NFC)
4. Check against dangerous files/directories
5. Verify within allowed working directory
6. Apply permission rules
```

### Case Sensitivity

On case-insensitive filesystems (Windows, macOS default), normalize case before comparing:

```
.Env, .ENV, .env -> all match the ".env" protection rule
```

---

## 7. Session Allowlist

When a user approves an action, optionally add it to a session-scoped allowlist to avoid re-prompting:

### How It Works

```
Agent: "Can I write to src/main.ts?"
User: "Yes, allow all writes to src/"
-> Add to session allowlist: file_write(src/*)
-> Future writes to src/ auto-approved for this session only
```

### Session Scope Rules

- Allowlist entries expire when the session ends
- Allowlist entries can't override organization policies
- Allowlist entries can't override always_deny rules
- Users can revoke allowlist entries mid-session

### Granularity Levels

| Level | Example | Scope |
|-------|---------|-------|
| Exact match | `file_write(src/main.ts)` | Single file |
| Directory | `file_write(src/*)` | All files in directory |
| Tool-wide | `file_write(*)` | All file writes |
| Universal | `*(*)` | Everything (dangerous, discourage) |

---

## 8. Hook Integration

Permission decisions can be influenced by hooks — user-defined code that runs at lifecycle points:

### Pre-Tool-Use Hook

Runs before the permission check. Can:
- **Block** the action (return error)
- **Modify** the action (change parameters)
- **Pass through** (no opinion)

### Post-Tool-Use Hook

Runs after tool execution. Can:
- **Log** the action and result
- **Alert** on suspicious patterns
- **Trigger** follow-up actions

### Hook Priority

```
Hook says BLOCK -> Action denied (regardless of permission rules)
Hook says PASS -> Normal permission pipeline continues
Hook says MODIFY -> Modified action enters permission pipeline
```

**Key Insight:** Hooks provide an escape hatch for custom security logic that doesn't fit the rule model. But hooks themselves need permission — don't let agents modify their own hooks.

---

## 9. Implementation Checklist

### Minimum Viable Permission System

- [ ] Rule-based allow/deny/ask model
- [ ] At least two modes: default (interactive) and plan (read-only)
- [ ] Dangerous file protection (`.env`, `.bashrc`, `.ssh/`)
- [ ] Path validation (null bytes, traversal, symlinks)
- [ ] Decision logging with reasons
- [ ] Session-scoped allowlist

### Production-Grade Permission System

- [ ] All of the above, plus:
- [ ] Multiple rule sources with priority (org > project > user > session)
- [ ] Wildcard and prefix matching
- [ ] Command decomposition for shell rules
- [ ] Auto mode with classifier and denial tracking
- [ ] Fallback from classifier to user prompting
- [ ] Case-insensitive matching on case-insensitive filesystems
- [ ] Unicode normalization on paths
- [ ] Pre/post hooks with block/modify/pass semantics
- [ ] Organization policy limits (non-overridable)
- [ ] Audit trail of all permission decisions

---

## Related Documents

- [AGENT-SECURITY-COMMAND-EXECUTION.md](AGENT-SECURITY-COMMAND-EXECUTION.md) — Command security that feeds into permission checks
- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Tool system where permissions are enforced
- [AGENT-ERROR-HANDLING-AND-HOOKS.md](AGENT-ERROR-HANDLING-AND-HOOKS.md) — Hook framework that extends permissions
