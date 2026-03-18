#!/usr/bin/env bash
# Test checkpoint migration from temp to final location
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Test counter
TESTS_RUN=0
TESTS_PASSED=0

# Track test home for cleanup
TEST_HOME=""

# Test helpers
pass() {
    echo "  ✓ $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo "  ✗ $1"
    exit 1
}

test_case() {
    echo ""
    echo "TEST: $1"
    TESTS_RUN=$((TESTS_RUN + 1))
}

# Setup test environment
setup() {
    TEST_HOME=$(mktemp -d)
    export HOME="$TEST_HOME"
    export INSTALL_DIR="$TEST_HOME/dream-server"
    export DS_VERSION="test-version"
    export INTERACTIVE=false

    # Provide minimal logging stubs (checkpoint.sh only needs log() and warn())
    log() { echo "[LOG] $*" >&2; }
    warn() { echo "[WARN] $*" >&2; }
    export -f log warn

    # Source checkpoint lib
    source "$ROOT_DIR/lib/checkpoint.sh"
}

# Cleanup test environment
cleanup() {
    if [[ -n "${TEST_HOME:-}" && -d "$TEST_HOME" ]]; then
        rm -rf "$TEST_HOME"
    fi
}

trap cleanup EXIT

# ============================================================================
# Test 1: Checkpoint saves to temp location when INSTALL_DIR doesn't exist
# ============================================================================
test_case "Checkpoint saves to temp location (phases 1-5)"
setup

checkpoint_save 3

if [[ -f "$CHECKPOINT_TEMP" ]]; then
    pass "Checkpoint created at temp location"
else
    fail "Checkpoint not created at temp location"
fi

if [[ ! -f "$CHECKPOINT_FINAL" ]]; then
    pass "Checkpoint not created at final location (correct)"
else
    fail "Checkpoint incorrectly created at final location"
fi

# Verify content
LAST_PHASE=$(grep "^LAST_PHASE=" "$CHECKPOINT_TEMP" | cut -d= -f2)
if [[ "$LAST_PHASE" == "3" ]]; then
    pass "Checkpoint contains correct phase number"
else
    fail "Checkpoint has wrong phase number: $LAST_PHASE"
fi

cleanup

# ============================================================================
# Test 2: Checkpoint migrates from temp to final location
# ============================================================================
test_case "Checkpoint migrates to final location (phase 6)"
setup

# Simulate phases 1-5: checkpoint in temp location
checkpoint_save 5

if [[ -f "$CHECKPOINT_TEMP" ]]; then
    pass "Phase 5 checkpoint in temp location"
else
    fail "Phase 5 checkpoint not in temp location"
fi

# Simulate phase 6: create INSTALL_DIR and migrate
mkdir -p "$INSTALL_DIR"
checkpoint_migrate

if [[ -f "$CHECKPOINT_FINAL" ]]; then
    pass "Checkpoint migrated to final location"
else
    fail "Checkpoint not migrated to final location"
fi

if [[ ! -f "$CHECKPOINT_TEMP" ]]; then
    pass "Temp checkpoint removed after migration"
else
    fail "Temp checkpoint still exists after migration"
fi

# Verify content preserved
LAST_PHASE=$(grep "^LAST_PHASE=" "$CHECKPOINT_FINAL" | cut -d= -f2)
if [[ "$LAST_PHASE" == "5" ]]; then
    pass "Migrated checkpoint preserves phase number"
else
    fail "Migrated checkpoint has wrong phase: $LAST_PHASE"
fi

cleanup

# ============================================================================
# Test 3: Checkpoint saves to final location after migration (phases 7+)
# ============================================================================
test_case "Checkpoint saves to final location (phases 7+)"
setup

# Simulate INSTALL_DIR already exists
mkdir -p "$INSTALL_DIR"

checkpoint_save 8

if [[ -f "$CHECKPOINT_FINAL" ]]; then
    pass "Checkpoint created at final location"
else
    fail "Checkpoint not created at final location"
fi

if [[ ! -f "$CHECKPOINT_TEMP" ]]; then
    pass "Checkpoint not created at temp location (correct)"
else
    fail "Checkpoint incorrectly created at temp location"
fi

cleanup

# ============================================================================
# Test 4: Checkpoint load finds checkpoint in either location
# ============================================================================
test_case "Checkpoint load checks both locations"
setup

# Test loading from temp location
checkpoint_save 2
LOADED_PHASE=$(checkpoint_load)
if [[ "$LOADED_PHASE" == "2" ]]; then
    pass "Loaded checkpoint from temp location"
else
    fail "Failed to load from temp location"
fi

cleanup
setup

# Test loading from final location
mkdir -p "$INSTALL_DIR"
checkpoint_save 9
LOADED_PHASE=$(checkpoint_load)
if [[ "$LOADED_PHASE" == "9" ]]; then
    pass "Loaded checkpoint from final location"
else
    fail "Failed to load from final location"
fi

cleanup

# ============================================================================
# Test 5: Checkpoint clear removes both locations
# ============================================================================
test_case "Checkpoint clear removes all checkpoint files"
setup

# Create checkpoint in temp location
checkpoint_save 3

# Create INSTALL_DIR and migrate
mkdir -p "$INSTALL_DIR"
checkpoint_migrate

# Clear should remove final location
checkpoint_clear

if [[ ! -f "$CHECKPOINT_FINAL" && ! -f "$CHECKPOINT_TEMP" ]]; then
    pass "All checkpoint files removed"
else
    fail "Checkpoint files still exist after clear"
fi

cleanup

# ============================================================================
# Test 6: Stale checkpoint detection
# ============================================================================
test_case "Stale checkpoint detection (>24 hours)"
setup

# Create checkpoint with old timestamp
mkdir -p "$(dirname "$CHECKPOINT_TEMP")"
OLD_TIMESTAMP=$(($(date +%s) - 86401))  # 24 hours + 1 second ago
cat > "$CHECKPOINT_TEMP" << EOF
LAST_PHASE=5
TIMESTAMP=$OLD_TIMESTAMP
INSTALL_DIR=$INSTALL_DIR
VERSION=test
EOF

# Should fail to load stale checkpoint
if checkpoint_load >/dev/null 2>&1; then
    fail "Stale checkpoint was loaded (should have been rejected)"
else
    pass "Stale checkpoint rejected"
fi

cleanup

# ============================================================================
# Test 7: Invalid checkpoint handling
# ============================================================================
test_case "Invalid checkpoint handling"
setup

# Create invalid checkpoint (missing required fields)
mkdir -p "$(dirname "$CHECKPOINT_TEMP")"
cat > "$CHECKPOINT_TEMP" << EOF
LAST_PHASE=
TIMESTAMP=
EOF

# Should fail to load invalid checkpoint
if checkpoint_load >/dev/null 2>&1; then
    fail "Invalid checkpoint was loaded (should have been rejected)"
else
    pass "Invalid checkpoint rejected"
fi

cleanup

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "CHECKPOINT MIGRATION TEST RESULTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test cases: $TESTS_RUN"
echo "Assertions passed: $TESTS_PASSED"
echo ""
echo "✓ All tests passed"
exit 0
