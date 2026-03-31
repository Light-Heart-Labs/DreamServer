# Agent Enterprise and Policy Enforcement

Best practices for deploying autonomous AI agents in enterprise environments — remote managed settings, organization policy enforcement, cross-device settings synchronization, security approval flows, and fail-open/fail-closed patterns. Derived from production analysis of agentic systems deployed in regulated enterprises with HIPAA requirements, org-level spend caps, and centralized configuration management.

*Last updated: 2026-03-31*

---

## Why This Matters

Enterprise deployment transforms an agent from a developer tool into regulated infrastructure. IT admins need to enforce policies (block certain tools, restrict network access, mandate security settings). Settings must sync across devices. Dangerous configuration changes need user approval. And the system must handle network failures gracefully — failing open for non-critical settings, failing closed for compliance-critical ones.

---

## 1. Remote Managed Settings

### Architecture

A central server distributes configuration to all agent installations in an organization:

```
Agent Instance                      Settings Server
     |                                     |
     |-- GET /managed_settings ----------->|
     |<-- 200 { settings } or 304 ---------|
     |                                     |
     |   (background poll every 60min)     |
     |-- GET /managed_settings ----------->|
     |   If-None-Match: "sha256:abc..."    |
     |<-- 304 Not Modified ----------------|
```

### Eligibility

Not all users receive managed settings:

| User Type | Eligible | Why |
|-----------|----------|-----|
| API key (Console) | Always | All API users can receive org policies |
| OAuth Enterprise | Yes | Enterprise subscribers have admin-managed configs |
| OAuth Team | Yes | Team subscribers have admin-managed configs |
| OAuth Pro/Free | No | Individual users manage their own settings |
| Custom API base URL | No | Non-standard deployments bypass managed settings |

### ETag-Based Caching

```
fetchManagedSettings(currentCache):
  // Compute checksum from sorted, normalized settings JSON
  checksum = sha256(JSON.stringify(sortKeys(currentCache)))

  response = httpGet("/managed_settings", {
    headers: { "If-None-Match": `"sha256:${checksum}"` },
    timeout: 10_000  // 10 seconds
  })

  if response.status == 304:
    return currentCache  // unchanged, use cached version

  if response.status == 404:
    deleteCache()
    return {}  // no managed settings

  if response.status == 200:
    newSettings = response.body
    saveToCache(newSettings)
    return newSettings
```

### Fail-Open Behavior

When the settings server is unreachable:

```
loadManagedSettings():
  try:
    return await fetchFromServer()
  catch NetworkError:
    cached = loadFromDisk()  // ~/.agent/managed-settings.json
    if cached:
      return cached  // use last known good settings
    return {}  // no settings — continue without restrictions
```

**Never block the agent from starting because managed settings are unavailable.** Fail open for non-critical settings.

### Background Polling

```
startSettingsPolling():
  interval = setInterval(3600_000, async () => {  // 60 minutes
    try:
      newSettings = await fetchManagedSettings(currentSettings)

      if settingsChanged(currentSettings, newSettings):
        currentSettings = newSettings
        notifySettingsChanged()  // hot-reload
    catch:
      // Silently continue with cached settings
  })

  // Don't keep process alive just for polling
  interval.unref()

  // Register cleanup to stop polling on shutdown
  registerCleanup(() => clearInterval(interval))
```

### Loading Promise Pattern

Managed settings load asynchronously. Other systems need to wait:

```
// During bootstrap:
loadingPromise = initializeManagedSettings()

// Other systems await before initializing:
await Promise.race([
  loadingPromise,
  timeout(30_000)  // 30-second max wait, prevent deadlock
])
```

---

## 2. Security Approval Flow

### Dangerous Settings Detection

Some settings changes require explicit user approval:

| Dangerous Setting | Why |
|------------------|-----|
| Hooks (shell commands) | Could execute arbitrary code |
| Managed file paths | Could point to sensitive directories |
| Script configurations | Could run untrusted scripts |
| Permission overrides | Could bypass safety rules |

### Approval Flow

```
onSettingsChanged(oldSettings, newSettings):
  dangerousChanges = detectDangerousChanges(oldSettings, newSettings)

  if dangerousChanges.length == 0:
    return APPLY  // safe changes, apply immediately

  if not isInteractiveMode():
    return APPLY  // non-interactive, can't prompt user

  // Show blocking dialog
  approved = await showSecurityDialog({
    title: "Settings Change Requires Approval",
    changes: dangerousChanges,
    actions: ["Accept", "Reject"]
  })

  if approved:
    logEvent("settings_security_accepted")
    return APPLY

  logEvent("settings_security_rejected")
  gracefulShutdown(exitCode: 1)  // user rejected — exit
```

---

## 3. Organization Policy Limits

### What Policies Control

| Policy | Effect When Disabled |
|--------|---------------------|
| `allow_product_feedback` | Disable feedback submission |
| `allow_web_search` | Block web search tool |
| `allow_shell_execution` | Block shell/bash tool |
| `allow_file_write` | Block file modifications |
| `allow_mcp_servers` | Block external MCP connections |
| (extensible) | Any feature can be policy-gated |

### Policy Fetch and Caching

Same pattern as managed settings (ETag, 60-min polling, fail-open), with one critical difference:

### Fail-Closed for Essential Policies

```
ESSENTIAL_TRAFFIC_DENY_ON_MISS = ["allow_product_feedback"]

isPolicyAllowed(policyName):
  // Fast path: check session cache
  if sessionCache has policyName:
    return sessionCache[policyName].allowed

  // Slow path: check file cache
  fileCache = readPolicyCache()
  if fileCache has policyName:
    return fileCache[policyName].allowed

  // No cache available
  if isEssentialTrafficOnly() and policyName in ESSENTIAL_TRAFFIC_DENY_ON_MISS:
    return false  // FAIL CLOSED — compliance requirement

  return true  // Fail open for non-essential policies
```

**Why fail-closed for some policies:** HIPAA and other regulations require that compliance-critical features stay disabled even when the policy server is unreachable. A healthcare org that blocks data feedback must keep it blocked even during outages.

### Refresh on Auth Change

```
onAuthChanged():
  // Clear all cached policies
  sessionCache = null
  deletePolicyCacheFile()

  // Refetch with new auth context (new subscription may have different policies)
  await fetchPolicies()
```

---

## 4. Cross-Device Settings Sync

### What Syncs

| Key | Content |
|-----|---------|
| `settings.json` | User preferences and configuration |
| `hooks.json` | Custom hook definitions |
| `keybindings.json` | Keyboard shortcut customizations |
| `config.json` | Agent configuration |
| Memory files | Auto-managed and user-created memories |

### Upload Flow (Local → Cloud)

```
uploadSettings():
  // Gate checks
  if not isOAuthUser(): return
  if not isInteractiveMode(): return
  if not featureEnabled("settings_sync_push"): return

  // Fetch current remote state
  remoteEntries = await fetchRemoteSettings()

  // Build local entries
  localEntries = buildLocalEntries(SYNC_KEYS)

  // Find changed entries (incremental delta)
  changed = localEntries.filter(local =>
    !remoteEntries.has(local.key) or
    remoteEntries.get(local.key).value != local.value
  )

  if changed.length == 0: return  // nothing to sync

  // Upload with retry
  await uploadWithRetry(changed, {
    maxRetries: 3,
    maxFileSize: 500_000,  // 500KB per file (backend limit)
    timeout: 10_000
  })
```

### Download Flow (Cloud → Local)

```
downloadSettings():
  // Typically runs during container initialization (before plugins install)
  if not featureEnabled("settings_sync_download"): return

  remoteEntries = await fetchRemoteSettings()

  for entry in remoteEntries:
    localPath = resolveLocalPath(entry.key)
    mkdirRecursive(dirname(localPath))
    writeFile(localPath, entry.value, { mode: 0o600 })

  // Clear memory file cache (downloaded memories may differ)
  clearMemoryFileCache()
```

### Conflict Resolution

Simple strategy: **most recent write wins per key**. No merge — the entire file is replaced.

For more sophisticated needs (e.g., hooks.json where two devices add different hooks), consider a merge strategy, but production systems typically use last-write-wins for simplicity and predictability.

---

## 5. Settings Change Detection and Hot-Reload

### Change Detection

```
SettingsChangeDetector:
  watchers: Map<source, FileWatcher>
  listeners: Set<ChangeListener>

  watch(sources):
    for source in sources:
      watcher = watchFile(source.path, () => {
        newValue = readAndParse(source.path)
        if changed(source.lastValue, newValue):
          source.lastValue = newValue
          notifyListeners(source.name, newValue)
      })
      watchers.set(source.name, watcher)

  notifyListeners(sourceName, newValue):
    for listener in listeners:
      listener.onSettingsChanged(sourceName, newValue)
```

### Hot-Reload Consumers

When settings change at runtime, these systems update without restart:

| Consumer | What It Updates |
|----------|----------------|
| Environment variables | Re-export settings-derived env vars |
| Telemetry config | Update analytics destination/verbosity |
| Permission rules | Reload allow/deny/ask rules |
| Tool availability | Enable/disable tools based on new settings |
| Feature flags | Re-evaluate flag conditions |
| Theme | Update terminal colors/styles |

### Re-entrancy Guard

```
SettingsReloader:
  isProcessing: boolean
  pendingReload: Settings | null

  onChanged(newSettings):
    if isProcessing:
      pendingReload = newSettings  // queue, don't process concurrently
      return

    isProcessing = true
    try:
      applySettings(newSettings)
    finally:
      isProcessing = false

      if pendingReload:
        queued = pendingReload
        pendingReload = null
        onChanged(queued)  // process queued reload
```

---

## 6. Implementation Checklist

### Minimum Viable Enterprise

- [ ] Remote managed settings fetch with ETag caching
- [ ] Fail-open on network failure (use cached settings)
- [ ] Background polling (60-minute interval)
- [ ] Policy enforcement (isPolicyAllowed check)
- [ ] File-based policy cache

### Production-Grade Enterprise

- [ ] All of the above, plus:
- [ ] Eligibility checks (subscription tier gating)
- [ ] Loading promise pattern (30s timeout for async init)
- [ ] Security approval flow for dangerous settings
- [ ] Blocking dialog in interactive mode
- [ ] Rejection → graceful shutdown
- [ ] Fail-closed for essential policies (HIPAA compliance)
- [ ] Policy refresh on auth change
- [ ] Cross-device settings sync (upload + download)
- [ ] Incremental delta upload (only changed keys)
- [ ] File size limits (500KB per file)
- [ ] Retry with exponential backoff (3 attempts)
- [ ] Settings change detection via file watchers
- [ ] Hot-reload for env vars, telemetry, permissions, tools, flags, theme
- [ ] Re-entrancy guard on settings reload
- [ ] Cleanup registration (stop polling on shutdown)
- [ ] setInterval.unref() (don't keep process alive)

---

## Related Documents

- [AGENT-BOOTSTRAP-AND-CONFIGURATION.md](AGENT-BOOTSTRAP-AND-CONFIGURATION.md) — Multi-source config where enterprise settings have highest priority
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Organization policies feed into permission rules
- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — Subscription tier determines policy eligibility
- [AGENT-FEATURE-DELIVERY.md](AGENT-FEATURE-DELIVERY.md) — Rate limit tiers and subscription gating
- [AGENT-LIFECYCLE-AND-PROCESS.md](AGENT-LIFECYCLE-AND-PROCESS.md) — Cleanup handlers for polling intervals
- [AGENT-REMOTE-AND-TEAM-COLLABORATION.md](AGENT-REMOTE-AND-TEAM-COLLABORATION.md) — Settings sync for remote environments
