#!/bin/bash
# Integration test: Full installation dry run
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$SCRIPT_DIR"

echo "=== Integration Test: Full Install Dry Run ==="

# Run installer in dry-run mode
if bash install-core.sh --dry-run --install-dir /tmp/dream-test 2>&1 | grep -q "DRY RUN MODE"; then
    echo "✓ Dry run completed successfully"
    exit 0
else
    echo "✗ Dry run failed"
    exit 1
fi
