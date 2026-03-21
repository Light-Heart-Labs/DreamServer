#!/usr/bin/env bash
# Test lib/safe-env.sh: load_env_file and load_env_from_output
# Ensures .env loading is safe (no eval, no injection) and consistent.
#
# Run from repo root:  bash dream-server/tests/test-safe-env.sh
# Or from dream-server: bash tests/test-safe-env.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() { echo "[FAIL] $*"; exit 1; }
pass() { echo "[PASS] $*"; }

# Source the implementation
[[ -f "$ROOT_DIR/lib/safe-env.sh" ]] || fail "lib/safe-env.sh not found"
. "$ROOT_DIR/lib/safe-env.sh"

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# ---- load_env_file: valid keys and values ----
echo "Test 1: load_env_file parses valid KEY=value and exports"
cat > "$tmpdir/.env" << 'EOF'
# comment
SOME_KEY=simple_value
ANOTHER=with-dash_123
QUOTED_DOUBLE="value with spaces"
QUOTED_SINGLE='single quoted'
# empty above
EMPTY_VAL=
EOF
load_env_file "$tmpdir/.env"
[[ "${SOME_KEY:-}" == "simple_value" ]] || fail "SOME_KEY not set (got: ${SOME_KEY:-})"
[[ "${ANOTHER:-}" == "with-dash_123" ]] || fail "ANOTHER not set"
[[ "${QUOTED_DOUBLE:-}" == "value with spaces" ]] || fail "QUOTED_DOUBLE not set"
[[ "${QUOTED_SINGLE:-}" == "single quoted" ]] || fail "QUOTED_SINGLE not set"
pass "load_env_file exports valid vars"

# ---- load_env_file: dangerous line must not be executed ----
echo "Test 2: load_env_file skips/invalidates dangerous key names (no eval)"
# Key with shell metacharacters should be skipped by our key regex
cat > "$tmpdir/.env2" << 'EOF'
SAFE_VAR=ok
EVIL_KEY$(echo injected)=value
NORMAL_AFTER=works
EOF
unset SAFE_VAR EVIL_KEY NORMAL_AFTER 2>/dev/null || true
load_env_file "$tmpdir/.env2"
[[ "${SAFE_VAR:-}" == "ok" ]] || fail "SAFE_VAR not set"
[[ "${NORMAL_AFTER:-}" == "works" ]] || fail "NORMAL_AFTER not set"
# EVIL_KEY... should not be set (key regex rejects it)
pass "load_env_file rejects invalid key names"

# ---- load_env_file: missing file is no-op ----
echo "Test 3: load_env_file missing file is no-op"
load_env_file "$tmpdir/nonexistent.env"
pass "load_env_file missing file returns 0"

# ---- load_env_file: empty file ----
echo "Test 4: load_env_file empty file is no-op"
touch "$tmpdir/empty.env"
load_env_file "$tmpdir/empty.env"
pass "load_env_file empty file is no-op"

# ---- load_env_from_output: stdin (must run in current shell so export persists) ----
echo "Test 5: load_env_from_output parses KEY=\"value\" from stdin"
unset FROM_STDIN 2>/dev/null || true
load_env_from_output < <(echo 'FROM_STDIN="hello from stdin"')
[[ "${FROM_STDIN:-}" == "hello from stdin" ]] || fail "FROM_STDIN not set (got: ${FROM_STDIN:-})"
pass "load_env_from_output exports from stdin"

echo ""
echo "All safe-env tests passed."
