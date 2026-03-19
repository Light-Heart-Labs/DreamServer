#!/usr/bin/env bats
# ============================================================================
# BATS tests for installers/lib/tier-map.sh
# ============================================================================
# Tests: resolve_tier_config(), tier_to_model()

load '../bats/bats-support/load'
load '../bats/bats-assert/load'

setup() {
    # Stub logging functions that tier-map.sh expects
    error() { echo "ERROR: $*" >&2; return 1; }
    export -f error
    log() { :; }
    export -f log

    # Source the library under test
    source "$BATS_TEST_DIRNAME/../../installers/lib/tier-map.sh"
}

# ── resolve_tier_config ─────────────────────────────────────────────────────

@test "resolve_tier_config: tier 1 sets Entry Level with qwen3-8b" {
    TIER=1
    resolve_tier_config
    assert_equal "$TIER_NAME" "Entry Level"
    assert_equal "$LLM_MODEL" "qwen3-8b"
    assert_equal "$GGUF_FILE" "Qwen3-8B-Q4_K_M.gguf"
    assert_equal "$MAX_CONTEXT" "16384"
}

@test "resolve_tier_config: tier 2 sets Prosumer with qwen3-8b" {
    TIER=2
    resolve_tier_config
    assert_equal "$TIER_NAME" "Prosumer"
    assert_equal "$LLM_MODEL" "qwen3-8b"
    assert_equal "$MAX_CONTEXT" "32768"
}

@test "resolve_tier_config: tier 3 sets Pro with qwen3-14b" {
    TIER=3
    resolve_tier_config
    assert_equal "$TIER_NAME" "Pro"
    assert_equal "$LLM_MODEL" "qwen3-14b"
    assert_equal "$GGUF_FILE" "Qwen3-14B-Q4_K_M.gguf"
    assert_equal "$MAX_CONTEXT" "32768"
}

@test "resolve_tier_config: tier 4 sets Enterprise with qwen3-30b-a3b" {
    TIER=4
    resolve_tier_config
    assert_equal "$TIER_NAME" "Enterprise"
    assert_equal "$LLM_MODEL" "qwen3-30b-a3b"
    assert_equal "$GGUF_FILE" "Qwen3-30B-A3B-Q4_K_M.gguf"
    assert_equal "$MAX_CONTEXT" "131072"
}

@test "resolve_tier_config: NV_ULTRA sets NVIDIA Ultra with qwen3-coder-next" {
    TIER=NV_ULTRA
    resolve_tier_config
    assert_equal "$TIER_NAME" "NVIDIA Ultra (90GB+)"
    assert_equal "$LLM_MODEL" "qwen3-coder-next"
    assert_equal "$GGUF_FILE" "qwen3-coder-next-Q4_K_M.gguf"
    assert_equal "$MAX_CONTEXT" "131072"
}

@test "resolve_tier_config: SH_LARGE sets Strix Halo 90+ with qwen3-coder-next" {
    TIER=SH_LARGE
    resolve_tier_config
    assert_equal "$TIER_NAME" "Strix Halo 90+"
    assert_equal "$LLM_MODEL" "qwen3-coder-next"
    assert_equal "$MAX_CONTEXT" "131072"
}

@test "resolve_tier_config: SH_COMPACT sets Strix Halo Compact with qwen3-30b-a3b" {
    TIER=SH_COMPACT
    resolve_tier_config
    assert_equal "$TIER_NAME" "Strix Halo Compact"
    assert_equal "$LLM_MODEL" "qwen3-30b-a3b"
    assert_equal "$MAX_CONTEXT" "131072"
}

@test "resolve_tier_config: CLOUD sets claude model with 200k context" {
    TIER=CLOUD
    resolve_tier_config
    assert_equal "$TIER_NAME" "Cloud (API)"
    assert_equal "$LLM_MODEL" "anthropic/claude-sonnet-4-5-20250514"
    assert_equal "$GGUF_FILE" ""
    assert_equal "$GGUF_URL" ""
    assert_equal "$MAX_CONTEXT" "200000"
}

@test "resolve_tier_config: invalid tier returns error" {
    TIER=INVALID
    run resolve_tier_config
    assert_failure
    assert_output --partial "ERROR: Invalid tier: INVALID"
}

# ── tier_to_model ────────────────────────────────────────────────────────────

@test "tier_to_model: maps all numeric tiers correctly" {
    run tier_to_model 1
    assert_output "qwen3-8b"

    run tier_to_model 2
    assert_output "qwen3-8b"

    run tier_to_model 3
    assert_output "qwen3-14b"

    run tier_to_model 4
    assert_output "qwen3-30b-a3b"
}

@test "tier_to_model: maps T-prefix aliases correctly" {
    run tier_to_model T1
    assert_output "qwen3-8b"

    run tier_to_model T2
    assert_output "qwen3-8b"

    run tier_to_model T3
    assert_output "qwen3-14b"

    run tier_to_model T4
    assert_output "qwen3-30b-a3b"
}

@test "tier_to_model: maps special tiers correctly" {
    run tier_to_model CLOUD
    assert_output "anthropic/claude-sonnet-4-5-20250514"

    run tier_to_model NV_ULTRA
    assert_output "qwen3-coder-next"

    run tier_to_model SH_LARGE
    assert_output "qwen3-coder-next"

    run tier_to_model SH_COMPACT
    assert_output "qwen3-30b-a3b"

    run tier_to_model SH
    assert_output "qwen3-30b-a3b"
}

@test "tier_to_model: invalid tier returns empty string" {
    run tier_to_model INVALID
    assert_output ""

    run tier_to_model 99
    assert_output ""

    run tier_to_model ""
    assert_output ""
}
