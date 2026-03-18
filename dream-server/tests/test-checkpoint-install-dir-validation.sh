#!/usr/bin/env bash
# Test INSTALL_DIR validation in checkpoint system
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Setup test environment
TEST_HOME=$(mktemp -d)
export HOME="$TEST_HOME"
export INSTALL_DIR="$TEST_HOME/dream-server-old"  # Set before sourcing checkpoint.sh
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

echo "TEST: INSTALL_DIR validation"

# Create checkpoint with one INSTALL_DIR
checkpoint_save 5

# Try to load with different INSTALL_DIR
export INSTALL_DIR="$TEST_HOME/dream-server-new"

# Should fail to load due to INSTALL_DIR mismatch
if checkpoint_load >/dev/null 2>&1; then
    echo "  ✗ Checkpoint loaded despite INSTALL_DIR mismatch (should have been rejected)"
    exit 1
else
    echo "  ✓ Checkpoint rejected due to INSTALL_DIR mismatch"
fi

echo ""
echo "✓ Test passed"