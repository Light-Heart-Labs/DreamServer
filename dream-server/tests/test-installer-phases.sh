#!/usr/bin/env bash
# Test suite for installer phase contracts
# Validates that installer phases follow expected structure and contracts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

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
echo "Installer Phase Contracts Test Suite"
echo "========================================"

# Test 1: All expected phase files exist
run_test "All installer phase files exist"
EXPECTED_PHASES=(
    "01-preflight.sh"
    "02-detection.sh"
    "03-tier.sh"
    "04-docker.sh"
    "05-compose.sh"
    "06-directories.sh"
    "07-devtools.sh"
    "08-model.sh"
    "09-bootstrap.sh"
    "10-services.sh"
    "11-health.sh"
    "12-summary.sh"
)

MISSING_PHASES=0
for phase in "${EXPECTED_PHASES[@]}"; do
    if [[ ! -f "installers/phases/$phase" ]]; then
        fail "Missing phase: $phase"
        MISSING_PHASES=$((MISSING_PHASES + 1))
    fi
done

if [[ $MISSING_PHASES -eq 0 ]]; then
    pass "All ${#EXPECTED_PHASES[@]} expected phases exist"
else
    fail "$MISSING_PHASES phases missing"
fi

# Test 2: All phase files have proper error handling
run_test "All phases have set -euo pipefail"
PHASES_WITHOUT_ERROR_HANDLING=0
for phase in installers/phases/*.sh; do
    if [[ -f "$phase" ]]; then
        if ! head -30 "$phase" | grep -q "set -euo pipefail"; then
            fail "$(basename "$phase") missing 'set -euo pipefail'"
            PHASES_WITHOUT_ERROR_HANDLING=$((PHASES_WITHOUT_ERROR_HANDLING + 1))
        fi
    fi
done

if [[ $PHASES_WITHOUT_ERROR_HANDLING -eq 0 ]]; then
    pass "All phases have proper error handling"
else
    fail "$PHASES_WITHOUT_ERROR_HANDLING phases missing error handling"
fi

# Test 3: Phase files have proper headers
run_test "Phases have standardized headers"
PHASES_WITHOUT_HEADERS=0
for phase in installers/phases/*.sh; do
    if [[ -f "$phase" ]]; then
        if ! head -20 "$phase" | grep -qE "(Purpose:|Expects:|Provides:)"; then
            fail "$(basename "$phase") missing standardized header"
            PHASES_WITHOUT_HEADERS=$((PHASES_WITHOUT_HEADERS + 1))
        fi
    fi
done

if [[ $PHASES_WITHOUT_HEADERS -eq 0 ]]; then
    pass "All phases have standardized headers"
else
    fail "$PHASES_WITHOUT_HEADERS phases missing headers"
fi

# Test 4: install-core.sh exists and sources phases
run_test "install-core.sh exists and sources phases"
if [[ -f "installers/install-core.sh" ]]; then
    if grep -q "source.*phases/" "installers/install-core.sh" || grep -q "\. .*phases/" "installers/install-core.sh"; then
        pass "install-core.sh sources phase files"
    else
        fail "install-core.sh should source phase files"
    fi
else
    fail "installers/install-core.sh not found"
fi

# Test 5: Installer lib files exist
run_test "Installer library files exist"
EXPECTED_LIBS=(
    "constants.sh"
    "detection.sh"
    "logging.sh"
    "tier-map.sh"
    "ui.sh"
)

MISSING_LIBS=0
for lib in "${EXPECTED_LIBS[@]}"; do
    if [[ ! -f "installers/lib/$lib" ]]; then
        fail "Missing lib: $lib"
        MISSING_LIBS=$((MISSING_LIBS + 1))
    fi
done

if [[ $MISSING_LIBS -eq 0 ]]; then
    pass "All ${#EXPECTED_LIBS[@]} expected lib files exist"
else
    fail "$MISSING_LIBS lib files missing"
fi

# Test 6: Lib files have error handling
run_test "Installer lib files have set -euo pipefail"
LIBS_WITHOUT_ERROR_HANDLING=0
for lib in installers/lib/*.sh; do
    if [[ -f "$lib" ]]; then
        if ! head -30 "$lib" | grep -q "set -euo pipefail"; then
            fail "$(basename "$lib") missing 'set -euo pipefail'"
            LIBS_WITHOUT_ERROR_HANDLING=$((LIBS_WITHOUT_ERROR_HANDLING + 1))
        fi
    fi
done

if [[ $LIBS_WITHOUT_ERROR_HANDLING -eq 0 ]]; then
    pass "All lib files have proper error handling"
else
    fail "$LIBS_WITHOUT_ERROR_HANDLING lib files missing error handling"
fi

# Summary
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
