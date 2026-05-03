# Codex Rate Limit Monitoring — Full System Research

> Temporary research file. Delete after implementation.

## Table of Contents

1. [Codex Usage API](#1-codex-usage-api)
2. [Current System Architecture](#2-current-system-architecture)
3. [Anthropic-Hardcoded Locations](#3-anthropic-hardcoded-locations)
4. [Provider-Agnostic Parts (No Changes Needed)](#4-provider-agnostic-parts)
5. [Implementation Plan](#5-implementation-plan)

---

## 1. Codex Usage API

**Sources:** OpenAI Codex source code (`github.com/openai/codex`, Rust codebase), CodexBar macOS app (`github.com/steipete/CodexBar`), Context7 Codex developer docs.

### 1.1 Active Polling Endpoint

```
GET https://chatgpt.com/backend-api/wham/usage
```

Fallback (when base URL doesn't contain `/backend-api`):
```
GET {base_url}/api/codex/usage
```

**Required Headers:**
```http
Authorization: Bearer <access_token>
ChatGPT-Account-Id: <account_id>
Content-Type: application/json
Accept: application/json
```

- `access_token` — The OAuth access token from `auth.openai.com` (same token our `codex-oauth.ts` already obtains)
- `account_id` — Account UUID from OAuth token data. Stored in `~/.codex/auth.json` under `tokens.account_id`. Optional per CodexBar ("when available") but may be required.

### 1.2 Response Schema

From `codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_payload.rs`:

```json
{
  "plan_type": "plus",
  "rate_limit": {
    "allowed": true,
    "limit_reached": false,
    "primary_window": {
      "used_percent": 96,
      "limit_window_seconds": 18000,
      "reset_after_seconds": 673,
      "reset_at": 1730947200
    },
    "secondary_window": {
      "used_percent": 70,
      "limit_window_seconds": 604800,
      "reset_after_seconds": 43200,
      "reset_at": 1730980800
    }
  },
  "credits": {
    "has_credits": false,
    "unlimited": true,
    "balance": null
  },
  "additional_rate_limits": [
    {
      "limit_name": "codex_other",
      "metered_feature": "codex_other",
      "rate_limit": {
        "allowed": true,
        "limit_reached": false,
        "primary_window": {
          "used_percent": 70,
          "limit_window_seconds": 3600,
          "reset_after_seconds": 1800,
          "reset_at": 1730947200
        }
      }
    }
  ]
}
```

- `primary_window` = 5h session (18000s). Maps to our `sessionPercent`.
- `secondary_window` = Weekly (604800s = 7d). Maps to our `weeklyPercent`.
- `reset_at` = Unix timestamp (seconds). Convert to ms for our `sessionResetTimestamp`/`weeklyResetTimestamp`.
- `plan_type` values: `guest`, `free`, `go`, `plus`, `pro`, `free_workspace`, `team`, `business`, `education`, `quorum`, `k12`, `enterprise`, `edu`

### 1.3 Passive Headers (From API Responses)

Rate limit data is also returned in HTTP response headers on every `/v1/responses` call:

```
x-codex-primary-used-percent         → float (e.g., "25.0")
x-codex-primary-window-minutes       → integer (e.g., "300" for 5h)
x-codex-primary-reset-at             → unix timestamp seconds
x-codex-secondary-used-percent       → float (weekly)
x-codex-secondary-window-minutes     → integer
x-codex-secondary-reset-at           → unix timestamp seconds
x-codex-credits-has-credits          → "true" or "false"
x-codex-credits-unlimited            → "true" or "false"
x-codex-credits-balance              → decimal string e.g. "9.99"
```

SSE event type `codex.rate_limits` also carries this data inline in streaming responses.

### 1.4 Token Details

Our `codex-oauth.ts` already uses the correct flow:
- **Client ID:** `app_EMoamEEZ73f0CkXaXp7hrann` (same as Codex CLI)
- **Auth endpoint:** `https://auth.openai.com/oauth/authorize`
- **Token endpoint:** `https://auth.openai.com/oauth/token`
- **Scopes:** `openid profile email offline_access`
- **Refresh:** `POST https://auth.openai.com/oauth/token` with `grant_type=refresh_token`

**Missing:** `account_id` for the `ChatGPT-Account-Id` header. Options:
1. Decode from the JWT access token
2. Read from `~/.codex/auth.json` (`tokens.account_id`)
3. Extract during OAuth token exchange (may be in response)
4. Try without it first (optional per CodexBar docs)

---

## 2. Current System Architecture

### 2.1 Two Parallel Account Systems

The app has TWO account management systems that don't fully integrate:

**System A: Legacy Claude Profile Manager (Main Process)**
- `claude-profile-manager.ts` — Manages OAuth profiles, rate limits, usage, auto-swap
- `claude-profiles.json` — Stores profiles with `activeProfileId`, `accountPriorityOrder`
- `usage-monitor.ts` — Polls Anthropic's `/api/oauth/usage` endpoint every 30s
- `token-refresh.ts` — Refreshes tokens via `console.anthropic.com/v1/oauth/token`
- `rate-limit-detector.ts` — Detects rate limits, triggers auto-swap
- `profile-scorer.ts` — Scores profiles by availability for auto-swap
- **100% Anthropic-specific.** Only knows about Anthropic OAuth tokens, Anthropic endpoints, Anthropic keychain format.

**System B: Multi-Provider Accounts (Renderer + Settings)**
- `ProviderAccount[]` in `settings-store.ts` — All connected accounts (any provider)
- `globalPriorityOrder: string[]` in AppSettings — Manual priority queue
- `useActiveProvider()` hook — First account in priority order = active
- **Provider-agnostic.** Works for all 10 providers. But has NO usage monitoring, NO auto-swap.

**The gap:** System A handles usage monitoring + auto-swap but only for Anthropic. System B handles multi-provider accounts but has no usage awareness.

### 2.2 Data Flow: Usage Polling

```
UsageMonitor.start() → 30s interval
  ↓
checkUsageAndSwap()
  ├─ determineActiveProfile()           ← Hardcoded: defaults to anthropic baseUrl
  ├─ getCredential()                    ← Hardcoded: reads from Anthropic keychain
  │   └─ ensureValidToken(configDir)    ← Hardcoded: refreshes via Anthropic endpoint
  ├─ fetchUsageViaAPI()                 ← Hardcoded: only allows anthropic/zai/zhipu domains
  │   ├─ getUsageEndpoint(provider)     ← Only 3 providers configured
  │   ├─ Add anthropic-specific headers ← if (provider === 'anthropic') add beta headers
  │   └─ Parse response                ← Provider-specific normalization
  ├─ emit('usage-updated')             → IPC 'claude:usageUpdated' → renderer
  ├─ emit('all-profiles-usage-updated') → IPC 'claude:allProfilesUsageUpdated' → renderer
  └─ checkThresholdsExceeded()
     └─ performProactiveSwap()          ← Only swaps Anthropic profiles
```

### 2.3 Data Flow: Account Swapping

**Manual swap (UI):**
```
User clicks account in UsageIndicator popover
  → handleSwapAccount(accountId)
  → setQueueOrder([accountId, ...rest])    ← Reorders globalPriorityOrder
  → requestUsageUpdate()                   ← Refreshes usage display
```

**Automatic swap (rate limit hit):**
```
SDK operation fails with 429
  → detectRateLimit(output)                ← Pattern: "Limit reached · resets..."
  → recordRateLimitEvent(profileId)
  → getBestAvailableProfileEnv()
  → profileManager.setActiveProfile()      ← Only updates claude-profiles.json
  → usageMonitor.getAllProfilesUsage()     ← Refreshes UI
  ← Returns new profile env vars
```

**Problem:** Auto-swap updates `claude-profiles.json` but NOT `globalPriorityOrder`. The renderer's priority queue may be out of sync.

### 2.4 UI Components

| Component | What it shows | Provider-specific? |
|---|---|---|
| `AuthStatusIndicator` | Provider badge (OpenAI/Anthropic) + auth type label | Codex = green "Codex", Anthropic = orange "OAuth" |
| `UsageIndicator` | Usage bars OR "Subscription" OR "Unlimited" | Anthropic OAuth = bars, Codex OAuth = "Subscription", API = "Unlimited" |
| `ProviderAccountCard` | Account card in settings with usage bars | Shows usage bars only when `account.usage` populated (Anthropic only) |
| `ProviderAccountsList` | All accounts grouped by provider | Generic, but re-auth routes differ per provider |
| `AddAccountDialog` | OAuth flow + account creation | Different flows: Codex → `codexAuthLogin()`, Anthropic → `claudeAuthLoginSubprocess()` |
| `ProviderSection` | Provider group with "Add" buttons | Button label: "Add Codex Subscription" vs "Add OAuth" |

### 2.5 Type Naming

Types use "Claude" prefix but are structurally generic:
```typescript
ClaudeUsageSnapshot    → { sessionPercent, weeklyPercent, resetTimestamps, profileId, ... }
ClaudeUsageData        → { sessionUsagePercent, weeklyUsagePercent }
ClaudeRateLimitEvent   → { type, hitAt, resetAt }
ProfileUsageSummary    → { sessionPercent, weeklyPercent, availabilityScore, ... }
AllProfilesUsage       → { activeProfile, allProfiles[], fetchedAt }
```

These types work perfectly for Codex data — same session/weekly model. No structural changes needed, just need to populate them.

---

## 3. Anthropic-Hardcoded Locations

### 3.1 CRITICAL — Must Change

| File | Line(s) | What's hardcoded | What to do |
|---|---|---|---|
| `usage-monitor.ts:45-49` | `ALLOWED_USAGE_API_DOMAINS` | Only `api.anthropic.com`, `api.z.ai`, `open.bigmodel.cn` | Add `chatgpt.com` |
| `usage-monitor.ts:60-73` | `PROVIDER_USAGE_ENDPOINTS` | Only anthropic/zai/zhipu paths | Add `{ provider: 'openai', usagePath: '/wham/usage' }` |
| `usage-monitor.ts:662,1069,1346,1359` | `baseUrl: 'https://api.anthropic.com'` | Hardcoded fallback for all OAuth profiles | Detect provider from account, use `chatgpt.com/backend-api` for Codex |
| `usage-monitor.ts:1424` | `if (provider === 'anthropic')` adds beta headers | Anthropic-specific `anthropic-beta` header | Add `else if (provider === 'openai')` to add `ChatGPT-Account-Id` header |
| `token-refresh.ts:31` | `ANTHROPIC_TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token'` | Only Anthropic refresh endpoint | Route to `auth.openai.com/oauth/token` for Codex |
| `token-refresh.ts:37` | `CLAUDE_CODE_CLIENT_ID = '9d1c250a-...'` | Only Anthropic client ID | Use `app_EMoamEEZ73f0CkXaXp7hrann` for Codex |
| `UsageIndicator.tsx:118` | `provider === 'anthropic' && authType === 'oauth'` | Only Anthropic gets usage bars | Add `\|\| provider === 'openai'` |

### 3.2 MODERATE — Should Change

| File | Line(s) | What's hardcoded | What to do |
|---|---|---|---|
| `usage-monitor.ts:1040-1072` | `determineActiveProfile()` | Returns `baseUrl: 'https://api.anthropic.com'` for all OAuth | Detect provider, return `chatgpt.com/backend-api` for Codex |
| `credential-utils.ts` | Keychain service names | `"Claude Code-credentials"` | Codex tokens stored differently (file-based, not keychain) |
| `usage-monitor.ts:1513` | `if (provider === 'zai' \|\| provider === 'zhipu')` | Provider-specific response unwrapping | Add Codex response parsing (different JSON structure) |
| `rate-limit-detector.ts:14` | `RATE_LIMIT_PATTERN` | Claude-specific: `"Limit reached · resets..."` | Add Codex-specific patterns |
| IPC channel names | `'claude:usageUpdated'`, `'claude:allProfilesUsageUpdated'` | "claude" prefix | Cosmetic — rename to `'usage:updated'` etc. (optional, low priority) |

### 3.3 LOW PRIORITY — Nice to Have

| Item | What | Why low priority |
|---|---|---|
| Type naming | `ClaudeUsageSnapshot` → `UsageSnapshot` | Structural refactor, types work as-is for Codex |
| IPC method names | `requestUsageUpdate` returns `ClaudeUsageSnapshot` | Works fine, just naming |
| `claudeProfileId` on `ProviderAccount` | Only used for Anthropic OAuth | Codex doesn't need it |

---

## 4. Provider-Agnostic Parts

These components already work for any provider and need NO changes:

| Component/Module | Why it's already generic |
|---|---|
| `profile-scorer.ts` | Scores by `billingModel`, usage thresholds, rate limit events — no provider checks |
| `rate-limit-manager.ts` | Stores/checks rate limit events — pure data, no provider logic |
| `operation-registry.ts` | Tracks running operations — no provider awareness |
| `ProviderAccount` type | Has `provider` field, `billingModel`, `usage` — works for any provider |
| `globalPriorityOrder` | Array of account IDs — provider-agnostic ordering |
| `useActiveProvider()` hook | Returns first account in priority order — generic |
| `ProviderAccountCard` | Shows usage bars when `account.usage` is populated — will work for Codex once data flows |
| `AddAccountDialog` | Already has separate Codex OAuth flow |
| `AuthStatusIndicator` | Already shows Codex-specific green badge |
| All i18n keys | Codex-specific labels already exist |

---

## 5. Implementation Plan

### Phase 1: Codex Usage Fetcher (Core)

Create `apps/desktop/src/main/claude-profile/codex-usage-fetcher.ts`:

```typescript
// Responsibilities:
// 1. Read Codex OAuth token (from our codex-auth.json)
// 2. Read account_id (from ~/.codex/auth.json or JWT decode)
// 3. Call GET https://chatgpt.com/backend-api/wham/usage
// 4. Parse response into ClaudeUsageSnapshot format
// 5. Handle 401 → refresh token via codex-oauth.ts
// 6. Handle 403 → mark as needsReauthentication
```

**Key function:**
```typescript
async function fetchCodexUsage(accessToken: string, accountId?: string): Promise<ClaudeUsageSnapshot>
```

### Phase 2: Wire into Usage Monitor

Modify `usage-monitor.ts`:

1. Add `chatgpt.com` to `ALLOWED_USAGE_API_DOMAINS`
2. Add Codex to `PROVIDER_USAGE_ENDPOINTS`
3. Update `determineActiveProfile()` to detect Codex accounts from `globalPriorityOrder`
4. Update `getCredential()` to read Codex OAuth token (from `codex-auth.json`)
5. Update `fetchUsageViaAPI()` to handle Codex response format
6. Add Codex-specific headers (`ChatGPT-Account-Id`)
7. Add Codex response parsing (different JSON structure than Anthropic)

### Phase 3: Token Refresh Routing

Modify `token-refresh.ts` or create parallel Codex path:

- When refreshing a Codex token, use `auth.openai.com/oauth/token` with Codex client ID
- When refreshing an Anthropic token, use `console.anthropic.com/v1/oauth/token` with Claude client ID
- Provider detection: check the account's `provider` field, or detect from token prefix

### Phase 4: UI Updates

1. `UsageIndicator.tsx:118` — Add `|| provider === 'openai'` to `hasUsageMonitoring`
2. That's it — the rest of the UI already handles usage bars, reset times, multi-profile display generically

### Phase 5: Auto-Swap for Codex

1. Add Codex-specific rate limit patterns to `rate-limit-detector.ts`
2. Codex returns `"codexErrorInfo": "UsageLimitExceeded"` on limit hit
3. Auto-swap logic in `profile-scorer.ts` already works — it just needs usage data populated

---

## Appendix: Comparison Table

| Aspect | Anthropic (Claude Code) | OpenAI (Codex) |
|---|---|---|
| **Usage endpoint** | `api.anthropic.com/api/oauth/usage` | `chatgpt.com/backend-api/wham/usage` |
| **Auth header** | `Bearer <oauth_token>` | `Bearer <access_token>` + `ChatGPT-Account-Id` |
| **Session window** | ~5h | Configurable (`limit_window_seconds`) |
| **Weekly window** | 7 days | Configurable (`limit_window_seconds`) |
| **Token source** | Keychain (`Claude Code-credentials`) | File (`codex-auth.json`) |
| **Token refresh** | `console.anthropic.com/v1/oauth/token` | `auth.openai.com/oauth/token` |
| **Client ID** | `9d1c250a-e61b-44d9-88ed-5944d1962f5e` | `app_EMoamEEZ73f0CkXaXp7hrann` |
| **Passive tracking** | Not available | `x-codex-*` response headers |
| **Rate limit error** | `"Limit reached · resets Dec 17..."` | `"codexErrorInfo": "UsageLimitExceeded"` |
| **Profile isolation** | `~/.claude-profiles/{name}/` dirs | Single `codex-auth.json` file |
| **Multi-account** | Multiple config dirs in keychain | Single file (no multi-account yet) |

## Appendix: Caveats

1. **Undocumented API** — `chatgpt.com/backend-api/wham/usage` is internal. The Codex CLI depends on it, so it's unlikely to break silently.
2. **Account ID** — May be required. Test without it first. If needed, decode from JWT or read `~/.codex/auth.json`.
3. **CORS** — Not an issue (Electron main process = Node.js).
4. **Polling rate** — Unknown if OpenAI rate-limits `wham/usage`. Start conservatively (every 30-60s).
5. **Multi-account Codex** — Codex CLI doesn't support multiple accounts. We store one token file. If user has multiple Codex accounts, they'd need to re-auth each time (unlike Anthropic which supports multiple config dirs).
