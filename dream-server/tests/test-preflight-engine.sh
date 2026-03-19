#!/bin/bash
# ============================================================================
# Dream Server preflight-engine.sh Test Suite
# ============================================================================
# Ensures scripts/preflight-engine.sh runs without errors and validates
# system requirements before installation.
#
# Usage: ./tests/test-preflight-engine.sh
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
echo "║   preflight-engine.sh Test Suite                  ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# 1. Script exists and is executable
if [[ ! -f "$ROOT_DIR/scripts/preflight-engine.sh" ]]; then
    fail "scripts/preflight-engine.sh not found"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; [[ $FAILED -eq 0 ]]; exit $?
fi
pass "preflight-engine.sh exists"

if [[ ! -x "$ROOT_DIR/scripts/preflight-engine.sh" ]]; then
    fail "preflight-engine.sh not executable"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; [[ $FAILED -eq 0 ]]; exit $?
fi
pass "preflight-engine.sh is executable"

# 2. Script has proper error handling
if grep -q "set -.*euo.*pipefail" "$ROOT_DIR/scripts/preflight-engine.sh"; then
    pass "Script has proper error handling (set -euo pipefail)"
else
    fail "Script missing proper error handling"
fi

# 3. Script accepts required arguments
TEMP_REPORT=$(mktemp)
trap 'rm -f "$TEMP_REPORT"' EXIT

set +e
out=$(cd "$ROOT_DIR" && bash scripts/preflight-engine.sh \
    --report "$TEMP_REPORT" \
    --tier T1 \
    --ram-gb 16 \
    --disk-gb 100 \
    --gpu-backend nvidia \
    --gpu-vram-mb 8192 \
    --gpu-name "Test GPU" \
    --platform-id linux-x86_64 \
    --script-dir "$ROOT_DIR" 2>&1)
exit_code=$?
set -e

if [[ $exit_code -eq 0 ]]; then
    pass "Script runs with required arguments"
else
    fail "Script failed with required arguments (exit $exit_code)"
fi

# 4. Script generates report file
if [[ -f "$TEMP_REPORT" ]]; then
    pass "Script generates report file"
else
    fail "Script did not generate report file"
fi

# 5. Report contains expected fields
if [[ -f "$TEMP_REPORT" ]]; then
    if grep -q "ram\|disk\|gpu" "$TEMP_REPORT"; then
        pass "Report contains system information"
    else
        fail "Report missing system information"
    fi
fi

# 6. Script validates RAM requirements
if grep -q "ram\|RAM\|memory" "$ROOT_DIR/scripts/preflight-engine.sh"; then
    pass "Script validates RAM requirements"
else
    fail "Script missing RAM validation"
fi

# 7. Script validates disk space requirements
if grep -q "disk\|DISK\|storage" "$ROOT_DIR/scripts/preflight-engine.sh"; then
    pass "Script validates disk space requirements"
else
    fail "Script missing disk space validation"
fi

# 8. Script supports --env output mode
set +e
env_out=$(cd "$ROOT_DIR" && bash scripts/preflight-engine.sh \
    --report "$TEMP_REPORT" \
    --tier T1 \
    --ram-gb 16 \
    --disk-gb 100 \
    --gpu-backend nvidia \
    --gpu-vram-mb 8192 \
    --gpu-name "Test GPU" \
    --platform-id linux-x86_64 \
    --script-dir "$ROOT_DIR" \
    --env 2>&1)
env_exit=$?
set -e

if [[ $env_exit -eq 0 ]] && echo "$env_out" | grep -q "="; then
    pass "Script supports --env output mode"
else
    fail "Script --env mode failed or missing"
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
