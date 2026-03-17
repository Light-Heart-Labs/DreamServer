#!/bin/bash
# Basic integrity test for dream-backup.sh checksums + verify

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DREAM_BACKUP="$SCRIPT_DIR/../dream-backup.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${BLUE}ℹ${NC} $1"; }

if [[ ! -x "$DREAM_BACKUP" ]]; then
  fail "dream-backup.sh not found or not executable at $DREAM_BACKUP"
fi

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# Create a minimal fake Dream directory with some data
FAKE_DREAM="$TMP_ROOT/dream"
mkdir -p "$FAKE_DREAM/data/open-webui"
mkdir -p "$FAKE_DREAM/config"

# Required by create_manifest()
echo "test" > "$FAKE_DREAM/.version"

# Add files
echo "hello" > "$FAKE_DREAM/data/open-webui/file.txt"
echo "world" > "$FAKE_DREAM/config/settings.json"

BACKUPS_DIR="$TMP_ROOT/backups"

info "Creating backup"
DREAM_DIR="$FAKE_DREAM" "$DREAM_BACKUP" --output "$BACKUPS_DIR" --type full >/dev/null

backup_id="$(ls -1 "$BACKUPS_DIR" | head -n 1)"
[[ -n "$backup_id" ]] || fail "No backup created"

[[ -f "$BACKUPS_DIR/$backup_id/checksums.sha256" ]] || fail "checksums.sha256 not created"
pass "checksums.sha256 created"

info "Verifying backup"
DREAM_DIR="$FAKE_DREAM" "$DREAM_BACKUP" --output "$BACKUPS_DIR" verify "$backup_id" >/dev/null
pass "verify passes on untampered backup"

info "Tampering with a file and expecting verify to fail"
echo "tampered" >> "$BACKUPS_DIR/$backup_id/data/open-webui/file.txt"

set +e
DREAM_DIR="$FAKE_DREAM" "$DREAM_BACKUP" --output "$BACKUPS_DIR" verify "$backup_id" >/dev/null 2>&1
rc=$?
set -e

if [[ $rc -eq 0 ]]; then
  fail "verify unexpectedly succeeded after tampering"
fi

pass "verify fails after tampering"
