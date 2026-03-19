#!/bin/bash
# Minimal tests for restore safety UX behaviors.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DREAM_RESTORE="$SCRIPT_DIR/../dream-restore.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${BLUE}ℹ${NC} $1"; }

[[ -x "$DREAM_RESTORE" ]] || fail "dream-restore.sh not found or not executable"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAKE_DREAM="$TMP/dream"
mkdir -p "$FAKE_DREAM/.backups"
# minimal marker so 'is this a Dream dir' check passes
mkdir -p "$FAKE_DREAM/data"

# Create a minimal backup (manifest only, no data dirs)
BID="20260101-000000"
B="$FAKE_DREAM/.backups/$BID"
mkdir -p "$B"
cat > "$B/manifest.json" <<'JSON'
{
  "manifest_version": "1.0",
  "backup_date": "2026-01-01T00:00:00Z",
  "backup_id": "20260101-000000",
  "backup_type": "user-data",
  "dream_version": "test",
  "hostname": "test",
  "description": "test",
  "contents": {"user_data": true, "config": false, "cache": false}
}
JSON

info "Restore should cancel unless backup ID is typed"
set +e
out=$(DREAM_DIR="$FAKE_DREAM" bash "$DREAM_RESTORE" "$BID" 2>&1 <<< $'\n')
rc=$?
set -e

# Cancel is not an error (returns 0)
[[ $rc -eq 0 ]] || fail "Expected rc=0 on cancel, got $rc"

echo "$out" | grep -q "Restore cancelled" || fail "Expected 'Restore cancelled' message"
pass "Restore cancels if confirmation doesn't match backup id"

info "Restore proceeds when backup ID is typed"
set +e
out=$(DREAM_DIR="$FAKE_DREAM" bash "$DREAM_RESTORE" -f "$BID" 2>&1)
rc=$?
set -e

[[ $rc -eq 0 ]] || fail "Expected rc=0 on forced restore, got $rc"
pass "Forced restore runs without interactive confirmation"
