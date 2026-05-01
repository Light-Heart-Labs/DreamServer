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

# Filesystem POSIX-permission check.
# Phase 06 runs `chmod 600 $INSTALL_DIR/.env` to lock down secrets. On exFAT,
# FAT32, fuseblk (NTFS via ntfs-3g), 9p and DrvFs that chmod is a silent no-op
# — the secrets file ends up world-readable. Refuse install up front so the
# user can pick a POSIX-native path.
check_install_dir_filesystem() {
    local probe="$INSTALL_DIR"
    while [[ -n "$probe" && ! -e "$probe" ]]; do
        probe="$(dirname "$probe")"
    done
    [[ -z "$probe" ]] && probe="/"

    local fs_type=""
    fs_type=$(stat -fc %T "$probe" 2>/dev/null || true)
    fs_type="${fs_type,,}"  # lowercase
    INSTALL_FS_TYPE="${fs_type:-unknown}"

    case "$fs_type" in
        fuseblk|msdos|exfat|vfat|fat|9p|drvfs|ntfs|ntfs-3g)
            error "INSTALL_DIR ($INSTALL_DIR) is on a ${fs_type} filesystem.

Dream Server stores secrets in $INSTALL_DIR/.env and locks them with
chmod 600. ${fs_type} silently ignores POSIX permissions, which would
leave the secrets file world-readable.

Pick a path on a POSIX-native filesystem (ext4, btrfs, xfs, zfs) and
re-run, e.g.:  INSTALL_DIR=\"\$HOME/dream-server\" $0"
            ;;
    esac
    log "INSTALL_DIR filesystem: ${INSTALL_FS_TYPE}"
}

# Docker Desktop file-sharing probe — only meaningful when Docker Desktop
# is in use (most Linux installs use the native daemon and skip this).
check_docker_desktop_sharing() {
    command -v docker >/dev/null 2>&1 || return 0

    local os_string=""
    os_string=$(docker info --format '{{json .OperatingSystem}}' 2>/dev/null || true)
    case "$os_string" in
        *"Docker Desktop"*) ;;
        *) return 0 ;;
    esac

    local probe="$INSTALL_DIR"
    while [[ -n "$probe" && ! -e "$probe" ]]; do
        probe="$(dirname "$probe")"
    done
    [[ -z "$probe" ]] && probe="/"

    local out=""
    out=$(docker run --rm -v "${probe}:/check:ro" alpine true 2>&1) || true
    if echo "$out" | grep -qiE "not shared from the host|Mounts denied|file sharing|filesharing"; then
        error "Docker Desktop cannot bind-mount $INSTALL_DIR.

Add the path to Docker Desktop > Settings > Resources > File Sharing,
apply, then re-run this installer.

Probe output:
$(printf '%s\n' "$out" | sed 's/^/    /')"
    fi
    log "Docker Desktop file sharing OK"
}

check_install_dir_filesystem
check_docker_desktop_sharing

# Firewall check: warn if UFW or firewalld is active. The dashboard host agent
# binds to the Docker bridge gateway (default 172.17.0.1:7710) and compose
# containers reach it via the host INPUT chain. Default-DROP firewalls block
# that traffic and the dashboard reports "Host agent is offline". Warn-only —
# never abort install.
if command -v ufw >/dev/null 2>&1 && systemctl is-active --quiet ufw 2>/dev/null; then
    ai_warn "UFW is active. The dashboard host agent must be reachable from compose subnets."
    ai_warn "After install, run:"
    ai_warn "  sudo ufw allow from 172.16.0.0/12 to any port 7710 proto tcp comment 'dream-host-agent'"
elif command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld 2>/dev/null; then
    ai_warn "firewalld is active. The dashboard host agent must be reachable from compose subnets."
    ai_warn "After install, run:"
    ai_warn "  sudo firewall-cmd --permanent --add-rich-rule='rule family=\"ipv4\" source address=\"172.16.0.0/12\" port protocol=\"tcp\" port=\"7710\" accept'"
    ai_warn "  sudo firewall-cmd --reload"
fi

ai_ok "Pre-flight checks passed."
signal "No cloud dependencies required for core operation."
