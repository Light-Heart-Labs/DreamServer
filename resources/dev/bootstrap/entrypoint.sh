#!/bin/bash
# ============================================================================
# DreamServer Bootstrap — Container Entrypoint
# ============================================================================
# Clones the latest DreamServer repo and runs the installer using the
# host Docker daemon (via mounted socket). This ensures every run gets
# the latest installer code — the bootstrap image never needs updating.
#
# Required mounts:
#   -v /var/run/docker.sock:/var/run/docker.sock
#
# Optional mounts:
#   -v ~/dream-server:/opt/dream-server    (persist installation)
#   -v /sys:/sys:ro                         (GPU detection)
#   -v /proc:/proc:ro                       (hardware detection)
#
# All arguments are passed through to install.sh:
#   docker run ... dream-bootstrap:latest --all --tier 3 --voice
# ============================================================================

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GRN='\033[0;32m'
YEL='\033[1;33m'
CYN='\033[0;36m'
BLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYN}[bootstrap]${NC} $1"; }
ok()   { echo -e "${GRN}[bootstrap]${NC} $1"; }
warn() { echo -e "${YEL}[bootstrap]${NC} $1"; }
fail() { echo -e "${RED}[bootstrap]${NC} $1"; exit 1; }

REPO_URL="https://github.com/Light-Heart-Labs/DreamServer.git"
INSTALL_DIR="${DREAM_INSTALL_DIR:-/opt/dream-server}"

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BLD}${GRN}DreamServer Bootstrap Container${NC}"
echo ""

# ── Validate Docker socket ───────────────────────────────────────────────────
if [[ ! -S /var/run/docker.sock ]]; then
    fail "Docker socket not mounted. Run with:"
    echo "  docker run --rm -it \\"
    echo "    -v /var/run/docker.sock:/var/run/docker.sock \\"
    echo "    -v ~/dream-server:/opt/dream-server \\"
    echo "    ghcr.io/light-heart-labs/dream-bootstrap:latest"
    exit 1
fi

if ! docker info &>/dev/null 2>&1; then
    fail "Cannot connect to Docker daemon. Check socket permissions."
fi
ok "Docker daemon accessible via socket"

# ── Hardware detection hints ──────────────────────────────────────────────────
if [[ -d /sys/class/drm ]]; then
    log "Host /sys mounted — GPU detection available"
fi
if [[ -f /proc/meminfo ]]; then
    RAM_GB=$(awk '/MemTotal/ {printf "%.0f", $2/1024/1024}' /proc/meminfo)
    log "Host RAM: ${RAM_GB}GB"
fi

# ── Clone or update DreamServer ──────────────────────────────────────────────
if [[ -d "$INSTALL_DIR/.git" ]]; then
    log "Existing installation found, updating..."
    cd "$INSTALL_DIR"
    if ! git pull --ff-only 2>/dev/null; then
        warn "Git pull failed (local changes?). Using existing version."
    fi
    ok "Updated to latest"
elif [[ -d "$INSTALL_DIR" && -f "$INSTALL_DIR/install.sh" ]]; then
    log "Installation directory exists (bind mount). Using as-is."
else
    log "Cloning DreamServer (latest)..."
    # Clone just the dream-server subdirectory
    TEMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TEMP_DIR"' EXIT

    git clone --depth 1 --filter=blob:none --sparse "$REPO_URL" "$TEMP_DIR/repo" 2>&1 | tail -1 || {
        # Fallback to full clone
        git clone --depth 1 "$REPO_URL" "$TEMP_DIR/repo" 2>&1 | tail -1 ||
            fail "Failed to clone repository. Check network connectivity."
    }

    cd "$TEMP_DIR/repo"
    git sparse-checkout set dream-server 2>/dev/null || true

    # Copy dream-server contents to install dir
    if [[ -d "$TEMP_DIR/repo/dream-server" ]]; then
        cp -r "$TEMP_DIR/repo/dream-server/." "$INSTALL_DIR/"
    else
        cp -r "$TEMP_DIR/repo/." "$INSTALL_DIR/"
    fi

    rm -rf "$TEMP_DIR"
    trap - EXIT
    ok "Cloned to $INSTALL_DIR"
fi

# ── Make scripts executable ──────────────────────────────────────────────────
chmod +x "$INSTALL_DIR/install.sh" 2>/dev/null || true
chmod +x "$INSTALL_DIR/install-core.sh" 2>/dev/null || true
chmod +x "$INSTALL_DIR/dream-cli" 2>/dev/null || true
find "$INSTALL_DIR/installers" -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true
find "$INSTALL_DIR/scripts" -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true
find "$INSTALL_DIR/lib" -name "*.sh" -exec chmod +x {} \; 2>/dev/null || true

# ── Launch installer ─────────────────────────────────────────────────────────
log "Launching DreamServer installer..."
echo -e "${CYN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

cd "$INSTALL_DIR"

# --skip-docker: Docker is already available via socket
# All user-supplied flags ($@) are passed through
exec bash ./install.sh --skip-docker "$@"
