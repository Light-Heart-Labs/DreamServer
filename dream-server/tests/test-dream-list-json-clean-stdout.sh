#!/usr/bin/env bash
# ============================================================================
# Regression: `dream list --json` keeps stdout valid JSON even when registry
# loading emits diagnostics on stderr.
# ============================================================================
# Audit follow-up on PR #1000 (Lightheartdevs, 2026-04-28):
#
#   "Now that #1006 has moved log()/warn() to stderr on main, please rebase
#    and add a regression proving `dream list --json` remains valid JSON
#    when PyYAML/registry loading warnings occur."
#
# This test:
#   1. Scaffolds a hermetic install dir (copy of dream-cli + minimal lib/)
#      with one VALID extension manifest and one BROKEN manifest (missing
#      required `service.id` field).
#   2. Runs `dream-cli list --json`, capturing stdout and stderr separately.
#   3. Asserts stdout parses as JSON, contains the valid extension, and
#      excludes the broken one.
#   4. Asserts stderr contains the registry's `# SKIP:` diagnostic for the
#      broken manifest — proving the warning fired during sr_load.
#   5. Asserts stdout has no leakage from stderr.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DREAM_CLI="$ROOT_DIR/dream-cli"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() { echo -e "  ${GREEN}✓ PASS${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC} $1"; FAILED=$((FAILED + 1)); }

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   dream list --json — clean stdout regression ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

if [[ ! -x "$DREAM_CLI" ]]; then
    fail "dream-cli not found at $DREAM_CLI"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; exit 1
fi
if ! command -v python3 &>/dev/null; then
    echo "  ⊘ SKIP — python3 required for JSON parse assertion"
    exit 0
fi
if ! python3 -c 'import yaml' &>/dev/null; then
    echo "  ⊘ SKIP — PyYAML required for sr_load (install: pip3 install pyyaml)"
    exit 0
fi

# Hermetic scaffold so SCRIPT_DIR resolves inside the tempdir, isolating
# EXTENSIONS_DIR from the live repo.
TEMP_DIR=$(mktemp -d)
stdout_file="$TEMP_DIR/stdout.txt"
stderr_file="$TEMP_DIR/stderr.txt"
trap 'rm -rf "$TEMP_DIR"' EXIT

cp "$DREAM_CLI" "$TEMP_DIR/dream-cli"
mkdir -p "$TEMP_DIR/lib"
# Required: dream-cli unconditionally sources service-registry.sh.
cp "$ROOT_DIR/lib/service-registry.sh" "$TEMP_DIR/lib/"
# Optional helpers — cp only if present so the test still runs on
# trees that haven't landed them. Failure here would still propagate
# (no `|| true`) — we want a missing-file regression to surface.
[[ -f "$ROOT_DIR/lib/safe-env.sh"   ]] && cp "$ROOT_DIR/lib/safe-env.sh"   "$TEMP_DIR/lib/"
[[ -f "$ROOT_DIR/lib/python-cmd.sh" ]] && cp "$ROOT_DIR/lib/python-cmd.sh" "$TEMP_DIR/lib/"

# Valid extension — should appear in the JSON output.
mkdir -p "$TEMP_DIR/extensions/services/valid-svc"
cat > "$TEMP_DIR/extensions/services/valid-svc/manifest.yaml" <<'EOF'
schema_version: dream.services.v1
service:
  id: valid-svc
  name: Valid Service
  category: optional
  port: 9999
  compose_file: compose.yaml
  gpu_backends: [all]
EOF

# Broken extension — missing `service.id`. Triggers
#   `# SKIP: <path>: missing required "id" field`
# on stderr from sr_load's Python parser, while sr_load continues.
mkdir -p "$TEMP_DIR/extensions/services/broken-svc"
cat > "$TEMP_DIR/extensions/services/broken-svc/manifest.yaml" <<'EOF'
schema_version: dream.services.v1
service:
  port: 8888
  compose_file: compose.yaml
EOF

# Run dream list --json with isolated install dir.
#
# Set DREAM_HOME so INSTALL_DIR resolves to the tempdir; SCRIPT_DIR is
# computed by dream-cli from BASH_SOURCE[0], which is the copy in tempdir.
# Disable colour output so stdout is byte-exact JSON.
rc=0
NO_COLOR=1 DREAM_HOME="$TEMP_DIR" "$TEMP_DIR/dream-cli" list --json \
    > "$stdout_file" 2> "$stderr_file" || rc=$?

# 1. Exit code clean (sr_load tolerates broken manifests, list shouldn't fail).
if [[ "$rc" -eq 0 ]]; then
    pass "dream list --json exited 0"
else
    fail "dream list --json exited $rc"
    echo "  --- stderr ---"; cat "$stderr_file" | sed 's/^/  /'
fi

# 2. stdout parses as valid JSON.
if python3 -c 'import json,sys; json.loads(open(sys.argv[1]).read())' "$stdout_file" 2>/dev/null; then
    pass "stdout parses as valid JSON"
else
    fail "stdout is NOT valid JSON"
    echo "  --- stdout ---"; cat "$stdout_file" | sed 's/^/  /'
fi

# 3. JSON includes the valid extension and excludes the broken one.
if python3 -c '
import json, sys
data = json.loads(open(sys.argv[1]).read())
ids = {entry["id"] for entry in data}
assert "valid-svc" in ids, f"valid-svc missing from {ids}"
assert "broken-svc" not in ids, f"broken-svc leaked through: {ids}"
' "$stdout_file" 2>/dev/null; then
    pass "valid extension present, broken extension correctly skipped"
else
    fail "extension membership wrong in JSON"
    echo "  --- stdout ---"; cat "$stdout_file" | sed 's/^/  /'
fi

# 4. stderr received the registry diagnostic — proving the warning fired
#    while we were collecting stdout. Match the literal `# SKIP:` prefix
#    that lib/service-registry.sh:117-151 emits, not just the substring
#    `SKIP` (which other code paths could legitimately emit later).
if grep -q "# SKIP:" "$stderr_file"; then
    pass "stderr contains '# SKIP:' diagnostic from sr_load"
else
    fail "stderr missing expected '# SKIP:' diagnostic"
    echo "  --- stderr ---"; cat "$stderr_file" | sed 's/^/  /'
fi

# 5. stdout has no leakage from stderr (registry diagnostics, log/warn
#    sigils, ANSI colour escapes). Use $'\x1b' (literal ESC byte 0x1B)
#    in the bash regex test so the ANSI check is real, not a string
#    match against the four-character sequence "\033[".
if grep -qE '# SKIP:|^⚠|^\[dream\]' "$stdout_file" \
   || [[ "$(cat "$stdout_file")" == *$'\x1b['* ]]; then
    fail "stdout contains stderr-style content (would break jq pipelines)"
    echo "  --- stdout ---"; cat "$stdout_file" | sed 's/^/  /'
else
    pass "stdout free of stderr leakage (jq-safe)"
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
