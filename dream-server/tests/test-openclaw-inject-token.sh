#!/bin/bash
# ============================================================================
# OpenClaw inject-token.js Hardening Test Suite
# ============================================================================
# Validates that config/openclaw/inject-token.js produces a merged runtime
# config WITHOUT the dangerouslyAllowHostHeaderOriginFallback flag, while
# preserving the flags Docker auto-connect actually needs.
#
# Why this test matters:
#   - inject-token.js is load-bearing: it re-injects controlUi flags at every
#     container start, so any cosmetic edit to openclaw.json/pro.json/
#     openclaw-strix-halo.json is overridden by this script. The test must
#     guard the *runtime* output, not just the static JSON files.
#   - dangerouslyDisableDeviceAuth=true MUST stay (Docker auto-connect breaks
#     without it; the auth pairing flow is incompatible with inject-token.js).
#   - allowedOrigins must be populated so the gateway no longer needs the
#     Host-header fallback to accept cross-origin requests from the Control UI.
#
# Usage: ./tests/test-openclaw-inject-token.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() { echo -e "  ${GREEN}✓ PASS${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC} $1"; FAILED=$((FAILED + 1)); }
skip() { echo -e "  ${YELLOW}⊘ SKIP${NC} $1"; }

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   OpenClaw inject-token.js Hardening Test    ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# Preconditions
if ! command -v node >/dev/null 2>&1; then
    skip "node not available — cannot exercise inject-token.js"
    echo ""
    echo "Result: 0 passed, 0 failed (skipped: node missing)"
    exit 0
fi
if ! command -v jq >/dev/null 2>&1; then
    skip "jq not available — cannot inspect merged config"
    echo ""
    echo "Result: 0 passed, 0 failed (skipped: jq missing)"
    exit 0
fi

INJECT_SCRIPT="$ROOT_DIR/config/openclaw/inject-token.js"
SOURCE_CONFIG="$ROOT_DIR/config/openclaw/openclaw.json"

if [[ ! -f "$INJECT_SCRIPT" ]]; then
    fail "inject-token.js not found at $INJECT_SCRIPT"
    exit 1
fi
if [[ ! -f "$SOURCE_CONFIG" ]]; then
    fail "source config openclaw.json not found at $SOURCE_CONFIG"
    exit 1
fi

# Sandbox: HOME points at a tempdir so Part 1 can write ~/.openclaw/openclaw.json
# without touching the developer's real home. Part 3 writes to the hardcoded
# /tmp/openclaw-config.json — we treat that as our test artifact.
TEST_HOME="$(mktemp -d -t dream-openclaw-XXXXXXXX)"
mkdir -p "$TEST_HOME/.openclaw"
MERGED_PATH="/tmp/openclaw-config.json"

cleanup() {
    rm -rf "$TEST_HOME"
    rm -f "$MERGED_PATH"
}
trap cleanup EXIT

run_inject() {
    HOME="$TEST_HOME" \
    OPENCLAW_GATEWAY_TOKEN="test-token-abc123" \
    OPENCLAW_EXTERNAL_PORT="7860" \
    OPENCLAW_CONFIG="$SOURCE_CONFIG" \
    LLM_MODEL="test-model" \
    GGUF_FILE="" \
    OLLAMA_URL="" \
    OPENCLAW_LLM_URL="" \
    LITELLM_KEY="" \
        node "$INJECT_SCRIPT" >/dev/null 2>&1
}

if ! run_inject; then
    fail "inject-token.js exited non-zero"
    exit 1
fi
pass "inject-token.js ran without error"

if [[ ! -f "$MERGED_PATH" ]]; then
    fail "merged config $MERGED_PATH was not created"
    exit 1
fi
pass "merged config written to $MERGED_PATH"

# ── Assertion 1: dangerous Host-header fallback is GONE ─────────────────────
if jq -e '.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback' "$MERGED_PATH" >/dev/null 2>&1; then
    fail "dangerouslyAllowHostHeaderOriginFallback is present in merged config (should be removed)"
else
    pass "dangerouslyAllowHostHeaderOriginFallback absent from merged config"
fi

# ── Assertion 2: dangerouslyDisableDeviceAuth still TRUE (Docker regression guard) ─
if [[ "$(jq -r '.gateway.controlUi.dangerouslyDisableDeviceAuth' "$MERGED_PATH")" == "true" ]]; then
    pass "dangerouslyDisableDeviceAuth=true preserved (Docker auto-connect intact)"
else
    fail "dangerouslyDisableDeviceAuth must remain true — Docker auto-connect would break"
fi

# ── Assertion 3: allowInsecureAuth still TRUE (HTTP-only deployment guard) ──
if [[ "$(jq -r '.gateway.controlUi.allowInsecureAuth' "$MERGED_PATH")" == "true" ]]; then
    pass "allowInsecureAuth=true preserved (HTTP deployment intact)"
else
    fail "allowInsecureAuth must remain true — HTTP-only stack would refuse to connect"
fi

# ── Assertion 4: allowedOrigins populated with the expected localhost entries ─
ORIGINS_COUNT="$(jq '.gateway.controlUi.allowedOrigins | length' "$MERGED_PATH")"
if [[ "$ORIGINS_COUNT" -ge 2 ]]; then
    pass "allowedOrigins populated ($ORIGINS_COUNT entries)"
else
    fail "allowedOrigins should contain at least the 2 localhost entries (got $ORIGINS_COUNT)"
fi

for origin in "http://localhost:7860" "http://127.0.0.1:7860"; do
    if jq -e --arg o "$origin" '.gateway.controlUi.allowedOrigins | index($o)' "$MERGED_PATH" >/dev/null 2>&1; then
        pass "allowedOrigins contains $origin"
    else
        fail "allowedOrigins missing expected entry: $origin"
    fi
done

# ── Assertion 5: gateway.auth.mode === 'token' (auth-flow regression guard) ──
if [[ "$(jq -r '.gateway.mode' "$MERGED_PATH")" == "local" ]]; then
    pass "gateway.mode=local preserved"
else
    fail "gateway.mode must be 'local' (required by OpenClaw v2026.3.8+)"
fi

# Note: gateway.auth is patched into ~/.openclaw/openclaw.json (Part 1), not
# the merged config (Part 3). Verify the Part 1 output instead.
HOME_CONFIG="$TEST_HOME/.openclaw/openclaw.json"
if [[ -f "$HOME_CONFIG" ]]; then
    if [[ "$(jq -r '.gateway.auth.mode' "$HOME_CONFIG")" == "token" ]]; then
        pass "gateway.auth.mode=token written to ~/.openclaw/openclaw.json"
    else
        fail "gateway.auth.mode must be 'token' in ~/.openclaw/openclaw.json"
    fi
    if [[ "$(jq -r '.gateway.auth.token' "$HOME_CONFIG")" == "test-token-abc123" ]]; then
        pass "gateway.auth.token populated from OPENCLAW_GATEWAY_TOKEN"
    else
        fail "gateway.auth.token did not pick up OPENCLAW_GATEWAY_TOKEN"
    fi
    # Persistent-volume defang: home config (Part 1 output) must NOT carry
    # dangerouslyAllowHostHeaderOriginFallback. The home config lives in a
    # named Docker volume, so a residual flag from a pre-PR install would
    # otherwise persist across upgrades.
    if jq -e '.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback // empty' "$HOME_CONFIG" >/dev/null 2>&1; then
        fail "home config STILL contains dangerouslyAllowHostHeaderOriginFallback (Part 1 not defanging)"
    else
        pass "home config lacks dangerouslyAllowHostHeaderOriginFallback (Part 1 defanged)"
    fi
else
    fail "Part 1 output ~/.openclaw/openclaw.json not written"
fi

# ── Upgrade scenario: pre-seed bad flag, confirm Part 1 strips it ───────────
# Simulate an upgrade from a pre-PR install where ~/.openclaw/openclaw.json on
# the named Docker volume already contains dangerouslyAllowHostHeaderOriginFallback.
# Re-running inject-token.js must remove that flag.
echo ""
cat >"$TEST_HOME/.openclaw/openclaw.json" <<'JSON'
{
  "gateway": {
    "mode": "local",
    "controlUi": {
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true,
      "dangerouslyAllowHostHeaderOriginFallback": true
    }
  }
}
JSON

if ! run_inject; then
    fail "upgrade scenario: inject-token.js exited non-zero on re-run"
else
    pass "upgrade scenario: inject-token.js ran cleanly against pre-seeded home config"
    if jq -e '.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback // empty' "$HOME_CONFIG" >/dev/null 2>&1; then
        fail "upgrade scenario: pre-existing bad flag was NOT defanged (carry-over still present)"
    else
        pass "upgrade scenario: pre-existing bad flag defanged on re-run"
    fi
fi

# ── Negative test: verify the test would actually catch a regression ────────
# Re-run inject-token.js against a fixture that re-introduces the bad flag,
# and confirm assertion 1 would have failed.
FIXTURE_DIR="$(mktemp -d -t dream-openclaw-fix-XXXXXXXX)"
BAD_CONFIG="$FIXTURE_DIR/openclaw.json"
cat >"$BAD_CONFIG" <<'JSON'
{
  "agents": { "defaults": { "model": { "primary": "local-llama/m" }, "models": { "local-llama/m": {} }, "subagents": { "model": "local-llama/m", "maxConcurrent": 20 } } },
  "models": { "providers": { "local-llama": { "baseUrl": "http://x/v1", "apiKey": "n", "models": [ { "id": "m", "name": "m", "contextWindow": 1 } ] } } },
  "gateway": {
    "mode": "local",
    "controlUi": {
      "allowInsecureAuth": true,
      "dangerouslyDisableDeviceAuth": true,
      "dangerouslyAllowHostHeaderOriginFallback": true
    }
  }
}
JSON

# Patch a temporary copy of inject-token.js that re-injects the flag — this
# simulates the fix being reverted. If our assertion 1 still passes against
# this script, the test has no teeth. We must also strip the Part 3 `delete`
# defang (otherwise it silently wipes the re-injected flag), so we replace
# the delete line with the bad setter.
BAD_SCRIPT="$FIXTURE_DIR/inject-token.js"
cp "$INJECT_SCRIPT" "$BAD_SCRIPT"
# (sed -i portability: pass empty string on macOS / nothing on GNU).
if sed --version >/dev/null 2>&1; then
    sed -i 's|delete primary.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback;.*|primary.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback = true;|' "$BAD_SCRIPT"
else
    sed -i '' 's|delete primary.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback;.*|primary.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback = true;|' "$BAD_SCRIPT"
fi

rm -f "$MERGED_PATH"
HOME="$TEST_HOME" \
OPENCLAW_GATEWAY_TOKEN="test-token-abc123" \
OPENCLAW_EXTERNAL_PORT="7860" \
OPENCLAW_CONFIG="$BAD_CONFIG" \
LLM_MODEL="test-model" \
    node "$BAD_SCRIPT" >/dev/null 2>&1 || true

if [[ -f "$MERGED_PATH" ]] && jq -e '.gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback' "$MERGED_PATH" >/dev/null 2>&1; then
    pass "negative test: regressed script DOES re-introduce the flag (test has teeth)"
else
    fail "negative test failed — could not simulate regression; assertion 1 may be toothless"
fi

rm -rf "$FIXTURE_DIR"

echo ""
echo "─────────────────────────────────────────────────"
echo -e "Result: ${GREEN}${PASSED} passed${NC}, ${RED}${FAILED} failed${NC}"
echo "─────────────────────────────────────────────────"

if [[ "$FAILED" -gt 0 ]]; then
    exit 1
fi
exit 0
