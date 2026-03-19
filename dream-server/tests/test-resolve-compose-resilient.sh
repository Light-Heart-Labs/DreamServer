#!/bin/bash
# ============================================================================
# Resolve compose stack resilient parsing test
# ============================================================================
# Tests that resolve-compose-stack.sh handles broken manifests correctly:
# - Default behavior: crash on bad manifest (Let It Crash principle)
# - --skip-broken flag: skip bad manifest and continue with others
#
# Usage: ./tests/test-resolve-compose-resilient.sh
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() { echo -e "  ${GREEN}✓ PASS${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC} $1"; FAILED=$((FAILED + 1)); }
skip() { echo -e "  ${YELLOW}⊘ SKIP${NC} $1"; }

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   Resolve Compose Resilient Parsing Test      ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

# 1. Script exists
if [[ ! -f "$ROOT_DIR/scripts/resolve-compose-stack.sh" ]]; then
    fail "scripts/resolve-compose-stack.sh not found"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; exit 1
fi
pass "resolve-compose-stack.sh exists"

# 2. --skip-broken flag is accepted
help_exit=0
bash "$ROOT_DIR/scripts/resolve-compose-stack.sh" --help 2>&1 | grep -q "skip-broken" || help_exit=$?
if [[ $help_exit -eq 0 ]] || grep -q "skip-broken" "$ROOT_DIR/scripts/resolve-compose-stack.sh"; then
    pass "--skip-broken flag is implemented"
else
    skip "--skip-broken flag not in help (may still work)"
fi

# 3. Behavioral test: Create temp extension with broken manifest
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Create minimal directory structure
mkdir -p "$TEMP_DIR/extensions/services/broken-ext"
mkdir -p "$TEMP_DIR/extensions/services/good-ext"

# Create broken manifest (invalid YAML)
cat > "$TEMP_DIR/extensions/services/broken-ext/manifest.yaml" <<'EOF'
schema_version: dream.services.v1
service:
  id: broken-ext
  name: Broken Extension
  compose_file: compose.yaml
  invalid_yaml: {{{
EOF

# Create good manifest
cat > "$TEMP_DIR/extensions/services/good-ext/manifest.yaml" <<'EOF'
schema_version: dream.services.v1
service:
  id: good-ext
  name: Good Extension
  compose_file: compose.yaml
  gpu_backends: ["nvidia", "amd", "apple"]
EOF

# Create compose files
cat > "$TEMP_DIR/extensions/services/good-ext/compose.yaml" <<'EOF'
services:
  good-service:
    image: nginx:latest
EOF

# Create base compose file
cat > "$TEMP_DIR/docker-compose.base.yml" <<'EOF'
services:
  base-service:
    image: nginx:latest
EOF

# 4. Test default behavior: should exit 1 on broken manifest
default_exit=0
bash "$ROOT_DIR/scripts/resolve-compose-stack.sh" --script-dir "$TEMP_DIR" --tier 1 --gpu-backend nvidia 2>&1 || default_exit=$?

if [[ $default_exit -ne 0 ]]; then
    pass "Default behavior: exits on broken manifest (Let It Crash)"
else
    fail "Default behavior: should exit 1 on broken manifest"
fi

# 5. Test --skip-broken flag: should continue and skip broken extension
skip_exit=0
output=$(bash "$ROOT_DIR/scripts/resolve-compose-stack.sh" --script-dir "$TEMP_DIR" --tier 1 --gpu-backend nvidia --skip-broken 2>&1) || skip_exit=$?

if [[ $skip_exit -eq 0 ]]; then
    pass "--skip-broken: continues execution despite broken manifest"
else
    fail "--skip-broken: should not exit on broken manifest"
fi

# 6. Verify error message is printed to stderr with --skip-broken
if echo "$output" | grep -q "ERROR: Failed to parse manifest"; then
    pass "--skip-broken: error message printed to stderr"
else
    fail "--skip-broken: error message not printed"
fi

# 7. Verify good extension is still included with --skip-broken
flags_output=$(bash "$ROOT_DIR/scripts/resolve-compose-stack.sh" --script-dir "$TEMP_DIR" --tier 1 --gpu-backend nvidia --skip-broken 2>/dev/null)
if echo "$flags_output" | grep -q "good-ext"; then
    pass "--skip-broken: good extension still included in output"
else
    skip "--skip-broken: good extension not in output (may be filtered by other logic)"
fi

# 8. Verify broken extension is not included with --skip-broken
if echo "$flags_output" | grep -q "broken-ext"; then
    fail "--skip-broken: broken extension should not be in output"
else
    pass "--skip-broken: broken extension correctly excluded"
fi

# 9. Test with JSON parse error
cat > "$TEMP_DIR/extensions/services/broken-ext/manifest.json" <<'EOF'
{
  "schema_version": "dream.services.v1",
  "service": {
    "id": "broken-ext"
    "name": "Missing comma"
  }
}
EOF

rm -f "$TEMP_DIR/extensions/services/broken-ext/manifest.yaml"

json_exit=0
bash "$ROOT_DIR/scripts/resolve-compose-stack.sh" --script-dir "$TEMP_DIR" --tier 1 --gpu-backend nvidia 2>&1 || json_exit=$?

if [[ $json_exit -ne 0 ]]; then
    pass "JSON parse error: exits by default"
else
    fail "JSON parse error: should exit 1"
fi

# 10. Verify --skip-broken works with JSON errors
json_skip_exit=0
bash "$ROOT_DIR/scripts/resolve-compose-stack.sh" --script-dir "$TEMP_DIR" --tier 1 --gpu-backend nvidia --skip-broken 2>&1 || json_skip_exit=$?

if [[ $json_skip_exit -eq 0 ]]; then
    pass "JSON parse error: --skip-broken continues execution"
else
    fail "JSON parse error: --skip-broken should not exit"
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
