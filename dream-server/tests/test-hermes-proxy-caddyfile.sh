#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CADDYFILE="$PROJECT_DIR/extensions/services/hermes-proxy/Caddyfile"

fail() {
    echo "[FAIL] $*" >&2
    exit 1
}

[[ -f "$CADDYFILE" ]] || fail "Hermes proxy Caddyfile not found"

grep -Eq '^[[:space:]]*redir[[:space:]]+\*[[:space:]]+/auth/required[[:space:]]+303([[:space:]]*#.*)?$' "$CADDYFILE" \
    || fail "Hermes proxy denied auth response must redirect with an explicit wildcard matcher"

if grep -Eq '^[[:space:]]*redir[[:space:]]+/auth/required[[:space:]]+303([[:space:]]*#.*)?$' "$CADDYFILE"; then
    fail "Hermes proxy redirect is missing the wildcard matcher; Caddy parses the target as a path matcher"
fi

echo "[PASS] Hermes proxy auth redirect uses explicit wildcard matcher"
