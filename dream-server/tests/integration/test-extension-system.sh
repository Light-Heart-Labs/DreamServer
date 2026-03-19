#!/bin/bash
# Integration test: Extension manifest validation
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$SCRIPT_DIR"

echo "=== Integration Test: Extension System ==="

# Test that extension manifests can be validated
if [[ -f scripts/validate-manifests.sh ]]; then
    if bash scripts/validate-manifests.sh 2>&1 | grep -q "manifest validation"; then
        echo "✓ Extension manifest validation works"
        exit 0
    else
        echo "✗ Extension manifest validation failed"
        exit 1
    fi
else
    echo "✗ validate-manifests.sh not found"
    exit 1
fi
