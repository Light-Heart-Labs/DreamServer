#!/usr/bin/env bash
# Test suite for scripts/health-check.sh
# Validates service health checking, parallel execution, and status reporting

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HEALTH_CHECK="$SCRIPT_DIR/scripts/health-check.sh"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

pass() {
    echo -e "${GREEN}✓${NC} $1"
    PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
    echo -e "${RED}✗${NC} $1"
    FAIL_COUNT=$((FAIL_COUNT + 1))
}

check() {
    local name="$1"
    shift
    if "$@"; then
        pass "$name"
        return 0
    else
        fail "$name"
        return 1
    fi
}

echo "Testing health-check.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: Script exists and is executable
check "health-check.sh exists and is executable" test -x "$HEALTH_CHECK"

# Test 2: Script has proper shebang
check "Has proper shebang" grep -q '^#!/bin/bash' "$HEALTH_CHECK"

# Test 3: Script uses set -euo pipefail
check "Uses set -euo pipefail" grep -q 'set -euo pipefail' "$HEALTH_CHECK"

# Test 4: Has Bash 4+ guard for associative arrays
check "Has Bash 4+ version guard" grep -q 'BASH_VERSINFO' "$HEALTH_CHECK"

# Test 5: Loads service registry
check "Loads service registry" grep -q 'service-registry.sh' "$HEALTH_CHECK"

# Test 6: Has --json flag support
check "Supports --json flag" grep -q '\-\-json' "$HEALTH_CHECK"

# Test 7: Has --quiet flag support
check "Supports --quiet flag" grep -q '\-\-quiet' "$HEALTH_CHECK"

# Test 8: Defines exit codes (0=healthy, 1=degraded, 2=critical)
if grep -q 'EXIT_CODE=0' "$HEALTH_CHECK" && \
   grep -q 'EXIT_CODE=1' "$HEALTH_CHECK" && \
   grep -q 'EXIT_CODE=2' "$HEALTH_CHECK"; then
    pass "Defines proper exit codes (0, 1, 2)"
else
    fail "Missing exit code definitions"
fi

# Test 9: Has test_llm function for inference testing
check "Has test_llm function for inference testing" grep -q 'test_llm()' "$HEALTH_CHECK"

# Test 10: Has test_service function for generic health checks
check "Has test_service function" grep -q 'test_service()' "$HEALTH_CHECK"

# Test 11: Has test_gpu function for GPU monitoring
check "Has test_gpu function" grep -q 'test_gpu()' "$HEALTH_CHECK"

# Test 12: Has test_disk function for disk monitoring
check "Has test_disk function" grep -q 'test_disk()' "$HEALTH_CHECK"

# Test 13: Uses parallel health checks (background processes)
if grep -q 'check_service_async' "$HEALTH_CHECK" && grep -q '&$' "$HEALTH_CHECK"; then
    pass "Uses parallel health checks for performance"
else
    fail "Missing parallel health check implementation"
fi

# Test 14: Checks container state via docker inspect
check "Checks container state via docker inspect" grep -q 'check_container_state' "$HEALTH_CHECK"

# Test 15: Has proper error handling for missing services
if grep -q 'CRITICAL_FAIL' "$HEALTH_CHECK" && grep -q 'ANY_FAIL' "$HEALTH_CHECK"; then
    pass "Tracks critical and non-critical failures"
else
    fail "Missing failure tracking"
fi

# Test 16: Validates JSON output structure
if grep -q '"timestamp"' "$HEALTH_CHECK" && \
   grep -q '"status"' "$HEALTH_CHECK" && \
   grep -q '"services"' "$HEALTH_CHECK"; then
    pass "JSON output includes required fields"
else
    fail "JSON output missing required fields"
fi

# Test 17: Uses curl for health endpoint checks
check "Uses curl for HTTP health checks" grep -q 'curl.*health' "$HEALTH_CHECK"

# Test 18: Has timeout configuration
check "Has timeout configuration" grep -q 'TIMEOUT=' "$HEALTH_CHECK"

# Test 19: Loads environment from .env file
check "Loads .env file for configuration" grep -q 'load_env_file' "$HEALTH_CHECK"

# Test 20: Has color output control (disabled for JSON/quiet)
if grep -q 'if \$JSON_OUTPUT \|\| \$QUIET' "$HEALTH_CHECK"; then
    pass "Disables colors for JSON/quiet modes"
else
    fail "Missing color output control"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC}"

if [[ $FAIL_COUNT -gt 0 ]]; then
    exit 1
fi
