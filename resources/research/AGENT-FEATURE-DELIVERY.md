# Agent Feature Delivery

Best practices for auto-updates, version management, rate limit tier detection, subscription gating, remote kill switches, and contributor safety in autonomous AI agent systems. Derived from production analysis of agentic systems managing rolling updates across millions of installations with safe rollback and subscription-aware feature gating.

*Last updated: 2026-03-31*

---

## Why This Matters

An agent that can't update itself ships bugs forever. An agent without a kill switch can't be stopped when something goes wrong. An agent that doesn't respect subscription tiers loses revenue. And an agent that leaks internal information in public commits creates security incidents.

Production systems treat delivery as infrastructure — versioned, gated, reversible, and safe.

---

## 1. Auto-Update System

### Version Checking

Poll for updates on a fixed interval:

```
AutoUpdater:
  pollInterval: 1800_000  // 30 minutes
  isUpdating: false

  checkForUpdates():
    if isUpdating:
      return  // prevent concurrent updates

    latest = fetchLatestVersion(channel)  // npm registry, GitHub releases, etc.
    current = getCurrentVersion()

    if latest == null:
      return  // registry unreachable, skip

    // Check kill switch
    maxVersion = getMaxVersion()
    if maxVersion and semverGt(latest, maxVersion):
      latest = maxVersion  // cap at max allowed version

    // Check skip list
    if shouldSkipVersion(latest):
      return

    // Compare (ignore build metadata, e.g., +sha)
    if semverEq(current, latest):
      return  // already up to date

    performUpdate(latest)
```

### Update Channels

| Channel | npm Tag | Use Case |
|---------|---------|----------|
| `latest` | `@latest` | Current development, default |
| `stable` | `@stable` | Frozen releases for production |
| `beta` | `@beta` | Pre-release testing |

Users configure their channel in settings:

```json
{
  "autoUpdatesChannel": "stable"
}
```

### Installation Type Detection

Different installations need different update mechanisms:

| Type | Detection | Update Method |
|------|-----------|--------------|
| **npm global** | `npm list -g` includes package | `npm install -g package@version` |
| **npm local** | Package in `~/.agent/local/` | `npm install` in local directory |
| **Native installer** | Bundled binary with symlink | Native installer's update mechanism |
| **Package manager** | Homebrew/winget/apt/rpm | Show manual instructions, don't auto-update |
| **Development** | `NODE_ENV=development` or `.git` in package dir | Cannot auto-update, warn and exit |

```
detectInstallationType():
  if isDevelopmentBuild():
    return "development"

  if hasNativeInstallerSymlink():
    return "native"

  if installedViaPackageManager():
    return packageManagerName  // "homebrew", "winget", etc.

  if isGlobalNpmInstall():
    return "npm-global"

  return "npm-local"  // default
```

### Update Workflow

```
performUpdate(targetVersion):
  isUpdating = true

  try:
    installType = detectInstallationType()

    switch installType:
      case "development":
        warn("Cannot auto-update development builds")
        return

      case "homebrew":
      case "winget":
      case "apt":
        show("Update available: {targetVersion}. Run: {packageManagerUpdateCommand}")
        return

      case "native":
        // Use native installer with lock contention handling
        nativeInstaller.update(targetVersion)

      case "npm-global":
        exec("npm install -g {packageName}@{targetVersion}")

      case "npm-local":
        exec("npm install {packageName}@{targetVersion}", cwd: localInstallDir)

    log.info("Updated to {targetVersion}")
    trackEvent("update_success", { from: currentVersion, to: targetVersion, method: installType })

  catch error:
    log.error("Update failed: {error}")
    trackEvent("update_failed", { target: targetVersion, error: error.message })

  finally:
    isUpdating = false
```

---

## 2. Remote Kill Switch

### The Problem

A critical bug ships. Users are affected. You need to stop them from running that version — or prevent them from updating to it.

### Max Version Mechanism

A server-side configuration that caps the maximum allowed version:

```
MaxVersionConfig:
  version: "2.3.1"               // cap version
  message: "Version 2.4.0 has a critical bug. Capped at 2.3.1."
```

### Enforcement

```
enforceMaxVersion(desiredVersion):
  maxConfig = fetchMaxVersionConfig()  // from remote config service

  if maxConfig == null:
    return desiredVersion  // config unavailable, don't block

  if semverGt(desiredVersion, maxConfig.version):
    log.warn("Version {desiredVersion} exceeds max allowed {maxConfig.version}")

    if maxConfig.message:
      show(maxConfig.message)

    return maxConfig.version  // downgrade to max allowed

  return desiredVersion
```

### Skip Version

Allow users to pin a minimum version to prevent downgrades:

```json
{
  "minimumVersion": "2.3.0"
}
```

```
shouldSkipVersion(targetVersion):
  minVersion = settings.minimumVersion
  if minVersion and semverLt(targetVersion, minVersion):
    return true  // don't downgrade below user's minimum
  return false
```

---

## 3. Subscription Tier Detection

### Tier Hierarchy

| Tier | Detection Source | Features |
|------|-----------------|----------|
| **Enterprise** | OAuth token scope | All features, custom policies |
| **Team** | OAuth token scope | All features, team collaboration |
| **Max** | OAuth token scope | Premium models, higher limits |
| **Pro** | OAuth token scope | Standard features |
| **Free** | No paid scope / API key only | Basic features, lower limits |

### Detection from Auth Context

```
detectSubscriptionTier(authContext):
  if authContext.type == "api_key":
    return null  // API users don't have tiers (usage-based)

  if authContext.type == "oauth":
    return authContext.subscriptionType  // from token claims
```

### Feature Gating by Tier

```
TIER_FEATURES = {
  "free":       ["basic_tools", "file_edit"],
  "pro":        ["basic_tools", "file_edit", "web_search", "mcp"],
  "max":        ["basic_tools", "file_edit", "web_search", "mcp", "premium_models", "extended_context"],
  "team":       ["basic_tools", "file_edit", "web_search", "mcp", "premium_models", "team_memory"],
  "enterprise": ["*"]  // all features
}

canUseFeature(feature, tier):
  if tier == null:
    return true  // API users get all features (pay per token)
  allowed = TIER_FEATURES[tier]
  return "*" in allowed or feature in allowed
```

### Rate Limit Adaptation

Different tiers have different rate limits. Detect and adapt:

```
getRateLimits(tier):
  switch tier:
    case "free":       return { rpm: 10,  tpm: 20_000 }
    case "pro":        return { rpm: 60,  tpm: 100_000 }
    case "max":        return { rpm: 120, tpm: 300_000 }
    case "team":       return { rpm: 120, tpm: 300_000 }
    case "enterprise": return { rpm: 300, tpm: 1_000_000 }
    default:           return { rpm: 60,  tpm: 100_000 }  // safe default
```

### Spend Cap Detection

For organizations with spending limits:

```
checkSpendCap(authContext):
  if authContext.orgSpendCap:
    if authContext.creditsRemaining <= 0:
      return BLOCKED("Organization spend cap reached")

    if authContext.creditsRemaining < LOW_CREDITS_THRESHOLD:
      return WARNING("Low credits remaining: ${authContext.creditsRemaining}")

  return OK
```

---

## 4. Contributor Safety Mode

### The Problem

When an AI agent contributes to public repositories, it can accidentally leak:
- Internal model codenames
- Unreleased version numbers
- Internal project names or Slack channels
- AI attribution that the project wants to avoid
- Internal tooling references

### Detection: Public vs Internal Repository

```
classifyRepository():
  remoteUrl = git remote get-url origin

  if remoteUrl == null:
    return "unknown"  // no remote, assume public (safe default)

  if remoteUrl in INTERNAL_REPO_ALLOWLIST:
    return "internal"  // safe to include internal references

  return "public"  // assume public, activate safety mode
```

**Safe default:** If uncertain, assume public. Better to strip unnecessary info than to leak internal details.

### What to Strip

When contributor safety mode is active, instruct the agent to never include:

| Category | Examples |
|----------|---------|
| Model codenames | Internal animal names, project codenames |
| Unreleased versions | Future model version numbers |
| Internal repos | Internal organization names, private repo URLs |
| Internal tooling | Internal CLI tools, dashboards, Slack channels |
| AI attribution | "Generated by AI", "Co-authored-by: AI", model names |
| Internal links | Internal documentation URLs, wiki links |

### Implementation

Inject safety instructions into the system prompt when contributor safety mode is active:

```
if contributorSafetyMode:
  appendToSystemPrompt("""
    You are contributing to a public repository. Do NOT include:
    - Internal model names or codenames
    - Unreleased product version numbers
    - Internal repository or project names
    - Internal Slack channels or documentation links
    - AI tool names or AI attribution lines
    - Co-Authored-By lines referencing AI

    Write commit messages and PR descriptions as a human developer would.
  """)
```

### Activation Logic

```
isContributorSafetyActive():
  // Force ON via environment variable
  if env.CONTRIBUTOR_SAFETY == "1":
    return true

  // Force OFF only for confirmed internal repos
  repoClass = classifyRepository()
  if repoClass == "internal":
    return false

  // Default: ON for public and unknown repos
  return true
```

### Commit Attribution Sanitization

When the agent creates commits, sanitize the attribution:

```
sanitizeCommitAttribution(modelName):
  // Map internal model names to public equivalents
  PUBLIC_NAMES = {
    "internal-large-*": "public-large-model",
    "internal-medium-*": "public-medium-model",
    "*": "ai-assistant"  // fallback
  }

  for pattern, publicName in PUBLIC_NAMES:
    if matches(modelName, pattern):
      return publicName

  return "ai-assistant"  // safe fallback
```

---

## 5. Version Migration

### When Updates Change Behavior

Sometimes an update changes configuration format, default settings, or tool behavior. Migrations handle the transition:

```
VersionMigration:
  fromVersion: "2.3.x"
  toVersion: "2.4.0"
  description: "Migrate model setting from string to object"

  migrate(config):
    if typeof config.model == "string":
      config.model = { name: config.model, tier: "medium" }
    return config
```

### Running Migrations on Update

```
onUpdateComplete(fromVersion, toVersion):
  migrations = findApplicableMigrations(fromVersion, toVersion)

  for migration in migrations (sorted by version):
    try:
      config = migration.migrate(config)
      config._migratedTo = migration.toVersion
    catch error:
      log.warn("Migration {migration.description} failed: {error}")
      // Don't crash — partial migration is better than no migration
      break

  saveConfig(config)
```

---

## 6. Implementation Checklist

### Minimum Viable Feature Delivery

- [ ] Version checking against registry (npm, GitHub, etc.)
- [ ] Semver comparison (ignore build metadata)
- [ ] Auto-update for at least one installation type
- [ ] Update polling interval (30 minutes)
- [ ] Concurrent update prevention (isUpdating flag)
- [ ] Subscription tier detection from auth context
- [ ] Basic feature gating by tier

### Production-Grade Feature Delivery

- [ ] All of the above, plus:
- [ ] Multiple update channels (latest, stable, beta)
- [ ] Installation type detection and per-type update logic
- [ ] Package manager detection (show manual instructions)
- [ ] Remote kill switch (max version cap)
- [ ] Skip version / minimum version pinning
- [ ] Update success/failure telemetry
- [ ] Rate limit adaptation by tier
- [ ] Spend cap detection and blocking
- [ ] Contributor safety mode (public repo detection)
- [ ] Internal repo allowlist
- [ ] System prompt injection for safety mode
- [ ] Commit attribution sanitization
- [ ] Version migration system (config format evolution)
- [ ] Migration ordering and partial failure handling
- [ ] Stale closure prevention in polling callbacks

---

## Related Documents

- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — Authentication that provides subscription tier
- [AGENT-BOOTSTRAP-AND-CONFIGURATION.md](AGENT-BOOTSTRAP-AND-CONFIGURATION.md) — Feature flags and config migration
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — Rate limiting adapted to subscription tier
- [AGENT-SYSTEM-PROMPT-ENGINEERING.md](AGENT-SYSTEM-PROMPT-ENGINEERING.md) — Safety instructions injected for contributor mode
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Feature-gated permissions
