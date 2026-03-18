#!/usr/bin/env bash
# Test that phase 6 migration happens in correct order
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Setup test environment
TEST_HOME=$(mktemp -d)
export HOME="$TEST_HOME"
export INSTALL_DIR="$TEST_HOME/dream-server"
export DS_VERSION="test-version"
export INTERACTIVE=false

# Provide minimal logging stubs
log() { echo "[LOG] $*" >&2; }
warn() { echo "[WARN] $*" >&2; }
export -f log warn

# Source checkpoint lib
source "$ROOT_DIR/lib/checkpoint.sh"

# Cleanup
cleanup() {
    if [[ -n "${TEST_HOME:-}" && -d "$TEST_HOME" ]]; then
        rm -rf "$TEST_HOME"
    fi
}
trap cleanup EXIT

echo "TEST: Phase 6 migration order (migrate before save)"

# Simulate phases 1-5: checkpoint at phase 5 in temp location
checkpoint_save 5

if [[ ! -f "$CHECKPOINT_TEMP" ]]; then
    echo "  ✗ Phase 5 checkpoint not in temp location"
    exit 1
fi

PHASE_BEFORE=$(grep "^LAST_PHASE=" "$CHECKPOINT_TEMP" | cut -d= -f2)
if [[ "$PHASE_BEFORE" != "5" ]]; then
    echo "  ✗ Checkpoint should be at phase 5, got: $PHASE_BEFORE"
    exit 1
fi

# Simulate phase 6: create INSTALL_DIR, migrate, then save phase 6
mkdir -p "$INSTALL_DIR"
checkpoint_migrate
checkpoint_save 6

# Verify final checkpoint is at phase 6 (not 5)
if [[ ! -f "$CHECKPOINT_FINAL" ]]; then
    echo "  ✗ Checkpoint not in final location"
    exit 1
fi

PHASE_AFTER=$(grep "^LAST_PHASE=" "$CHECKPOINT_FINAL" | cut -d= -f2)
if [[ "$PHASE_AFTER" != "6" ]]; then
    echo "  ✗ Final checkpoint should be at phase 6, got: $PHASE_AFTER"
    exit 1
fi

# Verify temp checkpoint is gone
if [[ -f "$CHECKPOINT_TEMP" ]]; then
    echo "  ✗ Temp checkpoint should be removed after migration"
    exit 1
fi

echo "  ✓ Phase 6 migration order correct"
echo "  ✓ Checkpoint migrated from temp (phase 5) to final (phase 6)"
echo ""
echo "✓ Test passed"
