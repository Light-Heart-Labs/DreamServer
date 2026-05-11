#!/bin/bash
# ============================================================================
# Dream Server Windows compose failure report tests
# ============================================================================
# Static checks for install-time automatic report wiring on Windows.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIAG_LIB="$ROOT_DIR/installers/windows/lib/compose-diagnostics.ps1"
INSTALL_PS1="$ROOT_DIR/installers/windows/install-windows.ps1"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
PASS=0
FAIL=0

pass() { echo -e "  ${GREEN}PASS${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAIL=$((FAIL + 1)); }

check() {
    local pattern="$1" file="$2" label="$3"
    if grep -Fq -- "$pattern" "$file"; then
        pass "$label"
    else
        fail "$label"
    fi
}

echo ""
echo "=== Windows compose failure report tests ==="
echo ""

[[ -f "$DIAG_LIB" ]] && pass "compose diagnostics library exists" || fail "compose diagnostics library missing"
[[ -f "$INSTALL_PS1" ]] && pass "Windows installer exists" || fail "Windows installer missing"

check 'function Write-DreamComposeFailureReport' "$DIAG_LIB" "report writer function exists"
check 'install-report-$stamp.txt' "$DIAG_LIB" "report uses install-report timestamp path"
check 'Get-DreamComposeFailedImages' "$DIAG_LIB" "report extracts failed images from compose log"
check 'Get-NetTCPConnection' "$DIAG_LIB" "report includes Windows port checks"
check 'docker compose @ComposeFlags @envArgs config' "$DIAG_LIB" "report captures compose config"
check '[switch]$SaveReport' "$DIAG_LIB" "diagnostics only save report when requested"
check '-ComposeLogPath $_composeLog' "$INSTALL_PS1" "installer passes compose log to diagnostics"
check '-ComposeArgs @("up", "-d", "--remove-orphans", "--no-build")' "$INSTALL_PS1" "installer passes exact compose up args"
check '-SaveReport' "$INSTALL_PS1" "installer enables saved report on compose failure"

if grep -q "Write-DreamComposeDiagnostics .*SaveReport" "$ROOT_DIR/installers/windows/dream.ps1"; then
    fail "dream.ps1 command failures should not create install reports by default"
else
    pass "dream.ps1 diagnostics remain console-only by default"
fi

echo ""
echo "Result: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
