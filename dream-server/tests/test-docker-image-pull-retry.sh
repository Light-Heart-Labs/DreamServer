#!/bin/bash
# ============================================================================
# Dream Server Docker Image Pull Retry Test Suite
# ============================================================================
# Tests that Docker image pulls have retry logic
#
# Usage: ./tests/test-docker-image-pull-retry.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║   Docker Image Pull Retry Test Suite     ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

echo "1. Retry Logic Implementation Tests"
echo "────────────────────────────────────"

# Test 1: pull_with_progress function exists
printf "  %-50s " "pull_with_progress function exists..."
if grep -q "^pull_with_progress()" "$ROOT_DIR/installers/lib/ui.sh"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 2: pull_with_progress has retry loop
printf "  %-50s " "pull_with_progress has retry loop..."
if grep -A 50 "^pull_with_progress()" "$ROOT_DIR/installers/lib/ui.sh" | grep -q "for attempt in"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 3: pull_with_progress has max_attempts variable
printf "  %-50s " "pull_with_progress defines max_attempts..."
if grep -A 10 "^pull_with_progress()" "$ROOT_DIR/installers/lib/ui.sh" | grep -q "max_attempts="; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 4: pull_with_progress shows retry message
printf "  %-50s " "pull_with_progress shows retry message..."
if grep -A 50 "^pull_with_progress()" "$ROOT_DIR/installers/lib/ui.sh" | grep -q "Retry attempt"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 5: pull_with_progress has sleep between retries
printf "  %-50s " "pull_with_progress has delay between retries..."
if grep -A 50 "^pull_with_progress()" "$ROOT_DIR/installers/lib/ui.sh" | grep -B 2 "Retry attempt" | grep -q "sleep"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 6: pull_with_progress returns success on any successful attempt
printf "  %-50s " "pull_with_progress returns 0 on success..."
if grep -A 50 "^pull_with_progress()" "$ROOT_DIR/installers/lib/ui.sh" | grep -q "return 0"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 7: pull_with_progress returns failure after all attempts
printf "  %-50s " "pull_with_progress returns 1 after all failures..."
if grep -A 60 "^pull_with_progress()" "$ROOT_DIR/installers/lib/ui.sh" | tail -5 | grep -q "return 1"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

echo ""
echo "2. Integration Tests"
echo "────────────────────"

# Test 8: Phase 08 uses pull_with_progress
printf "  %-50s " "Phase 08 calls pull_with_progress..."
if grep -q "pull_with_progress" "$ROOT_DIR/installers/phases/08-images.sh"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 9: Phase 08 tracks pull failures
printf "  %-50s " "Phase 08 tracks pull_failed count..."
if grep -q "pull_failed" "$ROOT_DIR/installers/phases/08-images.sh"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Test 10: Phase 08 shows warning for failed pulls
printf "  %-50s " "Phase 08 shows warning for failures..."
if grep -q "ai_warn.*failed" "$ROOT_DIR/installers/phases/08-images.sh"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

echo ""
echo "3. Retry Strategy Tests"
echo "───────────────────────"

# Test 11: Retry count is 3 (matches model download retry count)
printf "  %-50s " "Retry count is 3 attempts..."
retry_count=$(grep -A 10 "^pull_with_progress()" "$ROOT_DIR/installers/lib/ui.sh" | grep "max_attempts=" | grep -oP '\d+' || echo "0")
if [[ "$retry_count" == "3" ]]; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC} (found $retry_count, expected 3)"
    ((FAILED++))
fi

# Test 12: Retry delay exists (prevents hammering)
printf "  %-50s " "Retry delay prevents hammering..."
if grep -A 50 "^pull_with_progress()" "$ROOT_DIR/installers/lib/ui.sh" | grep -B 2 "Retry attempt" | grep -q "sleep [0-9]"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

echo ""
echo "═══════════════════════════════════════════"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed${NC} ($PASSED/$((PASSED + FAILED)))"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC} ($PASSED passed, $FAILED failed)"
    echo ""
    exit 1
fi
