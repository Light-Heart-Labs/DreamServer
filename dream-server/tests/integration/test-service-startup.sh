#!/bin/bash
# Integration test: Service registry loads correctly
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$SCRIPT_DIR"

echo "=== Integration Test: Service Startup ==="

# Test that service registry loads
if source lib/service-registry.sh 2>/dev/null; then
    if sr_load 2>/dev/null; then
        echo "✓ Service registry loaded successfully"
        exit 0
    else
        echo "✗ Service registry load failed"
        exit 1
    fi
else
    echo "✗ Failed to source service-registry.sh"
    exit 1
fi
