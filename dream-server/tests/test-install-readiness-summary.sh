#!/bin/bash
# ============================================================================
# Dream Server install readiness summary tests
# ============================================================================
# Behavioral tests for installers/lib/readiness-summary.sh with mocked curl
# and docker commands.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SUMMARY_LIB="$ROOT_DIR/installers/lib/readiness-summary.sh"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'
PASS=0
FAIL=0

pass() { echo -e "  ${GREEN}PASS${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAIL=$((FAIL + 1)); }

assert_contains() {
    local file="$1" needle="$2" label="$3"
    if grep -Fq -- "$needle" "$file"; then
        pass "$label"
    else
        fail "$label"
        echo "    missing: $needle"
    fi
}

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

mkdir -p "$TMP_DIR/bin"

cat > "$TMP_DIR/bin/curl" <<'EOF'
#!/usr/bin/env bash
url="${@: -1}"
case "$url" in
  *3001*) printf "200" ;;
  *3000*) printf "000"; exit 7 ;;
  *6333*) printf "000"; exit 7 ;;
  *) printf "404" ;;
esac
EOF
chmod +x "$TMP_DIR/bin/curl"

cat > "$TMP_DIR/bin/docker" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "inspect" ]]; then
  container="${@: -1}"
  case "$container" in
    dream-dashboard) echo "healthy"; exit 0 ;;
    dream-webui) echo "running"; exit 0 ;;
    dream-qdrant) exit 1 ;;
    *) echo "missing"; exit 1 ;;
  esac
fi
exit 0
EOF
chmod +x "$TMP_DIR/bin/docker"

export PATH="$TMP_DIR/bin:$PATH"

source "$SUMMARY_LIB"

OUTPUT="$TMP_DIR/readiness.txt"
{
    printf 'Dashboard|http://127.0.0.1:3001|dream-dashboard|http://localhost:3001\n'
    printf 'Chat UI (Open WebUI)|http://127.0.0.1:3000|dream-webui|http://localhost:3000\n'
    printf 'Qdrant|http://127.0.0.1:6333|dream-qdrant|http://localhost:6333\n'
} | dream_readiness_summary "dream status" "/tmp/dream-install.log" "http://localhost:3001" > "$OUTPUT"

echo ""
echo "=== Install readiness summary tests ==="
echo ""

assert_contains "$OUTPUT" "INSTALL READINESS" "summary has heading"
assert_contains "$OUTPUT" "Ready now: 1/3" "summary counts ready services"
assert_contains "$OUTPUT" "[OK] Dashboard" "summary lists ready service"
assert_contains "$OUTPUT" "[!!] Chat UI (Open WebUI)" "summary lists starting service"
assert_contains "$OUTPUT" "starting - HTTP 000" "summary explains starting service"
assert_contains "$OUTPUT" "[!!] Qdrant" "summary lists missing service"
assert_contains "$OUTPUT" "not detected - missing" "summary explains missing container"
assert_contains "$OUTPUT" "HTTP 000" "summary includes failed HTTP code"
assert_contains "$OUTPUT" "Open dashboard: http://localhost:3001" "summary shows dashboard next step"
assert_contains "$OUTPUT" "Check status: dream status" "summary shows status command"
assert_contains "$OUTPUT" "Logs: /tmp/dream-install.log" "summary shows log path"

echo ""
echo "Result: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
