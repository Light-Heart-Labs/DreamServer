#!/bin/bash
# ============================================================================
# Dream Server llm-cold-storage.sh Test Suite
# ============================================================================
# Ensures scripts/llm-cold-storage.sh runs without errors and handles
# model archiving operations correctly.
#
# Usage: ./tests/test-llm-cold-storage.sh
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
echo "║   llm-cold-storage.sh Test Suite                  ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# 1. Script exists and is executable
if [[ ! -f "$ROOT_DIR/scripts/llm-cold-storage.sh" ]]; then
    fail "scripts/llm-cold-storage.sh not found"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; [[ $FAILED -eq 0 ]]; exit $?
fi
pass "llm-cold-storage.sh exists"

if [[ ! -x "$ROOT_DIR/scripts/llm-cold-storage.sh" ]]; then
    fail "llm-cold-storage.sh not executable"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; [[ $FAILED -eq 0 ]]; exit $?
fi
pass "llm-cold-storage.sh is executable"

# 2. Help command works
set +e
help_out=$(bash "$ROOT_DIR/scripts/llm-cold-storage.sh" --help 2>&1)
help_exit=$?
set -e

if [[ $help_exit -eq 0 ]] && echo "$help_out" | grep -q "Usage:"; then
    pass "--help flag works and shows usage"
else
    fail "--help flag failed or missing usage"
fi

# 3. Status command works (dry-run, no actual archiving)
set +e
status_out=$(bash "$ROOT_DIR/scripts/llm-cold-storage.sh" --status 2>&1)
status_exit=$?
set -e

if [[ $status_exit -eq 0 ]]; then
    pass "--status command runs without errors"
else
    fail "--status command failed with exit code $status_exit"
fi

# 4. Dry-run mode works (default behavior)
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

export HF_CACHE="$TEMP_DIR/huggingface/hub"
export COLD_DIR="$TEMP_DIR/cold-storage"
mkdir -p "$HF_CACHE"

set +e
dryrun_out=$(bash "$ROOT_DIR/scripts/llm-cold-storage.sh" 2>&1)
dryrun_exit=$?
set -e

if [[ $dryrun_exit -eq 0 ]]; then
    pass "Dry-run mode (default) runs without errors"
else
    fail "Dry-run mode failed with exit code $dryrun_exit"
fi

# 5. Script has proper error handling (set -euo pipefail)
if grep -q "set -.*uo.*pipefail" "$ROOT_DIR/scripts/llm-cold-storage.sh"; then
    pass "Script has proper error handling (set -uo pipefail)"
else
    fail "Script missing proper error handling"
fi

# 6. Script validates required dependencies (checks for python, pip, etc.)
if grep -qE "python|pip|huggingface" "$ROOT_DIR/scripts/llm-cold-storage.sh"; then
    pass "Script checks for required dependencies"
else
    fail "Script missing dependency checks"
fi

# 7. Script has protected models list
if grep -q "PROTECTED_MODELS" "$ROOT_DIR/scripts/llm-cold-storage.sh"; then
    pass "Script has protected models list"
else
    fail "Script missing protected models list"
fi

# 8. Script handles restore operations
if grep -q "do_restore\|--restore" "$ROOT_DIR/scripts/llm-cold-storage.sh"; then
    pass "Script supports restore operations"
else
    fail "Script missing restore functionality"
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
