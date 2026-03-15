#!/bin/bash
# ============================================================================
# Test: resolve_tier_config() — tier-map.sh
# ============================================================================
# Sources the actual tier-map.sh and verifies each tier resolves to the
# correct LLM_MODEL, GGUF_FILE, and MAX_CONTEXT.
#
# Run: bash tests/test-tier-map.sh
# ============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0

# Minimal stubs for dependencies
error() { echo "ERROR: $*" >&2; return 1; }

# Source the module under test
source "$SCRIPT_DIR/installers/lib/tier-map.sh"

assert_eq() {
    local label="$1" expected="$2" actual="$3"
    if [[ "$expected" == "$actual" ]]; then
        echo "  PASS: $label"
        ((PASS++))
    else
        echo "  FAIL: $label (expected '$expected', got '$actual')"
        ((FAIL++))
    fi
}

run_tier() {
    local tier_val="$1"
    TIER="$tier_val"
    # Reset globals
    TIER_NAME="" LLM_MODEL="" GGUF_FILE="" GGUF_URL="" MAX_CONTEXT=""
    resolve_tier_config
}

echo "=== Testing resolve_tier_config() ==="
echo ""

# --- Tier 1: Entry Level ---
echo "Tier 1 (Entry Level):"
run_tier 1
assert_eq "TIER_NAME"   "Entry Level"                          "$TIER_NAME"
assert_eq "LLM_MODEL"   "qwen3-8b"                            "$LLM_MODEL"
assert_eq "GGUF_FILE"   "Qwen3-8B-Q4_K_M.gguf"               "$GGUF_FILE"
assert_eq "MAX_CONTEXT"  "16384"                                "$MAX_CONTEXT"
echo ""

# --- Tier 2: Prosumer ---
echo "Tier 2 (Prosumer):"
run_tier 2
assert_eq "TIER_NAME"   "Prosumer"                             "$TIER_NAME"
assert_eq "LLM_MODEL"   "qwen3-8b"                            "$LLM_MODEL"
assert_eq "GGUF_FILE"   "Qwen3-8B-Q4_K_M.gguf"               "$GGUF_FILE"
assert_eq "MAX_CONTEXT"  "32768"                                "$MAX_CONTEXT"
echo ""

# --- Tier 3: Pro ---
echo "Tier 3 (Pro):"
run_tier 3
assert_eq "TIER_NAME"   "Pro"                                  "$TIER_NAME"
assert_eq "LLM_MODEL"   "qwen3-14b"                           "$LLM_MODEL"
assert_eq "GGUF_FILE"   "Qwen3-14B-Q4_K_M.gguf"              "$GGUF_FILE"
assert_eq "MAX_CONTEXT"  "32768"                                "$MAX_CONTEXT"
echo ""

# --- Tier 4: Enterprise ---
echo "Tier 4 (Enterprise):"
run_tier 4
assert_eq "TIER_NAME"   "Enterprise"                           "$TIER_NAME"
assert_eq "LLM_MODEL"   "qwen3-30b-a3b"                       "$LLM_MODEL"
assert_eq "GGUF_FILE"   "Qwen3-30B-A3B-Q4_K_M.gguf"          "$GGUF_FILE"
assert_eq "MAX_CONTEXT"  "131072"                               "$MAX_CONTEXT"
echo ""

# --- NV_ULTRA ---
echo "NV_ULTRA (NVIDIA Ultra 90GB+):"
run_tier NV_ULTRA
assert_eq "TIER_NAME"   "NVIDIA Ultra (90GB+)"                 "$TIER_NAME"
assert_eq "LLM_MODEL"   "qwen3-coder-next"                    "$LLM_MODEL"
assert_eq "GGUF_FILE"   "qwen3-coder-next-Q4_K_M.gguf"       "$GGUF_FILE"
assert_eq "MAX_CONTEXT"  "131072"                               "$MAX_CONTEXT"
echo ""

# --- SH_LARGE ---
echo "SH_LARGE (Strix Halo 90+):"
run_tier SH_LARGE
assert_eq "TIER_NAME"   "Strix Halo 90+"                      "$TIER_NAME"
assert_eq "LLM_MODEL"   "qwen3-coder-next"                    "$LLM_MODEL"
assert_eq "GGUF_FILE"   "qwen3-coder-next-Q4_K_M.gguf"       "$GGUF_FILE"
assert_eq "MAX_CONTEXT"  "131072"                               "$MAX_CONTEXT"
echo ""

# --- SH_COMPACT ---
echo "SH_COMPACT (Strix Halo Compact):"
run_tier SH_COMPACT
assert_eq "TIER_NAME"   "Strix Halo Compact"                  "$TIER_NAME"
assert_eq "LLM_MODEL"   "qwen3-30b-a3b"                       "$LLM_MODEL"
assert_eq "GGUF_FILE"   "Qwen3-30B-A3B-Q4_K_M.gguf"          "$GGUF_FILE"
assert_eq "MAX_CONTEXT"  "131072"                               "$MAX_CONTEXT"
echo ""

# --- Invalid tier should fail ---
echo "Invalid tier (should fail):"
if TIER="INVALID" resolve_tier_config 2>/dev/null; then
    echo "  FAIL: Invalid tier did not return error"
    ((FAIL++))
else
    echo "  PASS: Invalid tier returned error"
    ((PASS++))
fi
echo ""

# --- GGUF_URL should be set for all tiers ---
echo "GGUF_URL populated for all tiers:"
for t in 1 2 3 4 NV_ULTRA SH_LARGE SH_COMPACT; do
    run_tier "$t"
    if [[ -n "$GGUF_URL" && "$GGUF_URL" == https://* ]]; then
        echo "  PASS: Tier $t has valid GGUF_URL"
        ((PASS++))
    else
        echo "  FAIL: Tier $t missing or invalid GGUF_URL"
        ((FAIL++))
    fi
done
echo ""

# --- Summary ---
echo "==============================="
echo "Results: $PASS passed, $FAIL failed"
echo "==============================="

[[ $FAIL -eq 0 ]] && exit 0 || exit 1
