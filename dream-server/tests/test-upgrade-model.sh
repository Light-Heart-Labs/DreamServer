#!/bin/bash
# ============================================================================
# Dream Server upgrade-model.sh Test Suite
# ============================================================================
# Ensures scripts/upgrade-model.sh has proper structure and safety checks.
# Tests model upgrade functionality for atomic operations and rollback.
#
# Usage: ./tests/test-upgrade-model.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() { echo -e "  ${GREEN}✓ PASS${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC} $1"; FAILED=$((FAILED + 1)); }

echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║   upgrade-model.sh Test Suite                    ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# 1. Script exists
if [[ ! -f "$ROOT_DIR/scripts/upgrade-model.sh" ]]; then
    fail "scripts/upgrade-model.sh not found"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; [[ $FAILED -eq 0 ]]; exit $?
fi
pass "upgrade-model.sh exists"

# 2. Script is executable
if [[ -x "$ROOT_DIR/scripts/upgrade-model.sh" ]]; then
    pass "upgrade-model.sh is executable"
else
    fail "upgrade-model.sh is not executable"
fi

# 3. Check for jq dependency
if grep -q "command -v jq" "$ROOT_DIR/scripts/upgrade-model.sh"; then
    pass "Script checks for jq dependency"
else
    fail "Script missing jq dependency check"
fi

# 4. Check for set -euo pipefail
if grep -q "set -euo pipefail" "$ROOT_DIR/scripts/upgrade-model.sh"; then
    pass "Script uses set -euo pipefail"
else
    fail "Script missing set -euo pipefail"
fi

# 5. Check for rollback functionality
if grep -q "\-\-rollback" "$ROOT_DIR/scripts/upgrade-model.sh"; then
    pass "Script supports --rollback flag"
else
    fail "Script missing --rollback flag"
fi

# 6. Check for list functionality
if grep -q "\-\-list" "$ROOT_DIR/scripts/upgrade-model.sh"; then
    pass "Script supports --list flag"
else
    fail "Script missing --list flag"
fi

# 7. Check for current model display
if grep -q "\-\-current" "$ROOT_DIR/scripts/upgrade-model.sh"; then
    pass "Script supports --current flag"
else
    fail "Script missing --current flag"
fi

# 8. Check for state file management
if grep -q "STATE_FILE" "$ROOT_DIR/scripts/upgrade-model.sh"; then
    pass "Script includes state file management"
else
    fail "Script missing state file management"
fi

# 9. Check for backup functionality
if grep -q "BACKUP" "$ROOT_DIR/scripts/upgrade-model.sh"; then
    pass "Script includes backup functionality"
else
    fail "Script missing backup functionality"
fi

# 10. Check for health check timeout
if grep -q "HEALTH_CHECK_TIMEOUT" "$ROOT_DIR/scripts/upgrade-model.sh"; then
    pass "Script includes health check timeout"
else
    fail "Script missing health check timeout"
fi

# 11. Check for compose file detection
if grep -q "detect_compose_file" "$ROOT_DIR/scripts/upgrade-model.sh"; then
    pass "Script includes compose file detection"
else
    fail "Script missing compose file detection"
fi

# 12. Syntax validation
if bash -n "$ROOT_DIR/scripts/upgrade-model.sh"; then
    pass "Script passes syntax validation"
else
    fail "Script has syntax errors"
fi

# 13. Check for usage documentation
if head -20 "$ROOT_DIR/scripts/upgrade-model.sh" | grep -q "Usage:"; then
    pass "Script includes usage documentation"
else
    fail "Script missing usage documentation"
fi

# 14. Check for atomic operation mentions
if grep -qi "atomic" "$ROOT_DIR/scripts/upgrade-model.sh"; then
    pass "Script mentions atomic operations"
else
    fail "Script missing atomic operation documentation"
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
