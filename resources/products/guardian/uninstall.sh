#!/bin/bash
# ============================================================================
# Guardian — Uninstaller
# ============================================================================
# Stops service, removes systemd unit, clears immutable flags, removes files.
# Must be run as root (or with sudo).
#
# Usage:
#   sudo ./uninstall.sh
# ============================================================================

set -euo pipefail

INSTALL_BIN="/usr/local/bin/guardian.sh"
INSTALL_CONF_DIR="/etc/guardian"
INSTALL_CONF="$INSTALL_CONF_DIR/guardian.conf"
INSTALL_SERVICE="/etc/systemd/system/guardian.service"
STATE_DIR="/var/lib/guardian"
LOG_FILE="/var/log/guardian.log"

info() { echo "[uninstall] $*"; }

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: Must be run as root (use sudo)" >&2
    exit 1
fi

# ── Stop and disable service ──────────────────────────────────────────────

info "Stopping guardian.service..."
systemctl stop guardian.service 2>/dev/null || true
systemctl disable guardian.service 2>/dev/null || true

# ── Clear immutable flags and remove files ────────────────────────────────

info "Removing installed files..."

for f in "$INSTALL_BIN" "$INSTALL_CONF" "$INSTALL_SERVICE"; do
    if [[ -f "$f" ]]; then
        chattr -i "$f" 2>/dev/null || true
        rm -f "$f"
        info "  Removed: $f"
    fi
done

# Remove config directory if empty
if [[ -d "$INSTALL_CONF_DIR" ]]; then
    rmdir "$INSTALL_CONF_DIR" 2>/dev/null && info "  Removed: $INSTALL_CONF_DIR" || \
        info "  $INSTALL_CONF_DIR not empty — skipping"
fi

# ── Reload systemd ────────────────────────────────────────────────────────

systemctl daemon-reload

# ── State and logs (optional) ─────────────────────────────────────────────

echo ""
info "Guardian service removed."
info ""
info "The following are NOT removed automatically (they contain your backups/logs):"
info "  State dir: $STATE_DIR"
info "  Log file:  $LOG_FILE"
info ""
info "To remove them manually:"
info "  sudo chattr -Ri $STATE_DIR && sudo rm -rf $STATE_DIR"
info "  sudo rm -f $LOG_FILE $LOG_FILE.1"
