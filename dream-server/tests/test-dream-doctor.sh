#!/bin/bash
# ============================================================================
# Dream Server dream-doctor.sh Test Suite
# ============================================================================
# Ensures scripts/dream-doctor.sh runs without errors and produces
# diagnostic output for troubleshooting.
#
# Usage: ./tests/test-dream-doctor.sh
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
echo "║   dream-doctor.sh Test Suite                      ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# 1. Script exists and is executable
if [[ ! -f "$ROOT_DIR/scripts/dream-doctor.sh" ]]; then
    fail "scripts/dream-doctor.sh not found"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; [[ $FAILED -eq 0 ]]; exit $?
fi
pass "dream-doctor.sh exists"

if [[ ! -x "$ROOT_DIR/scripts/dream-doctor.sh" ]]; then
    fail "dream-doctor.sh not executable"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; [[ $FAILED -eq 0 ]]; exit $?
fi
pass "dream-doctor.sh is executable"

# 2. Script runs without shell errors
set +e
out=$(cd "$ROOT_DIR" && bash scripts/dream-doctor.sh 2>&1)
exit_code=$?
set -e

if echo "$out" | grep -qE "unbound variable|syntax error|command not found"; then
    fail "dream-doctor.sh produced shell errors"
else
    pass "dream-doctor.sh runs without shell errors"
fi

# 3. Exit code is valid (0 or 1)
if [[ $exit_code -eq 0 ]] || [[ $exit_code -eq 1 ]]; then
    pass "dream-doctor.sh exit code is valid: $exit_code"
else
    fail "dream-doctor.sh exit code unexpected: $exit_code"
fi

# 4. Output contains diagnostic sections
if echo "$out" | grep -qi "system\|docker\|gpu\|diagnostic"; then
    pass "Output contains diagnostic information"
else
    fail "Output missing diagnostic sections"
fi

# 5. Script checks for Docker
if grep -q "docker" "$ROOT_DIR/scripts/dream-doctor.sh"; then
    pass "Script includes Docker diagnostics"
else
    fail "Script missing Docker diagnostics"
fi

# 6. Script checks for GPU
if grep -qi "gpu\|nvidia\|amd" "$ROOT_DIR/scripts/dream-doctor.sh"; then
    pass "Script includes GPU diagnostics"
else
    fail "Script missing GPU diagnostics"
fi

# 7. Script has help or usage information
if grep -q "Usage:\|--help" "$ROOT_DIR/scripts/dream-doctor.sh"; then
    pass "Script has usage/help information"
else
    fail "Script missing usage/help information"
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
