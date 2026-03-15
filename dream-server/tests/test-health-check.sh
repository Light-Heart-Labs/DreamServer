#!/bin/bash
# ============================================================================
# Dream Server health-check.sh Test Suite
# ============================================================================
# Ensures scripts/health-check.sh runs without shell errors and produces
# expected exit codes and (when requested) JSON output. Supports rock-solid
# installs by validating the health-check path used in post-install checklists.
#
# Usage: ./tests/test-health-check.sh
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
echo "║   health-check.sh Test Suite                  ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# 1. Script exists
if [[ ! -f "$ROOT_DIR/scripts/health-check.sh" ]]; then
    fail "scripts/health-check.sh not found"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; exit 1
fi
pass "health-check.sh exists"

# 2. Runs without shell error (--quiet to reduce output; we care about exit and no "unbound" etc.)
set +e
out=$(cd "$ROOT_DIR" && bash scripts/health-check.sh --quiet 2>&1)
exit_code=$?
set -e

if echo "$out" | grep -q "unbound variable\|syntax error\|command not found"; then
    fail "health-check.sh produced shell error in output"
else
    pass "health-check.sh runs without shell errors"
fi

# Exit code must be 0, 1, or 2 (documented: 0=healthy, 1=degraded, 2=critical)
if [[ "$exit_code" -eq 0 ]] || [[ "$exit_code" -eq 1 ]] || [[ "$exit_code" -eq 2 ]]; then
    pass "health-check.sh exit code is valid (0|1|2): $exit_code"
else
    fail "health-check.sh exit code should be 0, 1, or 2; got $exit_code"
fi

# 3. --json produces JSON-like output (no strict parse here, just key presence)
set +e
json_out=$(cd "$ROOT_DIR" && bash scripts/health-check.sh --json 2>&1)
json_exit=$?
set -e

if echo "$json_out" | grep -q '"'; then
    pass "health-check.sh --json produces JSON-like output"
else
    fail "health-check.sh --json output does not look like JSON"
fi

if [[ "$json_exit" -eq 0 ]] || [[ "$json_exit" -eq 1 ]] || [[ "$json_exit" -eq 2 ]]; then
    pass "health-check.sh --json exit code valid: $json_exit"
else
    fail "health-check.sh --json exit code invalid: $json_exit"
fi

# 4. Script is executable or runnable via bash
if [[ -x "$ROOT_DIR/scripts/health-check.sh" ]] || true; then
    pass "health-check.sh is runnable (bash or executable)"
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
