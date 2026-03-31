# Agent Initialization and Wiring

How the system boots — the 6-stage startup sequence, parallel prefetching for sub-500ms cold starts, preflight network checks, fast mode optimization, system prompt section caching mechanics, and context attachment prefetch ordering. This document connects every component into a running system. Derived from production analysis of agentic systems achieving <500ms startup with 20+ subsystems initialized.

*Last updated: 2026-03-31*

---

## Why This Matters

The other 28 documents describe what each component does. This document describes how they're wired together at startup, in what order, with what dependencies, and what optimizations make it fast. Without this, you have a box of parts and no assembly instructions.

---

## 1. The 6-Stage Bootstrap

### Stage 1: Early Side-Effects (Before Imports)

The very first lines of the entry point, before any module imports:

```
Stage 1 (t=0ms):
  profileCheckpoint("entry")

  // Fire-and-forget: spawn MDM subprocess to read managed settings
  startMdmRawRead()  // ~20ms subprocess spawn, reads in background

  // Fire-and-forget: start keychain read
  startKeychainPrefetch()  // ~65ms on macOS, reads in background

  // Now imports begin (~135ms of module loading)
```

**Why before imports:** Module loading takes 100-150ms. Keychain reads take ~65ms. By starting keychain reads before imports, they complete during import time — free parallelism.

### Stage 2: Module Loading with Feature-Gated DCE

```
Stage 2 (t=0ms to ~135ms):
  import React, CLI parsing, configuration, API clients, UI...

  // Feature-gated conditional imports for dead code elimination:
  if feature("COORDINATOR_MODE"):
    import coordinatorModule
  if feature("KAIROS"):
    import assistantModeModules
  if feature("EXPERIMENTAL_SKILL_SEARCH"):
    import skillSearchModules

  profileCheckpoint("imports_loaded")
```

**Dead code elimination (DCE):** Feature flags evaluated at build time. Disabled features are removed from the bundle entirely, reducing bundle size and startup time.

### Stage 3: Validation and Configuration

```
Stage 3 (t=~135ms):
  profileCheckpoint("preAction_start")

  // Await prefetch completions (should already be done)
  await ensureMdmSettingsLoaded()
  await ensureKeychainPrefetchCompleted()

  profileCheckpoint("preAction_after_mdm")

  // Full initialization sequence
  await init()

  profileCheckpoint("preAction_after_init")
```

### Stage 4: Setup Screens

```
Stage 4 (t=~200ms):
  // Show interactive setup if needed
  await showSetupScreens()
    // Theme selection (first run only)
    // Settings validation
    // Resume session chooser
    // Assistant/model chooser

  // Configure model
  setInitialMainLoopModel()
```

### Stage 5: REPL Launch

```
Stage 5 (t=~250ms):
  // Dynamic import for code splitting
  replModule = await import("./screens/REPL")

  // Start React/Ink renderer
  renderAndRun(root, <App><REPL /></App>)
```

### Stage 6: Query Loop Activation

```
Stage 6 (t=~300ms, "ready"):
  // REPL component mounts
  // Query generator initializes
  // First iteration:
  //   - Start memory prefetch (async)
  //   - Start skill discovery prefetch (feature-gated)
  //   - Call model (streaming)
  //   - Execute tools
  //   - Collect attachments
  //   - Continue loop
```

---

## 2. The Init Sequence (Detail)

The `init()` function runs these steps in a specific dependency order:

```
init():
  // 1. Enable configuration system
  enableConfig()
  validateConfigSchema()

  // 2. Apply safe environment variables
  setNodeExtraCACerts()
  configureProxy()
  configureMTLS()

  // 3. Set up shutdown handlers (must be early)
  registerGracefulShutdownHandlers()

  // 4. Lazy-load telemetry (heavy — 400KB OpenTelemetry SDK)
  scheduleAsyncLoad("telemetry", () => initializeTelemetry())

  // 5. Initialize feature flags
  scheduleAsyncLoad("featureFlags", () => initializeFeatureFlags())

  // 6. Async initialization (all in parallel):
  await Promise.all([
    populateOAuthAccount(),          // fetch user profile
    detectJetBrainsIDE(),            // IDE integration
    detectGitRepository(),           // git root, branch, remote
    initializeRemoteManagedSettings(), // enterprise config
  ])

  // 7. Configure HTTP stack
  configureMTLSCertificates()
  configureHTTPAgents()
  configureProxy()

  // 8. API preconnect (TCP+TLS handshake overlap)
  preconnectToAPI()  // starts TCP connection before first API call

  // 9. Optional: CCR upstream proxy
  if isCCRMode():
    initializeUpstreamProxy()
```

**Dependency order matters:**
- Config must load before anything reads settings
- Shutdown handlers must register before any async operations start
- OAuth must complete before feature flags (user context needed for evaluation)
- HTTP stack must configure before API preconnect
- API preconnect overlaps TLS handshake with remaining init — saves 50-100ms on first API call

---

## 3. Preflight Checks

### When They Run

During onboarding (first-run experience), rendered as a React component:

```
PreflightCheck:
  state: "checking" | "success" | "failed"

  onMount():
    results = await runChecks()
    if results.allPassed:
      state = "success"
      advanceToNextStep()
    else:
      state = "failed"
      showErrorWithGuidance(results)
      setTimeout(100, () => process.exit(1))
```

### Checks Performed

| Check | Endpoint | Purpose |
|-------|----------|---------|
| API connectivity | `/api/hello` | Verify the agent can reach the LLM API |
| OAuth connectivity | `/v1/oauth/hello` | Verify auth endpoints are reachable |

### Failure Handling

| Failure Type | User Sees | Action |
|-------------|-----------|--------|
| Network unreachable | "Cannot connect to API" + docs link | Exit after 100ms |
| SSL certificate error | SSL hint + certificate guidance | Exit after 100ms |
| Timeout | "Connection timed out" | Exit after 100ms |
| DNS failure | "Cannot resolve hostname" | Exit after 100ms |

### SSL Hint Detection

```
getSSLHint(error):
  if error.code == "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    return "Corporate proxy may require NODE_EXTRA_CA_CERTS"
  if error.code == "CERT_HAS_EXPIRED":
    return "Server certificate has expired"
  if error.code == "SELF_SIGNED_CERT_IN_CHAIN":
    return "Self-signed certificate detected — add to trust store"
  return null
```

### UX: Spinner with Timeout

Show a spinner for up to 1 second. If check hasn't completed by then, keep showing spinner. Auto-advance on success, show error on failure.

---

## 4. Fast Mode

### What It Is

An inference speed optimization that uses a higher-performance model configuration when available.

### Multi-Layer Availability Check

```
isFastModeAvailable():
  // Layer 1: Environment override
  if env.DISABLE_FAST_MODE: return false

  // Layer 2: Feature flag (org-level kill switch)
  if featureFlag("fast_mode_disabled"): return false

  // Layer 3: Bundled mode requirement
  if requiresBundledMode and not isBundledBuild: return false

  // Layer 4: SDK session gating
  if isSDKSession and not settings.fastMode: return false

  // Layer 5: API provider filter (first-party only)
  if provider in ["bedrock", "vertex", "foundry"]: return false

  // Layer 6: Organization status
  orgStatus = fetchOrgFastModeStatus()
  if orgStatus.status == "disabled": return false

  return true
```

### Organization Status

Fetched from the API and cached:

| Status | Meaning | Action |
|--------|---------|--------|
| `enabled` | Organization allows fast mode | Use it |
| `disabled:free` | Free tier, not available | Show upgrade prompt |
| `disabled:preference` | Admin disabled it | Respect org setting |
| `disabled:extra_usage` | Extra usage not enabled | Show enablement instructions |
| `disabled:network_error` | Couldn't check | Fall back to cache |

### Runtime State Machine

```
States: active ←→ cooldown

active → cooldown:
  Trigger: API returns 429 with overage reason
  Action: Set cooldown expiry timestamp, log duration

cooldown → active:
  Trigger: Current time passes cooldown expiry
  Action: Clear cooldown state, resume fast mode
```

### Prefetch with Throttle

```
prefetchFastModeStatus():
  if timeSinceLastPrefetch < 30_000:  // 30-second throttle
    return cached

  if isNonEssentialTrafficDisabled:
    return cached  // don't make optional network calls

  try:
    status = await fetchOrgStatus()
    cache(status)
    return status
  catch:
    return cached  // network failure → use last known state
```

---

## 5. System Prompt Section Caching

### Two Section Types

| Type | Caching | Recomputes When | Cache Impact |
|------|---------|----------------|-------------|
| `systemPromptSection` | **Cached** | `/clear`, `/compact`, or session restart | No prompt cache break |
| `DANGEROUS_uncachedSystemPromptSection` | **Never cached** | Every single turn | Breaks prompt cache on value change |

**Why the alarming name?** "DANGEROUS" in the function name forces developers to think before using it. Every uncached section recomputes on every turn and can break the API's prompt cache. Use only for truly volatile data.

### Section Cache Mechanics

```
SectionCache:
  entries: Map<sectionName, string | null>

  resolve(section):
    if section.type == "cached" and entries.has(section.name):
      return entries.get(section.name)  // cache hit

    // Compute (may be async)
    value = await section.compute()

    if section.type == "cached":
      entries.set(section.name, value)  // cache for future turns

    return value

  clear():
    entries.clear()
    clearBetaHeaderLatches()  // reset header tracking too
```

### Beta Header Latches

Some optional API headers should only be sent once per conversation (e.g., "enable fast mode", "enable thinking"). Latches track which have been emitted:

```
BetaHeaderLatches:
  fastModeLatched: boolean      // fast mode header sent?
  cacheEditingLatched: boolean  // cache editing header sent?
  thinkingClearLatched: boolean // thinking clear header sent?

  // Reset on /clear and /compact (new conversation context)
  reset():
    fastModeLatched = null
    cacheEditingLatched = null
    thinkingClearLatched = null
```

### Parallel Resolution

All sections resolve in parallel for speed:

```
resolveAllSections(sectionDefs):
  promises = sectionDefs.map(def => resolve(def))
  results = await Promise.all(promises)
  return results.filter(r => r != null)  // null = section disabled
```

### Cache Invalidation Events

| Event | Action |
|-------|--------|
| `/clear` command | Clear all cached sections + reset header latches |
| `/compact` command | Clear all cached sections + reset header latches |
| `/resume` command | Clear all cached sections (new context) |
| Session start | Fresh cache (nothing cached yet) |
| Settings change | Specific sections may recompute (not full clear) |

---

## 6. Context Attachment Prefetch

### The Prefetch Pattern

Expensive context lookups (memory search, skill discovery) run asynchronously while the model streams, then their results are collected after tool execution:

```
// At iteration boundary (before model call):
memoryPrefetch = startRelevantMemoryPrefetch(lastUserMessage)
skillPrefetch = startSkillDiscoveryPrefetch()

// ... model streams, tools execute ...

// After tools complete:
if memoryPrefetch.settled:
  attachments.push(...memoryPrefetch.results)
if skillPrefetch.settled:
  attachments.push(...skillPrefetch.results)
```

### Memory Prefetch

```
startRelevantMemoryPrefetch(userMessage):
  // Skip conditions:
  if userMessage.wordCount <= 1: return null    // too vague
  if not isInteractiveSession: return null       // no user to serve
  if sessionMemoryBytes >= 60_000: return null   // session budget exhausted

  // Fire async search
  return asyncSearch({
    query: extractKeyTerms(userMessage),
    maxResults: 5,
    maxBytesPerFile: 4096,       // 4KB per memory file
    abortSignal: childAbortController.signal
  })
```

**Budget enforcement:**
- 5 files maximum per prefetch
- 4KB maximum per file
- 60KB cumulative session cap (across all prefetches)
- Stops prefetching after session budget exhausted

### Skill Discovery Prefetch

```
startSkillDiscoveryPrefetch():
  // Feature-gated
  if not feature("EXPERIMENTAL_SKILL_SEARCH"): return null

  // Only on tool execution iterations (write-pivot detection)
  if not isToolExecutionIteration: return null

  // Don't recurse (prevent discovery during SKILL.md expansion)
  if isSkillExpansionContext: return null

  return asyncSkillSearch({
    context: currentConversation,
    maxResults: 3
  })
```

### Disposal Pattern

Prefetch handles implement the disposal interface for guaranteed cleanup:

```
using memoryPrefetch = startRelevantMemoryPrefetch(...)

// `using` guarantees dispose() runs on ALL exit paths:
// - Normal return
// - Throw
// - Generator .return() (user abort)
// No need to instrument 13+ exit sites manually
```

### Attachment Assembly Order

The full attachment pipeline, in order:

```
1. User at-mentions (explicit files, directories, memory references)
2. IDE context (opened files, line selections from IDE integration)
3. System injections:
   - Todo list state
   - Task notifications
   - Date change notices
   - Plan mode state
   - Companion state
4. Dynamic discovery:
   - Nested memory files (conditional on query relevance)
   - Changed files (git diff since last turn)
   - Dynamic skills (triggered by context)
   - Skill/command listings
5. Async prefetch results:
   - Memory prefetch (collected here, started earlier)
   - Skill discovery prefetch (collected here, started earlier)
```

### Token Budget Allocation

Each attachment type has a token budget:

| Attachment Type | Budget | Notes |
|----------------|--------|-------|
| Memory files | 4KB per file, 5 files | 20KB per turn, 60KB session |
| File reads | `MAX_LINES_TO_READ` | Configurable per tool |
| IDE context | Varies | Based on selection size |
| Skill definitions | 25K per skill | For context inclusion |
| Changed files | Varies | Only diffs, not full files |

---

## 7. How Everything Connects

### The Complete Data Flow (One Turn)

```
User types message
  → Command queue enqueues (priority: "next")
  → REPL dequeues command
  → Query loop iteration begins
    → Pre-call checks (blocking limit, auto-compact)
    → Start memory prefetch (async)
    → Start skill discovery prefetch (async, feature-gated)
    → Prepare messages for API (normalize, budget, persist oversized results)
    → Call model API (streaming)
      → Yield StreamEvents to UI (tokens appear for user)
      → StreamingToolExecutor detects tool_use blocks
      → Start concurrent-safe tools immediately
    → Model stream completes
    → Execute remaining tools (batched: concurrent then sequential)
      → Each tool: schema validate → security check → permission check → hooks → execute
      → Results buffered in order
    → Run stop hooks (may inject blocking errors → continue)
    → Collect attachments:
      → Drain queued commands
      → Collect memory prefetch results
      → Collect skill discovery results
    → Roll everything into messages
    → Check needsFollowUp:
      → true: continue loop (next iteration)
      → false: return "completed" (agent done)
  → REPL displays final response
  → Extract memories (async, fire-and-forget)
  → Check auto-dream gates (async, fire-and-forget)
  → Wait for next user input
```

---

## 8. Implementation Checklist

### Minimum Viable Initialization

- [ ] Sequential bootstrap (config → auth → tools → prompt → session)
- [ ] Single entry point that launches the REPL
- [ ] Basic preflight check (API reachable?)
- [ ] System prompt assembled from sections
- [ ] Query loop starts on first user input

### Production-Grade Initialization

- [ ] All of the above, plus:
- [ ] 6-stage bootstrap with parallel prefetching
- [ ] Keychain prefetch before imports (save 65ms)
- [ ] MDM subprocess spawn before imports
- [ ] Feature-gated dead code elimination at build time
- [ ] Init sequence with correct dependency ordering
- [ ] API preconnect (TCP+TLS overlap during init)
- [ ] Preflight checks with SSL hint detection
- [ ] Fast mode multi-layer availability check
- [ ] Fast mode cooldown state machine
- [ ] Fast mode org status prefetch with 30s throttle
- [ ] System prompt section caching (cached vs DANGEROUS_uncached)
- [ ] Beta header latches with reset on /clear and /compact
- [ ] Parallel section resolution
- [ ] Memory prefetch at iteration boundary (async, 5 files, 4KB, 60KB session cap)
- [ ] Skill discovery prefetch (feature-gated, write-pivot detection)
- [ ] Disposal pattern for prefetch handles (`using` keyword)
- [ ] Attachment assembly in correct order (5 phases)
- [ ] Token budget allocation per attachment type
- [ ] Startup profiling with checkpoint timing
- [ ] Dynamic import for code splitting (REPL module)
- [ ] Setup screens (first-run theme, model selection)

---

## Related Documents

- [AGENT-QUERY-LOOP-AND-STATE-MACHINE.md](AGENT-QUERY-LOOP-AND-STATE-MACHINE.md) — The loop this initialization launches
- [AGENT-BOOTSTRAP-AND-CONFIGURATION.md](AGENT-BOOTSTRAP-AND-CONFIGURATION.md) — Configuration loaded during init
- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — OAuth populated during init
- [AGENT-SYSTEM-PROMPT-ENGINEERING.md](AGENT-SYSTEM-PROMPT-ENGINEERING.md) — Prompt sections assembled by caching system
- [AGENT-MEMORY-AND-CONSOLIDATION.md](AGENT-MEMORY-AND-CONSOLIDATION.md) — Memory prefetch initiated at iteration boundary
- [AGENT-STREAMING-TOOL-EXECUTION.md](AGENT-STREAMING-TOOL-EXECUTION.md) — Tool execution started during model streaming
- [AGENT-ENTERPRISE-AND-POLICY.md](AGENT-ENTERPRISE-AND-POLICY.md) — Remote settings initialized during init
- [AGENT-LIFECYCLE-AND-PROCESS.md](AGENT-LIFECYCLE-AND-PROCESS.md) — Shutdown handlers registered during init
- [AGENT-SDK-BRIDGE.md](AGENT-SDK-BRIDGE.md) — Bridge mode determined during init
- [AGENT-FEATURE-DELIVERY.md](AGENT-FEATURE-DELIVERY.md) — Fast mode and feature flags evaluated during init
