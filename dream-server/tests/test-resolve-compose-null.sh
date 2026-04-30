#!/bin/bash
# ============================================================================
# resolve-compose-stack.sh --null contract test
# ============================================================================
# Verifies that:
#   1. --null emits each argv token NUL-separated.
#   2. The standard consumer pattern (`while IFS= read -r -d ''`) reads
#      back the array correctly, including paths containing whitespace.
#   3. Default (string) mode is unchanged when --null is not passed.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RESOLVER="$ROOT_DIR/scripts/resolve-compose-stack.sh"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() { echo -e "  ${GREEN}✓ PASS${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC} $1"; FAILED=$((FAILED + 1)); }

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   resolve-compose-stack.sh --null contract    ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

if [[ ! -x "$RESOLVER" ]]; then
    fail "resolver not found at $RESOLVER"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; exit 1
fi
pass "resolver is executable"

# Build a temp script-dir with a parent path containing a space, plus
# the minimum scaffolding the resolver expects.
TEMP_DIR=$(mktemp -d "/tmp/ds null test.XXXXXX")
trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$TEMP_DIR/space dir/dream-server"
SCRIPT_DIR_WITH_SPACE="$TEMP_DIR/space dir/dream-server"
touch "$SCRIPT_DIR_WITH_SPACE/docker-compose.base.yml"
touch "$SCRIPT_DIR_WITH_SPACE/docker-compose.nvidia.yml"
mkdir -p "$SCRIPT_DIR_WITH_SPACE/extensions/services"

# 1. --null mode emits NUL-separated tokens. Bash's `$()` strips NUL
#    bytes silently, so we use a tempfile to inspect the raw bytes.
nul_file="$TEMP_DIR/null-output.bin"
"$RESOLVER" --script-dir "$SCRIPT_DIR_WITH_SPACE" \
    --tier 1 --gpu-backend nvidia --null > "$nul_file"

nul_count=$(tr -cd '\0' < "$nul_file" | wc -c | tr -d ' ')
if [[ "$nul_count" -ge 4 ]]; then
    pass "--null output contains $nul_count NUL bytes"
else
    fail "--null output should have >= 4 NUL bytes, got $nul_count"
fi

# 2. Round-trip via `read -d ''` produces an array with the expected
#    tokens.
arr=()
while IFS= read -r -d '' tok; do
    arr+=("$tok")
done < <("$RESOLVER" --script-dir "$SCRIPT_DIR_WITH_SPACE" \
    --tier 1 --gpu-backend nvidia --null)

if [[ ${#arr[@]} -eq 4 ]]; then
    pass "round-trip array has 4 tokens"
else
    fail "expected 4 tokens, got ${#arr[@]}: ${arr[*]}"
fi

if [[ "${arr[0]:-}" == "-f" && "${arr[1]:-}" == "docker-compose.base.yml" ]]; then
    pass "first token pair is -f docker-compose.base.yml"
else
    fail "expected '-f docker-compose.base.yml' first, got '${arr[0]:-<unset>} ${arr[1]:-<unset>}'"
fi

if [[ "${arr[2]:-}" == "-f" && "${arr[3]:-}" == "docker-compose.nvidia.yml" ]]; then
    pass "second token pair is -f docker-compose.nvidia.yml"
else
    fail "expected '-f docker-compose.nvidia.yml' second, got '${arr[2]:-<unset>} ${arr[3]:-<unset>}'"
fi

# 3. Synthetic NUL stream containing a path with whitespace round-trips
#    through the consumer pattern intact. Bash's `$()` strips NUL bytes,
#    so we feed the read loop directly from process substitution.
recv=()
while IFS= read -r -d '' tok; do
    recv+=("$tok")
done < <(printf '%s\0%s\0%s\0' "-f" "/tmp/path with spaces/compose.yml" "-f")

if [[ ${#recv[@]} -eq 3 ]] \
    && [[ "${recv[0]}" == "-f" ]] \
    && [[ "${recv[1]}" == "/tmp/path with spaces/compose.yml" ]] \
    && [[ "${recv[2]}" == "-f" ]]; then
    pass "consumer pattern preserves whitespace inside tokens"
else
    fail "round-trip mangled whitespace token: count=${#recv[@]} [${recv[*]}]"
fi

# 4. Default mode (no --null) still emits the legacy space-delimited
#    string. Inspect the raw bytes via tempfile because `$()` would
#    discard any NUL anyway and we want to detect a regression.
default_file="$TEMP_DIR/default-output.txt"
"$RESOLVER" --script-dir "$SCRIPT_DIR_WITH_SPACE" \
    --tier 1 --gpu-backend nvidia > "$default_file"

default_nul_count=$(tr -cd '\0' < "$default_file" | wc -c | tr -d ' ')
if [[ "$default_nul_count" -eq 0 ]]; then
    pass "default mode contains no NUL bytes (legacy string preserved)"
else
    fail "default mode unexpectedly contains $default_nul_count NUL bytes"
fi

default_text=$(cat "$default_file")
if [[ "$default_text" == "-f docker-compose.base.yml -f docker-compose.nvidia.yml" ]]; then
    pass "default mode output is the expected legacy string"
else
    fail "default mode output changed: '$default_text'"
fi

# 5. End-to-end: an extension whose own directory name contains a
#    space produces a relative compose path with a literal space, and
#    that path survives the NUL round-trip as a single token.
EXT_NAME="space ext"
mkdir -p "$SCRIPT_DIR_WITH_SPACE/extensions/services/$EXT_NAME"
cat > "$SCRIPT_DIR_WITH_SPACE/extensions/services/$EXT_NAME/manifest.json" <<EOF
{
  "schema_version": "dream.services.v1",
  "service": {
    "id": "space-ext",
    "compose_file": "compose.yaml",
    "gpu_backends": ["all"]
  }
}
EOF
touch "$SCRIPT_DIR_WITH_SPACE/extensions/services/$EXT_NAME/compose.yaml"

ext_arr=()
while IFS= read -r -d '' tok; do
    ext_arr+=("$tok")
done < <("$RESOLVER" --script-dir "$SCRIPT_DIR_WITH_SPACE" \
    --tier 1 --gpu-backend nvidia --null)

# Find the token that points at the space-ext compose file. It should
# be exactly one element with the literal space preserved.
expected_path="extensions/services/$EXT_NAME/compose.yaml"
match_count=0
for t in "${ext_arr[@]}"; do
    [[ "$t" == "$expected_path" ]] && match_count=$((match_count + 1))
done

if [[ "$match_count" -eq 1 ]]; then
    pass "extension dir with space round-trips as a single token: '$expected_path'"
else
    fail "expected exactly one token '$expected_path', got $match_count matches in [${ext_arr[*]}]"
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
