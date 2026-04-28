#!/usr/bin/env bash
# ============================================================================
# Regression: `dream config show` masks `N8N_USER` and
# `LANGFUSE_INIT_USER_EMAIL` even in environments without `jq`.
# ============================================================================
# Audit follow-up on PR #994 (Lightheartdevs, 2026-04-28):
#
#   "Schema-driven secret masking is useful, but the CLI only learns
#    the schema secret flags through `jq`. In Git Bash without `jq`,
#    newly marked user/email fields such as `N8N_USER` and
#    `LANGFUSE_INIT_USER_EMAIL` can still print in clear. Please either
#    make schema parsing available without `jq` for this command or
#    extend the fallback mask to cover the new schema secrets."
#
# Both fixes are now in place: a Python fallback parser when `jq` is
# absent, plus `*user*` / `*email*` keyword fallback when neither is
# present. This test exercises all three PATH configurations.
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
echo "║   dream config show — secret masking matrix   ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

if [[ ! -x "$DREAM_CLI" ]]; then
    fail "dream-cli not found at $DREAM_CLI"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; exit 1
fi

# Scaffold a hermetic install dir. The schema marks N8N_USER and
# LANGFUSE_INIT_USER_EMAIL as secret:true; .env contains values that
# must NEVER appear in `dream config show` output.
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

INSTALL_SCAFFOLD="$TEMP_DIR/install"
mkdir -p "$INSTALL_SCAFFOLD"
# check_install requires either docker-compose.base.yml or docker-compose.yml
touch "$INSTALL_SCAFFOLD/docker-compose.base.yml"

cat > "$INSTALL_SCAFFOLD/.env" <<'EOF'
# Test fixture
N8N_USER=actual-admin-username
LANGFUSE_INIT_USER_EMAIL=admin@example.test
DREAM_VERSION=2.0.0-test
HOST_RAM_GB=32
EOF

cat > "$INSTALL_SCAFFOLD/.env.schema.json" <<'EOF'
{
  "properties": {
    "N8N_USER": {"type": "string", "secret": true},
    "LANGFUSE_INIT_USER_EMAIL": {"type": "string", "secret": true},
    "DREAM_VERSION": {"type": "string"},
    "HOST_RAM_GB": {"type": "string"}
  }
}
EOF

# Sentinel values whose appearance in stdout would prove a leak.
SECRET_USER='actual-admin-username'
SECRET_EMAIL='admin@example.test'

run_dream_config_show() {
    # Invokes dream-cli with a controlled PATH to simulate environments
    # with/without jq + python3. NO_COLOR=1 keeps output ASCII.
    local _path="$1"
    local _label="$2"
    local _output
    _output=$(NO_COLOR=1 PATH="$_path" DREAM_HOME="$INSTALL_SCAFFOLD" \
        "$BASH" "$DREAM_CLI" config show 2>&1)
    echo "$_output"
}

# Discover real paths to bash, sed, awk, mktemp, etc. so the CLI runs.
# We strip jq and/or python3 from PATH by listing only their needed
# siblings. The simplest approach: build a path that excludes a
# specific binary by symlinking required binaries into a tempdir.
build_pathdir_excluding() {
    # build_pathdir_excluding "<exclude1> <exclude2> ..."
    local _excludes="$1"
    local _pdir="$TEMP_DIR/pathdir-$RANDOM"
    mkdir -p "$_pdir"
    local _bin
    # Tools dream-cli (the section we exercise) actually uses.
    for _bin in bash sh ls cat grep sed awk tr cut sort head tail \
                printf echo mkdir rm tee dirname basename pwd command \
                python3 jq find env; do
        local _real
        _real="$(command -v "$_bin" 2>/dev/null || true)"
        [[ -z "$_real" ]] && continue
        # Skip excluded names.
        case " $_excludes " in *" $_bin "*) continue ;; esac
        ln -s "$_real" "$_pdir/$_bin"
    done
    echo "$_pdir"
}

# --- Case 1: jq + python3 both present (schema-driven path) ---
PATH_FULL=$(build_pathdir_excluding "")
out1=$(run_dream_config_show "$PATH_FULL" "full")
if grep -q "N8N_USER=\\*\\*\\*" <<<"$out1" && ! grep -qF "$SECRET_USER" <<<"$out1"; then
    pass "with jq+python3: N8N_USER masked, value not leaked"
else
    fail "with jq+python3: N8N_USER not masked correctly"
    echo "  --- output ---"; awk '{print "  " $0}' <<<"$out1"
fi
if grep -q "LANGFUSE_INIT_USER_EMAIL=\\*\\*\\*" <<<"$out1" && ! grep -qF "$SECRET_EMAIL" <<<"$out1"; then
    pass "with jq+python3: LANGFUSE_INIT_USER_EMAIL masked, value not leaked"
else
    fail "with jq+python3: LANGFUSE_INIT_USER_EMAIL not masked correctly"
    echo "  --- output ---"; awk '{print "  " $0}' <<<"$out1"
fi

# --- Case 2: no jq, python3 present (Git-Bash-without-jq simulation) ---
PATH_NO_JQ=$(build_pathdir_excluding "jq")
out2=$(run_dream_config_show "$PATH_NO_JQ" "no-jq")
if grep -q "N8N_USER=\\*\\*\\*" <<<"$out2" && ! grep -qF "$SECRET_USER" <<<"$out2"; then
    pass "without jq: N8N_USER masked via python3 fallback"
else
    fail "without jq: N8N_USER LEAKED — Git Bash regression"
    echo "  --- output ---"; awk '{print "  " $0}' <<<"$out2"
fi
if grep -q "LANGFUSE_INIT_USER_EMAIL=\\*\\*\\*" <<<"$out2" && ! grep -qF "$SECRET_EMAIL" <<<"$out2"; then
    pass "without jq: LANGFUSE_INIT_USER_EMAIL masked via python3 fallback"
else
    fail "without jq: LANGFUSE_INIT_USER_EMAIL LEAKED — Git Bash regression"
    echo "  --- output ---"; awk '{print "  " $0}' <<<"$out2"
fi

# --- Case 3: neither jq nor python3 (keyword-fallback only) ---
PATH_NO_TOOLS=$(build_pathdir_excluding "jq python3")
out3=$(run_dream_config_show "$PATH_NO_TOOLS" "no-tools")
if grep -q "N8N_USER=\\*\\*\\*" <<<"$out3" && ! grep -qF "$SECRET_USER" <<<"$out3"; then
    pass "without jq+python3: N8N_USER masked via *user* keyword"
else
    fail "without jq+python3: N8N_USER LEAKED — keyword fallback gap"
    echo "  --- output ---"; awk '{print "  " $0}' <<<"$out3"
fi
if grep -q "LANGFUSE_INIT_USER_EMAIL=\\*\\*\\*" <<<"$out3" && ! grep -qF "$SECRET_EMAIL" <<<"$out3"; then
    pass "without jq+python3: LANGFUSE_INIT_USER_EMAIL masked via *user*/*email* keyword"
else
    fail "without jq+python3: LANGFUSE_INIT_USER_EMAIL LEAKED — keyword fallback gap"
    echo "  --- output ---"; awk '{print "  " $0}' <<<"$out3"
fi

# --- Sanity: non-secret keys are NOT masked (no over-mask regression) ---
if grep -q "DREAM_VERSION=2.0.0-test" <<<"$out1"; then
    pass "non-secret DREAM_VERSION shown in clear (no over-mask)"
else
    fail "non-secret DREAM_VERSION incorrectly masked or missing"
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
