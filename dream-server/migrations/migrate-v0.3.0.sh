#!/bin/bash
# Migration: v0.2.0 → v0.3.0
# Description: Fix volume ownership for non-root container users (PR #295)
# Date: 2026-03-19

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$(dirname "$SCRIPT_DIR")}"
DATA_DIR="${INSTALL_DIR}/data"

echo "Migrating to v0.3.0: Fixing volume ownership for non-root containers..."

# Check if running with sufficient privileges
if [[ $EUID -ne 0 ]] && ! sudo -n true 2>/dev/null; then
    echo "Note: This migration requires sudo to fix file ownership."
    echo "You may be prompted for your password."
fi

# Fix token-spy data directory ownership
if [[ -d "${DATA_DIR}/token-spy" ]]; then
    echo "  Fixing token-spy data directory ownership..."
    if [[ $EUID -eq 0 ]]; then
        chown -R 1000:1000 "${DATA_DIR}/token-spy" 2>/dev/null || true
    else
        sudo chown -R 1000:1000 "${DATA_DIR}/token-spy" 2>/dev/null || {
            echo "  Warning: Could not fix token-spy ownership. You may need to run manually:"
            echo "    sudo chown -R 1000:1000 ${DATA_DIR}/token-spy"
        }
    fi
    echo "  ✓ token-spy data directory ownership fixed"
fi

# Fix dashboard data directory ownership (if it exists)
if [[ -d "${DATA_DIR}/dashboard" ]]; then
    echo "  Fixing dashboard data directory ownership..."
    if [[ $EUID -eq 0 ]]; then
        chown -R 1000:1000 "${DATA_DIR}/dashboard" 2>/dev/null || true
    else
        sudo chown -R 1000:1000 "${DATA_DIR}/dashboard" 2>/dev/null || {
            echo "  Warning: Could not fix dashboard ownership. You may need to run manually:"
            echo "    sudo chown -R 1000:1000 ${DATA_DIR}/dashboard"
        }
    fi
    echo "  ✓ dashboard data directory ownership fixed"
fi

echo "Migration v0.3.0 complete"
echo ""
echo "Services now run as non-root users (UID 1000) for improved security."
echo "If you encounter permission errors, run:"
echo "  sudo chown -R 1000:1000 ${DATA_DIR}"
