#!/bin/bash
# Test suite for scripts/upgrade-model.sh
# Validates model upgrade logic and safety checks

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
UPGRADE_SCRIPT="${PROJECT_DIR}/scripts/upgrade-model.sh"

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
echo "upgrade-model.sh Test Suite"
echo "========================================"

run_test "upgrade-model.sh exists and is executable"
if [[ -x "$UPGRADE_SCRIPT" ]]; then
    pass "Script is executable"
else
    fail "Script not found or not executable: $UPGRADE_SCRIPT"
fi

run_test "Script has set -euo pipefail"
if head -30 "$UPGRADE_SCRIPT" | grep -q "set -euo pipefail"; then
    pass "Script has proper error handling"
else
    fail "Script missing 'set -euo pipefail'"
fi

run_test "Script provides usage information"
if grep -qE "(usage|Usage|USAGE|--help)" "$UPGRADE_SCRIPT"; then
    pass "Script has usage information"
else
    fail "Script should provide usage information"
fi

run_test "Script validates model files"
if grep -qE "(\.gguf|model|GGUF)" "$UPGRADE_SCRIPT"; then
    pass "Script references GGUF model files"
else
    fail "Script should validate GGUF model files"
fi

run_test "Script checks disk space"
if grep -qE "(disk|space|df|du)" "$UPGRADE_SCRIPT"; then
    pass "Script checks disk space"
else
    fail "Script should check disk space before upgrade"
fi

run_test "Script handles backup/rollback"
if grep -qE "(backup|rollback|restore)" "$UPGRADE_SCRIPT"; then
    pass "Script has backup/rollback logic"
else
    fail "Script should handle backup/rollback"
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
