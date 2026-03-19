#!/bin/bash
# Test suite for scripts/build-capability-profile.sh
# Validates hardware capability profiling logic

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PROFILE_SCRIPT="${PROJECT_DIR}/scripts/build-capability-profile.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

pass() {
    echo -e "${GREEN}✓${NC} $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail() {
    echo -e "${RED}✗${NC} $1"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

run_test() {
    TESTS_RUN=$((TESTS_RUN + 1))
    echo -e "\n${YELLOW}Test $TESTS_RUN:${NC} $1"
}

echo "========================================"
echo "build-capability-profile.sh Test Suite"
echo "========================================"

run_test "build-capability-profile.sh exists and is executable"
if [[ -x "$PROFILE_SCRIPT" ]]; then
    pass "Script is executable"
else
    fail "Script not found or not executable: $PROFILE_SCRIPT"
fi

run_test "Script has set -euo pipefail"
if head -30 "$PROFILE_SCRIPT" | grep -q "set -euo pipefail"; then
    pass "Script has proper error handling"
else
    fail "Script missing 'set -euo pipefail'"
fi

run_test "Script checks for detect-hardware.sh dependency"
if grep -q "detect-hardware.sh" "$PROFILE_SCRIPT"; then
    pass "Script references detect-hardware.sh"
else
    fail "Script should depend on detect-hardware.sh"
fi

run_test "Script accepts --output parameter"
if grep -q "\-\-output" "$PROFILE_SCRIPT"; then
    pass "Script supports --output parameter"
else
    fail "Script should support --output parameter"
fi

run_test "Script generates .capabilities.json"
if grep -q "\.capabilities\.json" "$PROFILE_SCRIPT"; then
    pass "Script generates .capabilities.json"
else
    fail "Script should generate .capabilities.json"
fi

run_test "Script uses Python for JSON processing"
if grep -q "python" "$PROFILE_SCRIPT"; then
    pass "Script uses Python for JSON processing"
else
    fail "Script should use Python for JSON processing"
fi

echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo "Tests run:    $TESTS_RUN"
echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
echo "========================================"

if [[ $TESTS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}Some tests failed.${NC}"
    exit 1
fi
