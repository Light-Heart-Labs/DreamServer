#!/bin/bash
# ============================================================================
# Dream Server resolve-compose-stack.sh Test Suite
# ============================================================================
# Ensures scripts/resolve-compose-stack.sh correctly merges compose files
# and handles tier/backend/profile overlays.
#
# Usage: ./tests/test-resolve-compose-stack.sh
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
echo "║   resolve-compose-stack.sh Test Suite            ║"
echo "╚═══════════════════════════════════════════════════╝"
echo ""

# 1. Script exists and is executable
if [[ ! -f "$ROOT_DIR/scripts/resolve-compose-stack.sh" ]]; then
    fail "scripts/resolve-compose-stack.sh not found"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; [[ $FAILED -eq 0 ]]; exit $?
fi
pass "resolve-compose-stack.sh exists"

if [[ ! -x "$ROOT_DIR/scripts/resolve-compose-stack.sh" ]]; then
    fail "resolve-compose-stack.sh not executable"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; [[ $FAILED -eq 0 ]]; exit $?
fi
pass "resolve-compose-stack.sh is executable"

# 2. Script runs without errors (basic invocation)
set +e
out=$(cd "$ROOT_DIR" && bash scripts/resolve-compose-stack.sh 2>&1)
exit_code=$?
set -e

if [[ $exit_code -eq 0 ]]; then
    pass "resolve-compose-stack.sh runs without errors"
else
    fail "resolve-compose-stack.sh exited with code $exit_code"
fi

# 3. Output contains expected compose file references
if echo "$out" | grep -q "docker-compose"; then
    pass "Output contains compose file references"
else
    fail "Output missing compose file references"
fi

# 4. Base compose file is always included
if echo "$out" | grep -q "docker-compose.base.yml"; then
    pass "Base compose file included in output"
else
    fail "Base compose file not found in output"
fi

# 5. Script handles GPU backend selection
if [[ -f "$ROOT_DIR/docker-compose.amd.yml" ]]; then
    set +e
    out_amd=$(cd "$ROOT_DIR" && bash scripts/resolve-compose-stack.sh --gpu-backend amd 2>&1)
    set -e
    if echo "$out_amd" | grep -q "docker-compose.amd.yml"; then
        pass "AMD GPU backend overlay detected"
    else
        fail "AMD GPU backend overlay not included"
    fi
fi

if [[ -f "$ROOT_DIR/docker-compose.nvidia.yml" ]]; then
    set +e
    out_nvidia=$(cd "$ROOT_DIR" && bash scripts/resolve-compose-stack.sh --gpu-backend nvidia 2>&1)
    set -e
    if echo "$out_nvidia" | grep -q "docker-compose.nvidia.yml"; then
        pass "NVIDIA GPU backend overlay detected"
    else
        fail "NVIDIA GPU backend overlay not included"
    fi
fi

# 6. Script discovers extension compose files
extension_count=$(find "$ROOT_DIR/extensions/services" -name "compose.yaml" -o -name "compose.yml" 2>/dev/null | wc -l)
if [[ $extension_count -gt 0 ]]; then
    if echo "$out" | grep -q "extensions/services"; then
        pass "Extension compose files discovered"
    else
        fail "Extension compose files not discovered"
    fi
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
