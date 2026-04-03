#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 01: Pre-flight Checks
# ============================================================================
# Part of: installers/phases/
# Purpose: Root/OS/tools checks, existing installation detection
#
# Expects: SCRIPT_DIR, INSTALL_DIR, LOG_FILE, INTERACTIVE, DRY_RUN,
#           PKG_MANAGER,
#           show_phase(), ai(), ai_ok(), signal(), log(), warn(), error()
# Provides: OS sourced from /etc/os-release, OPTIONAL_TOOLS_MISSING
#
# Modder notes:
#   Add new pre-flight checks (e.g., kernel version) here.
# ============================================================================

dream_progress 5 "preflight" "Running preflight checks"
show_phase 1 6 "Pre-flight Checks" "~30 seconds"
ai "I'm scanning your system for required components..."

# Root check
if [[ $EUID -eq 0 ]]; then
    error "Do not run as root. Run as regular user with sudo access."
fi

# OS check
if [[ ! -f /etc/os-release ]]; then
    error "Unsupported OS. This installer requires Linux."
fi

_installer_version="$VERSION"
source /etc/os-release
VERSION="$_installer_version"
log "Detected OS: $PRETTY_NAME"

# Check for required tools
if ! command -v curl &> /dev/null; then
    case "$PKG_MANAGER" in
        dnf)    error "curl is required but not installed. Install with: sudo dnf install curl" ;;
        pacman) error "curl is required but not installed. Install with: sudo pacman -S curl" ;;
        zypper) error "curl is required but not installed. Install with: sudo zypper install curl" ;;
        *)      error "curl is required but not installed. Install with: sudo apt install curl" ;;
    esac
fi
log "curl: $(curl --version 2>/dev/null | sed -n '1p')"

if ! command -v jq &> /dev/null; then
    log "jq not found - attempting auto-install..."
    case "$PKG_MANAGER" in
        dnf)    sudo dnf install -y jq ;;
        pacman) sudo pacman -S --noconfirm jq ;;
        zypper) sudo zypper install -y jq ;;
        apk)    sudo apk add jq ;;
        *)      sudo apt-get install -y jq ;;
    esac
    command -v jq &> /dev/null || error "Failed to install jq automatically. Install it manually and re-run."
fi
log "jq: $(jq --version 2>/dev/null)"

# Check optional tools (warn but don't fail)
OPTIONAL_TOOLS_MISSING=""
if ! command -v rsync &> /dev/null; then
    OPTIONAL_TOOLS_MISSING="$OPTIONAL_TOOLS_MISSING rsync"
fi
if [[ -n "$OPTIONAL_TOOLS_MISSING" ]]; then
    warn "Optional tools missing:$OPTIONAL_TOOLS_MISSING"
    echo "  These are needed for update/backup scripts. Install with:"
    case "$PKG_MANAGER" in
        dnf)    echo "  sudo dnf install$OPTIONAL_TOOLS_MISSING" ;;
        pacman) echo "  sudo pacman -S$OPTIONAL_TOOLS_MISSING" ;;
        zypper) echo "  sudo zypper install$OPTIONAL_TOOLS_MISSING" ;;
        *)      echo "  sudo apt install$OPTIONAL_TOOLS_MISSING" ;;
    esac
fi

# Check source files exist
if [[ ! -f "$SCRIPT_DIR/docker-compose.yml" ]] && [[ ! -f "$SCRIPT_DIR/docker-compose.base.yml" ]]; then
    error "No compose files found in $SCRIPT_DIR. Please run from the dream-server directory."
fi

# Existing installation — update in place (secrets and data are preserved)
if [[ -d "$INSTALL_DIR" ]]; then
    log "Existing installation found at $INSTALL_DIR — updating in place"
    signal "Existing install detected. Secrets and data will be preserved."
fi

ai_ok "Pre-flight checks passed."
signal "No cloud dependencies required for core operation."
