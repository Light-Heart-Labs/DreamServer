#!/bin/bash
# ============================================================================
# Dream Server Installer — Orchestrator
# ============================================================================
# Unified installer - voice-enabled by default, uses docker-compose.yml
# profiles for optional features.
# Mission: M5 (Clonable Dream Setup Server)
#
# This file sources library modules (pure functions, no side effects) then
# runs each install phase in order.  Individual modules live under:
#   installers/lib/      — reusable function libraries
#   installers/phases/   — sequential install steps (execute on source)
#
# See each module's header for what it expects and provides.
# ============================================================================

set -euo pipefail

#=============================================================================
# Cleanup on Failure
#=============================================================================
# Track what phases have completed so we can provide useful context on failure.
export INSTALL_PHASE="init"
cleanup_on_error() {
    local exit_code=$?
    echo ""
    echo -e "\033[0;31m[ERROR] Installation failed during phase: ${INSTALL_PHASE}\033[0m"
    echo -e "\033[0;33m        Log file: ${LOG_FILE:-/tmp/dream-server-install.log}\033[0m"
    echo ""
    echo "The install did not complete. Partial state may exist at:"
    echo "  ${INSTALL_DIR:-~/dream-server}"
    echo ""
    echo "To retry, run the installer again. It will resume safely."
    echo "To start fresh, remove the install directory first:"
    echo "  rm -rf ${INSTALL_DIR:-~/dream-server} && ./install.sh"
    exit "$exit_code"
}
trap cleanup_on_error ERR

#=============================================================================
# Interrupt Protection
#=============================================================================
# Accidental keypresses (Ctrl+C, Ctrl+Z) shouldn't silently kill the install.
# We require a double-tap of Ctrl+C within 3 seconds to actually abort.
LAST_SIGINT=0
interrupt_handler() {
    local now
    now=$(date +%s)
    if (( now - LAST_SIGINT <= 3 )); then
        echo ""
        echo -e "\033[0;33m[!] Install cancelled by user.\033[0m"
        echo -e "\033[0;32m    Log file: ${LOG_FILE:-/tmp/dream-server-install.log}\033[0m"
        exit 130
    fi
    LAST_SIGINT=$now
    echo ""
    echo -e "\033[0;33m[!] Press Ctrl+C again within 3 seconds to cancel the install.\033[0m"
}
trap interrupt_handler INT
# Ignore Ctrl+Z (SIGTSTP) entirely — backgrounding the installer breaks things
trap '' TSTP

#=============================================================================
# Load libraries (pure functions, no side effects)
#=============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$SCRIPT_DIR/installers/lib/constants.sh"
source "$SCRIPT_DIR/installers/lib/logging.sh"
source "$SCRIPT_DIR/installers/lib/ui.sh"
source "$SCRIPT_DIR/installers/lib/detection.sh"
source "$SCRIPT_DIR/installers/lib/tier-map.sh"
source "$SCRIPT_DIR/installers/lib/compose-select.sh"
source "$SCRIPT_DIR/installers/lib/packaging.sh"
source "$SCRIPT_DIR/installers/lib/progress.sh"
if [[ -f "$SCRIPT_DIR/lib/service-registry.sh" ]]; then 
    source "$SCRIPT_DIR/lib/service-registry.sh" 
    sr_load 
fi

#=============================================================================
# Command Line Args
#=============================================================================
DRY_RUN=false
SKIP_DOCKER=false
FORCE=false
TIER=""
ENABLE_VOICE=true
ENABLE_WORKFLOWS=true
ENABLE_RAG=true
ENABLE_OPENCLAW=true
INTERACTIVE=true
DREAM_MODE="${DREAM_MODE:-local}"
OFFLINE_MODE=false   # M1 integration: fully air-gapped operation
SUMMARY_JSON_FILE="${SUMMARY_JSON_FILE:-}"

usage() {
    cat << EOF
Dream Server Installer v${VERSION}

Usage: $0 [OPTIONS]

Options:
    --dry-run         Show what would be done without making changes
    --skip-docker     Skip Docker installation (assume already installed)
    --force           Overwrite existing installation
    --tier N          Force specific tier (1-4) instead of auto-detect
    --cloud           Cloud mode: skip GPU detection, use LiteLLM + cloud APIs
    --voice           Enable voice services (Whisper + Kokoro)
    --workflows       Enable n8n workflow automation
    --rag             Enable RAG with Qdrant vector database
    --openclaw        Enable OpenClaw AI agent framework
    --all             Enable all optional services
    --non-interactive Run without prompts (use defaults or flags)
    --offline         M1 mode: Configure for fully offline/air-gapped operation
    --summary-json P  Write machine-readable install summary JSON to path P
    -h, --help        Show this help

Tiers:
    1 - Entry Level   (8GB+ VRAM, 7B models)
    2 - Prosumer      (12GB+ VRAM, 14B-32B AWQ models)
    3 - Pro           (24GB+ VRAM, 32B models)
    4 - Enterprise    (48GB+ VRAM or dual GPU, 72B models)

Port Configuration:
    All service ports are configurable via .env (see .env.example).
    Example: WEBUI_PORT=8080 OLLAMA_PORT=11435 ./install.sh

Examples:
    $0                           # Interactive setup
    $0 --tier 2 --voice          # Tier 2 with voice
    $0 --all --non-interactive   # Full stack, no prompts
    $0 --cloud                   # Cloud mode (no GPU needed, uses API keys)
    $0 --offline --all           # Fully offline (M1 mode) with all services
    $0 --dry-run                 # Preview installation

EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=true; shift ;;
        --skip-docker) SKIP_DOCKER=true; shift ;;
        --force) FORCE=true; shift ;;
        --tier) TIER="$2"; shift 2 ;;
        --cloud) DREAM_MODE="cloud"; shift ;;
        --voice) ENABLE_VOICE=true; shift ;;
        --workflows) ENABLE_WORKFLOWS=true; shift ;;
        --rag) ENABLE_RAG=true; shift ;;
        --openclaw) ENABLE_OPENCLAW=true; shift ;;
        --all) ENABLE_VOICE=true; ENABLE_WORKFLOWS=true; ENABLE_RAG=true; ENABLE_OPENCLAW=true; shift ;;
        --non-interactive) INTERACTIVE=false; shift ;;
        --offline) OFFLINE_MODE=true; shift ;;
        --summary-json) SUMMARY_JSON_FILE="$2"; shift 2 ;;
        -h|--help) usage ;;
        *) error "Unknown option: $1" ;;
    esac
done

# Detect distro + package manager (after arg parsing so --help still shows
# the correct VERSION before /etc/os-release overwrites it)
detect_pkg_manager

#=============================================================================
# Splash
#=============================================================================
show_stranger_boot
[[ "$INTERACTIVE" == "true" ]] && sleep 5

$DRY_RUN && echo -e "${AMB}>>> DRY RUN MODE — I will simulate everything. No changes made. <<<${NC}\n"

#=============================================================================
# Run phases
#=============================================================================
INSTALL_PHASE="01-preflight";    source "$SCRIPT_DIR/installers/phases/01-preflight.sh"
INSTALL_PHASE="02-detection";    source "$SCRIPT_DIR/installers/phases/02-detection.sh"
INSTALL_PHASE="03-features";     source "$SCRIPT_DIR/installers/phases/03-features.sh"
INSTALL_PHASE="04-requirements"; source "$SCRIPT_DIR/installers/phases/04-requirements.sh"
INSTALL_PHASE="05-docker";       source "$SCRIPT_DIR/installers/phases/05-docker.sh"
INSTALL_PHASE="06-directories";  source "$SCRIPT_DIR/installers/phases/06-directories.sh"
INSTALL_PHASE="07-devtools";     source "$SCRIPT_DIR/installers/phases/07-devtools.sh"
INSTALL_PHASE="08-images";       source "$SCRIPT_DIR/installers/phases/08-images.sh"
INSTALL_PHASE="09-offline";      source "$SCRIPT_DIR/installers/phases/09-offline.sh"
INSTALL_PHASE="10-amd-tuning";   source "$SCRIPT_DIR/installers/phases/10-amd-tuning.sh"
INSTALL_PHASE="11-services";     source "$SCRIPT_DIR/installers/phases/11-services.sh"
INSTALL_PHASE="12-health";       source "$SCRIPT_DIR/installers/phases/12-health.sh"
INSTALL_PHASE="13-summary";      source "$SCRIPT_DIR/installers/phases/13-summary.sh"
