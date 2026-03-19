#!/bin/bash
# ============================================================================
# Dream Server detect-hardware.sh Test Suite
# ============================================================================
# Ensures scripts/detect-hardware.sh has proper structure and detection logic.
# Tests hardware detection for GPU, CPU, RAM, and disk.
#
# Usage: ./tests/test-detect-hardware.sh
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
echo "║   detect-hardware.sh Test Suite                  ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# 1. Script exists
if [[ ! -f "$ROOT_DIR/scripts/detect-hardware.sh" ]]; then
    fail "scripts/detect-hardware.sh not found"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; [[ $FAILED -eq 0 ]]; exit $?
fi
pass "detect-hardware.sh exists"

# 2. Script is executable
if [[ -x "$ROOT_DIR/scripts/detect-hardware.sh" ]]; then
    pass "detect-hardware.sh is executable"
else
    fail "detect-hardware.sh is not executable"
fi

# 3. Check for GPU detection
if grep -qi "nvidia\|amd\|intel.*arc" "$ROOT_DIR/scripts/detect-hardware.sh"; then
    pass "Script includes GPU detection (NVIDIA/AMD/Intel)"
else
    fail "Script missing GPU detection"
fi

# 4. Check for RAM detection
if grep -qi "ram\|memory\|memtotal" "$ROOT_DIR/scripts/detect-hardware.sh"; then
    pass "Script includes RAM detection"
else
    fail "Script missing RAM detection"
fi

# 5. Check for disk detection
if grep -qi "disk\|df\|storage" "$ROOT_DIR/scripts/detect-hardware.sh"; then
    pass "Script includes disk detection"
else
    fail "Script missing disk detection"
fi

# 6. Check for CPU detection
if grep -qi "cpu\|processor\|/proc/cpuinfo" "$ROOT_DIR/scripts/detect-hardware.sh"; then
    pass "Script includes CPU detection"
else
    fail "Script missing CPU detection"
fi

# 7. Check for nvidia-smi usage
if grep -q "nvidia-smi" "$ROOT_DIR/scripts/detect-hardware.sh"; then
    pass "Script uses nvidia-smi for NVIDIA detection"
else
    fail "Script missing nvidia-smi usage"
fi

# 8. Check for lspci usage
if grep -q "lspci" "$ROOT_DIR/scripts/detect-hardware.sh"; then
    pass "Script uses lspci for hardware detection"
else
    fail "Script missing lspci usage"
fi

# 9. Check for JSON output support
if grep -q "json\|JSON" "$ROOT_DIR/scripts/detect-hardware.sh"; then
    pass "Script supports JSON output"
else
    fail "Script missing JSON output support"
fi

# 10. Syntax validation
if bash -n "$ROOT_DIR/scripts/detect-hardware.sh"; then
    pass "Script passes syntax validation"
else
    fail "Script has syntax errors"
fi

# 11. Check for error handling
if grep -q "set -e" "$ROOT_DIR/scripts/detect-hardware.sh"; then
    pass "Script uses set -e for error handling"
else
    fail "Script missing set -e"
fi

# 12. Check for main function
if grep -q "^main()" "$ROOT_DIR/scripts/detect-hardware.sh"; then
    pass "Script includes main() function"
else
    fail "Script missing main() function"
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
