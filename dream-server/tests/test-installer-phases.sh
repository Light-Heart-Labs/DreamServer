#!/bin/bash
# ============================================================================
# Test: Installer Phases Compliance
# ============================================================================
# Purpose: Verify all installer phase files follow "Let It Crash" principle
#          - No silent error suppression (2>/dev/null || true)
#          - All errors captured with inline exit code pattern
#          - All failures logged with exit codes
#
# Usage: bash tests/test-installer-phases.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHASES_DIR="$SCRIPT_DIR/installers/phases"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    echo -e "${GREEN}✓${NC} $1"
}

fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    echo -e "${RED}✗${NC} $1"
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

test_no_silent_suppression() {
    local file="$1"
    local basename=$(basename "$file")
    TESTS_RUN=$((TESTS_RUN + 1))

    # Check for silent error suppression patterns
    # Allowed: 2>&1 (redirect stderr to stdout for logging)
    # Forbidden: 2>/dev/null || true (silent suppression)
    # Forbidden: &>/dev/null (silent suppression)
    # Forbidden: >/dev/null 2>&1 || true (silent suppression)

    local violations=0

    # Pattern 1: 2>/dev/null || true
    if grep -n '2>/dev/null.*||.*true' "$file" | grep -v '^[[:space:]]*#'; then
        fail "$basename: Found '2>/dev/null || true' pattern"
        violations=$((violations + 1))
    fi

    # Pattern 2: &>/dev/null (without proper error handling)
    # Allow &>/dev/null if followed by explicit exit code check
    if grep -n '&>/dev/null' "$file" | grep -v '^[[:space:]]*#' | grep -v '_exit=0'; then
        fail "$basename: Found '&>/dev/null' without exit code capture"
        violations=$((violations + 1))
    fi

    # Pattern 3: >/dev/null 2>&1 || true
    if grep -n '>/dev/null 2>&1.*||.*true' "$file" | grep -v '^[[:space:]]*#'; then
        fail "$basename: Found '>/dev/null 2>&1 || true' pattern"
        violations=$((violations + 1))
    fi

    if [[ $violations -eq 0 ]]; then
        pass "$basename: No silent error suppression"
    fi
}

test_inline_exit_code_pattern() {
    local file="$1"
    local basename=$(basename "$file")
    TESTS_RUN=$((TESTS_RUN + 1))

    # Check that commands with potential failures use inline exit code capture
    # Pattern: command_exit=0; command 2>&1 || command_exit=$?

    # Count how many times we redirect stderr (2>&1 or 2>>"$LOG_FILE")
    local stderr_redirects=$(grep -c '2>&1\|2>>.*LOG_FILE' "$file" || echo 0)

    # Count how many exit code captures we have
    local exit_captures=$(grep -c '_exit=0' "$file" || echo 0)

    # We expect at least some exit code captures if there are stderr redirects
    if [[ $stderr_redirects -gt 5 && $exit_captures -eq 0 ]]; then
        fail "$basename: Has $stderr_redirects stderr redirects but no exit code captures"
    else
        pass "$basename: Uses inline exit code capture pattern ($exit_captures captures)"
    fi
}

test_error_logging() {
    local file="$1"
    local basename=$(basename "$file")
    TESTS_RUN=$((TESTS_RUN + 1))

    # Check that exit code failures are logged
    # Pattern: [[ $exit_code -ne 0 ]] && log "..."

    local exit_checks=$(grep -c '\[\[.*_exit.*-ne 0.*\]\]' "$file" || echo 0)
    local log_calls=$(grep -c 'log ".*failed.*exit' "$file" || echo 0)

    # We expect some error logging if there are exit code checks
    if [[ $exit_checks -gt 0 && $log_calls -eq 0 ]]; then
        warn "$basename: Has $exit_checks exit code checks but no error logging"
    else
        pass "$basename: Logs errors with exit codes ($log_calls log calls)"
    fi
}

test_no_bare_command_or_true() {
    local file="$1"
    local basename=$(basename "$file")
    TESTS_RUN=$((TESTS_RUN + 1))

    # Check for bare "|| true" without proper error handling
    # This is a code smell - we should capture exit codes instead

    local bare_or_true=$(grep -n '||[[:space:]]*true[[:space:]]*$' "$file" | grep -v '^[[:space:]]*#' | grep -v 'return 0 2>/dev/null || true' || echo "")

    if [[ -n "$bare_or_true" ]]; then
        fail "$basename: Found bare '|| true' without exit code capture:"
        echo "$bare_or_true"
    else
        pass "$basename: No bare '|| true' patterns"
    fi
}

test_set_flags() {
    local file="$1"
    local basename=$(basename "$file")
    TESTS_RUN=$((TESTS_RUN + 1))

    # Check that phase files have proper set flags
    # We expect: set -euo pipefail (or at least set -e)

    if grep -q '^set -euo pipefail' "$file"; then
        pass "$basename: Has 'set -euo pipefail'"
    elif grep -q '^set -e' "$file"; then
        warn "$basename: Has 'set -e' but not full 'set -euo pipefail'"
    else
        # Phase files are sourced, so they may not have set flags
        # This is acceptable
        pass "$basename: Sourced file (no set flags required)"
    fi
}

echo "============================================================================"
echo "Installer Phases Compliance Test"
echo "============================================================================"
echo ""

# Test all phase files
for phase_file in "$PHASES_DIR"/*.sh; do
    if [[ ! -f "$phase_file" ]]; then
        continue
    fi

    basename=$(basename "$phase_file")
    echo "Testing: $basename"
    echo "----------------------------------------"

    test_no_silent_suppression "$phase_file"
    test_inline_exit_code_pattern "$phase_file"
    test_error_logging "$phase_file"
    test_no_bare_command_or_true "$phase_file"
    test_set_flags "$phase_file"

    echo ""
done

# Summary
echo "============================================================================"
echo "Test Summary"
echo "============================================================================"
echo "Tests run:    $TESTS_RUN"
echo "Tests passed: $TESTS_PASSED"
echo "Tests failed: $TESTS_FAILED"
echo ""

if [[ $TESTS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}✓ All tests passed${NC}"
    exit 0
else
    echo -e "${RED}✗ $TESTS_FAILED test(s) failed${NC}"
    exit 1
fi
