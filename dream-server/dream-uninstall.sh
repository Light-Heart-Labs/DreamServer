#!/bin/bash
# dream-uninstall.sh - Dream Server Clean Uninstaller
# Removes all Dream Server components, data, and system modifications.
# Usage: ./dream-uninstall.sh [--keep-models] [--keep-data] [--force]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$HOME/dream-server}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

KEEP_MODELS=false
KEEP_DATA=false
FORCE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --keep-models) KEEP_MODELS=true; shift ;;
        --keep-data)   KEEP_DATA=true; shift ;;
        --force)       FORCE=true; shift ;;
        -h|--help)
            cat << EOF
Dream Server Uninstaller

Usage: $(basename "$0") [OPTIONS]

Options:
    --keep-models   Keep downloaded AI models (saves re-download time)
    --keep-data     Keep user data (chat history, n8n workflows, etc.)
    --force         Skip confirmation prompts
    -h, --help      Show this help

This will remove:
    - Docker containers, images, and volumes for Dream Server
    - Installation directory ($INSTALL_DIR)
    - Systemd user services (opencode-web, openclaw timers)
    - CLI symlink (/usr/local/bin/dream-cli)
    - Backup directory (~/.dream-server)

EOF
            exit 0
            ;;
        *) log_error "Unknown option: $1"; exit 1 ;;
    esac
done

echo ""
echo -e "${RED}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║         DREAM SERVER UNINSTALLER                ║${NC}"
echo -e "${RED}╚══════════════════════════════════════════════════╝${NC}"
echo ""

# Detect install dir
if [[ -d "$SCRIPT_DIR" && -f "$SCRIPT_DIR/dream-cli" ]]; then
    INSTALL_DIR="$SCRIPT_DIR"
fi

if [[ ! -d "$INSTALL_DIR" ]]; then
    log_error "Install directory not found: $INSTALL_DIR"
    exit 1
fi

log_info "Install directory: $INSTALL_DIR"
$KEEP_MODELS && log_info "Keeping models (--keep-models)"
$KEEP_DATA && log_info "Keeping user data (--keep-data)"
echo ""

if [[ "$FORCE" != "true" ]]; then
    echo -e "${YELLOW}This will permanently remove Dream Server and its components.${NC}"
    read -rp "Are you sure? Type 'yes' to confirm: " confirm
    if [[ "$confirm" != "yes" ]]; then
        log_info "Uninstall cancelled."
        exit 0
    fi
    echo ""
fi

# 1. Stop and remove Docker containers
log_info "Stopping Docker containers..."
cd "$INSTALL_DIR" 2>/dev/null || true
if command -v docker &>/dev/null; then
    # Try docker compose first, fall back to finding dream containers
    docker compose down --remove-orphans 2>/dev/null || true

    # Remove any remaining dream-* containers
    dream_containers=$(docker ps -a --filter "name=dream-" --format "{{.Names}}" 2>/dev/null || true)
    if [[ -n "$dream_containers" ]]; then
        log_info "Removing Dream Server containers..."
        echo "$dream_containers" | xargs -r docker rm -f 2>/dev/null || true
    fi

    # Remove dream-specific Docker volumes
    dream_volumes=$(docker volume ls --filter "name=dream" --format "{{.Name}}" 2>/dev/null || true)
    if [[ -n "$dream_volumes" ]]; then
        log_info "Removing Docker volumes..."
        echo "$dream_volumes" | xargs -r docker volume rm 2>/dev/null || true
    fi

    log_ok "Docker cleanup complete"
else
    log_warn "Docker not found — skipping container cleanup"
fi

# 2. Stop and remove systemd user services
log_info "Removing systemd user services..."
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
for unit in opencode-web.service openclaw-session-cleanup.timer openclaw-session-manager.timer \
            memory-shepherd-workspace.timer memory-shepherd-memory.timer \
            openclaw-session-cleanup.service openclaw-session-manager.service \
            memory-shepherd-workspace.service memory-shepherd-memory.service; do
    if [[ -f "$SYSTEMD_USER_DIR/$unit" ]]; then
        systemctl --user disable --now "$unit" 2>/dev/null || true
        rm -f "$SYSTEMD_USER_DIR/$unit"
    fi
done
systemctl --user daemon-reload 2>/dev/null || true
log_ok "Systemd services removed"

# 3. Remove CLI symlink
if [[ -L "/usr/local/bin/dream-cli" ]]; then
    log_info "Removing CLI symlink..."
    sudo rm -f /usr/local/bin/dream-cli 2>/dev/null || rm -f /usr/local/bin/dream-cli 2>/dev/null || true
    log_ok "CLI symlink removed"
fi

# 4. Remove desktop file
DESKTOP_FILE="$HOME/.local/share/applications/dream-server.desktop"
if [[ -f "$DESKTOP_FILE" ]]; then
    rm -f "$DESKTOP_FILE"
    log_ok "Desktop entry removed"
fi

# 5. Remove install directory (with optional data/model preservation)
log_info "Removing installation directory..."
if $KEEP_MODELS && [[ -d "$INSTALL_DIR/data/models" ]]; then
    MODELS_BACKUP="$HOME/.dream-server-models-backup"
    mkdir -p "$MODELS_BACKUP"
    mv "$INSTALL_DIR/data/models"/* "$MODELS_BACKUP/" 2>/dev/null || true
    log_info "Models preserved at: $MODELS_BACKUP"
fi

if $KEEP_DATA; then
    # Remove everything except data/
    find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 ! -name 'data' -exec rm -rf {} + 2>/dev/null || true
    log_info "User data preserved at: $INSTALL_DIR/data/"
else
    rm -rf "$INSTALL_DIR"
fi
log_ok "Installation directory cleaned"

# 6. Remove backup directory
if [[ -d "$HOME/.dream-server" ]]; then
    log_info "Removing backup directory..."
    rm -rf "$HOME/.dream-server"
    log_ok "Backups removed"
fi

# 7. Remove OpenCode config (if we created it)
OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"
if [[ -f "$OPENCODE_CONFIG" ]] && grep -q "llama-server" "$OPENCODE_CONFIG" 2>/dev/null; then
    rm -f "$OPENCODE_CONFIG"
    log_ok "OpenCode config removed"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Dream Server has been uninstalled.           ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
if $KEEP_MODELS; then
    echo "Your models were saved to: $HOME/.dream-server-models-backup"
    echo "To reuse them on reinstall, move them back to ~/dream-server/data/models/"
fi
if $KEEP_DATA; then
    echo "Your user data was preserved at: $INSTALL_DIR/data/"
fi
