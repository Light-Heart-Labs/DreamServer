#!/bin/bash
# ============================================================================
# DreamServer — Linux One-Click Installer
# ============================================================================
# Double-click from your file manager or run: ./dreamserver-install.sh
#
# This script ONLY handles Docker prerequisites. All intelligence (hardware
# detection, model selection, extension management) lives in the main
# installer which is pulled fresh every time via git clone.
#
# Supported: Ubuntu, Debian, Fedora, RHEL, Arch, openSUSE, and derivatives.
# ============================================================================

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────────
BOOTSTRAP_URL="https://raw.githubusercontent.com/Light-Heart-Labs/DreamServer/v2.1.0/dream-server/get-dream-server.sh"
MIN_DOCKER_COMPOSE_V=2

# ── Colors & UI ───────────────────────────────────────────────────────────────
RED='\033[0;31m'
GRN='\033[0;32m'
YEL='\033[1;33m'
CYN='\033[0;36m'
BLD='\033[1m'
NC='\033[0m'

step()  { echo -e "\n${CYN}[${1}]${NC} ${BLD}${2}${NC}"; }
ok()    { echo -e "  ${GRN}✓${NC} $1"; }
warn()  { echo -e "  ${YEL}!${NC} $1"; }
fail()  { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info()  { echo -e "  $1"; }

# ── Ensure we're in a terminal ────────────────────────────────────────────────
# When double-clicked from a file manager, stdin may not be a terminal.
# Detect this and re-launch inside one.
if [ ! -t 0 ] && [ -z "${DREAMSERVER_IN_TERMINAL:-}" ]; then
    export DREAMSERVER_IN_TERMINAL=1
    SELF="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"

    for term in gnome-terminal konsole xfce4-terminal mate-terminal lxterminal \
                tilix alacritty kitty wezterm foot sakura terminology xterm; do
        if command -v "$term" &>/dev/null; then
            case "$term" in
                gnome-terminal)
                    exec "$term" -- bash "$SELF" "$@" ;;
                konsole)
                    exec "$term" --hold -e bash "$SELF" "$@" ;;
                alacritty|kitty|wezterm|foot)
                    exec "$term" -e bash "$SELF" "$@" ;;
                *)
                    exec "$term" -e bash "$SELF" "$@" ;;
            esac
        fi
    done
    echo "No terminal emulator found. Please run this script from a terminal:"
    echo "  chmod +x dreamserver-install.sh && ./dreamserver-install.sh"
    exit 1
fi

# ── Banner ────────────────────────────────────────────────────────────────────
clear 2>/dev/null || true
echo ""
echo -e "${BLD}${GRN}"
cat << 'BANNER'
    ____                              _____
   / __ \________  ____ _____ ___    / ___/___  ______   _____  _____
  / / / / ___/ _ \/ __ `/ __ `__ \   \__ \/ _ \/ ___/ | / / _ \/ ___/
 / /_/ / /  /  __/ /_/ / / / / / /  ___/ /  __/ /   | |/ /  __/ /
/_____/_/   \___/\__,_/_/ /_/ /_/  /____/\___/_/    |___/\___/_/
BANNER
echo -e "${NC}"
echo -e "  ${BLD}Linux Installer${NC} — Getting Docker ready for you"
echo ""

# ── Phase 1: Detect distribution ─────────────────────────────────────────────
step "1/4" "Detecting Linux distribution..."

if [[ ! -f /etc/os-release ]]; then
    fail "Cannot detect Linux distribution (/etc/os-release not found)"
fi

# shellcheck source=/dev/null
source /etc/os-release
DISTRO_ID="${ID:-unknown}"
DISTRO_NAME="${PRETTY_NAME:-$DISTRO_ID}"

# Determine package manager
PKG=""
case "$DISTRO_ID" in
    ubuntu|debian|linuxmint|pop|elementary|zorin|kali|raspbian|neon)
        PKG="apt" ;;
    fedora|rhel|centos|rocky|alma|nobara)
        PKG="dnf" ;;
    arch|cachyos|manjaro|endeavouros|garuda|artix)
        PKG="pacman" ;;
    opensuse*|sles)
        PKG="zypper" ;;
    void)
        PKG="xbps" ;;
    alpine)
        PKG="apk" ;;
    *)
        # Fallback: check what's actually available
        if   command -v apt-get &>/dev/null; then PKG="apt"
        elif command -v dnf     &>/dev/null; then PKG="dnf"
        elif command -v pacman  &>/dev/null; then PKG="pacman"
        elif command -v zypper  &>/dev/null; then PKG="zypper"
        else fail "Unsupported package manager. Install Docker manually: https://docs.docker.com/engine/install/"; fi
        ;;
esac

ok "$DISTRO_NAME (package manager: $PKG)"

# ── Phase 2: Install prerequisites ───────────────────────────────────────────
step "2/4" "Checking prerequisites..."

install_pkg() {
    case "$PKG" in
        apt)    sudo apt-get update -qq && sudo apt-get install -y -qq "$@" ;;
        dnf)    sudo dnf install -y -q "$@" ;;
        pacman) sudo pacman -S --noconfirm --needed "$@" ;;
        zypper) sudo zypper --non-interactive install -y "$@" ;;
        xbps)   sudo xbps-install -Sy "$@" ;;
        apk)    sudo apk add --quiet "$@" ;;
    esac
}

# git
if command -v git &>/dev/null; then
    ok "git found"
else
    warn "Installing git..."
    install_pkg git
    ok "git installed"
fi

# curl
if command -v curl &>/dev/null; then
    ok "curl found"
else
    warn "Installing curl..."
    install_pkg curl
    ok "curl installed"
fi

# ── Phase 3: Docker Engine ────────────────────────────────────────────────────
step "3/4" "Setting up Docker..."

DOCKER_INSTALLED=false
DOCKER_RUNNING=false

# Check if docker CLI exists
if command -v docker &>/dev/null; then
    DOCKER_INSTALLED=true
    ok "Docker CLI found: $(docker --version 2>/dev/null | head -1)"

    # Check if daemon is running (with or without sudo)
    if docker info &>/dev/null 2>&1; then
        DOCKER_RUNNING=true
        ok "Docker daemon running"
    elif sudo docker info &>/dev/null 2>&1; then
        DOCKER_RUNNING=true
        warn "Docker daemon running (requires sudo — will fix group membership)"
    fi
fi

# Install Docker if not present
if [[ "$DOCKER_INSTALLED" != "true" ]]; then
    warn "Docker not found. Installing via official script..."
    info "(This may take a few minutes and requires sudo)"
    echo ""

    tmpfile=$(mktemp /tmp/install-docker.XXXXXX.sh)
    trap 'rm -f "$tmpfile"' EXIT

    if ! curl -fsSL https://get.docker.com -o "$tmpfile"; then
        fail "Failed to download Docker installer. Check your internet connection."
    fi

    if ! sudo sh "$tmpfile"; then
        rm -f "$tmpfile"
        fail "Docker installation failed. See errors above."
    fi
    rm -f "$tmpfile"
    trap - EXIT

    DOCKER_INSTALLED=true
    ok "Docker Engine installed"
fi

# Docker Compose plugin
if docker compose version &>/dev/null 2>&1 || sudo docker compose version &>/dev/null 2>&1; then
    ok "Docker Compose available"
else
    warn "Installing Docker Compose plugin..."
    case "$PKG" in
        apt)    sudo apt-get install -y -qq docker-compose-plugin ;;
        dnf)    sudo dnf install -y -q docker-compose-plugin ;;
        pacman) sudo pacman -S --noconfirm --needed docker-compose ;;
        zypper) sudo zypper --non-interactive install -y docker-compose ;;
        *)      warn "Install docker-compose-plugin manually for your distro" ;;
    esac

    if docker compose version &>/dev/null 2>&1 || sudo docker compose version &>/dev/null 2>&1; then
        ok "Docker Compose installed"
    else
        fail "Docker Compose installation failed. Install manually: https://docs.docker.com/compose/install/"
    fi
fi

# Start Docker daemon if not running
if [[ "$DOCKER_RUNNING" != "true" ]]; then
    warn "Starting Docker daemon..."
    if command -v systemctl &>/dev/null; then
        sudo systemctl start docker
        sudo systemctl enable docker
    elif command -v service &>/dev/null; then
        sudo service docker start
    else
        fail "Cannot start Docker daemon. Start it manually and re-run this script."
    fi

    # Verify it's running now
    if docker info &>/dev/null 2>&1 || sudo docker info &>/dev/null 2>&1; then
        DOCKER_RUNNING=true
        ok "Docker daemon started"
    else
        fail "Docker daemon failed to start. Check: sudo journalctl -u docker"
    fi
fi

# Add user to docker group (avoid needing sudo for docker commands)
if ! groups 2>/dev/null | grep -q '\bdocker\b'; then
    warn "Adding $USER to docker group..."
    sudo usermod -aG docker "$USER"

    # Try to activate group in current session
    if command -v newgrp &>/dev/null; then
        info ""
        info "Group membership updated. Continuing with 'sudo docker' for now."
        info "After installation, log out and back in so 'docker' works without sudo."
        info ""
        # We don't exec newgrp because it replaces the shell and we lose our script.
        # The main installer (get-dream-server.sh) handles sudo docker fallback.
    fi
fi

echo ""
ok "Docker is ready"

# ── Phase 4: Hand off to DreamServer installer ───────────────────────────────
step "4/4" "Launching DreamServer installer..."

echo ""
info "Downloading latest DreamServer installer..."
info "Everything from here is pulled fresh — no updates needed."
echo -e "${CYN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Hand off to the existing bootstrap script
# get-dream-server.sh handles: git clone, GPU detection, 13-phase install
if curl -fsSL "$BOOTSTRAP_URL" | bash; then
    echo ""
    echo -e "${GRN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "  ${BLD}${GRN}DreamServer is ready!${NC}"
    echo -e "  Open ${BLD}http://localhost:3000${NC} in your browser"
    echo -e "${GRN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""

    # Open browser (best effort)
    if command -v xdg-open &>/dev/null; then
        xdg-open "http://localhost:3000" 2>/dev/null &
    elif command -v sensible-browser &>/dev/null; then
        sensible-browser "http://localhost:3000" 2>/dev/null &
    fi
else
    echo ""
    warn "Installer exited with an error. Check the output above."
    info "You can retry with: curl -fsSL $BOOTSTRAP_URL | bash"
    info "Or for help: https://github.com/Light-Heart-Labs/DreamServer/issues"
fi

# Keep terminal open if launched from file manager
if [[ -n "${DREAMSERVER_IN_TERMINAL:-}" ]]; then
    echo ""
    read -r -p "Press Enter to close this window..."
fi
