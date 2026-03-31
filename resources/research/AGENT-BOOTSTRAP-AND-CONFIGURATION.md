# Agent Bootstrap and Configuration Management

Best practices for initializing agent systems with correct dependency ordering, and managing configuration across multiple sources with enterprise policy enforcement. Derived from production analysis of agentic systems that cold-start in under 500ms while loading configuration from 5+ sources with strict priority rules.

*Last updated: 2026-03-31*

---

## Why This Matters

An agent that takes 5 seconds to start is an agent people stop using. An agent that loads the wrong configuration is a security incident waiting to happen. An enterprise agent that lets users override organization policy is a compliance failure.

Production systems need fast, correct, observable bootstrapping — and a configuration system that's both flexible for individuals and locked-down for organizations.

---

## Part 1: Bootstrap Sequence

### 1.1 The Dependency Problem

Agent systems have complex startup dependencies:

```
Can't load tools until permissions are loaded
Can't load permissions until config is loaded
Can't load config until we know the working directory
Can't connect MCP servers until auth is ready
Can't authenticate until keychain is accessible
```

Getting the order wrong causes crashes, silent misconfigurations, or security gaps.

### 1.2 Bootstrap Phases

Organize startup into sequential phases with explicit dependencies:

| Phase | What Happens | Depends On | Typical Time |
|-------|-------------|-----------|-------------|
| **0. Preflight** | Parse CLI args, detect platform, set working directory | Nothing | <10ms |
| **1. Configuration** | Load and merge configs from all sources | Phase 0 | 20-50ms |
| **2. Authentication** | Load API keys, refresh tokens, validate credentials | Phase 1 (config tells us where keys are) | 30-100ms |
| **3. Permissions** | Load permission rules, initialize permission state | Phase 1 (config contains rules) |  <10ms |
| **4. Tools** | Register built-in tools, load plugins, build tool schemas | Phases 1, 3 | 20-50ms |
| **5. MCP Servers** | Connect to configured MCP servers | Phases 2, 4 (need auth + tool registry) | 50-200ms |
| **6. System Prompt** | Assemble prompt from sections, load project memory | Phases 1-5 (everything) | 10-30ms |
| **7. Session** | Load or create session, restore history if resuming | Phase 6 | 20-100ms |
| **8. Ready** | Accept user input | Phase 7 | 0ms |

### 1.3 Parallel Prefetching

Some operations can overlap even within the sequential model:

```
Phase 0 (Preflight):
  parse CLI args
  detect platform

Phase 1+2 (Parallel):
  PARALLEL:
    - Load config files from disk
    - Start keychain read (async, may take 50-100ms on macOS)
    - Fetch remote settings (async, may take 100-300ms)

  AWAIT ALL, then merge results with priority rules
```

**Key Insight:** Keychain access on macOS takes ~65ms. Starting it early (even before config is fully loaded) saves that time from the critical path. Same for remote settings — start the network call immediately, use the result when it arrives.

### 1.4 Startup Profiling

Instrument every phase with checkpoints:

```
startupProfile = {}

checkpoint("cli_parse_start")
parseCLIArgs()
checkpoint("cli_parse_end")

checkpoint("config_load_start")
loadConfig()
checkpoint("config_load_end")

// ... etc

checkpoint("ready")

// Report total and per-phase times
logProfile(startupProfile)
```

### What to Track

| Metric | Why |
|--------|-----|
| Total startup time | User-facing performance |
| Config load time | Identifies slow config sources (network, disk) |
| Auth time | Keychain access or token refresh delays |
| MCP connection time | Slow servers degrade startup |
| Plugin load time | Identifies heavy plugins |
| Memory at ready | Baseline for leak detection |

### 1.5 Lazy Loading

Not everything needs to load at startup. Defer expensive operations:

| Load Eagerly | Load Lazily |
|-------------|------------|
| Core config | Telemetry SDK (heavy, ~400KB) |
| API key | Feature flag evaluation engine |
| Permission rules | Plugin marketplace metadata |
| Built-in tool schemas | Help text and documentation |
| Working directory detection | Auto-update checker |

**Pattern:** Lazy-load with memoization. First access triggers the load; subsequent accesses are instant.

```
lazyLoad(loader):
  cached = null
  return ():
    if cached == null:
      cached = loader()
    return cached
```

---

## Part 2: Configuration Management

### 2.1 Configuration Sources

Production agent systems load configuration from multiple sources:

| Source | Example | Who Controls | Volatility |
|--------|---------|-------------|-----------|
| **Built-in defaults** | Hardcoded in application | Developer | Never changes at runtime |
| **Organization/MDM policy** | Windows Registry (HKLM), macOS managed plist, Linux /etc/ | IT Admin | Rarely changes |
| **Managed config file** | `/etc/agent/config.json` or managed profile | IT Admin | Rarely changes |
| **User settings file** | `~/.agent/settings.json` | User | Changes occasionally |
| **Project settings** | `.agent/settings.json` in project root | Developer | Changes per-project |
| **Environment variables** | `AGENT_MODEL`, `AGENT_API_KEY` | User/CI | Changes per-session |
| **CLI arguments** | `--model opus --timeout 30` | User | Changes per-invocation |
| **Remote settings** | Fetched from settings API | Operations team | Can change anytime |

### 2.2 Priority Model: First Source Wins

For security-critical settings (permissions, allowed tools, blocked commands), use **first source wins** with organizational override:

```
Priority (highest to lowest):
  1. Remote/managed settings    (org control — can't be overridden)
  2. MDM/Registry (machine)     (IT admin — can't be overridden by user)
  3. Managed config file        (IT admin)
  4. CLI arguments              (user, this invocation)
  5. Environment variables      (user, this session)
  6. Project settings           (developer, this project)
  7. User settings              (user, all projects)
  8. Built-in defaults          (lowest priority)
```

**Why first-source-wins:** It prevents privilege escalation. A user can't override an organization's security policy by editing their local settings file. The managed/MDM source "wins" because it's checked first.

### For non-security settings (UI preferences, model selection), use **last source wins**:

```
Priority (each overrides the previous):
  1. Built-in defaults          (base)
  2. User settings              (personal preference)
  3. Project settings           (project-specific)
  4. Environment variables      (session-specific)
  5. CLI arguments              (invocation-specific)
```

### 2.3 Platform-Specific Config Sources

#### Windows

| Source | Location | Access Method |
|--------|----------|--------------|
| Machine policy (HKLM) | `HKLM\SOFTWARE\AgentName\` | Registry read |
| User settings (HKCU) | `HKCU\SOFTWARE\AgentName\` | Registry read |
| Config file | `%APPDATA%\AgentName\settings.json` | File read |
| Managed profile | `%ProgramData%\AgentName\managed.json` | File read |

#### macOS

| Source | Location | Access Method |
|--------|----------|--------------|
| MDM managed plist | `/Library/Managed Preferences/com.agent.name.plist` | plist read |
| System config | `/Library/Application Support/AgentName/` | File read |
| User config | `~/Library/Application Support/AgentName/` | File read |
| Keychain | macOS Keychain Services | Security framework |

#### Linux

| Source | Location | Access Method |
|--------|----------|--------------|
| System config | `/etc/agent-name/config.json` | File read |
| Drop-in directory | `/etc/agent-name/conf.d/*.json` | File glob + merge |
| User config | `~/.config/agent-name/settings.json` | File read |
| XDG compliance | `$XDG_CONFIG_HOME/agent-name/` | File read |

### 2.4 Config Schema Validation

Validate all configuration against a schema at load time:

```
loadAndValidate(source):
  raw = readSource(source)

  try:
    validated = schema.parse(raw)
    return validated
  catch validationError:
    log.warn("Invalid config from {source}: {validationError}")
    return DEFAULTS  // fall back to defaults, don't crash
```

**Critical rule:** Never crash on invalid config. Log the error and fall back to safe defaults. Users shouldn't be locked out because of a typo in their settings file.

### 2.5 Config Merging

When merging from multiple sources:

```
mergeConfigs(sources):
  result = {}

  for source in sources (by priority):
    for key, value in source:
      if key not in result:  // first-source-wins for security settings
        result[key] = value
      elif isNonSecuritySetting(key):  // last-source-wins for preferences
        result[key] = value

  return result
```

### Deep Merge vs Shallow Merge

| Setting Type | Merge Strategy | Why |
|-------------|---------------|-----|
| Permission rules | **Deep merge** (arrays concatenated) | Org rules + user rules both apply |
| Blocked commands | **Deep merge** (arrays concatenated) | Org blocks + user blocks both apply |
| UI preferences | **Shallow replace** | User's preference overrides default |
| Model selection | **Shallow replace** | Most specific setting wins |

### 2.6 Change Detection

Config can change during a session (file edited, remote settings updated):

```
ConfigWatcher:
  watchedSources: Map<source, { lastHash, lastModified }>

  checkForChanges():
    for source in watchedSources:
      current = readSource(source)
      currentHash = hash(current)

      if currentHash != source.lastHash:
        source.lastHash = currentHash
        emit("config_changed", { source, old, new: current })

  onConfigChanged(source, oldConfig, newConfig):
    // Re-merge all sources
    mergedConfig = mergeConfigs(allSources)

    // Re-entrancy guard: don't trigger another change while processing this one
    if isProcessingChange:
      queueChange(mergedConfig)
      return

    isProcessingChange = true
    applyConfig(mergedConfig)
    isProcessingChange = false
```

### 2.7 Environment Variable Expansion

Config values can reference environment variables:

```json
{
  "api_key": "${AGENT_API_KEY}",
  "log_dir": "${HOME}/.agent/logs",
  "proxy": "${HTTPS_PROXY:-}"
}
```

**Expansion rules:**
- `${VAR}` — substitute value of VAR
- `${VAR:-default}` — substitute VAR or use "default" if unset
- `${VAR:?error}` — substitute VAR or fail with "error" if unset
- Undefined variables with no default → empty string or error (configurable)

**Security:** Re-validate the full config AFTER expansion. A variable containing shell metacharacters or SSRF targets could inject dangerous values.

---

## 3. Feature Flags

### Why Feature Flags

New features need safe rollout:
- Enable for internal users first
- Gradual rollout to wider audience
- Instant kill-switch if problems found
- A/B testing for UX experiments

### Flag Evaluation

```
isFeatureEnabled(flagName, context):
  // Check local override first (development, testing)
  if localOverrides.has(flagName):
    return localOverrides.get(flagName)

  // Check org policy (some features force-disabled for enterprise)
  if orgPolicy.disables(flagName):
    return false

  // Evaluate via feature flag service (e.g., GrowthBook, LaunchDarkly)
  return flagService.evaluate(flagName, {
    userId: context.userId,
    userType: context.userType,  // internal vs external
    platform: context.platform,
    version: context.appVersion
  })
```

### Flag Categories

| Category | Examples | Rollback Time |
|----------|---------|--------------|
| **Kill switches** | Disable a broken feature | Instant (no deploy needed) |
| **Rollout gates** | Enable new tool for 10% → 50% → 100% | Minutes |
| **Experiments** | Test prompt variant A vs B | End of experiment |
| **Entitlements** | Premium features for paid users | N/A (permanent) |
| **Internal** | Debug tools for developers | Always on for internal |

### Dead Code Elimination

Feature flags can enable build-time dead code elimination:

```
// At build time, if FEATURE_X is known to be disabled:
if (FEATURE_X_ENABLED) {
  // This entire block is removed from the production bundle
  importHeavyModule()
  registerExperimentalTools()
}
```

**Benefit:** Reduces bundle size and startup time for features that aren't yet enabled.

---

## 4. Enterprise Polling Patterns

When deploying in enterprise environments, agents fetch configuration from remote servers. These patterns ensure reliability.

### ETag-Based HTTP Caching

Avoid re-downloading unchanged settings:

```
fetchWithETag(url, currentData):
  checksum = sha256(JSON.stringify(sortKeys(currentData)))
  response = httpGet(url, {
    headers: { "If-None-Match": '"sha256:' + checksum + '"' },
    timeout: 10_000
  })
  if response.status == 304: return currentData  // unchanged
  if response.status == 404: return {}           // no settings
  return response.body                           // new settings
```

### Fail-Open vs Fail-Closed

| Policy Type | On Network Failure | Why |
|------------|-------------------|-----|
| Non-critical (preferences, UI) | **Fail open** — use cached or continue without | Don't block the agent over cosmetic settings |
| Compliance-critical (HIPAA, data handling) | **Fail closed** — deny the feature | Regulated environments require features stay disabled even during outages |

Maintain an explicit list of policies that must fail closed. Everything else fails open.

### Background Polling

```
startPolling(fetchFn, interval = 3600_000):  // 60 minutes
  timer = setInterval(interval, async () => {
    try:
      newData = await fetchFn()
      if changed(currentData, newData):
        currentData = newData
        notifySettingsChanged()  // trigger hot-reload
    catch:
      // Silently continue with cached settings
  })
  timer.unref()  // don't keep process alive just for polling
  registerCleanup(() => clearInterval(timer))
```

### Loading Promise Pattern

Remote settings load asynchronously. Other systems that depend on them await a loading promise with a timeout to prevent deadlocks:

```
loadingPromise = initializeRemoteSettings()
await Promise.race([loadingPromise, timeout(30_000)])
// After 30s, continue without remote settings rather than hang
```

### Settings Change Detection with Hot-Reload

When settings change (from polling, file edit, or sync), apply changes without restarting:

```
onSettingsChanged(source, newSettings):
  reExportEnvironmentVariables(newSettings)
  reloadPermissionRules(newSettings)
  reloadToolAvailability(newSettings)
  updateTelemetryConfig(newSettings)
  updateTheme(newSettings)
```

Use a re-entrancy guard to prevent concurrent reloads (see [AGENT-ENTERPRISE-AND-POLICY.md](AGENT-ENTERPRISE-AND-POLICY.md) for the full pattern).

---

## 5. Migration System

### Why Migrations

Config schemas evolve. Users have settings files from old versions. Without migrations:
- Old settings silently ignored (user confusion)
- Old settings cause validation errors (user locked out)
- Breaking changes require manual user intervention

### Migration Architecture

```
migrations/
  001_rename_model_field.ts
  002_add_permission_defaults.ts
  003_migrate_tool_names.ts
  004_upgrade_mcp_config_format.ts
```

Each migration:
```
Migration:
  version: number           // sequential
  name: string              // human-readable
  up(config): config        // transform old → new
  down(config): config      // transform new → old (for rollback)
```

### Migration Runner

```
runMigrations(config, currentVersion):
  pendingMigrations = allMigrations.filter(m => m.version > currentVersion)

  for migration in pendingMigrations (sorted by version):
    try:
      config = migration.up(config)
      config._version = migration.version
    catch error:
      log.error("Migration {migration.name} failed: {error}")
      // Don't crash — use last successful state
      break

  return config
```

### Backward Compatibility

Support reading old config formats for at least 2 major versions:

```
loadConfig(path):
  raw = readFile(path)
  version = raw._version or 0

  if version < MINIMUM_SUPPORTED_VERSION:
    warn("Config too old. Please re-run setup.")
    return DEFAULTS

  if version < CURRENT_VERSION:
    raw = runMigrations(raw, version)
    writeFile(path, raw)  // save migrated config

  return validate(raw)
```

---

## 5. Implementation Checklist

### Minimum Viable Bootstrap

- [ ] Sequential phase initialization (config → auth → tools → ready)
- [ ] Config from at least 2 sources (file + CLI args)
- [ ] Schema validation with fallback to defaults
- [ ] Startup timing (total time to ready)
- [ ] Lazy loading for heavy dependencies

### Minimum Viable Configuration

- [ ] File-based user settings
- [ ] Project-level settings
- [ ] Environment variable support
- [ ] CLI argument overrides
- [ ] Schema validation on load

### Production-Grade

- [ ] All of the above, plus:
- [ ] Parallel prefetching (keychain + remote + config in parallel)
- [ ] Per-phase startup profiling
- [ ] Platform-specific config sources (Registry/plist/XDG)
- [ ] First-source-wins for security settings
- [ ] Last-source-wins for preference settings
- [ ] Deep merge for permission/blocklist arrays
- [ ] Config change detection with re-entrancy guard
- [ ] Environment variable expansion with post-expansion validation
- [ ] Feature flag service integration
- [ ] Build-time dead code elimination for disabled features
- [ ] Config migration system (versioned, up/down transforms)
- [ ] Backward compatibility for old config formats
- [ ] MDM/enterprise policy enforcement (non-overridable)
- [ ] Drop-in config directories (Linux /etc/conf.d/ pattern)
- [ ] Startup memory baseline for leak detection

---

## Related Documents

- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — Authentication loaded during bootstrap phase 2
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Permission rules loaded from configuration
- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Plugin loading during bootstrap phase 4
- [AGENT-SYSTEM-PROMPT-ENGINEERING.md](AGENT-SYSTEM-PROMPT-ENGINEERING.md) — System prompt assembled in bootstrap phase 6
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — Model selection and API config from settings
