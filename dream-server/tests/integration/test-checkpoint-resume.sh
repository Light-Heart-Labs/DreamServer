#!/bin/bash
# Integration test: Checkpoint system behavior
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$SCRIPT_DIR"

echo "=== Integration Test: Checkpoint Resume ==="

# Test that checkpoint functions exist and are callable
if source lib/checkpoint.sh 2>/dev/null; then
    if declare -f checkpoint_save >/dev/null && \
       declare -f checkpoint_load >/dev/null && \
       declare -f checkpoint_clear >/dev/null; then
        echo "✓ Checkpoint functions loaded successfully"
        exit 0
    else
        echo "✗ Checkpoint functions not found"
        exit 1
    fi
else
    echo "✗ Failed to source checkpoint.sh"
    exit 1
fi
