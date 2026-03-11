#!/bin/bash
# test-preset-compatibility.sh
# Tests preset and backup compatibility validation

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DREAM_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Test counters
PASS=0
FAIL=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Test helper functions
pass() { echo -e "${GREEN}✓${NC} $1"; ((PASS++)); }
fail() { echo -e "${RED}✗${NC} $1"; ((FAIL++)); }

# Setup test environment
setup_test_env() {
    TEST_DIR=$(mktemp -d)
    TEST_PRESET_DIR="$TEST_DIR/presets/test-preset"
    mkdir -p "$TEST_PRESET_DIR"
}

# Cleanup test environment
cleanup_test_env() {
    if [[ -n "${TEST_DIR:-}" && -d "${TEST_DIR:-}" ]]; then
        rm -rf "$TEST_DIR"
    fi
}

trap cleanup_test_env EXIT

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Preset Compatibility Validation Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: Validation function exists
echo "Test 1: Validation function exists"
if source "$DREAM_DIR/lib/service-registry.sh" 2>/dev/null; then
    if declare -f sr_validate_extensions_list >/dev/null 2>&1; then
        pass "sr_validate_extensions_list function is defined"
    else
        fail "sr_validate_extensions_list function not found"
    fi
else
    fail "Failed to source service-registry.sh"
fi

# Test 2: Validation with all services available
echo ""
echo "Test 2: Validation with all services available (skipped if no services)"
setup_test_env

# Get first available service from registry
SCRIPT_DIR="$DREAM_DIR"
source "$DREAM_DIR/lib/service-registry.sh"
sr_load 2>/dev/null || true
if [[ ${#SERVICE_IDS[@]} -gt 0 ]]; then
    first_service="${SERVICE_IDS[0]}"
    echo "enabled:$first_service" > "$TEST_PRESET_DIR/extensions.list"

    result=$(sr_validate_extensions_list "$TEST_PRESET_DIR/extensions.list")
    IFS='|' read -r enabled_count enabled_list disabled_count disabled_list <<< "$result"

    if [[ "$enabled_count" == "0" && "$disabled_count" == "0" ]]; then
        pass "Validation succeeds with available services (counts: $enabled_count|$disabled_count)"
    else
        fail "Validation failed with available services (counts: $enabled_count|$disabled_count)"
    fi
else
    pass "Skipped (no services available - PyYAML may not be installed)"
fi

cleanup_test_env

# Test 3: Validation with missing enabled services
echo ""
echo "Test 3: Validation with missing enabled services"
setup_test_env

echo "enabled:fake-service-123" > "$TEST_PRESET_DIR/extensions.list"
echo "enabled:another-fake-service" >> "$TEST_PRESET_DIR/extensions.list"

SCRIPT_DIR="$DREAM_DIR"
source "$DREAM_DIR/lib/service-registry.sh"
result=$(sr_validate_extensions_list "$TEST_PRESET_DIR/extensions.list")
exit_code=$?
IFS='|' read -r enabled_count enabled_list disabled_count disabled_list <<< "$result"

if [[ "$exit_code" == "1" ]]; then
    pass "Validation returns exit code 1 for missing enabled services"
else
    fail "Validation should return exit code 1, got: $exit_code"
fi

if [[ "$enabled_count" == "2" ]]; then
    pass "Correct count of missing enabled services: $enabled_count"
else
    fail "Expected 2 missing enabled services, got: $enabled_count"
fi

if [[ "$enabled_list" == *"fake-service-123"* ]]; then
    pass "Missing service name found in enabled_list"
else
    fail "Missing service name not found in enabled_list: $enabled_list"
fi

cleanup_test_env

# Test 4: Validation with missing disabled services
echo ""
echo "Test 4: Validation with missing disabled services"
setup_test_env

echo "disabled:fake-disabled-service" > "$TEST_PRESET_DIR/extensions.list"

SCRIPT_DIR="$DREAM_DIR"
source "$DREAM_DIR/lib/service-registry.sh"
result=$(sr_validate_extensions_list "$TEST_PRESET_DIR/extensions.list")
exit_code=$?
IFS='|' read -r enabled_count enabled_list disabled_count disabled_list <<< "$result"

if [[ "$exit_code" == "0" ]]; then
    pass "Validation returns exit code 0 for missing disabled services (not critical)"
else
    fail "Validation should return exit code 0 for disabled services, got: $exit_code"
fi

if [[ "$disabled_count" == "1" ]]; then
    pass "Correct count of missing disabled services: $disabled_count"
else
    fail "Expected 1 missing disabled service, got: $disabled_count"
fi

if [[ "$disabled_list" == *"fake-disabled-service"* ]]; then
    pass "Missing disabled service name found in disabled_list"
else
    fail "Missing disabled service name not found in disabled_list: $disabled_list"
fi

cleanup_test_env

# Test 5: Validation with empty extensions.list
echo ""
echo "Test 5: Validation with empty extensions.list"
setup_test_env

touch "$TEST_PRESET_DIR/extensions.list"

SCRIPT_DIR="$DREAM_DIR"
source "$DREAM_DIR/lib/service-registry.sh"
result=$(sr_validate_extensions_list "$TEST_PRESET_DIR/extensions.list")
exit_code=$?
IFS='|' read -r enabled_count enabled_list disabled_count disabled_list <<< "$result"

if [[ "$exit_code" == "0" ]]; then
    pass "Validation succeeds with empty extensions.list"
else
    fail "Validation should succeed with empty file, got exit code: $exit_code"
fi

if [[ "$enabled_count" == "0" && "$disabled_count" == "0" ]]; then
    pass "Empty file returns zero counts"
else
    fail "Expected 0|0 counts, got: $enabled_count|$disabled_count"
fi

cleanup_test_env

# Test 6: Validation with missing file
echo ""
echo "Test 6: Validation with missing file"
setup_test_env

SCRIPT_DIR="$DREAM_DIR"
source "$DREAM_DIR/lib/service-registry.sh"
result=$(sr_validate_extensions_list "$TEST_PRESET_DIR/nonexistent.list")
exit_code=$?

if [[ "$exit_code" == "1" ]]; then
    pass "Validation returns exit code 1 for missing file"
else
    fail "Validation should return exit code 1 for missing file, got: $exit_code"
fi

cleanup_test_env

# Test 7: Validation with mixed available and unavailable services
echo ""
echo "Test 7: Validation with mixed available and unavailable services (skipped if no services)"
setup_test_env

SCRIPT_DIR="$DREAM_DIR"
source "$DREAM_DIR/lib/service-registry.sh"
sr_load 2>/dev/null || true
if [[ ${#SERVICE_IDS[@]} -gt 0 ]]; then
    first_service="${SERVICE_IDS[0]}"
    echo "enabled:$first_service" > "$TEST_PRESET_DIR/extensions.list"
    echo "enabled:fake-service" >> "$TEST_PRESET_DIR/extensions.list"
    echo "disabled:fake-disabled" >> "$TEST_PRESET_DIR/extensions.list"

    result=$(sr_validate_extensions_list "$TEST_PRESET_DIR/extensions.list")
    exit_code=$?
    IFS='|' read -r enabled_count enabled_list disabled_count disabled_list <<< "$result"

    if [[ "$exit_code" == "1" ]]; then
        pass "Validation returns exit code 1 when any enabled service is missing"
    else
        fail "Expected exit code 1, got: $exit_code"
    fi

    if [[ "$enabled_count" == "1" ]]; then
        pass "Correct count of missing enabled services in mixed scenario"
    else
        fail "Expected 1 missing enabled service, got: $enabled_count"
    fi

    if [[ "$disabled_count" == "1" ]]; then
        pass "Correct count of missing disabled services in mixed scenario"
    else
        fail "Expected 1 missing disabled service, got: $disabled_count"
    fi
else
    pass "Skipped (no services available - PyYAML may not be installed)"
fi

cleanup_test_env

# Test 8: Validation ignores comments and empty lines
echo ""
echo "Test 8: Validation ignores comments and empty lines"
setup_test_env

cat > "$TEST_PRESET_DIR/extensions.list" <<EOF
# This is a comment
enabled:fake-service

# Another comment
disabled:fake-disabled
EOF

SCRIPT_DIR="$DREAM_DIR"
source "$DREAM_DIR/lib/service-registry.sh"
result=$(sr_validate_extensions_list "$TEST_PRESET_DIR/extensions.list")
IFS='|' read -r enabled_count enabled_list disabled_count disabled_list <<< "$result"

if [[ "$enabled_count" == "1" && "$disabled_count" == "1" ]]; then
    pass "Comments and empty lines are properly ignored"
else
    fail "Expected 1|1 counts, got: $enabled_count|$disabled_count"
fi

cleanup_test_env

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[[ $FAIL -eq 0 ]] && exit 0 || exit 1

