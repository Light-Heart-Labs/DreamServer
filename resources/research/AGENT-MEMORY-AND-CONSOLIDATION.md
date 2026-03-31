# Agent Memory and Consolidation

Best practices for building persistent memory systems that let autonomous AI agents learn across sessions, extract durable knowledge from conversations, consolidate memories in the background, and synchronize learnings across teams. Derived from production analysis of agentic systems that maintain structured memory directories with type taxonomies, automatic extraction, background consolidation, and team-scale synchronization with secret scanning.

*Last updated: 2026-03-31*

---

## Why This Matters

An agent without memory starts from zero every session. It re-asks the same questions, re-learns the same codebase, and forgets every correction. Memory transforms an agent from a stateless tool into a persistent collaborator that accumulates expertise over time.

Production systems implement multi-layered memory: an index file, typed topic files, automatic extraction from conversations, periodic background consolidation, and team synchronization — all with strict size limits, staleness tracking, and secret scanning.

---

## 1. Memory Directory Structure

### The Index File

A single entry point file (e.g., `MEMORY.md`) serves as the index to all memories:

```
# Agent Memory

- [user_preferences.md](user_preferences.md) — User prefers functional style, TypeScript strict mode
- [project_architecture.md](project_architecture.md) — Monorepo with 3 packages, shared lib pattern
- [feedback_testing.md](feedback_testing.md) — Always run tests before committing, use vitest not jest
```

**Size Limits:**
- Maximum 200 lines OR 25KB, whichever triggers first
- Truncates at last newline boundary (never mid-line)
- Index entries should stay under ~150 characters each
- The index is pointers only — no memory content stored here

### Topic Files

Each memory topic is a separate markdown file with frontmatter:

```markdown
---
name: Testing Preferences
description: Team conventions for testing approach and tooling
type: feedback
---

## Key Points
- Use vitest, not jest (project migrated in Jan 2026)
- Integration tests required for all API endpoints
- Snapshot tests discouraged — prefer explicit assertions

## Why
Previous test suite was brittle due to snapshot overuse.
Team agreed on explicit assertions in Feb 2026 retro.
```

### Directory Location

Resolve the memory directory path with this priority:

```
1. Environment variable override (for SDK/embedded use)
2. Settings file (trusted sources only — policy/local/user, NOT project settings)
3. Default: ~/.agent/projects/<sanitized-project-root>/memory/

Path validation:
  - Must be absolute
  - Must be >= 3 characters
  - Not drive root or UNC root
  - No null bytes
  - Supports ~/ expansion in settings only
```

**Canonical project root:** Use the git root of the main repository (parent of all worktrees) so sibling worktrees share the same memory directory.

**Memoization:** Cache the resolved path keyed on project root to avoid repeated settings file parsing.

---

## 2. Memory Type Taxonomy

### Four Memory Types

| Type | What It Stores | Scope | When to Save |
|------|---------------|-------|-------------|
| **user** | Personal context — role, expertise, preferences, communication style | Always private | When learning about user details |
| **feedback** | Approach guidance — what to avoid, what to repeat, conventions | Private or team | When user corrects or guides the agent's approach |
| **project** | Ongoing work context — deadlines, incidents, coordination, active initiatives | Bias toward team | When tracking work state that persists across sessions |
| **reference** | Pointers to external systems — dashboards, channels, project trackers | Usually team | When user shares links or system references |

### What NOT to Save

| Don't Save | Why |
|-----------|-----|
| Code patterns and architecture | Derivable from the codebase itself |
| Git history and blame | Use git tools to retrieve |
| Debugging recipes | The fix is in the code |
| Ephemeral task details | Current conversation handles this |
| Anything in the project config file | Already persisted elsewhere |
| Current conversation state | Session memory, not long-term memory |

### Frontmatter Structure

```yaml
---
name: "Human-readable title"
description: "One-line summary for index and retrieval"
type: "user | feedback | project | reference"
---
```

### Date Handling

Convert relative dates to absolute dates in memory content:

```
BAD:  "Deadline is next Thursday"
GOOD: "Deadline is 2026-04-03 (Thursday)"
```

Relative dates become meaningless when the memory is read weeks later.

---

## 3. Memory Retrieval

### How the Agent Finds Relevant Memories

When the agent needs context for a task:

```
findRelevantMemories(query):
  // Scan all .md files in memory directory (exclude MEMORY.md index)
  files = listMemoryFiles(memoryDir)  // max 200 files scanned

  // Read frontmatter only (first 30 lines) for each file
  manifest = []
  for file in files:
    header = readFirstLines(file, 30)
    frontmatter = parseFrontmatter(header)
    manifest.append({
      filename: file.name,
      type: frontmatter.type,
      description: frontmatter.description,
      lastModified: file.mtime
    })

  // Call a smaller/faster model to rank relevance
  ranked = callModel("small", {
    prompt: "Given this query: {query}\nRank these memories by relevance:\n{manifest}",
    maxResults: 5
  })

  // Filter out already-surfaced memories (avoid re-picking stale candidates)
  // Filter out tool reference docs if the tool is actively in use (reduce noise)
  return ranked.top(5)
```

### Staleness Tracking

```
memoryAge(file):
  daysElapsed = floor((now() - file.mtimeMs) / 86_400_000)
  if daysElapsed < 0: daysElapsed = 0  // clamp for clock skew

  if daysElapsed == 0: return "today"
  if daysElapsed == 1: return "yesterday"
  return "{daysElapsed} days ago"
```

**Staleness caveat:** Memories older than 1 day get a system reminder:

```
"This memory is a point-in-time snapshot from {age}. Code references
 may be outdated. Verify against current codebase before acting on
 specific file paths or code patterns."
```

---

## 4. Automatic Memory Extraction

### When It Runs

At the end of each complete query loop — when the model finishes responding with no pending tool calls. Fire-and-forget: doesn't block the response to the user.

### Gate Chain (All Must Pass)

```
shouldExtractMemories():
  1. Feature flag enabled
  2. Auto-memory enabled (env var > settings > default true)
  3. Not in remote mode
  4. Main agent only (skip for subagents/workers)
  5. Throttle check: run every N eligible turns (configurable, default 1)
```

### Forked Agent Pattern

Memory extraction runs as a **forked agent** — an isolated agent that shares the parent's prompt cache for efficiency:

```
extractMemories(conversation):
  params = getParentCacheSafeParams()  // share prompt cache

  fork = runForkedAgent({
    cacheSafeParams: params,
    promptMessages: [buildExtractionPrompt(conversation, memoryManifest)],
    canUseTool: restrictToMemoryDirOnly,  // Read/Grep/Glob anywhere, Write only in memory dir
    maxTurns: 5,                          // hard cap
    skipTranscript: true,                 // don't write sidechain transcript
    querySource: "extract_memories"
  })

  // Collect written files from Edit/Write tool_use blocks
  savedFiles = extractWrittenPaths(fork.messages)
  if savedFiles.length > 0:
    notifyUser("Saved {savedFiles.length} memories")
```

### Mutual Exclusion with Main Agent

Both the main agent and the extraction agent can write to the memory directory. Prevent conflicts:

```
beforeExtraction():
  // Check if main agent already wrote to memory since our cursor
  mainAgentWrote = checkForMemoryWritesSinceCursor(conversation, cursor)

  if mainAgentWrote:
    // Main agent already handled it — skip extraction
    advanceCursor(pastMainAgentWrites)
    return SKIP

  // Safe to extract
  runExtraction()
  advanceCursor(pastExtraction)
```

### Coalescing Overlapping Calls

Only one extraction runs at a time:

```
ExtractionState:
  inProgress: boolean
  stashedContext: Context | null  // latest waiting context

  extract(context):
    if inProgress:
      stashedContext = context  // overwrite previous stash
      return  // will run as trailing extraction

    inProgress = true
    try:
      runExtraction(context)
    finally:
      inProgress = false

      // Run trailing extraction with latest stashed context
      if stashedContext:
        trailing = stashedContext
        stashedContext = null
        extract(trailing)  // recursive, but inProgress is false
```

---

## 5. Background Consolidation (Auto-Dream)

### What It Does

Periodically, a background agent reviews recent session transcripts and consolidates learnings into memory files. Think of it as the agent "dreaming" — processing experiences into long-term memory.

### Gate Chain (Cheapest Checks First)

```
shouldConsolidate():
  1. Enabled (settings > feature flag)
  2. Time gate: >= minHours (default 24h) since last consolidation
  3. Scan throttle: don't re-scan if last scan < 10 minutes ago
  4. Session gate: >= minSessions (default 5) touched since last consolidation
  5. Lock gate: acquire PID-based lock file (no concurrent consolidation)
```

### Lock Mechanism

```
ConsolidationLock:
  lockFile: "<memoryDir>/.consolidate-lock"

  acquire():
    // Write our PID to lock file
    write(lockFile, String(process.pid))
    // Re-read to verify (detect race condition)
    contents = read(lockFile)
    if contents != String(process.pid):
      return null  // someone else won the race

    priorMtime = stat(lockFile).mtime  // save for rollback
    return { priorMtime }

  isStale():
    age = now() - stat(lockFile).mtime
    return age > 3600_000  // 1 hour = stale (holder crashed)

  rollback(priorMtime):
    // On failure: restore mtime so next attempt re-checks
    if priorMtime == 0:
      unlink(lockFile)
    else:
      setMtime(lockFile, priorMtime)
```

**Key insight:** The lock file's mtime doubles as `lastConsolidatedAt`. No separate timestamp storage needed.

### Consolidation Agent

```
runConsolidation():
  lock = acquireLock()
  if lock == null: return  // locked by another process

  try:
    // Register DreamTask for UI tracking
    task = registerDreamTask()

    // Build prompt with session list and transcript directory
    prompt = buildConsolidationPrompt(recentSessions, transcriptDir)

    // Run forked agent with memory-dir-only write access
    result = runForkedAgent({
      cacheSafeParams: parentParams,
      promptMessages: [prompt],
      canUseTool: memoryDirWriteOnly,
      querySource: "auto_dream",
      onMessage: (msg) => updateDreamTaskUI(task, msg)
    })

    completeTask(task, result.touchedFiles)

  catch error:
    failTask(task, error)
    lock.rollback()  // restore mtime so we retry next cycle
```

### DreamTask UI Tracking

```
DreamTask:
  phase: "starting" | "updating"
  sessionsReviewing: number
  filesTouched: string[]
  turns: [{ text: string, toolUseCount: number }]

  // Phase flips from "starting" to "updating" on first Edit/Write tool call
  // Displayed in footer as background task pill
  // User can abort via keyboard shortcut → abortController → rollback lock
```

---

## 6. Team Memory Synchronization

### API Contract

```
GET  /api/team_memory?repo={owner/repo}           → all entries with content + hashes
GET  /api/team_memory?repo={owner/repo}&view=hashes → metadata + hashes only (delta detection)
PUT  /api/team_memory?repo={owner/repo}            → upsert entries (server keeps unmentioned keys)
```

### Sync Semantics

| Operation | Behavior |
|-----------|----------|
| **Pull** | Server content overwrites local (server wins per-key) |
| **Push** | Upload only keys whose content hash differs from server (delta) |
| **Upsert** | Server keeps keys not in PUT; deletions don't propagate |
| **Delete** | Deleting local file won't remove from server; next pull restores it |

### Secret Scanning

Before uploading team memory, scan for secrets:

```
SecretScanner:
  rules: 24 high-confidence patterns  // curated subset, not full gitleaks
  // Only rules with distinctive prefixes (near-zero false positives):
  // API keys (sk-ant-, ghp_, AKIA), tokens (xoxb-, xapp-), credentials
  // Generic keyword-context rules OMITTED (too many false positives)

  scan(content):
    matches = []
    for rule in rules:
      if regex(rule.pattern).test(content):
        matches.push({ ruleId: rule.id, label: rule.label })
        // NEVER log the actual matched text
    return matches

  redact(content):
    return content.replaceAll(matchedSecrets, "[REDACTED]")
```

### File Watcher

```
TeamMemoryWatcher:
  debounceMs: 2000  // 2 seconds after last change

  start():
    // Pull first (so pull-writes don't trigger push)
    await pullFromServer()

    // Watch directory recursively
    fs.watch(teamMemoryDir, { recursive: true }, (event, filename) => {
      debouncedPush()
    })

  debouncedPush():
    // Reset timer on each change
    clearTimeout(pushTimer)
    pushTimer = setTimeout(pushToServer, debounceMs)

  // Permanent failure suppression for: no auth, no repo, 4xx errors
  // Clears suppression when user explicitly deletes a file (recovery path)
```

---

## 7. Architectural Patterns

### Closure-Scoped State

Memory extraction and auto-dream use closure-scoped mutable state instead of module-level variables:

```
function createExtractor() {
  let inProgress = false
  let cursor = null
  let stashedContext = null

  return {
    extract(context) { ... },
    drain() { ... }
  }
}
```

**Why:** Enables test isolation. Each test calls `createExtractor()` for a fresh instance. Module-level state leaks between tests.

### Fire-and-Forget with Drain

```
inFlightOperations = new Set<Promise>()

// Fire
promise = extractMemories(context)
inFlightOperations.add(promise)
promise.finally(() => inFlightOperations.delete(promise))
// Don't await — let it run in background

// Drain (before shutdown)
drainPendingOperations(timeoutMs = 60000):
  await Promise.allSettled(inFlightOperations)
```

---

## 8. Implementation Checklist

### Minimum Viable Memory System

- [ ] Memory directory with index file (MEMORY.md)
- [ ] Topic files with frontmatter (name, description, type)
- [ ] Memory type taxonomy (at least: user, feedback, project)
- [ ] Size limits on index file (200 lines / 25KB)
- [ ] Path resolution (settings → default path)
- [ ] Directory auto-creation
- [ ] Basic memory retrieval (scan + frontmatter matching)

### Production-Grade Memory System

- [ ] All of the above, plus:
- [ ] 4 memory types with scope guidance (private vs team)
- [ ] What-not-to-save guidelines in extraction prompt
- [ ] Relevance-ranked retrieval via smaller model (top 5)
- [ ] Staleness tracking (age calculation, snapshot caveat)
- [ ] Canonical git root for worktree-shared memory
- [ ] Memoized path resolution
- [ ] Auto-extraction from conversations (end of query loop)
- [ ] Gate chain (feature flag → enabled → not remote → main agent)
- [ ] Forked agent for extraction (cache-safe params, max 5 turns)
- [ ] Tool restrictions (write only in memory dir)
- [ ] Mutual exclusion with main agent memory writes
- [ ] Coalescing overlapping extraction calls
- [ ] Throttling (every N turns)
- [ ] Background consolidation (auto-dream)
- [ ] Time gate + session gate + lock gate
- [ ] PID-based lock with mtime as timestamp
- [ ] Stale lock detection (1 hour)
- [ ] Lock rollback on failure
- [ ] DreamTask UI tracking with abort support
- [ ] Team memory sync (pull/push with delta detection)
- [ ] Secret scanning before upload (high-confidence patterns only)
- [ ] File watcher with debounced push (2s)
- [ ] Permanent failure suppression with recovery paths
- [ ] Closure-scoped state for test isolation
- [ ] Fire-and-forget with drain before shutdown

---

## Related Documents

- [AGENT-SYSTEM-PROMPT-ENGINEERING.md](AGENT-SYSTEM-PROMPT-ENGINEERING.md) — Memory injected as system prompt section
- [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) — Memory competes for context budget
- [AGENT-CONTEXT-COMPACTION-ADVANCED.md](AGENT-CONTEXT-COMPACTION-ADVANCED.md) — Compaction that preserves memory references
- [AGENT-TASK-AND-BACKGROUND-EXECUTION.md](AGENT-TASK-AND-BACKGROUND-EXECUTION.md) — Forked agent pattern used by extraction and consolidation
- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — Sessions that feed into consolidation gates
- [AGENT-LIFECYCLE-AND-PROCESS.md](AGENT-LIFECYCLE-AND-PROCESS.md) — Drain pending extractions before shutdown
- [AGENT-ENTERPRISE-AND-POLICY.md](AGENT-ENTERPRISE-AND-POLICY.md) — Team memory sync requires enterprise auth
