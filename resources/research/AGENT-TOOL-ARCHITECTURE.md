# Agent Tool Architecture

Best practices for designing extensible, secure tool systems for autonomous AI agents. Derived from production analysis of agentic systems managing 40+ tools with unified interfaces, validation pipelines, and plugin extensibility.

*Last updated: 2026-03-31*

---

## Why This Matters

Tools are how agents interact with the world — file systems, shell commands, web browsers, APIs, databases. A bad tool architecture leads to duplicated security logic, inconsistent error handling, and tools that can't be extended or composed. A good one makes every tool inherit security, permissions, and observability for free.

This document covers the unified tool interface pattern, the validation pipeline, plugin/extension loading, and MCP (Model Context Protocol) integration as used in production agentic systems.

---

## 1. Unified Tool Interface

### The Problem

Without a standard interface, every tool is a snowflake:
- Bash tool validates commands one way, file tool validates paths another way
- Some tools check permissions, others don't
- Error formats vary across tools
- Adding a new tool means reimplementing security, logging, and permissions

### The Solution: Standard Tool Definition

Every tool — built-in, plugin, or external — implements the same interface:

| Property | Type | Purpose |
|----------|------|---------|
| `name` | string | Unique identifier for the tool |
| `description` | string | Human-readable description (shown to the agent) |
| `inputSchema` | schema object | Typed input validation (e.g., Zod, JSON Schema) |
| `execute` | function | The actual tool logic |
| `isReadOnly` | boolean | Whether this tool modifies state |
| `requiresPermission` | boolean | Whether to run through permission pipeline |
| `progressReporter` | function (optional) | Emit progress updates during execution |

### Factory Pattern for Tool Creation

Use a factory function to ensure every tool gets the standard wrapper:

```
buildTool({
  name: "file_write",
  description: "Write content to a file",
  inputSchema: { path: string, content: string },
  isReadOnly: false,
  execute: (input, context) => { ... }
})
```

The factory adds:
- Input validation via the schema
- Permission checking
- Pre/post hooks
- Error wrapping
- Progress reporting
- Execution timing

**Key Insight:** Tools don't implement security themselves. The framework handles it. This means a new tool written by a plugin author automatically gets the same security as built-in tools.

---

## 2. Tool Execution Context

### The Problem

Tools need access to configuration, permissions, MCP clients, abort controllers, and more. Passing these as function parameters creates massive signatures. Globals create testing nightmares and thread-safety issues.

### The Solution: Context Injection

Pass a single context object that contains everything a tool might need:

| Context Property | What It Provides |
|-----------------|-----------------|
| `appState` | Current application state (read-only reference) |
| `permissionContext` | Permission rules, current mode, allowed directories |
| `abortController` | Signal to cancel long-running operations |
| `mcpClients` | Connected MCP server clients |
| `hooks` | Registered hook definitions |
| `fileCache` | Cached file contents for performance |
| `progressCallback` | Function to emit progress updates |
| `workingDirectory` | Current working directory |
| `sessionId` | Current session identifier |

### Subagent Context Isolation

When spawning child agents, create an isolated context:

```
Parent context:
  appState: full read/write
  setAppState: functional updater

Child context:
  appState: read-only reference to parent's state
  setAppState: no-op (children can't mutate parent state)
  setAppStateForTasks: limited updater for infrastructure tasks only
```

**Why:** Without isolation, child agents can accidentally (or maliciously) corrupt parent state. Read-only references plus no-op setters prevent this while still allowing children to read current state.

---

## 3. Validation Pipeline

Every tool call passes through this pipeline before execution:

```
Tool call received from agent
  |
  v
[1] Schema Validation
  -> Validate input against tool's schema
  -> Reject malformed input with clear error message
  |
  v
[2] Security Validation (tool-specific)
  -> Bash: AST parsing, injection detection, command classification
  -> File: Path validation, dangerous file checks, symlink resolution
  -> Network: URL validation, SSRF checks
  |
  v
[3] Permission Check
  -> Run through permission decision pipeline
  -> DENY: return permission error to agent
  -> ASK: prompt user, wait for response
  -> ALLOW: continue
  |
  v
[4] Pre-Tool-Use Hooks
  -> Execute registered hooks for this tool
  -> Hook can BLOCK (stop execution), MODIFY (change input), or PASS
  |
  v
[5] Execute Tool
  -> Run the tool's execute function with validated input and context
  -> Capture output, errors, timing
  |
  v
[6] Post-Tool-Use Hooks
  -> Execute post-execution hooks
  -> Hooks can log, alert, or trigger follow-up actions
  |
  v
[7] Return Result
  -> Format result consistently (success/error, output, timing)
  -> Update session state if needed
```

### Validation Failure Handling

| Stage | Failure Behavior |
|-------|-----------------|
| Schema validation | Return error message describing what's wrong — agent can retry |
| Security validation | Return security error — agent should not retry the same input |
| Permission denied | Return denial reason — agent can ask differently or inform user |
| Hook blocks | Return hook's error message — agent can adapt |
| Execution error | Return error with context — agent can diagnose and retry |

**Key Insight:** Always return useful error messages. The agent needs to understand *why* something failed to decide what to do next. "Permission denied" is better than a silent failure, and "Permission denied: writing to .env files requires user approval" is better still.

---

## 4. Tool Classification

### Read vs Write Classification

Classify every tool as read-only or write:

| Read-Only Tools | Write Tools |
|----------------|-------------|
| File read | File write / edit |
| Directory listing | File delete |
| Code search (grep, find) | Shell commands (context-dependent) |
| Git status / log / diff | Git commit / push / merge |
| MCP resource read | MCP resource write |
| Web fetch (GET) | Web fetch (POST, PUT, DELETE) |

**For shell commands:** Classification is per-command, not per-tool. `grep` is read-only, `rm` is write. The shell tool must decompose and classify each command.

### Why Classification Matters

1. **Plan mode:** Only read-only tools execute; write tools are blocked
2. **Parallel execution:** Read-only tools can run in parallel safely; write tools may need serialization
3. **Permission defaults:** Write tools default to "ask user"; read-only tools default to "allow"
4. **Audit logging:** Write operations logged more aggressively

---

## 5. Plugin and Extension Loading

### Registry Pattern

Maintain a central plugin registry:

```
PluginRegistry:
  plugins: Map<id, PluginDefinition>

  register(plugin):
    validate manifest
    check availability
    check for conflicts
    store in map

  getEnabled():
    return plugins where:
      isAvailable() == true
      userPreference != disabled
      (userPreference == enabled OR defaultEnabled == true)
```

### Plugin Definition

| Field | Required | Purpose |
|-------|----------|---------|
| `id` | Yes | Unique identifier (e.g., `my-plugin@marketplace`) |
| `name` | Yes | Human-readable name |
| `version` | Yes | Semver version |
| `description` | Yes | What the plugin does |
| `isAvailable()` | Yes | Runtime check (platform, dependencies, feature flags) |
| `defaultEnabled` | Yes | Whether enabled by default |
| `tools` | No | Tools this plugin provides |
| `hooks` | No | Hooks this plugin registers |
| `skills` | No | Skills/commands this plugin adds |

### Availability Checks

Plugins should declare their requirements and check them at load time:

```
isAvailable():
  if requires_gpu and not gpu_detected: return false
  if requires_platform("linux") and platform != "linux": return false
  if requires_feature("beta") and not feature_enabled("beta"): return false
  return true
```

### User Preference Override

Users can override the default enabled state:

```
Effective state = user_preference ?? plugin_default ?? true

user_preference: "enabled" | "disabled" | undefined
plugin_default: true | false
fallback: true (permissive — unknown plugins enabled by default)
```

### Plugin Security Considerations

| Risk | Mitigation |
|------|-----------|
| Malicious plugin code | Marketplace allowlist — only load from approved sources |
| Plugin conflicts | ID-based deduplication, version comparison |
| Dependency issues | Availability checks before loading |
| Permission escalation | Plugin tools go through same permission pipeline as built-in tools |
| Stale plugins | Version checking against marketplace |

---

## 6. MCP (Model Context Protocol) Integration

### What Is MCP

MCP is a standard protocol for connecting AI agents to external tool servers. Instead of hardcoding integrations, an agent connects to MCP servers that expose tools, resources, and prompts via a standard API.

### Transport Abstraction

Support multiple transport mechanisms under a unified client:

| Transport | When to Use | Characteristics |
|-----------|-------------|----------------|
| Stdio | Local subprocess servers | Lowest latency, simplest setup |
| Server-Sent Events (SSE) | Remote servers, one-way streaming | Good for long-running operations |
| HTTP (streamable) | Remote servers, request-response | Standard web infrastructure |
| WebSocket | Real-time bidirectional | Persistent connections, lower overhead for frequent calls |
| In-process | Same-runtime extensions | Zero serialization overhead |

### MCP Tool Wrapping

External MCP tools should be wrapped into the same unified interface as built-in tools:

```
MCP server exposes: { name: "search_docs", inputSchema: {...} }

Agent sees: same interface as any other tool
  -> Same permission pipeline
  -> Same validation
  -> Same hook integration
  -> Same error handling
```

**Key Insight:** The agent shouldn't know or care whether a tool is built-in or comes from an MCP server. The abstraction layer handles protocol differences.

### MCP Authentication

| Pattern | When | Implementation |
|---------|------|---------------|
| No auth | Trusted local servers | Direct connection |
| API key | Simple remote servers | Key in transport config |
| OAuth | Third-party services | Auth provider intercepts 401, triggers OAuth flow |
| Token refresh | Long-running sessions | Monitor expiry, refresh before deadline |

### MCP Elicitation

When an MCP server needs user input mid-operation (e.g., "Which database?"), use the elicitation pattern:

```
Server sends elicitation request (special error code)
  -> Agent routes to user interface
  -> User provides input
  -> Agent sends response back to server
  -> Server continues operation
```

This prevents blocking and keeps the user in control of interactive decisions.

### Resource Access

MCP servers can expose resources (files, database entries, etc.) in addition to tools:

```
list_resources() -> [{ uri, name, mimeType }]
read_resource(uri) -> content
```

Expose these as tools in the agent's tool set:
- `list_mcp_resources` — Browse available resources
- `read_mcp_resource` — Read a specific resource by URI

---

## 7. Progress Reporting

### Why It Matters

Long-running tools (large file writes, complex shell commands, API calls) need to report progress so:
- Users see activity (not a frozen screen)
- The system can detect stalls
- Timeouts can be context-aware

### Progress Model

```
ToolProgress:
  toolCallId: string
  status: "running" | "completing" | "error"
  message: string (optional, human-readable)
  percentComplete: number (optional, 0-100)
```

### Implementation Pattern

```
execute(input, context):
  context.reportProgress({ status: "running", message: "Parsing input..." })

  // ... do work ...

  context.reportProgress({ status: "running", message: "Writing file...", percent: 50 })

  // ... more work ...

  context.reportProgress({ status: "completing", message: "Verifying..." })

  return result
```

### Timeout Management

| Tool Type | Default Timeout | Rationale |
|-----------|----------------|-----------|
| File read | 10s | Should be fast |
| File write | 30s | Large files take time |
| Shell command | 120s | Builds can be slow |
| MCP tool call | 60s | Network latency + server processing |
| Web fetch | 30s | Network dependent |

Allow tools to extend their timeout by reporting progress — a tool that's actively reporting progress isn't stalled.

---

## 8. Skills System

### What Skills Are

Skills are reusable, parameterized agent behaviors — essentially saved prompts with metadata. They bridge the gap between one-off conversations and permanent tool implementations.

### Skill Sources

| Source | Location | Who Creates |
|--------|----------|------------|
| Project skills | `.agent/skills/<name>/SKILL.md` | Developer (committed to repo) |
| User skills | `~/.agent/skills/<name>/SKILL.md` | Individual user |
| Plugin skills | Plugin directory | Plugin author |
| Managed skills | Enterprise config | IT admin |
| Bundled skills | Built into the agent | Agent developers |
| MCP skills | External MCP servers | MCP server author |

### Skill Definition (SKILL.md)

```markdown
---
name: "Review PR"
description: "Reviews a pull request for code quality and security issues"
whenToUse: "When the user asks to review a PR or mentions code review"
effort: 3
---

Review the specified pull request:
1. Read all changed files
2. Check for security issues, bugs, and style violations
3. Provide actionable feedback organized by severity
```

### Skill Loading

```
loadSkills(directories):
  skills = []

  for dir in directories:
    // Recursive scan with gitignore support
    files = recursiveScan(dir, pattern: "**/SKILL.md", respectGitignore: true)

    for file in files:
      // Lazy loading: read frontmatter only (not full body)
      frontmatter = readFrontmatter(file, maxLines: 30)

      skills.push({
        name: frontmatter.name,
        description: frontmatter.description,
        whenToUse: frontmatter.whenToUse,
        effort: frontmatter.effort,
        path: file,
        source: detectSource(dir),
        estimatedTokens: estimateTokens(frontmatter)
      })

  return skills
```

**Lazy loading:** Only frontmatter is read upfront. The full skill body is loaded when the skill is actually invoked. This keeps startup fast even with hundreds of skills.

### Token Estimation

Skills compete for context budget. Estimate tokens from frontmatter to make inclusion decisions:

```
shouldIncludeSkillInPrompt(skill, availableBudget):
  if skill.estimatedTokens > availableBudget:
    return false
  if skill.whenToUse and not matchesCurrentContext(skill.whenToUse):
    return false
  return true
```

### Skillify: Creating Skills from Sessions

Capture a reusable skill from the current session's work:

```
skillify():
  // 1. Analyze current session
  userMessages = extractUserMessages(conversation)
  agentActions = extractToolCalls(conversation)

  // 2. Multi-round interview
  goal = askUser("What's the high-level goal of this workflow?")
  successCriteria = askUser("How do you know when it's done correctly?")
  scope = askUser("Should this be a project skill or personal skill?")

  // 3. Generate skill definition
  skillMd = generateSkillMarkdown({
    goal, successCriteria,
    steps: extractSteps(agentActions),
    tools: extractToolsUsed(agentActions),
    permissions: extractPermissionsNeeded(agentActions)
  })

  // 4. Save
  path = scope == "project"
    ? ".agent/skills/{name}/SKILL.md"
    : "~/.agent/skills/{name}/SKILL.md"
  writeFile(path, skillMd)
```

---

## 9. Implementation Checklist

### Minimum Viable Tool System

- [ ] Standard tool interface (name, schema, execute)
- [ ] Schema validation on all inputs
- [ ] Permission check before execution
- [ ] Consistent error format
- [ ] Read/write classification
- [ ] Basic progress reporting

### Production-Grade Tool System

- [ ] All of the above, plus:
- [ ] Context injection (not globals)
- [ ] Pre/post execution hooks
- [ ] Plugin registry with availability checks
- [ ] MCP protocol support (at least stdio transport)
- [ ] MCP tool wrapping into unified interface
- [ ] Subagent context isolation
- [ ] User preference override for plugins
- [ ] Marketplace allowlist for plugin sources
- [ ] Timeout management with progress-based extension
- [ ] Execution timing and audit logging
- [ ] Multiple MCP transports (stdio, SSE, HTTP, WebSocket)
- [ ] OAuth flow for authenticated MCP servers
- [ ] Resource access via MCP

---

## Related Documents

- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Permission system integrated at step 3 of the pipeline
- [AGENT-SECURITY-COMMAND-EXECUTION.md](AGENT-SECURITY-COMMAND-EXECUTION.md) — Security validation for shell tools (step 2)
- [AGENT-ERROR-HANDLING-AND-HOOKS.md](AGENT-ERROR-HANDLING-AND-HOOKS.md) — Hook framework and error handling patterns
- [AGENT-COORDINATION-PATTERNS.md](AGENT-COORDINATION-PATTERNS.md) — Multi-agent tool sharing and context isolation
