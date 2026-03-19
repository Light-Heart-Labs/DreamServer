#!/bin/bash
# Dream Server Bootstrap Installer
# curl -fsSL https://raw.githubusercontent.com/Light-Heart-Labs/DreamServer/v2.1.0/get-dream-server.sh | bash
#
# Detects OS, clones repo, runs installer.

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

REPO_URL="https://github.com/Light-Heart-Labs/DreamServer.git"
INSTALL_DIR="$HOME/dream-server"

log()     { echo -e "${CYAN}[dream]${NC} $1"; }
success() { echo -e "${GREEN}[  ok ]${NC} $1"; }
warn()    { echo -e "${YELLOW}[warn ]${NC} $1"; }
error()   { echo -e "${RED}[error]${NC} $1"; exit 1; }

# ── Banner ──────────────────────────────────────
echo ""
echo -e "${BOLD}${BLUE}"
cat << 'BANNER'
    ____                              _____
   / __ \________  ____ _____ ___    / ___/___  ______   _____  _____
  / / / / ___/ _ \/ __ `/ __ `__ \   \__ \/ _ \/ ___/ | / / _ \/ ___/
 / /_/ / /  /  __/ /_/ / / / / / /  ___/ /  __/ /   | |/ /  __/ /
/_____/_/   \___/\__,_/_/ /_/ /_/  /____/\___/_/    |___/\___/_/
BANNER
echo -e "${NC}"
echo -e "${BOLD}  One-line installer — Local AI for Everyone${NC}"
echo ""

# ── Detect OS ──────────────────────────────────────
detect_os() {
    if [[ -f /proc/version ]] && grep -qi microsoft /proc/version 2>/dev/null; then
        echo "wsl"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    else
        echo "unknown"
    fi
}

OS=$(detect_os)
log "Detected OS: $OS"

case "$OS" in
    linux|wsl)
        success "Linux/WSL detected — full support"
        ;;
    macos)
        warn "macOS detected — limited GPU support (Apple Silicon MLX coming soon)"
        ;;
    unknown)
        error "Unsupported OS. Dream Server requires Linux, WSL, or macOS."
        ;;
esac

# ── Check prerequisites ──────────────────────────────
log "Checking prerequisites..."

# Docker check (early fail fast)
if command -v docker &> /dev/null; then
    success "Docker found: $(docker --version | head -1)"
    if docker info &> /dev/null; then
        success "Docker daemon running"
    else
        warn "Docker installed but daemon not running"
        echo "  Start with: sudo systemctl start docker"
        echo "  Or on macOS: open Docker Desktop"
    fi
else
    warn "Docker not found — will attempt auto-install"
    echo "  Note: This requires sudo access and may take several minutes"
fi

# GPU check (early warning)
if command -v nvidia-smi &> /dev/null; then
    GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)
    if [[ -n "$GPU_INFO" ]]; then
        success "NVIDIA GPU detected: $GPU_INFO"
    else
        warn "nvidia-smi found but no GPU detected"
    fi
else
    warn "No nvidia-smi — GPU features will be limited"
    echo "  For full functionality, install NVIDIA drivers"
fi

# git
if command -v git &> /dev/null; then
    success "git found: $(git --version | head -1)"
else
    log "Installing git..."
    if [[ "$OS" == "macos" ]]; then
        xcode-select --install 2>/dev/null || true
        command -v git &> /dev/null || error "Please install git: https://git-scm.com"
    else
        if command -v apt-get &> /dev/null; then
            sudo apt-get update -qq && sudo apt-get install -y -qq git
        elif command -v dnf &> /dev/null; then
            sudo dnf install -y -q git
        elif command -v yum &> /dev/null; then
            sudo yum install -y -q git
        elif command -v pacman &> /dev/null; then
            sudo pacman -Sy --noconfirm git
        else
            error "Cannot install git automatically. Please install git and re-run."
        fi
    fi
    success "git installed"
fi

# curl
if command -v curl &> /dev/null; then
    success "curl found"
else
    log "Installing curl..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get install -y -qq curl
    elif command -v dnf &> /dev/null; then
        sudo dnf install -y -q curl
    else
        error "Please install curl and re-run."
    fi
    success "curl installed"
fi

# docker
if command -v docker &> /dev/null; then
    success "docker found: $(docker --version | head -1)"
else
    error "Docker is required but not installed.\n\nInstall Docker:\n  Ubuntu/WSL: https://docs.docker.com/engine/install/ubuntu/\n  Other:      https://docs.docker.com/get-docker/\n\nAfter installing, re-run this script."
fi

# docker compose (plugin or standalone)
if docker compose version &> /dev/null || docker-compose --version &> /dev/null; then
    success "docker compose found"
else
    error "Docker Compose is required but not found.\n\nInstall Docker Compose:\n  https://docs.docker.com/compose/install/\n\nAfter installing, re-run this script."
fi

# NVIDIA GPU check (for Linux/WSL only)
if [[ "$OS" == "linux" || "$OS" == "wsl" ]]; then
    log "Checking NVIDIA GPU..."
    if command -v nvidia-smi &> /dev/null; then
        GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)
        if [[ -n "$GPU_INFO" ]]; then
            success "NVIDIA GPU detected: $GPU_INFO"
            # Extract VRAM in MB and check minimum
            VRAM_MB=$(echo "$GPU_INFO" | grep -oP '\d+(?= MiB)' || echo "0")
            if [[ "$VRAM_MB" -lt 8192 ]]; then
                warn "GPU has less than 8GB VRAM. Some models may not fit."
                echo "  Consider using a smaller model (7B) or cloud fallback."
            fi
        else
            warn "nvidia-smi found but no GPU detected. GPU containers may fail."
        fi
    else
        warn "nvidia-smi not found. GPU support may not be available."
        echo "  For GPU support, install NVIDIA drivers: https://www.nvidia.com/drivers"
        echo "  CPU-only mode will be slow but functional for small models."
    fi
fi

# ── Check for existing installation ──────────────────
if [[ -d "$INSTALL_DIR" ]]; then
    if [[ -f "$INSTALL_DIR/.env" ]]; then
        warn "Dream Server already installed at $INSTALL_DIR"
        echo ""
        echo "  To start:     cd $INSTALL_DIR && docker compose up -d"
        echo "  To reinstall: rm -rf $INSTALL_DIR && re-run this script"
        echo "  To update:    cd $INSTALL_DIR && git pull && ./install.sh --force"
        echo ""
        exit 0
    else
        warn "Directory exists but incomplete install at $INSTALL_DIR"
        echo ""
        echo -n "  Remove and reinstall? [y/N] "
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            rm -rf "$INSTALL_DIR"
        else
            echo "  Aborting. Remove manually with: rm -rf $INSTALL_DIR"
            exit 1
        fi
    fi
fi

# ── Clone repository ──────────────────────────────
log "Cloning Dream Server..."

# Clone just the dream-server subdirectory using sparse checkout
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$TEMP_DIR/repo" 2>&1 | tail -1 || \
    error "Failed to clone repository. Check your internet connection."

cd "$TEMP_DIR/repo"
git sparse-checkout set dream-server 2>/dev/null || {
    # Fallback: full clone if sparse checkout fails
    cd /
    rm -rf "$TEMP_DIR/repo"
    git clone --depth 1 "$REPO_URL" "$TEMP_DIR/repo" 2>&1 | tail -1 || \
        error "Failed to clone repository."
    cd "$TEMP_DIR/repo"
}

# Move dream-server to install location (exclude dev-only files)
if [[ -d "$TEMP_DIR/repo/dream-server" ]]; then
    # Use rsync to exclude development files not needed at runtime
    if command -v rsync >/dev/null 2>&1; then
        rsync -a \
            --exclude='tests/' \
            --exclude='docs/' \
            --exclude='examples/' \
            --exclude='.github/' \
            --exclude='*.md' \
            --exclude='.shellcheckrc' \
            --exclude='PSScriptAnalyzerSettings.psd1' \
            --exclude='test-stack.sh' \
            --exclude='.gitignore' \
            --exclude='__pycache__/' \
            --exclude='*.pyc' \
            --exclude='.pytest_cache/' \
            --exclude='node_modules/' \
            --include='LICENSE' \
            "$TEMP_DIR/repo/dream-server/" "$INSTALL_DIR/"
    else
        # Fallback to cp if rsync not available
        cp -r "$TEMP_DIR/repo/dream-server" "$INSTALL_DIR"
        # Remove dev-only files after copy
        rm -rf "$INSTALL_DIR/tests" "$INSTALL_DIR/docs" "$INSTALL_DIR/examples" "$INSTALL_DIR/.github" 2>/dev/null || true
        rm -f "$INSTALL_DIR"/*.md "$INSTALL_DIR/.shellcheckrc" "$INSTALL_DIR/PSScriptAnalyzerSettings.psd1" "$INSTALL_DIR/test-stack.sh" "$INSTALL_DIR/.gitignore" 2>/dev/null || true
        # Keep LICENSE file
        [[ -f "$TEMP_DIR/repo/dream-server/LICENSE" ]] && cp "$TEMP_DIR/repo/dream-server/LICENSE" "$INSTALL_DIR/" 2>/dev/null || true
    fi
else
    error "dream-server directory not found in repository."
fi

success "Cloned to $INSTALL_DIR"

# ── Make scripts executable ──────────────────────────
chmod +x "$INSTALL_DIR/install.sh" 2>/dev/null || true
chmod +x "$INSTALL_DIR/dream-cli" 2>/dev/null || true
chmod +x "$INSTALL_DIR/scripts/"*.sh 2>/dev/null || true
# Note: tests/ directory excluded from installation

# ── Run installer ──────────────────────────────
echo ""
log "Launching Dream Server installer..."
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

cd "$INSTALL_DIR"
exec ./install.sh "$@"
