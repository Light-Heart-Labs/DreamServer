#!/usr/bin/env bash
# Regression checks for bootstrap-upgrade's llama-server hot-swap contract.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="$ROOT_DIR/scripts/bootstrap-upgrade.sh"

fail() {
    echo "[FAIL] $*" >&2
    exit 1
}

pass() {
    echo "[PASS] $*"
}

[[ -f "$TARGET" ]] || fail "missing $TARGET"

# Strip comments so explanatory text cannot satisfy or fail the checks.
active_code="$(grep -v '^[[:space:]]*#' "$TARGET")"

grep -qF 'up -d --force-recreate --no-deps llama-server' <<<"$active_code" \
    || fail "llama.cpp hot-swap must force-recreate llama-server without deps"
pass "llama.cpp hot-swap uses force-recreate/no-deps"

if grep -qE '\bstop[[:space:]]+llama-server\b' <<<"$active_code"; then
    fail "llama.cpp hot-swap must not stop llama-server before compose up"
fi
pass "llama.cpp hot-swap does not use stop + up"

grep -qF 'inspect dream-llama-server --format' <<<"$active_code" \
    || fail "hot-swap must inspect the recreated container command"
grep -qF '"/models/${FULL_GGUF_FILE}"' <<<"$active_code" \
    || fail "hot-swap must assert the running command points at the full GGUF"
pass "hot-swap asserts the running command uses the full GGUF"

stale_block="$(awk '
    /llama-server container started with stale --model arg/ { in_block=1 }
    in_block { print }
    in_block && /fi[[:space:]]*$/ { exit }
' "$TARGET" | grep -v '^[[:space:]]*#')"

grep -qF 'write_status "failed"' <<<"$stale_block" \
    || fail "stale --model assertion must mark bootstrap status failed"
grep -qF 'fail "llama-server container started with stale --model arg after force-recreate."' <<<"$stale_block" \
    || fail "stale --model assertion must exit non-zero"
pass "stale --model assertion fails loudly"
