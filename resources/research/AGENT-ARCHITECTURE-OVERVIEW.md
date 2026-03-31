# Agent Architecture Overview

The master blueprint — how 30 subsystems connect into a production agentic coding tool. This document is the map that makes every other document navigable. It shows the layers, the dependencies, the message flows, the error boundaries, and walks through complete end-to-end scenarios that touch every system.

*Last updated: 2026-03-31*

---

## 1. System Map

The architecture has 7 layers. Each layer depends on layers below it.

```
┌─────────────────────────────────────────────────────────────┐
│                    7. THE ENGINE                            │
│  Query Loop · Streaming Tool Execution · SDK Bridge ·      │
│  Initialization & Wiring                                    │
├─────────────────────────────────────────────────────────────┤
│                    6. PRODUCT LAYER                         │
│  Memory · Compaction · Background Tasks · Remote/Team ·    │
│  Enterprise/Policy · Message Pipeline · Media · Lifecycle   │
├─────────────────────────────────────────────────────────────┤
│                    5. OPERATIONS                            │
│  Worktree Isolation · Feature Delivery                      │
├─────────────────────────────────────────────────────────────┤
│                    4. RENDERING & EDITING                   │
│  Terminal UI · Diff/File Editing · IDE/LSP Integration      │
├─────────────────────────────────────────────────────────────┤
│                    3. CORE INFRASTRUCTURE                   │
│  System Prompts · Context Management · LLM API ·           │
│  Bootstrap/Config · Auth/Sessions · Speculation/Caching     │
├─────────────────────────────────────────────────────────────┤
│                    2. ARCHITECTURE                          │
│  Permissions · Tool System · Coordination · Error/Hooks     │
├─────────────────────────────────────────────────────────────┤
│                    1. SECURITY                              │
│  Command Execution Security · Network/Injection Defense     │
└─────────────────────────────────────────────────────────────┘
```

### All 30 Documents by Layer

| # | Layer | Document | One-Line Purpose |
|---|-------|----------|-----------------|
| 1 | Security | AGENT-SECURITY-COMMAND-EXECUTION | Multi-layer shell injection prevention |
| 2 | Security | AGENT-SECURITY-NETWORK-AND-INJECTION | SSRF, DNS rebinding, Unicode attack defense |
| 3 | Architecture | AGENT-PERMISSION-SYSTEM-DESIGN | Declarative rule-based permission enforcement |
| 4 | Architecture | AGENT-TOOL-ARCHITECTURE | Unified tool interface, MCP, plugins, skills |
| 5 | Architecture | AGENT-COORDINATION-PATTERNS | Multi-agent coordinator/worker orchestration |
| 6 | Architecture | AGENT-ERROR-HANDLING-AND-HOOKS | Error classification and event-driven hooks |
| 7 | Core | AGENT-SYSTEM-PROMPT-ENGINEERING | Section-based prompt assembly and caching |
| 8 | Core | AGENT-CONTEXT-AND-CONVERSATION | Token budgeting and conversation management |
| 9 | Core | AGENT-LLM-API-INTEGRATION | Streaming, retry, model selection, cost tracking |
| 10 | Core | AGENT-BOOTSTRAP-AND-CONFIGURATION | Startup sequence and multi-source config |
| 11 | Core | AGENT-AUTH-AND-SESSION-MANAGEMENT | OAuth, tokens, keychain, session persistence |
| 12 | Core | AGENT-SPECULATION-AND-CACHING | Optimistic execution and multi-layer caching |
| 13 | Rendering | AGENT-TERMINAL-UI-ARCHITECTURE | React reconciler for terminal with double buffering |
| 14 | Rendering | AGENT-DIFF-AND-FILE-EDITING | Patch generation, encoding, change attribution |
| 15 | Rendering | AGENT-IDE-AND-LSP-INTEGRATION | Language server diagnostics and code intelligence |
| 16 | Operations | AGENT-WORKTREE-AND-ISOLATION | Git worktrees for parallel agent execution |
| 17 | Operations | AGENT-FEATURE-DELIVERY | Auto-update, kill switch, subscription tiers |
| 18 | Product | AGENT-MEMORY-AND-CONSOLIDATION | Persistent memory with auto-dream consolidation |
| 19 | Product | AGENT-CONTEXT-COMPACTION-ADVANCED | Multi-stage context compaction pipeline |
| 20 | Product | AGENT-TASK-AND-BACKGROUND-EXECUTION | Forked agent pattern and 7 task types |
| 21 | Product | AGENT-REMOTE-AND-TEAM-COLLABORATION | WebSocket sessions, teammates, teleportation |
| 22 | Product | AGENT-ENTERPRISE-AND-POLICY | Managed settings, policy limits, fail-open/closed |
| 23 | Product | AGENT-MESSAGE-PIPELINE | Message types, command queue, collapsing |
| 24 | Product | AGENT-MEDIA-AND-ATTACHMENTS | Images, PDFs, clipboard, ANSI rendering |
| 25 | Product | AGENT-LIFECYCLE-AND-PROCESS | Graceful shutdown, crash recovery, concurrency |
| 26 | Engine | AGENT-QUERY-LOOP-AND-STATE-MACHINE | The main loop with 11 recovery transitions |
| 27 | Engine | AGENT-STREAMING-TOOL-EXECUTION | Concurrent tool execution with batching |
| 28 | Engine | AGENT-SDK-BRIDGE | Message translation and permission routing |
| 29 | Engine | AGENT-INITIALIZATION-AND-WIRING | 6-stage bootstrap connecting all systems |
| 30 | Meta | AGENT-BUILD-AND-DEPENDENCIES | Technology stack, project structure, packaging |

---

## 2. Component Dependency Graph

### Initialization Order (Bottom-Up)

```
Phase 0: Platform detection, CLI argument parsing
  ↓
Phase 1: Configuration (depends on: nothing)
  → Config system, schema validation, MDM/enterprise settings
  ↓
Phase 2: Authentication (depends on: config)
  → API keys, OAuth tokens, keychain access
  ↓
Phase 3: Permissions (depends on: config)
  → Permission rules, dangerous file lists
  ↓
Phase 4: Tools (depends on: config, permissions)
  → Built-in tools, plugin loading, skill discovery, MCP server connections
  ↓
Phase 5: System Prompt (depends on: everything above)
  → Section assembly, project memory injection, tool definitions
  ↓
Phase 6: Session (depends on: everything above)
  → Load or create session, restore history, crash recovery
  ↓
Phase 7: Query Loop (depends on: everything above)
  → Accept user input, call model, execute tools, manage context
```

### Runtime Dependencies Between Systems

```
Query Loop (26) ──→ LLM API (9) ──→ Auth (11)
     │                                   │
     ├──→ Streaming Tool Exec (27) ──→ Tool Architecture (4)
     │         │                              │
     │         ├──→ Permissions (3)           ├──→ Security (1, 2)
     │         └──→ Error/Hooks (6)          └──→ MCP (in 4)
     │
     ├──→ Context Management (8) ──→ Compaction (19)
     │                                   │
     │                                   └──→ Background Tasks (20) ──→ Forked Agent
     │
     ├──→ Message Pipeline (23) ──→ SDK Bridge (28)
     │                                   │
     │                                   └──→ Remote/Team (21)
     │
     ├──→ System Prompt (7) ──→ Memory (18)
     │
     ├──→ Media (24) ──→ Terminal UI (13)
     │
     └──→ Lifecycle (25) ──→ Cleanup Registry
```

---

## 3. Complete Turn Walkthrough

**Scenario:** User types `"read src/main.ts and fix the type error on line 42"`

### Step 1: Input Capture
**Systems:** Message Pipeline (23), Terminal UI (13)

```
User keystroke → Terminal input parser
  → Command queue enqueues with priority "next"
  → REPL component dequeues command
  → Creates UserMessage with uuid, timestamp, content
```

### Step 2: Pre-Call Checks
**Systems:** Context Management (8), Compaction (19), Message Pipeline (23)

```
Check blocking limit → if over hard cap, return "blocking_limit"
Check auto-compact threshold → if over, run compaction
Normalize messages for API:
  → Filter virtual messages
  → Apply tool result budget (persist oversized results to disk)
  → Strip problematic media from previous error
  → Merge consecutive user messages (provider compatibility)
```

### Step 3: Prefetch Initiation
**Systems:** Memory (18), Tool Architecture (4, skills)

```
Start memory prefetch (async) → scan memory files for relevance to "type error"
Start skill discovery prefetch (async, feature-gated)
Both run concurrently with model call
```

### Step 4: Model Call (Streaming)
**Systems:** Query Loop (26), LLM API (9), Streaming Tool Execution (27)

```
Build API request:
  → System prompt (cached sections + uncached volatile sections)
  → Conversation history (all messages)
  → Tool definitions (all available tools with schemas)
  → Model selection, temperature, max tokens

Stream response:
  → Yield StreamEvents to Terminal UI (tokens appear for user)
  → StreamingToolExecutor detects tool_use blocks as they arrive
  → If tool is concurrency-safe (e.g., file_read): start execution immediately
  → Model continues streaming while tool executes
```

### Step 5: Tool Execution
**Systems:** Streaming Tool Execution (27), Tool Architecture (4), Permissions (3), Security (1), Error/Hooks (6)

```
Model finishes streaming with tool_use blocks:
  [file_read(path="src/main.ts"), file_edit(path="src/main.ts", old="...", new="...")]

Partition into batches:
  Batch 0 (concurrent): [file_read] — read-only, safe to run
  Batch 1 (sequential): [file_edit] — writes, must run alone

For each tool call:
  Schema validate input (Zod) → Security check (path validation) →
  Permission check (declarative rules) → Pre-hooks (if registered) →
  Execute tool → Post-hooks → Return result

file_read: reads file, returns content (up to size limit)
file_edit: validates old_string unique, applies replacement, generates diff

LSP diagnostics check: after file edit, check for new errors from language server
```

### Step 6: Post-Tool Processing
**Systems:** Error/Hooks (6), Memory (18), Tool Architecture (4, skills)

```
Run stop hooks → may inject blocking error messages
  If blocking: add to history, continue query loop (recovery transition)
  If clean: proceed

Collect attachments:
  → Drain queued commands (user typed while agent worked)
  → Collect memory prefetch results (if settled)
  → Collect skill discovery results (if settled)
  → Collect LSP diagnostics (if any new errors)
```

### Step 7: State Update and Loop Decision
**Systems:** Query Loop (26)

```
Roll tool results into messages:
  state.messages = [...messages, ...assistantMessages, ...toolResults, ...attachments]

Check needsFollowUp:
  → Scan assistant message content for tool_use blocks
  → If found: needsFollowUp = true → continue loop (next iteration)
  → If not found: needsFollowUp = false → return "completed"
```

### Step 8: Next Iteration (if continuing)

Same flow from Step 2. Model sees previous tool results and can respond with text or more tool calls. Typically: model reads file (iteration 1), edits file (iteration 2), verifies fix (iteration 3), responds to user (iteration 4, no tools, loop exits).

### Step 9: Post-Turn Background Work
**Systems:** Memory (18), Task/Background (20), Lifecycle (25)

```
Fire-and-forget:
  → Extract memories from this conversation (forked agent, max 5 turns)
  → Check auto-dream gates (time + session count)
  → If gates pass: run background consolidation (forked agent)

Session persistence:
  → Checkpoint conversation to disk
  → Update session metadata (token usage, cost)
```

---

## 4. Error Boundary Specification

### Where Errors Are Caught

```
┌────────────────────────────────────────────────────────────────────┐
│ REPL / UI Layer                                                    │
│   Catches: uncaught exceptions from query loop                     │
│   Action: display error, offer retry or exit                       │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Query Loop (doc 26)                                          │  │
│  │   Catches: API errors, streaming errors                      │  │
│  │   Action: recovery transitions (11 paths) or terminal exit    │  │
│  │                                                              │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │ Tool Execution (doc 27)                                │  │  │
│  │  │   Catches: per-tool errors                             │  │  │
│  │  │   Action: return is_error=true result, don't crash     │  │  │
│  │  │   Bash cascade: abort siblings on bash failure         │  │  │
│  │  │                                                        │  │  │
│  │  │  ┌──────────────────────────────────────────────────┐  │  │  │
│  │  │  │ Individual Tool                                  │  │  │  │
│  │  │  │   Catches: tool-specific errors                  │  │  │  │
│  │  │  │   Action: format error message for model         │  │  │  │
│  │  │  └──────────────────────────────────────────────────┘  │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### Error Type → Response Mapping

| Error Type | Caught At | Response | Recoverable? |
|-----------|-----------|----------|-------------|
| Tool execution error | Tool executor | Return is_error result to model | Yes — model sees error, can retry |
| Bash command failure | BashTool | ShellError with stdout/stderr/exitCode | Yes — model analyzes output |
| Permission denied | Permission system | Denial message to model | Yes — model can change approach |
| File not found (ENOENT) | Tool | Error message with path | Yes — model tries different path |
| API rate limit (429) | LLM API layer | Retry with backoff (Retry-After) | Yes — automatic retry |
| API server error (500) | LLM API layer | Retry with exponential backoff | Yes — automatic retry |
| API prompt too long | Query loop | Recovery: collapse → compact → reactive | Yes — if compaction succeeds |
| API max output tokens | Query loop | Recovery: escalate → nudge (3x max) | Yes — model adjusts output |
| Streaming disconnect | Query loop | Recovery: fallback model retry | Sometimes |
| User abort (Ctrl+C) | AbortController | Clean exit, no error reported | N/A — intentional |
| Uncaught exception | REPL | Log, display error, graceful shutdown | No — session ends |
| Fatal startup error | Bootstrap | Preflight check failure, exit | No — must fix environment |

### Abort Detection (3 Forms)

The system must detect user cancellation from three sources:

```
1. Custom AbortError class → instanceof check
2. DOM AbortSignal → error.name === 'AbortError'
3. SDK abort → instanceof APIUserAbortError
```

All three must be checked to prevent false error reporting on intentional cancellation.

---

## 5. Message Type Flow Diagram

```
User types input
  → UserMessage ─────────────────────→ Query Loop
                                            │
                                            ↓
                                       LLM API call
                                            │
                                            ↓
  StreamEvent ←─────────── (streaming) ── API Response
                                            │
                                            ↓
                                     AssistantMessage
                                       (contains tool_use blocks)
                                            │
                                            ↓
                                     Tool Execution
                                            │
                                            ↓
  UserMessage (tool_result) ←──── Tool Results
  AttachmentMessage ←──────────── File/Memory Attachments
  SystemMessage ←──────────────── Errors, Warnings, Compact Boundaries
  ProgressMessage ←────────────── Tool Progress Updates (ephemeral)
  ToolUseSummaryMessage ←──────── Tool Use Summaries

                    ALL roll back into → Query Loop (next iteration)
```

### Bridge Translation (when active)

```
Internal Messages ──→ SDK Bridge ──→ SDKMessages (wire format)
  UserMessage      →   SDKUserMessage
  AssistantMessage →   SDKAssistantMessage
  SystemMessage    →   SDKSystemMessage
  (others filtered — tool results, progress, attachments are internal only)
```

---

## 6. Additional End-to-End Scenarios

### Scenario: Multi-Turn Refactor with Compaction

```
Turn 1-10: User asks to refactor auth module. Agent reads 20 files, edits 8.
Turn 11: Context hits auto-compact threshold (effective window - 13K)
  → Microcompact fires: old tool results cleared (preserving structure)
  → If still over: full compact via forked summarizer agent
  → CompactBoundaryMessage inserted
  → Top 5 files re-injected (50K budget)
  → Session-start hooks re-executed
Turn 12-40: Agent continues with compressed context
Turn 41: Another compaction cycle (recompaction tracking increases summary detail)
Turn 50: User satisfied. Agent returns "completed."
Post-turn: Memory extraction saves learnings about the auth module
```

### Scenario: Remote Session with Permission Routing

```
User connects via SDK client (mobile device)
  → SDK Bridge activates (WebSocket + HTTP hybrid)
  → User sends: "deploy to production"
  → Bridge forwards to REPL subprocess via stdin

Agent executes, needs to run: sudo systemctl restart app
  → Permission system: always_ask for sudo commands
  → Agent sends control_request via stdout NDJSON
  → Bridge captures, forwards to SDK client via WebSocket
  → SDK client shows permission dialog on user's phone
  → User approves → control_response flows back
  → Bridge forwards to REPL → tool execution continues

Agent completes deployment
  → AssistantMessage flows: REPL → stdout → Bridge → WebSocket → SDK client
  → User sees result on phone
```

### Scenario: Background Memory Consolidation

```
Agent finishes responding. User is idle for 30 seconds.

Auto-dream service checks gates:
  1. Enabled? Yes (settings)
  2. Time gate: 26 hours since last consolidation > 24h minimum → pass
  3. Scan throttle: 12 minutes since last scan > 10 min → pass
  4. Session gate: 7 sessions since last consolidation > 5 minimum → pass
  5. Lock gate: no other process holds lock → acquire (write PID, verify)

Consolidation agent spawns as forked agent:
  → Shares parent's prompt cache (CacheSafeParams match)
  → Reads recent session transcripts
  → Identifies durable learnings
  → Writes to memory files (Edit/Write tools, memory dir only)
  → DreamTask UI shows "Updating memories..." in footer

Completion:
  → Lock file mtime updated (= lastConsolidatedAt)
  → DreamTask status → completed
  → User sees: "Improved 3 memory files"
```

---

## 7. Cross-System Integration Points

These are the critical connections between systems that don't belong to any single document:

| Connection | From → To | What Flows |
|-----------|-----------|-----------|
| Query loop → Tool executor | doc 26 → doc 27 | ToolUseBlock[], returns Message[] |
| Tool executor → Permission system | doc 27 → doc 3 | canUseTool(name, input), returns allow/deny |
| Tool executor → Security | doc 27 → doc 1,2 | validateCommand(input), returns safe/unsafe |
| Tool executor → Hooks | doc 27 → doc 6 | PreToolUse/PostToolUse events |
| Query loop → Compaction | doc 26 → doc 19 | Token count check, triggers compact |
| Query loop → Memory prefetch | doc 26 → doc 18 | startPrefetch(query), returns memories |
| Query loop → Message pipeline | doc 26 → doc 23 | Command queue drain, message normalization |
| Message pipeline → SDK Bridge | doc 23 → doc 28 | Internal → SDK message conversion |
| SDK Bridge → Remote | doc 28 → doc 21 | Control requests for remote permissions |
| Bootstrap → Everything | doc 29 → all | Initialization order, dependency resolution |
| Lifecycle → Everything | doc 25 → all | Cleanup registry, graceful shutdown |
| Enterprise → Permissions | doc 22 → doc 3 | Policy limits restrict available tools |
| Memory extraction → Background tasks | doc 18 → doc 20 | Forked agent for extraction |
| Auto-dream → Background tasks | doc 18 → doc 20 | Forked agent for consolidation |
| LSP → Tool executor | doc 15 → doc 27 | Post-edit diagnostics injection |
| Terminal UI → Query loop | doc 13 → doc 26 | StreamEvent rendering, user input |

---

## 8. Implementation Checklist

### To Build This System From Scratch

- [ ] **Layer 1:** Implement command execution security and SSRF/injection defense (docs 1-2)
- [ ] **Layer 2:** Implement permission system, tool interface, coordination patterns, error/hooks (docs 3-6)
- [ ] **Layer 3:** Implement system prompts, context management, LLM API client, config system, auth, caching (docs 7-12)
- [ ] **Layer 4:** Implement terminal UI, file editing with diff, LSP integration (docs 13-15)
- [ ] **Layer 5:** Implement worktree isolation and feature delivery (docs 16-17)
- [ ] **Layer 6:** Implement memory, compaction, background tasks, remote/team, enterprise, message pipeline, media, lifecycle (docs 18-25)
- [ ] **Layer 7:** Implement query loop, streaming tool execution, SDK bridge, initialization wiring (docs 26-29)
- [ ] **Layer 0:** Set up project with correct dependencies and build config (doc 30)
- [ ] **Integration:** Wire all layers together following the dependency graph in this document
- [ ] **Test:** Verify each end-to-end scenario works
- [ ] **Ship:** Package, distribute, auto-update (doc 17 + doc 30)

---

## Related Documents

Every other document in this collection. This is the map that makes them all navigable.
