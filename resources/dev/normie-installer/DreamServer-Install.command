#!/bin/bash
# ============================================================================
# DreamServer — macOS One-Click Installer
# ============================================================================
# Double-click this file from Finder to install DreamServer.
# (.command files open automatically in Terminal.app)
#
# First launch: Right-click → Open → click "Open" in the security dialog.
# Or run: xattr -d com.apple.quarantine DreamServer-Install.command
#
# This script ONLY handles Docker prerequisites. All intelligence (hardware
# detection, model selection, extension management) lives in the main
# installer which is pulled fresh every time via git clone.
#
# Supported: macOS 12 (Monterey) and later, Intel and Apple Silicon.
# ============================================================================

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────────
BOOTSTRAP_URL="https://raw.githubusercontent.com/Light-Heart-Labs/DreamServer/main/dream-server/get-dream-server.sh"
MIN_MACOS_MAJOR=12
DOCKER_WAIT_TIMEOUT=120

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
echo -e "  ${BLD}macOS Installer${NC} — Getting Docker ready for you"
echo ""

# ── Phase 1: macOS version and architecture ──────────────────────────────────
step "1/4" "Checking macOS version..."

MACOS_VERSION=$(sw_vers -productVersion)
MACOS_MAJOR=$(echo "$MACOS_VERSION" | cut -d. -f1)

if [[ "$MACOS_MAJOR" -lt "$MIN_MACOS_MAJOR" ]]; then
    fail "macOS $MIN_MACOS_MAJOR (Monterey) or later required. Found: $MACOS_VERSION"
fi

ok "macOS $MACOS_VERSION"

# Detect architecture
ARCH=$(uname -m)
if [[ "$ARCH" == "arm64" ]]; then
    ok "Apple Silicon detected (Metal GPU acceleration available)"
else
    ok "Intel Mac detected (CPU-only inference)"
fi

# ── Phase 2: Homebrew ────────────────────────────────────────────────────────
step "2/4" "Checking Homebrew..."

if command -v brew &>/dev/null; then
    ok "Homebrew found"
else
    warn "Homebrew not found. Installing..."
    info "(This is the standard macOS package manager — safe and widely used)"
    echo ""

    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add brew to PATH for this session
    # Apple Silicon installs to /opt/homebrew, Intel to /usr/local
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f /usr/local/bin/brew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi

    if command -v brew &>/dev/null; then
        ok "Homebrew installed"
    else
        fail "Homebrew installation failed. Install manually: https://brew.sh"
    fi
fi

# Ensure git and curl are available (usually present on macOS, but be safe)
if ! command -v git &>/dev/null; then
    warn "Installing git..."
    brew install git
    ok "git installed"
fi

if ! command -v curl &>/dev/null; then
    warn "Installing curl..."
    brew install curl
    ok "curl installed"
fi

# ── Phase 3: Docker Desktop ──────────────────────────────────────────────────
step "3/4" "Setting up Docker Desktop..."

DOCKER_RUNNING=false

# Check if Docker CLI exists
if command -v docker &>/dev/null; then
    ok "Docker CLI found"
    # Check if daemon is running
    if docker info &>/dev/null 2>&1; then
        DOCKER_RUNNING=true
        ok "Docker daemon running"
    else
        warn "Docker installed but daemon not running"
    fi
fi

# Install Docker Desktop if not present
if ! command -v docker &>/dev/null; then
    warn "Docker Desktop not found. Installing via Homebrew..."
    info "(Docker Desktop provides the Docker runtime for macOS)"
    echo ""

    brew install --cask docker

    if [[ -d "/Applications/Docker.app" ]]; then
        ok "Docker Desktop installed"
    else
        echo ""
        fail "Docker Desktop installation failed.\nInstall manually: https://docs.docker.com/desktop/install/mac-install/"
    fi
fi

# Start Docker Desktop if not running
if [[ "$DOCKER_RUNNING" != "true" ]]; then
    warn "Starting Docker Desktop..."
    info "(First launch may take a minute while Docker initializes)"

    # Launch Docker Desktop
    open -a Docker

    # Wait for the daemon to be ready
    WAITED=0
    while [[ "$WAITED" -lt "$DOCKER_WAIT_TIMEOUT" ]]; do
        sleep 3
        WAITED=$((WAITED + 3))

        if docker info &>/dev/null 2>&1; then
            DOCKER_RUNNING=true
            break
        fi

        if (( WAITED % 15 == 0 )); then
            info "Waiting for Docker daemon... (${WAITED}s)"
        fi
    done

    if [[ "$DOCKER_RUNNING" == "true" ]]; then
        ok "Docker Desktop is running"
    else
        echo ""
        fail "Docker did not start within ${DOCKER_WAIT_TIMEOUT}s.\nOpen Docker Desktop from Applications manually, wait for it to start, then re-run this script."
    fi
fi

# Verify Docker Compose
if docker compose version &>/dev/null 2>&1; then
    ok "Docker Compose available"
else
    fail "Docker Compose not found. Update Docker Desktop to the latest version."
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

    # Open browser
    open "http://localhost:3000" 2>/dev/null || true
else
    echo ""
    warn "Installer exited with an error. Check the output above."
    info "You can retry with: curl -fsSL $BOOTSTRAP_URL | bash"
    info "Or for help: https://github.com/Light-Heart-Labs/DreamServer/issues"
fi

# Keep terminal open
echo ""
read -r -p "Press Enter to close this window..."
