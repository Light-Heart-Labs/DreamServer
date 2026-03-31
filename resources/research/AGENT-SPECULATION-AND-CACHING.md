# Agent Speculation and Caching Patterns

Best practices for optimistic/speculative execution and advanced caching in autonomous AI agent systems. Derived from production analysis of agentic systems that use speculative execution to eliminate perceived latency, and multi-layer caching to minimize redundant computation.

*Last updated: 2026-03-31*

---

## Why This Matters

Users wait. Every second the agent appears idle, trust erodes. Speculative execution — running the agent's likely next action before the user asks — can eliminate perceived latency entirely. And every redundant API call, file read, or config lookup wastes tokens, money, and time.

Production systems use speculation and caching as performance multipliers. These are the patterns that make an agent feel instant.

---

## Part 1: Speculative Execution

### 1.1 What Is Speculation

The agent predicts what the user will do next and begins working on it *before the user acts*. If the prediction is correct, the result appears instantly. If wrong, the speculative work is discarded.

**Example:**

```
User submits a code edit
Agent applies the edit
Agent is now idle, waiting for user

SPECULATION: Agent predicts user will say "run the tests"
  -> Agent speculatively runs tests in an isolated context
  -> Caches the result

User says: "run the tests"
  -> Result available instantly (from speculation cache)
  -> User experiences zero wait time
```

### 1.2 When to Speculate

| Trigger | Prediction | Confidence |
|---------|-----------|-----------|
| Agent just wrote code | User will ask to run tests | High |
| Agent just fixed a bug | User will ask to verify the fix | High |
| Agent is idle after completing a task | User will ask a follow-up question | Medium |
| Agent just read files | User will ask to modify them | Medium |
| Session just started | User will repeat their common first command | Low |

### Decision Framework

```
shouldSpeculate():
  if userIsTyping():
    return false  // user is about to tell us what to do

  if contextWindowNearlyFull():
    return false  // can't afford the token overhead

  if lastActionWasWrite():
    return true, prediction: "run tests or verify"

  if idleFor(seconds: 5):
    return true, prediction: "suggest next steps"

  return false
```

### 1.3 Isolation: The Critical Requirement

Speculation MUST run in an isolated context. If speculative execution modifies real state (files, git, databases), and the prediction was wrong, you've corrupted the user's environment.

### File State Overlay (Copy-on-Write)

```
SpeculationContext:
  // Real filesystem is read-only during speculation
  realFS: ReadOnlyFileSystem

  // Overlay captures any writes
  overlay: Map<path, content>

  readFile(path):
    if path in overlay:
      return overlay[path]  // read from overlay (speculative write)
    return realFS.read(path)  // read from real filesystem

  writeFile(path, content):
    overlay[path] = content  // write to overlay only
    // Real filesystem untouched
```

### Merging Speculation Results

If the user's actual request matches the speculation:

```
mergeSpeculation(speculationResult, actualRequest):
  // "Matches" = semantic intent match, not string equality.
  // Example: prediction was "run tests" and user says "can you run the test suite?"
  // Use the LLM to classify whether the actual request aligns with the prediction.
  // Fast path: if the first tool call of speculation matches the first tool call
  // the agent would make for the actual request, it's a match.
  if speculationMatches(speculationResult, actualRequest):
    // Apply overlay to real filesystem
    for path, content in speculationResult.overlay:
      realFS.write(path, content)

    // Return cached result
    return speculationResult.output

  else:
    // Discard everything
    speculationResult.discard()
    return null  // execute normally
```

### 1.4 Tool Restrictions During Speculation

Not all tools are safe for speculative execution:

| Tool | Safe to Speculate | Why |
|------|------------------|-----|
| File read | Yes | Read-only, no side effects |
| Code search | Yes | Read-only |
| File write | **Only with overlay** | Must not modify real files |
| File edit | **Only with overlay** | Must not modify real files |
| Shell (read-only commands) | Yes | grep, find, ls, etc. |
| Shell (write commands) | **No** | Can't isolate shell side effects |
| Git operations | **No** | Modifies repository state |
| Network requests | **No** | Can't un-send a request |
| MCP tool calls | **No** | External side effects unknown |

### 1.5 Abort Handling

Speculation must be instantly cancellable:

```
SpeculationRunner:
  abortController: new AbortController()

  start(prediction):
    try:
      result = runAgent(prediction, {
        signal: abortController.signal,
        context: isolatedContext,
        maxTurns: 20,         // limit speculative depth
        maxMessages: 50,       // limit context consumption
        toolFilter: SAFE_TOOLS_ONLY
      })
      cacheResult(prediction, result)

    catch error:
      if isAbortError(error):
        return  // normal cancellation, clean up silently
      log.warn("Speculation failed: {error}")

  abort():
    abortController.abort()
    discardOverlay()
```

### 1.6 Speculation Budget

Speculation consumes tokens. Limit it:

```
SpeculationBudget:
  maxTokensPerSpeculation: 10_000   // cap per prediction
  maxSpeculationsPerSession: 50     // cap per session
  maxConcurrent: 1                  // one speculation at a time

  canSpeculate():
    return currentSpeculations < maxConcurrent
       and sessionSpeculations < maxSpeculationsPerSession
       and sessionTokenBudget > maxTokensPerSpeculation
```

---

## Part 2: Caching Patterns

### 2.1 Cache Layers

Production agent systems use multiple cache layers:

| Layer | What It Caches | TTL | Eviction |
|-------|---------------|-----|----------|
| **LLM prompt cache** | System prompt prefix (API-side) | Provider-managed | Automatic |
| **File content cache** | Recently read files | 30-60s | LRU + file change invalidation |
| **Auth token cache** | Keychain reads, token lookups | 5 minutes | TTL expiry |
| **Config cache** | Parsed config objects | Until file changes | File watcher invalidation |
| **Tool result cache** | Idempotent tool results | 10-30s | LRU |
| **Feature flag cache** | Flag evaluation results | 1-5 minutes | TTL + background refresh |
| **MCP resource cache** | External resource contents | 30-60s | TTL |

### 2.2 LRU Cache with TTL

Basic building block for most caches:

```
LRUCache:
  capacity: number
  ttl: number (milliseconds)
  entries: OrderedMap<key, { value, createdAt, lastAccessed }>

  get(key):
    entry = entries.get(key)
    if entry == null:
      return MISS

    if now() - entry.createdAt > ttl:
      entries.delete(key)
      return EXPIRED

    entry.lastAccessed = now()
    entries.moveToEnd(key)  // most recently used
    return entry.value

  set(key, value):
    if entries.size >= capacity:
      evictLeastRecentlyUsed()
    entries.set(key, { value, createdAt: now(), lastAccessed: now() })

  evictLeastRecentlyUsed():
    oldestKey = entries.firstKey()
    entries.delete(oldestKey)
```

### 2.3 Stale-While-Refresh Pattern

Return stale data immediately while refreshing in the background:

```
StaleWhileRefreshCache:
  cache: LRUCache
  refreshing: Set<key>  // track in-progress refreshes

  get(key, refreshFn):
    entry = cache.get(key)

    if entry == MISS:
      // Cold miss — must wait for fresh data
      value = refreshFn(key)
      cache.set(key, value)
      return value

    if entry == EXPIRED or isStale(entry):
      // Stale — return immediately but refresh in background
      if key not in refreshing:
        refreshing.add(key)
        async:
          try:
            freshValue = refreshFn(key)
            cache.set(key, freshValue)
          finally:
            refreshing.delete(key)

      return entry.value  // stale but available NOW

    return entry.value  // fresh
```

**Why this matters:** A feature flag check that takes 200ms on a cold cache returns in <1ms on stale-while-refresh. The user never waits for a flag evaluation.

### 2.4 Cache Storm Prevention

When multiple requests hit the same cache miss simultaneously:

```
// WITHOUT storm prevention:
Request A: cache miss for "config" -> fetch from disk
Request B: cache miss for "config" -> fetch from disk (duplicate!)
Request C: cache miss for "config" -> fetch from disk (duplicate!)

// WITH storm prevention:
Request A: cache miss for "config" -> fetch from disk
Request B: cache miss for "config" -> wait for A's result
Request C: cache miss for "config" -> wait for A's result
```

**Implementation:**

```
CoalescingCache:
  pendingFetches: Map<key, Promise>

  get(key, fetchFn):
    cached = cache.get(key)
    if cached != MISS:
      return cached

    // Check if someone else is already fetching
    if key in pendingFetches:
      return await pendingFetches[key]  // piggyback on existing fetch

    // First requester — start the fetch
    promise = fetchFn(key)
    pendingFetches.set(key, promise)

    try:
      value = await promise
      cache.set(key, value)
      return value
    finally:
      pendingFetches.delete(key)
```

### 2.5 File Content Cache

Special considerations for caching file contents in an agent context:

```
FileCache:
  cache: LRUCache (capacity: 100 files, TTL: 60s)
  watchers: Map<path, FileWatcher>

  read(path):
    cached = cache.get(path)
    if cached and not fileModifiedSince(path, cached.readTime):
      return cached.content

    content = readFile(path)
    cache.set(path, { content, readTime: now() })
    startWatching(path)
    return content

  startWatching(path):
    if path not in watchers:
      watchers[path] = watchFile(path, onChange: () => {
        cache.invalidate(path)
      })

  // Agent wrote to a file — update cache immediately
  onAgentWrite(path, newContent):
    cache.set(path, { content: newContent, readTime: now() })
```

**Key Insight:** When the agent writes a file, update the cache immediately. Don't wait for the file watcher to fire — that adds unnecessary latency on the next read.

### 2.6 Prompt Cache Optimization

LLM APIs often cache the system prompt prefix. Maximize cache hits by keeping the prompt prefix stable:

```
System prompt structure:
  [STABLE PREFIX — cached by API]
    Core identity
    Safety rules
    Tool definitions
    Permission rules

  [CACHE BREAK POINT]

  [VOLATILE SUFFIX — not cached]
    Current time
    Git status
    Active task state
    Recent reminders
```

**Metrics to track:**
- Cache hit rate (% of requests that hit the prompt cache)
- Cache hit tokens (tokens saved from caching)
- Cache cost savings (cache hits are typically 90% cheaper)

### 2.7 Memoization for Pure Functions

For functions that always return the same output for the same input:

```
memoize(fn, options):
  cache = LRUCache(capacity: options.maxEntries, ttl: options.ttl)

  return (...args):
    key = serialize(args)
    cached = cache.get(key)
    if cached != MISS:
      return cached

    result = fn(...args)
    cache.set(key, result)
    return result
```

**Good candidates for memoization:**

| Function | Why Memoize |
|----------|------------|
| Token counting | Same text → same count. Called many times per turn. |
| Path normalization | Same path → same result. Called on every file operation. |
| Config parsing | Same file → same config. Don't reparse on every access. |
| Schema compilation | Same schema → same validator. Compile once, reuse. |
| Permission rule parsing | Same rule string → same parsed rule. |

---

## 3. Combining Speculation and Caching

The two systems reinforce each other:

```
Speculation reads files -> File cache populated
  -> When user asks for those files, cache hit (instant)

Speculation runs tests -> Result cached
  -> When user asks "run tests", cached result (instant)

File cache detects change -> Invalidate speculation
  -> Don't serve stale speculative results

Prompt cache stable prefix -> Speculation uses same prefix
  -> Speculation API calls benefit from prompt caching too
```

---

## 4. Implementation Checklist

### Minimum Viable Caching

- [ ] LRU cache with TTL for file contents
- [ ] Auth token caching (avoid repeated keychain reads)
- [ ] Config parsing cache
- [ ] Memoization utility for pure functions

### Minimum Viable Speculation

- [ ] Idle detection (agent finished, user not typing)
- [ ] Single prediction: "run tests after code write"
- [ ] Isolated context (at minimum: don't execute write tools)
- [ ] Abort on user input
- [ ] Result caching for match

### Production-Grade

- [ ] All of the above, plus:
- [ ] File state overlay (copy-on-write for speculative writes)
- [ ] Overlay merge on speculation match
- [ ] Tool restriction during speculation
- [ ] Speculation token budget (per-speculation and per-session caps)
- [ ] Stale-while-refresh for config and feature flags
- [ ] Cache storm prevention (coalescing concurrent fetches)
- [ ] File watcher integration for cache invalidation
- [ ] Agent-write cache update (immediate, don't wait for watcher)
- [ ] Prompt cache optimization (stable prefix, volatile suffix)
- [ ] Cache hit rate monitoring
- [ ] Speculation match rate monitoring
- [ ] Multiple speculation strategies (test, suggest, continue)
- [ ] Speculation depth limits (max turns, max messages)

---

## Related Documents

- [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) — Context management that speculation must respect
- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Tool system with read/write classification for speculation safety
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — API cost tracking for speculation budget
- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — Token caching patterns
- [AGENT-BOOTSTRAP-AND-CONFIGURATION.md](AGENT-BOOTSTRAP-AND-CONFIGURATION.md) — Config caching and feature flag evaluation
