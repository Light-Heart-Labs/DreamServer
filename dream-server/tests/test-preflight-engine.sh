#!/usr/bin/env bash
# Test suite for scripts/preflight-engine.sh
# Validates preflight checks, report generation, and environment output

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREFLIGHT_ENGINE="$SCRIPT_DIR/scripts/preflight-engine.sh"

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

echo "Testing preflight-engine.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: Script exists and is executable
check "preflight-engine.sh exists and is executable" test -x "$PREFLIGHT_ENGINE"

# Test 2: Script has proper shebang
check "Has proper shebang" grep -q '^#!/usr/bin/env bash' "$PREFLIGHT_ENGINE"

# Test 3: Script uses set -euo pipefail
check "Uses set -euo pipefail" grep -q 'set -euo pipefail' "$PREFLIGHT_ENGINE"

# Test 4: Generates valid JSON report
TEMP_REPORT=$(mktemp)
trap 'rm -f "$TEMP_REPORT"' EXIT

if bash "$PREFLIGHT_ENGINE" \
    --report "$TEMP_REPORT" \
    --tier T2 \
    --ram-gb 32 \
    --disk-gb 200 \
    --gpu-backend nvidia \
    --gpu-vram-mb 16384 \
    --gpu-name "RTX 4070" \
    --platform-id linux \
    --compose-overlays "docker-compose.base.yml,docker-compose.nvidia.yml" \
    --script-dir "$SCRIPT_DIR" \
    >/dev/null 2>&1; then

    if [[ -f "$TEMP_REPORT" ]]; then
        if python3 -m json.tool "$TEMP_REPORT" >/dev/null 2>&1; then
            pass "Generates valid JSON report"
        else
            fail "Generated report is not valid JSON"
        fi
    else
        fail "Report file not created"
    fi
else
    fail "Preflight engine execution failed"
fi

# Test 5: Report contains required fields
if [[ -f "$TEMP_REPORT" ]]; then
    REQUIRED_FIELDS=("timestamp" "platform" "tier" "ram_gb" "disk_gb" "gpu" "checks" "summary")
    ALL_PRESENT=true

    for field in "${REQUIRED_FIELDS[@]}"; do
        if ! grep -q "\"$field\"" "$TEMP_REPORT"; then
            ALL_PRESENT=false
            break
        fi
    done

    if $ALL_PRESENT; then
        pass "Report contains all required fields"
    else
        fail "Report missing required fields"
    fi
fi

# Test 6: --env mode produces shell-safe output
TEMP_ENV=$(mktemp)
trap 'rm -f "$TEMP_REPORT" "$TEMP_ENV"' EXIT

if bash "$PREFLIGHT_ENGINE" \
    --report "$TEMP_REPORT" \
    --tier T1 \
    --ram-gb 16 \
    --disk-gb 100 \
    --gpu-backend cpu \
    --gpu-vram-mb 0 \
    --gpu-name "None" \
    --platform-id linux \
    --script-dir "$SCRIPT_DIR" \
    --env > "$TEMP_ENV" 2>/dev/null; then

    # Check that output is shell-safe (KEY="value" format)
    if grep -qE '^[A-Z_]+="[^"]*"$' "$TEMP_ENV"; then
        pass "--env mode produces shell-safe output"
    else
        fail "--env mode output is not shell-safe"
    fi
else
    fail "--env mode execution failed"
fi

# Test 7: Handles missing arguments gracefully
if bash "$PREFLIGHT_ENGINE" 2>/dev/null; then
    fail "Should fail with missing arguments"
else
    pass "Fails gracefully with missing arguments"
fi

# Test 8: --strict mode enforces requirements
TEMP_STRICT=$(mktemp)
trap 'rm -f "$TEMP_REPORT" "$TEMP_ENV" "$TEMP_STRICT"' EXIT

# Low RAM scenario (8GB) with strict mode should fail
if bash "$PREFLIGHT_ENGINE" \
    --report "$TEMP_STRICT" \
    --tier T3 \
    --ram-gb 8 \
    --disk-gb 200 \
    --gpu-backend nvidia \
    --gpu-vram-mb 24576 \
    --gpu-name "RTX 4090" \
    --platform-id linux \
    --script-dir "$SCRIPT_DIR" \
    --strict >/dev/null 2>&1; then
    fail "--strict mode should fail with insufficient RAM"
else
    pass "--strict mode enforces RAM requirements"
fi

# Test 9: Validates tier values
TEMP_TIER=$(mktemp)
trap 'rm -f "$TEMP_REPORT" "$TEMP_ENV" "$TEMP_STRICT" "$TEMP_TIER"' EXIT

# Valid tiers: T0, T1, T2, T3, T4, SH_LARGE, SH_COMPACT, AP_BASE, AP_PRO, AP_ULTRA
for tier in T1 T2 T3 T4; do
    if bash "$PREFLIGHT_ENGINE" \
        --report "$TEMP_TIER" \
        --tier "$tier" \
        --ram-gb 32 \
        --disk-gb 200 \
        --gpu-backend nvidia \
        --gpu-vram-mb 16384 \
        --gpu-name "Test GPU" \
        --platform-id linux \
        --script-dir "$SCRIPT_DIR" \
        >/dev/null 2>&1; then
        : # Success expected
    else
        fail "Should accept valid tier: $tier"
        break
    fi
done
pass "Accepts valid tier values (T1-T4)"

# Test 10: Handles different GPU backends
for backend in nvidia amd cpu apple; do
    TEMP_BACKEND=$(mktemp)
    if bash "$PREFLIGHT_ENGINE" \
        --report "$TEMP_BACKEND" \
        --tier T2 \
        --ram-gb 32 \
        --disk-gb 200 \
        --gpu-backend "$backend" \
        --gpu-vram-mb 16384 \
        --gpu-name "Test GPU" \
        --platform-id linux \
        --script-dir "$SCRIPT_DIR" \
        >/dev/null 2>&1; then
        : # Success expected
    else
        fail "Should handle GPU backend: $backend"
        rm -f "$TEMP_BACKEND"
        break
    fi
    rm -f "$TEMP_BACKEND"
done
pass "Handles all GPU backends (nvidia, amd, cpu, apple)"

# Test 11: Validates platform IDs
for platform in linux macos windows wsl; do
    TEMP_PLATFORM=$(mktemp)
    if bash "$PREFLIGHT_ENGINE" \
        --report "$TEMP_PLATFORM" \
        --tier T2 \
        --ram-gb 32 \
        --disk-gb 200 \
        --gpu-backend nvidia \
        --gpu-vram-mb 16384 \
        --gpu-name "Test GPU" \
        --platform-id "$platform" \
        --script-dir "$SCRIPT_DIR" \
        >/dev/null 2>&1; then
        : # Success expected
    else
        fail "Should handle platform: $platform"
        rm -f "$TEMP_PLATFORM"
        break
    fi
    rm -f "$TEMP_PLATFORM"
done
pass "Handles all platform IDs (linux, macos, windows, wsl)"

# Test 12: Report includes check results
if [[ -f "$TEMP_REPORT" ]]; then
    if grep -q '"checks"' "$TEMP_REPORT" && grep -q '"summary"' "$TEMP_REPORT"; then
        pass "Report includes check results and summary"
    else
        fail "Report missing check results or summary"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC}"

if [[ $FAIL_COUNT -gt 0 ]]; then
    exit 1
fi
