#!/usr/bin/env bash
# Test suite for scripts/simulate-installers.sh
# Validates installer simulation, artifact generation, and cross-platform testing

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIMULATE_SCRIPT="$SCRIPT_DIR/scripts/simulate-installers.sh"

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

echo "Testing simulate-installers.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: Script exists and is executable
check "simulate-installers.sh exists and is executable" test -x "$SIMULATE_SCRIPT"

# Test 2: Script has proper shebang
check "Has proper shebang" grep -q '^#!/usr/bin/env bash' "$SIMULATE_SCRIPT"

# Test 3: Script uses set -euo pipefail
check "Uses set -euo pipefail" grep -q 'set -euo pipefail' "$SIMULATE_SCRIPT"

# Test 4: Creates output directory
check "Creates output directory" grep -q 'mkdir -p' "$SIMULATE_SCRIPT"

# Test 5: Defines all expected artifact paths
EXPECTED_ARTIFACTS=(
    "LINUX_LOG"
    "LINUX_SUMMARY_JSON"
    "MACOS_LOG"
    "WINDOWS_SIM_JSON"
    "MACOS_PREFLIGHT_JSON"
    "MACOS_DOCTOR_JSON"
    "DOCTOR_JSON"
    "SUMMARY_JSON"
    "SUMMARY_MD"
)

ALL_DEFINED=true
for artifact in "${EXPECTED_ARTIFACTS[@]}"; do
    if ! grep -q "^${artifact}=" "$SIMULATE_SCRIPT"; then
        ALL_DEFINED=false
        fail "Missing artifact definition: $artifact"
        break
    fi
done

if $ALL_DEFINED; then
    pass "Defines all expected artifact paths"
fi

# Test 6: Creates fake curl binary for offline simulation
check "Creates fake curl binary" grep -q 'FAKEBIN=' "$SIMULATE_SCRIPT"

# Test 7: Runs Linux installer dry-run
check "Runs Linux installer dry-run" grep -q 'install-core.sh.*--dry-run' "$SIMULATE_SCRIPT"

# Test 8: Runs macOS installer simulation
check "Runs macOS installer simulation" grep -q 'installers/macos.sh' "$SIMULATE_SCRIPT"

# Test 9: Runs Windows preflight simulation
check "Runs Windows preflight simulation" grep -q 'preflight-engine.sh' "$SIMULATE_SCRIPT"

# Test 10: Runs doctor snapshot
check "Runs doctor snapshot" grep -q 'dream-doctor.sh' "$SIMULATE_SCRIPT"

# Test 11: Uses Python for summary generation
check "Uses Python for summary generation" grep -q 'PYTHON_CMD=' "$SIMULATE_SCRIPT"

# Test 12: Generates summary JSON
check "Generates summary JSON" grep -q 'summary_json_path' "$SIMULATE_SCRIPT"

# Test 13: Generates summary markdown
check "Generates summary markdown" grep -q 'summary_md_path' "$SIMULATE_SCRIPT"

# Test 14: Captures exit codes from simulations
if grep -q 'LINUX_EXIT=' "$SIMULATE_SCRIPT" && \
   grep -q 'MACOS_EXIT=' "$SIMULATE_SCRIPT" && \
   grep -q 'DOCTOR_EXIT=' "$SIMULATE_SCRIPT"; then
    pass "Captures exit codes from all simulations"
else
    fail "Missing exit code capture"
fi

# Test 15: Uses trap for cleanup
check "Uses trap for cleanup" grep -q "trap.*rm.*FAKEBIN" "$SIMULATE_SCRIPT"

# Test 16: Passes correct flags to Linux installer
if grep -q '\-\-non-interactive' "$SIMULATE_SCRIPT" && \
   grep -q '\-\-skip-docker' "$SIMULATE_SCRIPT" && \
   grep -q '\-\-force' "$SIMULATE_SCRIPT"; then
    pass "Passes correct flags to Linux installer"
else
    fail "Missing required Linux installer flags"
fi

# Test 17: Passes correct flags to macOS installer
if grep -q '\-\-no-delegate' "$SIMULATE_SCRIPT" && \
   grep -q '\-\-report' "$SIMULATE_SCRIPT" && \
   grep -q '\-\-doctor-report' "$SIMULATE_SCRIPT"; then
    pass "Passes correct flags to macOS installer"
else
    fail "Missing required macOS installer flags"
fi

# Test 18: Simulates Windows scenario with realistic parameters
if grep -q '\-\-tier T1' "$SIMULATE_SCRIPT" && \
   grep -q '\-\-ram-gb 16' "$SIMULATE_SCRIPT" && \
   grep -q '\-\-gpu-backend nvidia' "$SIMULATE_SCRIPT" && \
   grep -q '\-\-platform-id windows' "$SIMULATE_SCRIPT"; then
    pass "Simulates Windows scenario with realistic parameters"
else
    fail "Windows simulation missing required parameters"
fi

# Test 19: Redirects output to log files
if grep -q '>".*LOG"' "$SIMULATE_SCRIPT" || grep -q '>"\$.*_LOG"' "$SIMULATE_SCRIPT"; then
    pass "Redirects output to log files"
else
    fail "Missing output redirection to logs"
fi

# Test 20: Python script loads and parses JSON artifacts
if grep -q 'load_json' "$SIMULATE_SCRIPT" && grep -q 'json.loads' "$SIMULATE_SCRIPT"; then
    pass "Python script loads and parses JSON artifacts"
else
    fail "Missing JSON parsing in Python script"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC}"

if [[ $FAIL_COUNT -gt 0 ]]; then
    exit 1
fi
