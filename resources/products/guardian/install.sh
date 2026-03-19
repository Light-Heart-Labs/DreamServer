#!/bin/bash
# ============================================================================
# Guardian — Installer
# ============================================================================
# Installs guardian.sh, config, and systemd service.
# Must be run as root (or with sudo).
#
# Usage:
#   sudo ./install.sh              # Install and start
#   sudo ./install.sh --dry-run    # Show what would be done
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INSTALL_BIN="/usr/local/bin/guardian.sh"
INSTALL_CONF_DIR="/etc/guardian"
INSTALL_CONF="$INSTALL_CONF_DIR/guardian.conf"
INSTALL_SERVICE="/etc/systemd/system/guardian.service"
STATE_DIR="/var/lib/guardian"
LOG_FILE="/var/log/guardian.log"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

run() {
    if $DRY_RUN; then
        echo "[dry-run] $*"
    else
        "$@"
    fi
}

info() { echo "[install] $*"; }
warn() { echo "[install] WARNING: $*"; }

# ── Preflight ──────────────────────────────────────────────────────────────

if [[ $EUID -ne 0 ]] && ! $DRY_RUN; then
    echo "ERROR: Must be run as root (use sudo)" >&2
    exit 1
fi

if [[ ! -f "$SCRIPT_DIR/guardian.sh" ]]; then
    echo "ERROR: guardian.sh not found in $SCRIPT_DIR" >&2
    exit 1
fi

# ── Install ────────────────────────────────────────────────────────────────

info "Installing Guardian..."

# 1. Create directories
info "Creating directories..."
run mkdir -p "$INSTALL_CONF_DIR"
run mkdir -p "$STATE_DIR/backups"
run mkdir -p "$STATE_DIR/state"

# 2. Copy guardian.sh
info "Installing $INSTALL_BIN"
if [[ -f "$INSTALL_BIN" ]]; then
    run chattr -i "$INSTALL_BIN" 2>/dev/null || true
fi
run cp "$SCRIPT_DIR/guardian.sh" "$INSTALL_BIN"
run chmod 755 "$INSTALL_BIN"
run chown root:root "$INSTALL_BIN"
run chattr +i "$INSTALL_BIN"

# 3. Copy config (don't overwrite existing)
if [[ -f "$INSTALL_CONF" ]] && ! $DRY_RUN; then
    info "Config already exists at $INSTALL_CONF — skipping (edit manually)"
else
    local_conf="$SCRIPT_DIR/guardian.conf"
    if [[ ! -f "$local_conf" ]]; then
        local_conf="$SCRIPT_DIR/guardian.conf.example"
    fi
    if [[ -f "$local_conf" ]]; then
        info "Installing config: $INSTALL_CONF"
        if [[ -f "$INSTALL_CONF" ]]; then
            run chattr -i "$INSTALL_CONF" 2>/dev/null || true
        fi
        run cp "$local_conf" "$INSTALL_CONF"
        run chmod 644 "$INSTALL_CONF"
        run chown root:root "$INSTALL_CONF"
        run chattr +i "$INSTALL_CONF"
    else
        warn "No guardian.conf or guardian.conf.example found — create $INSTALL_CONF manually"
    fi
fi

# 4. Install systemd service
info "Installing systemd service: $INSTALL_SERVICE"
if [[ -f "$INSTALL_SERVICE" ]]; then
    run chattr -i "$INSTALL_SERVICE" 2>/dev/null || true
fi
run cp "$SCRIPT_DIR/guardian.service" "$INSTALL_SERVICE"
run chmod 644 "$INSTALL_SERVICE"
run chown root:root "$INSTALL_SERVICE"
run chattr +i "$INSTALL_SERVICE"

# 5. Create log file
if [[ ! -f "$LOG_FILE" ]] || $DRY_RUN; then
    info "Creating log file: $LOG_FILE"
    run touch "$LOG_FILE"
fi

# 6. Enable and start
info "Enabling and starting guardian.service..."
run systemctl daemon-reload
run systemctl enable guardian.service
run systemctl start guardian.service

# ── Done ───────────────────────────────────────────────────────────────────

echo ""
if $DRY_RUN; then
    info "Dry run complete. No changes were made."
else
    info "Guardian installed successfully!"
    info ""
    info "  Config:  $INSTALL_CONF"
    info "  Script:  $INSTALL_BIN"
    info "  Service: $INSTALL_SERVICE"
    info "  Logs:    $LOG_FILE"
    info ""
    info "IMPORTANT: Edit $INSTALL_CONF to define your monitored resources."
    info "           Then update ReadWritePaths in $INSTALL_SERVICE"
    info "           to include your application directories."
    info ""
    info "After editing:"
    info "  sudo chattr -i $INSTALL_CONF   # unlock config"
    info "  sudo nano $INSTALL_CONF        # edit"
    info "  sudo chattr +i $INSTALL_CONF   # re-lock"
    info "  sudo systemctl restart guardian"
fi
