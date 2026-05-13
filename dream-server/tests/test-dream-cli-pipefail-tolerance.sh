#!/usr/bin/env bash
# Regression coverage for dream-cli paths made stricter by shell strict mode.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DREAM_CLI="$ROOT_DIR/dream-cli"
TMP_DIR="$(mktemp -d)"
INSTALL_DIR="$TMP_DIR/install"
BIN_DIR="$TMP_DIR/bin"

PASS=0
FAIL=0
SKIP=0

cleanup() {
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL + 1)); }
skip() { echo "[SKIP] $1"; SKIP=$((SKIP + 1)); }

run_dream() {
    local output rc
    set +e
    output=$(DREAM_HOME="$INSTALL_DIR" NO_COLOR=1 "$DREAM_CLI" "$@" 2>&1)
    rc=$?
    set -e
    printf '%s\n' "$rc"
    printf '%s\n' "$output"
}

reset_install() {
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    cp "$ROOT_DIR/docker-compose.base.yml" "$INSTALL_DIR/docker-compose.base.yml"
}

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/docker" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "compose" && "$2" == "ps" ]]; then
    exit 0
fi
if [[ "$1" == "ps" ]]; then
    exit 0
fi
exit 1
SH
cat > "$BIN_DIR/docker-compose" <<'SH'
#!/usr/bin/env bash
exit 0
SH
cat > "$BIN_DIR/curl" <<'SH'
#!/usr/bin/env bash
echo "curl: (7) Failed to connect" >&2
exit 7
SH
chmod +x "$BIN_DIR/docker" "$BIN_DIR/docker-compose" "$BIN_DIR/curl"
export PATH="$BIN_DIR:$PATH"

if grep -Eq '^set -euo pipefail|^set -eo pipefail' "$DREAM_CLI"; then
    pass "dream-cli enables pipefail"
else
    fail "dream-cli does not enable pipefail"
fi

if grep -q '^set -euo pipefail' "$DREAM_CLI"; then
    pass "dream-cli enables nounset"
else
    fail "dream-cli does not enable nounset"
fi

reset_install
: > "$INSTALL_DIR/.env"
result="$(run_dream config show)"
rc="$(printf '%s\n' "$result" | sed -n '1p')"
if [[ "$rc" == "0" ]]; then
    pass "config show tolerates empty .env"
else
    fail "config show exited $rc for empty .env"
fi

cat > "$INSTALL_DIR/.env" <<'EOF'
DREAM_MODE=local
EOF
result="$(run_dream mode)"
rc="$(printf '%s\n' "$result" | sed -n '1p')"
if [[ "$rc" == "0" ]]; then
    pass "mode display tolerates missing optional .env keys"
else
    fail "mode display exited $rc with missing optional .env keys"
fi

result="$(run_dream model current)"
rc="$(printf '%s\n' "$result" | sed -n '1p')"
if [[ "$rc" == "0" ]]; then
    pass "model current tolerates missing model/tier keys"
else
    fail "model current exited $rc with missing model/tier keys"
fi

mkdir -p "$INSTALL_DIR/presets/left" "$INSTALL_DIR/presets/right"
cat > "$INSTALL_DIR/presets/left/env" <<'EOF'
SHARED=value
ONLY_LEFT=one
EOF
cat > "$INSTALL_DIR/presets/right/env" <<'EOF'
SHARED=value
ONLY_RIGHT=two
EOF
cat > "$INSTALL_DIR/presets/left/extensions.list" <<'EOF'
enabled:left-only
EOF
cat > "$INSTALL_DIR/presets/right/extensions.list" <<'EOF'
enabled:right-only
EOF
result="$(run_dream preset diff left right)"
rc="$(printf '%s\n' "$result" | sed -n '1p')"
if [[ "$rc" == "0" ]] && grep -q 'ONLY_LEFT' <<<"$result" && grep -q 'ONLY_RIGHT' <<<"$result" && grep -q 'right-only' <<<"$result"; then
    pass "preset diff tolerates one-sided env and service keys"
else
    fail "preset diff failed for one-sided env/service keys"
fi

result="$(run_dream preset diff)"
rc="$(printf '%s\n' "$result" | sed -n '1p')"
if [[ "$rc" != "0" ]] && grep -q 'Usage:' <<<"$result"; then
    pass "preset diff validates missing positional arguments"
else
    fail "preset diff did not validate missing positional arguments"
fi

if command -v python3 >/dev/null 2>&1 && python3 -c 'import yaml' >/dev/null 2>&1; then
    reset_install
    cat > "$INSTALL_DIR/.env" <<'EOF'
DREAM_MODE=local
TIER=1
GPU_BACKEND=cpu
LLM_MODEL=test
OLLAMA_PORT=65535
EOF
    mkdir -p "$INSTALL_DIR/data"
    printf '{}' > "$INSTALL_DIR/data/bootstrap-status.json"
    result="$(run_dream status)"
    rc="$(printf '%s\n' "$result" | sed -n '1p')"
    if [[ "$rc" == "0" ]]; then
        pass "status tolerates malformed bootstrap-status.json"
    else
        fail "status exited $rc for malformed bootstrap-status.json"
    fi

    mkdir -p "$INSTALL_DIR/presets/bad"
    printf 'name=bad\n' > "$INSTALL_DIR/presets/bad/meta.txt"
    result="$(run_dream preset list)"
    rc="$(printf '%s\n' "$result" | sed -n '1p')"
    if [[ "$rc" == "0" ]] && grep -q 'unknown' <<<"$result"; then
        pass "preset list tolerates missing meta fields"
    else
        fail "preset list failed to tolerate missing meta fields"
    fi
else
    skip "PyYAML unavailable; skipped status/preset registry-backed cases"
fi

reset_install
cat > "$INSTALL_DIR/.env" <<'EOF'
DREAM_MODE=local
TIER=1
GPU_BACKEND=cpu
LLM_MODEL=test
OLLAMA_PORT=65535
EOF
result="$(run_dream chat hello)"
rc="$(printf '%s\n' "$result" | sed -n '1p')"
if [[ "$rc" != "0" ]] && grep -q 'llama-server not reachable' <<<"$result"; then
    pass "chat surfaces dead backend as failure"
else
    fail "chat did not fail clearly for dead backend"
fi

result="$(run_dream benchmark)"
rc="$(printf '%s\n' "$result" | sed -n '1p')"
if [[ "$rc" != "0" ]] && grep -q 'Benchmark failed' <<<"$result"; then
    pass "benchmark propagates chat failure"
else
    fail "benchmark did not propagate chat failure"
fi

echo "Result: $PASS passed, $FAIL failed, $SKIP skipped"
[[ "$FAIL" -eq 0 ]]
