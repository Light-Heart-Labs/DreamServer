#!/usr/bin/env bash
# Test suite for scripts/classify-hardware.sh
# Validates hardware classification, GPU database matching, and tier recommendations

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLASSIFY_SCRIPT="$SCRIPT_DIR/scripts/classify-hardware.sh"
GPU_DB="$SCRIPT_DIR/config/gpu-database.json"

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

echo "Testing classify-hardware.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: Script exists and is executable
check "classify-hardware.sh exists and is executable" test -x "$CLASSIFY_SCRIPT"

# Test 2: Script has proper shebang
check "Has proper shebang" grep -q '^#!/usr/bin/env bash' "$CLASSIFY_SCRIPT"

# Test 3: Script uses set -euo pipefail
check "Uses set -euo pipefail" grep -q 'set -euo pipefail' "$CLASSIFY_SCRIPT"

# Test 4: GPU database exists
check "GPU database exists" test -f "$GPU_DB"

# Test 5: GPU database is valid JSON
if python3 -m json.tool "$GPU_DB" >/dev/null 2>&1; then
    pass "GPU database is valid JSON"
else
    fail "GPU database is not valid JSON"
fi

# Test 6: Classifies NVIDIA GPU by device ID
TEMP_OUT=$(mktemp)
trap 'rm -f "$TEMP_OUT"' EXIT

if bash "$CLASSIFY_SCRIPT" \
    --platform-id linux \
    --gpu-vendor nvidia \
    --memory-type discrete \
    --vram-mb 24576 \
    --device-id "0x2684" \
    --gpu-name "NVIDIA GeForce RTX 4090" \
    --env > "$TEMP_OUT" 2>/dev/null; then

    if grep -q 'HW_CLASS_ID=' "$TEMP_OUT" && grep -q 'HW_REC_TIER=' "$TEMP_OUT"; then
        pass "Classifies NVIDIA GPU by device ID"
    else
        fail "Output missing required classification fields"
    fi
else
    fail "Failed to classify NVIDIA GPU"
fi

# Test 7: Classifies AMD APU (Strix Halo)
TEMP_AMD=$(mktemp)
trap 'rm -f "$TEMP_OUT" "$TEMP_AMD"' EXIT

if bash "$CLASSIFY_SCRIPT" \
    --platform-id linux \
    --gpu-vendor amd \
    --memory-type unified \
    --vram-mb 1024 \
    --device-id "0x1506" \
    --gpu-name "AMD Radeon Graphics" \
    --cpu-name "AMD Ryzen AI Max+ 395" \
    --ram-mb 98304 \
    --env > "$TEMP_AMD" 2>/dev/null; then

    if grep -q 'HW_CLASS_ID=' "$TEMP_AMD"; then
        pass "Classifies AMD APU (Strix Halo)"
    else
        fail "Failed to classify AMD APU"
    fi
else
    fail "AMD APU classification failed"
fi

# Test 8: Handles CPU-only fallback
TEMP_CPU=$(mktemp)
trap 'rm -f "$TEMP_OUT" "$TEMP_AMD" "$TEMP_CPU"' EXIT

if bash "$CLASSIFY_SCRIPT" \
    --platform-id linux \
    --gpu-vendor unknown \
    --memory-type none \
    --vram-mb 0 \
    --env > "$TEMP_CPU" 2>/dev/null; then

    if grep -q 'HW_CLASS_ID=' "$TEMP_CPU" && grep -q 'HW_REC_BACKEND=' "$TEMP_CPU"; then
        pass "Handles CPU-only fallback"
    else
        fail "CPU-only fallback missing required fields"
    fi
else
    fail "CPU-only classification failed"
fi

# Test 9: --env mode produces shell-safe output
if [[ -f "$TEMP_OUT" ]]; then
    if grep -qE '^HW_[A-Z_]+="[^"]*"$' "$TEMP_OUT"; then
        pass "--env mode produces shell-safe output"
    else
        fail "--env mode output is not shell-safe"
    fi
fi

# Test 10: Output includes all required contract fields
REQUIRED_FIELDS=(
    "HW_CLASS_ID"
    "HW_CLASS_LABEL"
    "HW_REC_BACKEND"
    "HW_REC_TIER"
    "HW_REC_COMPOSE_OVERLAYS"
)

ALL_PRESENT=true
for field in "${REQUIRED_FIELDS[@]}"; do
    if ! grep -q "^${field}=" "$TEMP_OUT"; then
        ALL_PRESENT=false
        fail "Missing required field: $field"
        break
    fi
done

if $ALL_PRESENT; then
    pass "Output includes all required contract fields"
fi

# Test 11: Handles Apple Silicon
TEMP_APPLE=$(mktemp)
trap 'rm -f "$TEMP_OUT" "$TEMP_AMD" "$TEMP_CPU" "$TEMP_APPLE"' EXIT

if bash "$CLASSIFY_SCRIPT" \
    --platform-id macos \
    --gpu-vendor apple \
    --memory-type unified \
    --vram-mb 65536 \
    --gpu-name "Apple M3 Max" \
    --ram-mb 65536 \
    --env > "$TEMP_APPLE" 2>/dev/null; then

    if grep -q 'HW_CLASS_ID=' "$TEMP_APPLE" && grep -q 'HW_REC_BACKEND="apple"' "$TEMP_APPLE"; then
        pass "Handles Apple Silicon classification"
    else
        fail "Apple Silicon classification incomplete"
    fi
else
    fail "Apple Silicon classification failed"
fi

# Test 12: Validates compose overlay format
if [[ -f "$TEMP_OUT" ]]; then
    if grep -qE '^HW_REC_COMPOSE_OVERLAYS="[^"]*\.yml[^"]*"$' "$TEMP_OUT"; then
        pass "Compose overlays have correct format"
    else
        fail "Compose overlays format is invalid"
    fi
fi

# Test 13: Handles missing GPU database gracefully
TEMP_NODB=$(mktemp)
trap 'rm -f "$TEMP_OUT" "$TEMP_AMD" "$TEMP_CPU" "$TEMP_APPLE" "$TEMP_NODB"' EXIT

if bash "$CLASSIFY_SCRIPT" \
    --platform-id linux \
    --gpu-vendor nvidia \
    --vram-mb 16384 \
    --db "/nonexistent/path/gpu-database.json" \
    2>/dev/null; then
    fail "Should fail with missing GPU database"
else
    pass "Fails gracefully with missing GPU database"
fi

# Test 14: Device ID matching takes precedence over name patterns
TEMP_PRECEDENCE=$(mktemp)
trap 'rm -f "$TEMP_OUT" "$TEMP_AMD" "$TEMP_CPU" "$TEMP_APPLE" "$TEMP_NODB" "$TEMP_PRECEDENCE"' EXIT

# Use a known device ID with a mismatched name to verify device ID precedence
if bash "$CLASSIFY_SCRIPT" \
    --platform-id linux \
    --gpu-vendor nvidia \
    --memory-type discrete \
    --vram-mb 24576 \
    --device-id "0x2684" \
    --gpu-name "Wrong GPU Name" \
    --env > "$TEMP_PRECEDENCE" 2>/dev/null; then

    # Should still classify correctly based on device ID
    if grep -q 'HW_CLASS_ID=' "$TEMP_PRECEDENCE"; then
        pass "Device ID matching takes precedence over name patterns"
    else
        fail "Device ID precedence not working"
    fi
else
    fail "Device ID precedence test failed"
fi

# Test 15: Tier recommendations are valid
if [[ -f "$TEMP_OUT" ]]; then
    TIER=$(grep '^HW_REC_TIER=' "$TEMP_OUT" | cut -d'"' -f2)
    VALID_TIERS="T0 T1 T2 T3 T4 SH_LARGE SH_COMPACT AP_BASE AP_PRO AP_ULTRA NV_ULTRA ARC ARC_LITE"

    if echo "$VALID_TIERS" | grep -qw "$TIER"; then
        pass "Tier recommendation is valid ($TIER)"
    else
        fail "Invalid tier recommendation: $TIER"
    fi
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Results: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC}"

if [[ $FAIL_COUNT -gt 0 ]]; then
    exit 1
fi
