#!/bin/bash
# ============================================================================
# Dream Server macOS Installer -- Main Orchestrator
# ============================================================================
# Standalone macOS Apple Silicon installer. Does not modify any existing files.
#
# macOS: llama-server runs natively with Metal on the host (port 8080).
#        Everything else runs in Docker. Containers reach llama-server via
#        host.docker.internal.
#
# Usage:
#   ./install-macos.sh                  # Interactive install
#   ./install-macos.sh --tier 3         # Force tier 3
#   ./install-macos.sh --dry-run        # Validate without installing
#   ./install-macos.sh --all            # Enable all optional services
#   ./install-macos.sh --non-interactive # Headless install (defaults)
#
# ============================================================================

# Guard: macOS ships Bash 3.2 (GPL). dream-cli and our libs need Bash 4+.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  # Default candidate paths cover standard Apple Silicon and Intel Homebrew
  # prefixes. If brew is already on PATH we also ask it for its actual prefix,
  # which handles custom installs (e.g. /Volumes/X/homebrew).
  candidates=(/opt/homebrew/bin/bash /usr/local/bin/bash)
  if command -v brew >/dev/null 2>&1; then
    brew_prefix="$(brew --prefix 2>/dev/null)"
    [ -n "$brew_prefix" ] && candidates=("$brew_prefix/bin/bash" "${candidates[@]}")
  fi
  for candidate in "${candidates[@]}"; do
    if [ -x "$candidate" ]; then
      exec "$candidate" "$0" "$@"
    fi
  done
  if ! command -v brew >/dev/null 2>&1; then
    echo "DreamServer requires Bash 4+ (you have ${BASH_VERSION})." >&2
    echo "Install Homebrew first:" >&2
    echo "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"" >&2
    echo "Then re-run this installer." >&2
    exit 1
  fi
  echo "Installing Bash 4+ via Homebrew (one-time setup)..."
  brew install bash || { echo "brew install bash failed" >&2; exit 1; }
  brew_prefix="$(brew --prefix 2>/dev/null)"
  if [ -n "$brew_prefix" ] && [ -x "$brew_prefix/bin/bash" ]; then
    exec "$brew_prefix/bin/bash" "$0" "$@"
  fi
  for candidate in /opt/homebrew/bin/bash /usr/local/bin/bash; do
    if [ -x "$candidate" ]; then
      exec "$candidate" "$0" "$@"
    fi
  done
  echo "Homebrew bash installed but not found in expected paths." >&2
  exit 1
fi

set -euo pipefail

# ── Parse arguments ──
DRY_RUN=false
FORCE=false
NON_INTERACTIVE=false
TIER_OVERRIDE=""
ENABLE_VOICE=false
ENABLE_WORKFLOWS=false
ENABLE_RAG=false
ENABLE_OPENCLAW=false
# Langfuse defaults OFF because its clickhouse + postgres + minio stack adds
# ~500MB baseline memory. Enable via --langfuse, --all, or post-install
# `dream enable langfuse`. --no-langfuse honored as explicit override so a
# --all run can still suppress Langfuse.
ENABLE_LANGFUSE=false
NO_LANGFUSE_EXPLICIT=false
ALL_FEATURES=false
CLOUD_MODE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)       DRY_RUN=true; shift ;;
        --force)         FORCE=true; shift ;;
        --non-interactive) NON_INTERACTIVE=true; shift ;;
        --tier)          TIER_OVERRIDE="${2:-}"; shift 2 ;;
        --voice)         ENABLE_VOICE=true; shift ;;
        --workflows)     ENABLE_WORKFLOWS=true; shift ;;
        --rag)           ENABLE_RAG=true; shift ;;
        --openclaw)      ENABLE_OPENCLAW=true; shift ;;
        --langfuse)      ENABLE_LANGFUSE=true; shift ;;
        --no-langfuse)   ENABLE_LANGFUSE=false; NO_LANGFUSE_EXPLICIT=true; shift ;;
        --all)           ALL_FEATURES=true; shift ;;
        --cloud)         CLOUD_MODE=true; shift ;;
        *)               echo "Unknown option: $1"; exit 1 ;;
    esac
done

if $ALL_FEATURES; then
    ENABLE_VOICE=true
    ENABLE_WORKFLOWS=true
    ENABLE_RAG=true
    ENABLE_OPENCLAW=true
    # --all enables Langfuse unless the user explicitly passed --no-langfuse.
    $NO_LANGFUSE_EXPLICIT || ENABLE_LANGFUSE=true
fi

# ── Locate script directory and source tree root ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── Source libraries ──
LIB_DIR="${SCRIPT_DIR}/lib"
source "${LIB_DIR}/constants.sh"
source "${LIB_DIR}/ui.sh"
source "${LIB_DIR}/tier-map.sh"
source "${LIB_DIR}/detection.sh"
source "${LIB_DIR}/env-generator.sh"

# ── File-local helpers ──
# Build a launchd-friendly PATH that includes Docker and Homebrew prefixes.
# launchd does NOT inherit the user's login shell PATH, so any path containing
# `docker` or `brew`-installed tools must be baked into the plist explicitly.
# Pass an optional leading directory (e.g. ~/.opencode/bin) as $1.
_compute_launchd_path() {
    local extra="${1:-}"
    local docker_bin="" docker_dir="" brew_prefix=""
    if command -v docker >/dev/null 2>&1; then
        docker_bin="$(command -v docker)"
        docker_dir="$(cd "$(dirname "$docker_bin")" && pwd)"
    fi
    if command -v brew >/dev/null 2>&1; then
        brew_prefix="$(brew --prefix)"
    fi
    local entries=()
    [[ -n "$extra" ]]                && entries+=("$extra")
    [[ -n "$docker_dir" ]]           && entries+=("$docker_dir")
    [[ -n "$brew_prefix" ]]          && entries+=("${brew_prefix}/bin")
    entries+=("/opt/homebrew/bin" "/usr/local/bin" "/usr/bin" "/bin")
    local seen=":" path_out="" d
    for d in "${entries[@]}"; do
        case "$seen" in
            *":${d}:"*) ;;
            *) seen="${seen}${d}:"; path_out="${path_out:+${path_out}:}${d}" ;;
        esac
    done
    printf '%s' "$path_out"
}

# ── Resolve install directory ──
INSTALL_DIR="${DS_INSTALL_DIR}"

# Initialize log file
mkdir -p "$(dirname "$DS_LOG_FILE")"
: > "$DS_LOG_FILE"

# ============================================================================
# PHASE 1 -- PREFLIGHT CHECKS
# ============================================================================
show_dream_banner
show_phase 1 6 "PREFLIGHT CHECKS" "30 seconds"

# macOS version
get_macos_version
info_box "macOS:" "${MACOS_NAME} ${MACOS_VERSION} (${MACOS_BUILD})"
if [[ "$MACOS_MAJOR" -lt "$MIN_MACOS_MAJOR" ]]; then
    ai_err "macOS ${MIN_MACOS_MAJOR}+ (Ventura) is required for Metal 3. Found: ${MACOS_VERSION}"
    exit 1
fi
ai_ok "macOS version OK"

# Apple Silicon check
get_apple_silicon_info
if ! $APPLE_IS_APPLE_SILICON; then
    ai_err "Apple Silicon (arm64) is required. Detected: ${APPLE_ARCH}"
    ai_err "Intel Macs do not have Metal GPU acceleration needed for local inference."
    exit 1
fi
info_box "Chip:" "${APPLE_CHIP}"
info_box "Variant:" "${APPLE_CHIP_VARIANT}"
ai_ok "Apple Silicon detected"

# Docker Desktop
test_docker_desktop
if ! $DOCKER_INSTALLED; then
    ai_err "Docker Desktop not found. Install from https://docs.docker.com/desktop/install/mac-install/"
    exit 1
fi
ai_ok "Docker CLI found"

if ! $DOCKER_RUNNING; then
    ai_err "Docker Desktop is not running."
    ai "Start it from the Applications folder or menu bar, then re-run this installer."
    exit 1
fi
ai_ok "Docker Desktop running (v${DOCKER_VERSION})"

# Disk space
test_disk_space "$INSTALL_DIR" 30
info_box "Disk free:" "${DISK_FREE_GB} GB"
if ! $DISK_SUFFICIENT; then
    ai_err "At least ${DISK_REQUIRED_GB} GB free space required. Found ${DISK_FREE_GB} GB."
    exit 1
fi
ai_ok "Disk space OK"

# Ollama conflict detection
check_ollama_conflict
if $OLLAMA_RUNNING; then
    ai_warn "Ollama is running (PID ${OLLAMA_PID}) and may conflict with Dream Server."
    ai "  Both use port 11434/8080. Ollama will shadow llama-server."
    if ! $NON_INTERACTIVE; then
        read -r -p "  Stop Ollama for this session? [Y/n] " ollama_choice < /dev/tty
        if [[ ! "$ollama_choice" =~ ^[nN] ]]; then
            kill "$OLLAMA_PID" 2>/dev/null || true
            sleep 2
            if pgrep -x ollama >/dev/null 2>&1; then
                ai_warn "Ollama restarted automatically. You may need to quit it from the menu bar."
            else
                ai_ok "Ollama stopped"
            fi
        else
            ai_warn "Ollama left running. Port conflicts may occur."
        fi
    else
        ai_warn "Ollama detected. Run without --non-interactive to resolve, or stop Ollama manually."
    fi
fi

# Port conflict checks — dynamically read from extension manifests
_conflict_ports=(8080 11434)  # llama-server (native) + Ollama default (host conflict, no manifest)
for _manifest in "${SOURCE_ROOT}/extensions/services/"*/manifest.yaml; do
    [[ -f "$_manifest" ]] || continue
    _port=$(grep 'external_port_default:' "$_manifest" 2>/dev/null | awk '{print $2}' | tr -d '"') || true
    if [[ -n "$_port" && "$_port" =~ ^[0-9]+$ && "$_port" -ne 8080 ]]; then
        _conflict_ports+=("$_port")
    fi
done

for port_check in "${_conflict_ports[@]}"; do
    if check_port_conflict "$port_check"; then
        ai_warn "Port ${port_check} is in use by ${PORT_CONFLICT_PROC} (PID ${PORT_CONFLICT_PID})"
    fi
done

# macOS AirPlay Receiver uses port 9000 (Monterey 12.0+, enabled by default).
# It cannot be killed — it's a system service. Auto-reassign Whisper to 9100.
if check_port_conflict 9000; then
    export WHISPER_PORT=9100
    ai_ok "Port 9000 in use (AirPlay Receiver) -- Whisper reassigned to port ${WHISPER_PORT}"
    ai "  To disable AirPlay Receiver: System Settings > General > AirDrop & Handoff > AirPlay Receiver"
fi

# ============================================================================
# PHASE 2 -- HARDWARE DETECTION
# ============================================================================
show_phase 2 6 "HARDWARE DETECTION" "10 seconds"

get_system_ram_gb

info_box "Chip:" "${APPLE_CHIP}"
info_box "Variant:" "${APPLE_CHIP_VARIANT}"
info_box "RAM:" "${SYSTEM_RAM_GB} GB (unified memory = effective VRAM)"
info_box "P-Cores:" "${APPLE_PERF_CORES}"
info_box "E-Cores:" "${APPLE_EFF_CORES}"
info_box "GPU Cores:" "${APPLE_GPU_CORES}"
info_box "Neural Engine:" "${APPLE_HAS_NEURAL_ENGINE}"
info_box "Backend:" "apple (Metal)"

# Auto-select tier (or use override)
if $CLOUD_MODE; then
    SELECTED_TIER="CLOUD"
elif [[ -n "$TIER_OVERRIDE" ]]; then
    SELECTED_TIER=$(echo "$TIER_OVERRIDE" | tr '[:lower:]' '[:upper:]')
    # Normalize T-prefix: T1 -> 1, T2 -> 2, etc.
    if [[ "$SELECTED_TIER" =~ ^T([0-9])$ ]]; then
        SELECTED_TIER="${BASH_REMATCH[1]}"
    fi
else
    SELECTED_TIER=$(auto_select_tier "$SYSTEM_RAM_GB" "$APPLE_CHIP_VARIANT")
fi

if [[ -z "${MODEL_PROFILE:-}" ]]; then
    if [[ -f "${INSTALL_DIR}/.env" ]]; then
        _existing_model_profile=$(grep -m1 '^MODEL_PROFILE=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r' || true)
        MODEL_PROFILE="${_existing_model_profile:-qwen}"
    else
        MODEL_PROFILE="qwen"
    fi
fi

resolve_tier_config "$SELECTED_TIER"
if [[ -n "${LLAMA_CPP_RELEASE_TAG_OVERRIDE:-}" ]]; then
    LLAMA_CPP_RELEASE_TAG="$LLAMA_CPP_RELEASE_TAG_OVERRIDE"
    LLAMA_CPP_MACOS_ASSET="llama-${LLAMA_CPP_RELEASE_TAG}-bin-macos-arm64.tar.gz"
    LLAMA_CPP_MACOS_URL="https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_RELEASE_TAG}/${LLAMA_CPP_MACOS_ASSET}"
fi
ai_ok "Selected tier: ${SELECTED_TIER} (${TIER_NAME})"
info_box "Model:" "${LLM_MODEL}"
info_box "GGUF:" "${GGUF_FILE}"
info_box "Context:" "${MAX_CONTEXT}"

# Re-check disk space for model + Docker images
if [[ "$GGUF_FILE" =~ 31B ]]; then
    NEEDED_GB=38
elif [[ "$GGUF_FILE" =~ 30B|26B ]]; then
    NEEDED_GB=35
elif [[ "$GGUF_FILE" =~ 14B ]]; then
    NEEDED_GB=27
elif [[ "$GGUF_FILE" =~ E4B ]]; then
    NEEDED_GB=25
else
    NEEDED_GB=23
fi
test_disk_space "$INSTALL_DIR" "$NEEDED_GB"
if ! $DISK_SUFFICIENT; then
    ai_warn "Tier ${SELECTED_TIER} needs ~${NEEDED_GB} GB (model + Docker images). Only ${DISK_FREE_GB} GB free."
    if ! $FORCE; then exit 1; fi
fi

# ============================================================================
# PHASE 3 -- FEATURE SELECTION
# ============================================================================
show_phase 3 6 "FEATURES" "interactive"

if ! $NON_INTERACTIVE && ! $ALL_FEATURES && ! $DRY_RUN; then
    chapter "Select Features"
    ai "Choose your Dream Server configuration:"
    echo ""
    echo -e "  ${BGRN}[1]${NC} Full Stack   -- Everything enabled (voice, workflows, RAG, agents)"
    echo -e "  ${WHT}[2]${NC} Core Only    -- Chat + LLM inference (lean and fast)"
    echo -e "  ${WHT}[3]${NC} Custom       -- Choose individually"
    echo ""

    read -r -p "  Selection (1/2/3): " feature_choice < /dev/tty
    case "${feature_choice:-1}" in
        1)
            ENABLE_VOICE=true; ENABLE_WORKFLOWS=true
            ENABLE_RAG=true; ENABLE_OPENCLAW=true
            ENABLE_LANGFUSE=true
            ;;
        2)
            ENABLE_VOICE=false; ENABLE_WORKFLOWS=false
            ENABLE_RAG=false; ENABLE_OPENCLAW=false
            ENABLE_LANGFUSE=false
            ;;
        3)
            read -r -p "  Enable Voice (Whisper + Kokoro)? [y/N] " yn < /dev/tty
            [[ "$yn" =~ ^[yY] ]] && ENABLE_VOICE=true
            read -r -p "  Enable Workflows (n8n)?           [y/N] " yn < /dev/tty
            [[ "$yn" =~ ^[yY] ]] && ENABLE_WORKFLOWS=true
            read -r -p "  Enable RAG (Qdrant + embeddings)? [y/N] " yn < /dev/tty
            [[ "$yn" =~ ^[yY] ]] && ENABLE_RAG=true
            read -r -p "  Enable OpenClaw (AI agents)?      [y/N] " yn < /dev/tty
            [[ "$yn" =~ ^[yY] ]] && ENABLE_OPENCLAW=true
            read -r -p "  Enable Langfuse (LLM observability, ~500MB)? [y/N] " yn < /dev/tty
            [[ "$yn" =~ ^[yY] ]] && ENABLE_LANGFUSE=true
            ;;
        *)
            ENABLE_VOICE=true; ENABLE_WORKFLOWS=true
            ENABLE_RAG=true; ENABLE_OPENCLAW=true
            ENABLE_LANGFUSE=true
            ;;
    esac
fi

ai "Features:"
info_box "  Voice:" "$(if $ENABLE_VOICE; then echo enabled; else echo disabled; fi)"
info_box "  Workflows:" "$(if $ENABLE_WORKFLOWS; then echo enabled; else echo disabled; fi)"
info_box "  RAG:" "$(if $ENABLE_RAG; then echo enabled; else echo disabled; fi)"
info_box "  OpenClaw:" "$(if $ENABLE_OPENCLAW; then echo enabled; else echo disabled; fi)"
info_box "  Langfuse:" "$(if $ENABLE_LANGFUSE; then echo enabled; else echo disabled; fi)"

# ============================================================================
# PHASE 4 -- SETUP (directories, copy source, generate .env)
# ============================================================================
show_phase 4 6 "SETUP" "1-2 minutes"

if $DRY_RUN; then
    ai "[DRY RUN] Would create: ${INSTALL_DIR}"
    ai "[DRY RUN] Would copy source files"
    ai "[DRY RUN] Would generate .env with secrets"
    ai "[DRY RUN] Would generate SearXNG config"
    $ENABLE_OPENCLAW && ai "[DRY RUN] Would configure OpenClaw"
    $ENABLE_LANGFUSE && ai "[DRY RUN] Would enable Langfuse (LLM observability)"
else
    # Create directory structure
    mkdir -p "${INSTALL_DIR}/config/searxng"
    mkdir -p "${INSTALL_DIR}/config/n8n"
    mkdir -p "${INSTALL_DIR}/config/litellm"
    mkdir -p "${INSTALL_DIR}/config/openclaw"
    mkdir -p "${INSTALL_DIR}/config/llama-server"
    mkdir -p "${INSTALL_DIR}/data/open-webui"
    mkdir -p "${INSTALL_DIR}/data/whisper"
    mkdir -p "${INSTALL_DIR}/data/tts"
    mkdir -p "${INSTALL_DIR}/data/n8n"
    mkdir -p "${INSTALL_DIR}/data/qdrant"
    mkdir -p "${INSTALL_DIR}/data/models"
    mkdir -p "${INSTALL_DIR}/data/privacy-shield"
    mkdir -p "${INSTALL_DIR}/data/langfuse/postgres"
    mkdir -p "${INSTALL_DIR}/data/langfuse/clickhouse"
    mkdir -p "${INSTALL_DIR}/data/langfuse/redis"
    mkdir -p "${INSTALL_DIR}/data/langfuse/minio"
    mkdir -p "${INSTALL_DIR}/bin"
    ai_ok "Created directory structure"

    # Copy source tree (skip .git, data, logs, .env, models)
    if [[ "$SOURCE_ROOT" != "$INSTALL_DIR" ]]; then
        ai "Copying source files to ${INSTALL_DIR}..."
        rsync -a --quiet \
            --exclude='.git' \
            --exclude='data' \
            --exclude='logs' \
            --exclude='models' \
            --exclude='node_modules' \
            --exclude='dist' \
            --exclude='.env' \
            --exclude='*.log' \
            --exclude='.current-mode' \
            --exclude='.profiles' \
            --exclude='.target-model' \
            --exclude='.target-quantization' \
            --exclude='.offline-mode' \
            "$SOURCE_ROOT/" "$INSTALL_DIR/"
        ai_ok "Source files installed"
    else
        ai "Running in-place, skipping file copy"
    fi

    # Copy extensions library to data dir for dashboard portal.
    # SOURCE_ROOT resolves to dream-server/, so we climb one more level
    # ($SOURCE_ROOT/..) to reach the repo root where resources/ lives.
    _ext_lib_src="${SOURCE_ROOT}/../resources/dev/extensions-library/services"
    if [[ -d "$_ext_lib_src" ]]; then
        mkdir -p "${INSTALL_DIR}/data/extensions-library"
        cp -r "$_ext_lib_src/." "${INSTALL_DIR}/data/extensions-library/"
        ai_ok "Extensions library copied to data/extensions-library/"
    else
        ai_warn "Extensions library not found at ${_ext_lib_src}; dashboard Extensions page will return 503 until populated"
    fi

    # Copy CLI tool to install root
    if [[ -f "${SCRIPT_DIR}/dream-macos.sh" ]]; then
        cp "${SCRIPT_DIR}/dream-macos.sh" "${INSTALL_DIR}/dream-macos.sh"
        chmod +x "${INSTALL_DIR}/dream-macos.sh"
        # Also copy the lib/ directory dream-macos.sh needs
        mkdir -p "${INSTALL_DIR}/lib"
        cp "${SCRIPT_DIR}/lib/"*.sh "${INSTALL_DIR}/lib/"
        ai_ok "Installed dream-macos.sh CLI"
    fi

    # Generate .env (idempotent unless --force)
    env_existed=false
    [[ -f "${INSTALL_DIR}/.env" ]] && env_existed=true
    generate_dream_env "$INSTALL_DIR" "$SELECTED_TIER" "$FORCE"
    if $env_existed && ! $FORCE; then
        ai_ok "Preserved existing .env (use --force to regenerate secrets)"
    else
        ai_ok "Generated .env with secure secrets"
    fi

    # Generate SearXNG config
    searx_existed=false
    [[ -f "${INSTALL_DIR}/config/searxng/settings.yml" ]] && searx_existed=true
    generate_searxng_config "$INSTALL_DIR" "$ENV_SEARXNG_SECRET" "$FORCE"
    if $searx_existed && ! $FORCE; then
        ai_ok "Preserved existing SearXNG config (use --force to regenerate)"
    else
        ai_ok "Generated SearXNG config"
    fi

    # Generate OpenClaw configs (if enabled)
    if $ENABLE_OPENCLAW; then
        openclaw_existed=false
        [[ -f "${INSTALL_DIR}/data/openclaw/home/openclaw.json" ]] && openclaw_existed=true
        generate_openclaw_config "$INSTALL_DIR" "$LLM_MODEL" "$MAX_CONTEXT" \
            "$ENV_OPENCLAW_TOKEN" "http://host.docker.internal:8080" "$FORCE"
        if $openclaw_existed && ! $FORCE; then
            ai_ok "Preserved existing OpenClaw config (use --force to regenerate)"
        else
            ai_ok "Generated OpenClaw configs"
        fi
    fi

    # Create llama-server models.ini (empty -- populated later)
    local_models_ini="${INSTALL_DIR}/config/llama-server/models.ini"
    if [[ ! -f "$local_models_ini" ]]; then
        echo "# Dream Server model registry" > "$local_models_ini"
    fi
fi

# ============================================================================
# PHASE 5 -- LAUNCH (download model, start services)
# ============================================================================
show_phase 5 6 "LAUNCH" "2-30 minutes (model download)"

if $DRY_RUN; then
    [[ -n "$GGUF_URL" ]] && ai "[DRY RUN] Would download: ${GGUF_FILE}"
    ai "[DRY RUN] Would download llama-server (Metal build)"
    ai "[DRY RUN] Would start native llama-server on port 8080"
    ai "[DRY RUN] Would run: docker compose up -d"
else
    # Change to install directory for docker compose
    cd "$INSTALL_DIR"

    # ── Bootstrap fast-start ──────────────────────────────────────────────
    _BOOTSTRAP_ACTIVE=false
    if bootstrap_needed "$SELECTED_TIER" "$INSTALL_DIR" "$GGUF_FILE"; then
        _BOOTSTRAP_ACTIVE=true
        FULL_GGUF_FILE="$GGUF_FILE"
        FULL_GGUF_URL="$GGUF_URL"
        FULL_GGUF_SHA256="$GGUF_SHA256"
        FULL_LLM_MODEL="$LLM_MODEL"
        FULL_MAX_CONTEXT="$MAX_CONTEXT"

        GGUF_FILE="$BOOTSTRAP_GGUF_FILE"
        GGUF_URL="$BOOTSTRAP_GGUF_URL"
        GGUF_SHA256=""
        LLM_MODEL="$BOOTSTRAP_LLM_MODEL"
        MAX_CONTEXT="$BOOTSTRAP_MAX_CONTEXT"
        ai "Fast-start mode: downloading bootstrap model (~1.5GB) for instant chat."
        ai "Your full model ($FULL_LLM_MODEL) will download in the background."
    fi

    # ── Download GGUF model (if not cloud-only) ──
    if [[ -n "$GGUF_URL" ]] && ! $CLOUD_MODE; then
        MODEL_PATH="${INSTALL_DIR}/data/models/${GGUF_FILE}"

        if [[ -f "$MODEL_PATH" ]]; then
            # Verify integrity if hash is available
            if verify_sha256 "$MODEL_PATH" "$GGUF_SHA256" "Model ${GGUF_FILE}"; then
                ai_ok "Model already present and verified: ${GGUF_FILE}"
            else
                ai "Removing corrupt file and re-downloading..."
                rm -f "$MODEL_PATH"
            fi
        fi

        if [[ ! -f "$MODEL_PATH" ]]; then
            # Download with retry logic (built into download_with_progress)
            if ! download_with_progress "$GGUF_URL" "$MODEL_PATH" "Downloading ${GGUF_FILE}"; then
                ai_err "Model download failed after retries. Re-run the installer to try again."
                exit 1
            fi

            # Verify freshly downloaded file
            if ! verify_sha256 "$MODEL_PATH" "$GGUF_SHA256" "Downloaded ${GGUF_FILE}"; then
                rm -f "$MODEL_PATH"
                ai_err "Downloaded file is corrupt. Re-run the installer to try again."
                exit 1
            fi
        fi
    fi

    # ── Patch .env for bootstrap model ──────────────────────────────────────
    if [[ "$_BOOTSTRAP_ACTIVE" == "true" ]]; then
        _env_file="$INSTALL_DIR/.env"
        if [[ -f "$_env_file" ]]; then
            sed -i '' "s|^GGUF_FILE=.*|GGUF_FILE=${GGUF_FILE}|" "$_env_file"
            sed -i '' "s|^LLM_MODEL=.*|LLM_MODEL=${LLM_MODEL}|" "$_env_file"
            sed -i '' "s|^MAX_CONTEXT=.*|MAX_CONTEXT=${MAX_CONTEXT}|" "$_env_file"
            sed -i '' "s|^CTX_SIZE=.*|CTX_SIZE=${MAX_CONTEXT}|" "$_env_file"
            ai_ok "Patched .env for bootstrap model ($GGUF_FILE)"
        fi
    fi

    # ── Download and start native llama-server (Metal) ──
    if ! $CLOUD_MODE; then
        chapter "NATIVE LLAMA-SERVER (METAL)"

        # Download llama.cpp Metal build
        LLAMA_ZIP="/tmp/${LLAMA_CPP_MACOS_ASSET}"
        if [[ ! -x "$LLAMA_SERVER_BIN" ]]; then
            if [[ ! -f "$LLAMA_ZIP" ]]; then
                download_with_progress "$LLAMA_CPP_MACOS_URL" "$LLAMA_ZIP" \
                    "Downloading llama-server (Metal)" || {

                    # Fallback: try Homebrew
                    ai_warn "Pre-built binary download failed. Trying Homebrew..."
                    if command -v brew >/dev/null 2>&1; then
                        brew install llama.cpp 2>&1 | tail -5
                        BREW_LLAMA=$(command -v llama-server 2>/dev/null || true)
                        if [[ -n "$BREW_LLAMA" ]]; then
                            mkdir -p "$LLAMA_SERVER_DIR"
                            cp "$BREW_LLAMA" "$LLAMA_SERVER_BIN"
                            chmod +x "$LLAMA_SERVER_BIN"
                            ai_ok "Installed llama-server via Homebrew"
                        else
                            ai_err "Could not install llama-server. Install manually:"
                            ai "  brew install llama.cpp"
                            exit 1
                        fi
                    else
                        ai_err "llama-server download failed and Homebrew not available."
                        ai "Install Homebrew: https://brew.sh"
                        ai "Then: brew install llama.cpp"
                        exit 1
                    fi
                }
            fi

            if [[ -f "$LLAMA_ZIP" ]] && [[ ! -x "$LLAMA_SERVER_BIN" ]]; then
                # Extract
                ai "Extracting llama-server..."
                mkdir -p "$LLAMA_SERVER_DIR"
                TEMP_EXTRACT="/tmp/llama-extract-$$"
                mkdir -p "$TEMP_EXTRACT"
                # Format-aware extraction (handles .tar.gz and .zip)
                if [[ "$LLAMA_ZIP" == *.tar.gz ]] || [[ "$LLAMA_ZIP" == *.tgz ]]; then
                    tar xzf "$LLAMA_ZIP" -C "$TEMP_EXTRACT"
                else
                    unzip -o -q "$LLAMA_ZIP" -d "$TEMP_EXTRACT"
                fi

                # Find llama-server binary (may be in a subdirectory)
                FOUND_BIN=$(find "$TEMP_EXTRACT" -name "llama-server" -type f | head -1)
                if [[ -n "$FOUND_BIN" ]]; then
                    cp "$FOUND_BIN" "$LLAMA_SERVER_BIN"
                    chmod +x "$LLAMA_SERVER_BIN"

                    # Also copy any companion dylibs and Metal libraries
                    FOUND_DIR=$(dirname "$FOUND_BIN")
                    find "$FOUND_DIR" -name "*.dylib" -exec cp {} "$LLAMA_SERVER_DIR/" \; 2>/dev/null || true
                    find "$FOUND_DIR" -name "*.metal" -exec cp {} "$LLAMA_SERVER_DIR/" \; 2>/dev/null || true

                    ai_ok "Extracted llama-server"
                else
                    ai_err "llama-server binary not found in archive."
                    ai "Try: brew install llama.cpp"
                    rm -rf "$TEMP_EXTRACT"
                    exit 1
                fi
                rm -rf "$TEMP_EXTRACT"
            fi

            # Remove quarantine attribute (macOS Gatekeeper)
            xattr -rd com.apple.quarantine "$LLAMA_SERVER_BIN" 2>/dev/null || true
            xattr -rd com.apple.quarantine "$LLAMA_SERVER_DIR"/*.dylib 2>/dev/null || true
        else
            ai_ok "llama-server already present"
        fi

        # Start native llama-server with Metal
        ai "Starting native llama-server (Metal)..."
        MODEL_FULL_PATH="${INSTALL_DIR}/data/models/${GGUF_FILE}"

        mkdir -p "$(dirname "$LLAMA_SERVER_PID_FILE")"

        # Kill any existing llama-server
        if [[ -f "$LLAMA_SERVER_PID_FILE" ]]; then
            OLD_PID=$(cat "$LLAMA_SERVER_PID_FILE" 2>/dev/null)
            if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
                kill "$OLD_PID" 2>/dev/null || true
                sleep 2
            fi
        fi

        # Read reasoning mode from .env (default off to prevent thinking models
        # from consuming the entire token budget on internal reasoning)
        _reasoning=$(grep '^LLAMA_REASONING=' "$INSTALL_DIR/.env" 2>/dev/null | cut -d= -f2 || echo "")
        [[ -z "$_reasoning" ]] && _reasoning="off"
        # Map .env values (off/on/auto) to llama-server --reasoning-format values
        case "$_reasoning" in
            off)  _reasoning_fmt="none" ;;
            on)   _reasoning_fmt="deepseek" ;;
            *)    _reasoning_fmt="$_reasoning" ;;
        esac

        "$LLAMA_SERVER_BIN" \
            --host 0.0.0.0 --port 8080 \
            --model "$MODEL_FULL_PATH" \
            --ctx-size "$MAX_CONTEXT" \
            --n-gpu-layers 999 \
            --reasoning-format "$_reasoning_fmt" \
            --metrics \
            > "$LLAMA_SERVER_LOG" 2>&1 &
        LLAMA_PID=$!
        echo "$LLAMA_PID" > "$LLAMA_SERVER_PID_FILE"

        # Wait for health endpoint
        ai "Waiting for llama-server to load model..."
        MAX_WAIT=180
        WAITED=0
        HEALTHY=false
        while [[ "$WAITED" -lt "$MAX_WAIT" ]]; do
            sleep 2
            WAITED=$((WAITED + 2))
            if curl -sf --max-time 10 http://localhost:8080/health >/dev/null 2>&1; then
                HEALTHY=true
                break
            fi
            # Check if process died
            if ! kill -0 "$LLAMA_PID" 2>/dev/null; then
                ai_err "llama-server process died. Check logs:"
                ai "  tail -50 ${LLAMA_SERVER_LOG}"
                exit 1
            fi
            if (( WAITED % 10 == 0 )); then
                ai "  Still loading... (${WAITED}s)"
            fi
        done

        if $HEALTHY; then
            ai_ok "Native llama-server healthy (PID ${LLAMA_PID})"
        else
            ai_warn "llama-server did not become healthy within ${MAX_WAIT}s. It may still be loading."
        fi
    fi

    # ── Assemble Docker Compose flags ──
    COMPOSE_FLAGS=("-f" "docker-compose.base.yml")

    if $CLOUD_MODE; then
        # Cloud mode: disable llama-server container
        COMPOSE_FLAGS+=("-f" "installers/macos/docker-compose.macos.yml")
    else
        # Normal macOS mode: native llama-server
        COMPOSE_FLAGS+=("-f" "installers/macos/docker-compose.macos.yml")
    fi

    # Discover enabled extension compose fragments via manifests
    EXT_DIR="${INSTALL_DIR}/extensions/services"
    CURRENT_BACKEND="apple"
    $CLOUD_MODE && CURRENT_BACKEND="none"

    # Sync Langfuse compose state with ENABLE_LANGFUSE before manifest discovery.
    # Langfuse ships as compose.yaml.disabled; enable it here when the user opted
    # in so the manifest loop below picks it up on the first pass. Disable
    # (rename back) when the user did not opt in so a re-install correctly drops it.
    _langfuse_svc_dir="${EXT_DIR}/langfuse"
    if [[ -d "$_langfuse_svc_dir" ]]; then
        _langfuse_compose="${_langfuse_svc_dir}/compose.yaml"
        if $ENABLE_LANGFUSE; then
            if [[ ! -f "$_langfuse_compose" && -f "${_langfuse_compose}.disabled" ]]; then
                mv "${_langfuse_compose}.disabled" "$_langfuse_compose"
                ai_ok "Langfuse compose re-enabled"
            fi
        else
            if [[ -f "$_langfuse_compose" ]]; then
                mv "$_langfuse_compose" "${_langfuse_compose}.disabled"
                log "Langfuse compose disabled (LLM observability not enabled)"
            fi
        fi
        unset _langfuse_compose
    fi
    unset _langfuse_svc_dir

    if [[ -d "$EXT_DIR" ]]; then
        for SVC_DIR in "$EXT_DIR"/*/; do
            [[ ! -d "$SVC_DIR" ]] && continue
            SVC_NAME=$(basename "$SVC_DIR")

            # Read manifest
            MANIFEST_PATH="${SVC_DIR}manifest.yaml"
            [[ ! -f "$MANIFEST_PATH" ]] && MANIFEST_PATH="${SVC_DIR}manifest.yml"
            [[ ! -f "$MANIFEST_PATH" ]] && continue

            # Quick manifest validation: must contain schema_version: dream.services.v1
            if ! grep -q "schema_version:.*dream\.services\.v1" "$MANIFEST_PATH" 2>/dev/null; then
                continue
            fi

            # Check gpu_backends compatibility
            BACKENDS_LINE=$(grep "gpu_backends:" "$MANIFEST_PATH" 2>/dev/null || true)
            if [[ -n "$BACKENDS_LINE" ]] && [[ "$CURRENT_BACKEND" != "none" ]]; then
                if ! echo "$BACKENDS_LINE" | grep -qE "(${CURRENT_BACKEND}|all)" 2>/dev/null; then
                    # Check if "apple" is not listed but service works on CPU
                    # Extension services like whisper, tts work on CPU in Docker
                    # Allow if gpu_backends contains "amd" or "nvidia" (CPU fallback)
                    if ! echo "$BACKENDS_LINE" | grep -qE "(amd|nvidia)" 2>/dev/null; then
                        continue
                    fi
                fi
            fi

            # Find compose file
            COMPOSE_FILE="compose.yaml"
            COMPOSE_REF=$(grep "compose_file:" "$MANIFEST_PATH" 2>/dev/null | awk -F: '{print $2}' | tr -d ' "'"'" || true)
            [[ -n "$COMPOSE_REF" ]] && COMPOSE_FILE="$COMPOSE_REF"

            COMPOSE_PATH="${SVC_DIR}${COMPOSE_FILE}"
            [[ ! -f "$COMPOSE_PATH" ]] && continue

            # Check feature flags
            SKIP=false
            case "$SVC_NAME" in
                whisper|tts)   $ENABLE_VOICE || SKIP=true ;;
                n8n)           $ENABLE_WORKFLOWS || SKIP=true ;;
                qdrant|embeddings) $ENABLE_RAG || SKIP=true ;;
                openclaw)      $ENABLE_OPENCLAW || SKIP=true ;;
                langfuse)      $ENABLE_LANGFUSE || SKIP=true ;;
            esac
            $SKIP && continue

            REL_PATH="${COMPOSE_PATH#"${INSTALL_DIR}/"}"
            COMPOSE_FLAGS+=("-f" "$REL_PATH")
        done
    fi

    # Layer Tier 0 memory overlay for low-RAM machines
    if [[ "$SELECTED_TIER" == "0" && -f "${INSTALL_DIR}/docker-compose.tier0.yml" ]]; then
        COMPOSE_FLAGS+=("-f" "docker-compose.tier0.yml")
        ai "Applying lightweight memory limits for Tier 0"
    fi

    # Docker compose override (user customizations)
    if [[ -f "${INSTALL_DIR}/docker-compose.override.yml" ]]; then
        COMPOSE_FLAGS+=("-f" "docker-compose.override.yml")
    fi

    # ── Validate compose files exist before launching ──
    for ((i=0; i<${#COMPOSE_FLAGS[@]}; i++)); do
        if [[ "${COMPOSE_FLAGS[$i]}" == "-f" ]] && (( i+1 < ${#COMPOSE_FLAGS[@]} )); then
            CF="${COMPOSE_FLAGS[$((i+1))]}"
            if [[ ! -f "$CF" ]]; then
                ai_err "Compose file not found: ${CF}"
                ai "The source tree may not have copied correctly. Try re-running with --force."
                exit 1
            fi
        fi
    done

    # ── Unload stale LaunchAgents before compose (crash-safe) ──
    # If a previous install registered these agents and this run fails at
    # compose-up, the old agents would keep running with stale paths
    # (DREAM_HOME pointing at the deleted install dir).  Clearing them
    # here guarantees a clean slate regardless of what happens below.
    launchctl bootout "gui/$(id -u)/${DREAM_AGENT_PLIST_LABEL}" 2>/dev/null || true
    launchctl bootout "gui/$(id -u)/${OPENCODE_PLIST_LABEL}" 2>/dev/null || true

    # ── Start Docker services ──
    chapter "STARTING SERVICES"
    ai "Running: docker compose ${COMPOSE_FLAGS[*]} up -d"
    set +o pipefail  # pipefail would abort on compose exit before PIPESTATUS is read; capture it first
    docker compose "${COMPOSE_FLAGS[@]}" up -d 2>&1 | while IFS= read -r line; do
        echo "  $line"
    done
    compose_exit="${PIPESTATUS[0]}"
    set -o pipefail

    if [[ "$compose_exit" -ne 0 ]]; then
        ai_err "docker compose up failed"
        exit 1
    fi
    ai_ok "Docker services started"

    # Save compose flags for dream-macos.sh
    echo "${COMPOSE_FLAGS[*]}" > "${INSTALL_DIR}/.compose-flags"

    # ── Launch background model upgrade ──────────────────────────────────
    if [[ "$_BOOTSTRAP_ACTIVE" == "true" ]]; then
        ai "Launching background download for $FULL_LLM_MODEL..."
        mkdir -p "$INSTALL_DIR/logs"
        _upgrade_script="$INSTALL_DIR/scripts/bootstrap-upgrade.sh"

        if [[ -x "$_upgrade_script" ]] || [[ -f "$_upgrade_script" ]]; then
            nohup bash "$_upgrade_script" \
                "$INSTALL_DIR" "$FULL_GGUF_FILE" "$FULL_GGUF_URL" \
                "$FULL_GGUF_SHA256" "$FULL_LLM_MODEL" "$FULL_MAX_CONTEXT" \
                > "$INSTALL_DIR/logs/model-upgrade.log" 2>&1 &
            ai "Full model ($FULL_LLM_MODEL) downloading in background."
            ai "Check progress: tail -f $INSTALL_DIR/logs/model-upgrade.log"
        else
            ai_warn "bootstrap-upgrade.sh not found. Download the full model manually."
        fi
    fi

    # ── Install & start OpenCode (native host binary) ──
    chapter "OPENCODE (AI CODING IDE)"

    if [[ ! -x "$OPENCODE_BIN" ]]; then
        ai "Installing OpenCode..."
        tmpfile=$(mktemp /tmp/opencode-install.XXXXXX.sh)
        if curl -fsSL --max-time 300 https://opencode.ai/install -o "$tmpfile" 2>/dev/null && bash "$tmpfile" >> "$DS_LOG_FILE" 2>&1; then
            ai_ok "OpenCode installed (~/.opencode/bin/opencode)"
        else
            ai_warn "OpenCode install failed — install later with: curl -fsSL https://opencode.ai/install | bash"
        fi
        rm -f "$tmpfile"
    else
        ai_ok "OpenCode already installed"
    fi

    # Configure OpenCode to use local llama-server (native Metal, port 8080)
    if [[ -x "$OPENCODE_BIN" ]]; then
        mkdir -p "$OPENCODE_CONFIG_DIR"
        if [[ ! -f "$OPENCODE_CONFIG_DIR/opencode.json" ]]; then
            cat > "$OPENCODE_CONFIG_DIR/opencode.json" <<OPENCODE_EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "llama-server/${LLM_MODEL}",
  "provider": {
    "llama-server": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama-server (local)",
      "options": {
        "baseURL": "http://127.0.0.1:8080/v1",
        "apiKey": "no-key"
      },
      "models": {
        "${LLM_MODEL}": {
          "name": "${LLM_MODEL}",
          "limit": {
            "context": ${MAX_CONTEXT:-32768},
            "output": 32768
          }
        }
      }
    }
  }
}
OPENCODE_EOF
            ai_ok "OpenCode configured for local llama-server (model: ${LLM_MODEL})"
        else
            ai_ok "OpenCode config already exists"
        fi

        # Install as macOS LaunchAgent (auto-start on login).
        # Log path is intentionally decoupled from INSTALL_DIR: xpcproxy denies
        # file-write-create on non-$HOME volumes, which causes the launchd spawn
        # to exit 78 before the target process ever runs. $HOME/Library/Logs is
        # always inside xpcproxy's sandbox writable set, so use that instead.
        mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/DreamServer"
        OPENCODE_LAUNCHD_PATH="$(_compute_launchd_path "${HOME}/.opencode/bin")"
        cat > "$OPENCODE_PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${OPENCODE_PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${HOME}/.opencode/bin/opencode</string>
        <string>web</string>
        <string>--port</string>
        <string>3003</string>
        <string>--hostname</string>
        <string>127.0.0.1</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${HOME}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>${OPENCODE_LAUNCHD_PATH}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${HOME}/Library/Logs/DreamServer/opencode-web.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/Library/Logs/DreamServer/opencode-web.log</string>
</dict>
</plist>
PLIST_EOF

        # Unload existing (if any) and load new plist. bootout legitimately
        # errors when no service is loaded, so we keep that suppressed; the
        # bootstrap call surfaces real failures (e.g. launchd throttle EIO).
        launchctl bootout "gui/$(id -u)/${OPENCODE_PLIST_LABEL}" >/dev/null 2>&1 || true
        _opencode_bootstrap_err="$(launchctl bootstrap "gui/$(id -u)" "$OPENCODE_PLIST" 2>&1)" && _opencode_bootstrap_rc=0 || _opencode_bootstrap_rc=$?
        if [[ $_opencode_bootstrap_rc -eq 0 ]]; then
            ai_ok "OpenCode Web UI service installed (LaunchAgent, port 3003)"
        else
            ai_warn "OpenCode LaunchAgent failed (rc=${_opencode_bootstrap_rc}): ${_opencode_bootstrap_err}"
            ai_warn "Start manually: opencode web --port 3003"
        fi
    fi
fi

# ── Dream Host Agent (extension lifecycle management) ──
AGENT_PYTHON="$(command -v python3)"
if [[ -f "${INSTALL_DIR}/bin/dream-host-agent.py" ]] && [[ -n "$AGENT_PYTHON" ]]; then
    # See opencode-web block above for the xpcproxy sandbox rationale behind
    # the $HOME-rooted log path.
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs/DreamServer"
    DREAM_AGENT_PATH="$(_compute_launchd_path "")"
    if ! command -v docker >/dev/null 2>&1; then
        ai_warn "docker not found on PATH at install time — host agent will fail to start until Docker Desktop is launched and 'docker' resolves on your shell PATH"
    fi
    cat > "$DREAM_AGENT_PLIST" <<AGENT_PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${DREAM_AGENT_PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${AGENT_PYTHON}</string>
        <string>${INSTALL_DIR}/bin/dream-host-agent.py</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>DREAM_HOME</key>
        <string>${INSTALL_DIR}</string>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PATH</key>
        <string>${DREAM_AGENT_PATH}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>StandardOutPath</key>
    <string>${HOME}/Library/Logs/DreamServer/dream-host-agent.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/Library/Logs/DreamServer/dream-host-agent.log</string>
</dict>
</plist>
AGENT_PLIST_EOF

    launchctl bootout "gui/$(id -u)/${DREAM_AGENT_PLIST_LABEL}" >/dev/null 2>&1 || true
    _agent_bootstrap_err="$(launchctl bootstrap "gui/$(id -u)" "$DREAM_AGENT_PLIST" 2>&1)" && _agent_bootstrap_rc=0 || _agent_bootstrap_rc=$?
    if [[ $_agent_bootstrap_rc -eq 0 ]]; then
        ai_ok "Dream host agent installed (LaunchAgent, port ${DREAM_AGENT_PORT})"
    else
        ai_warn "Dream host agent LaunchAgent failed (rc=${_agent_bootstrap_rc}): ${_agent_bootstrap_err}"
        if [[ "${_agent_bootstrap_err}" == *"Input/output error"* ]]; then
            ai_warn "launchd is throttled. Recover with: launchctl bootout gui/\$(id -u)/${DREAM_AGENT_PLIST_LABEL}; sleep 10; then re-run this installer"
        else
            ai_warn "Start manually: dream agent start"
        fi
    fi
else
    [[ ! -f "${INSTALL_DIR}/bin/dream-host-agent.py" ]] && ai_warn "Host agent script not found, skipping"
    [[ -z "$AGENT_PYTHON" ]] && ai_warn "python3 not found, host agent not installed"
fi

# ============================================================================
# PHASE 6 -- VERIFICATION
# ============================================================================
show_phase 6 6 "VERIFICATION" "30 seconds"

if $DRY_RUN; then
    ai "[DRY RUN] Would health-check all services"
    ai "[DRY RUN] Would auto-configure Perplexica for ${LLM_MODEL}"
    ai "[DRY RUN] Install validation complete"
    ai_ok "Dry run finished -- no changes made"
    exit 0
fi

# Health check loop
ai "Running health checks..."
MAX_ATTEMPTS=30
ALL_HEALTHY=true

# Parallel arrays (Bash 3.2 compatible -- no associative arrays)
HEALTH_NAMES=("LLM (llama-server)" "Chat UI (Open WebUI)")
HEALTH_URLS=("http://localhost:8080/health" "http://localhost:3000")
$ENABLE_VOICE && HEALTH_NAMES+=("Whisper (STT)") && HEALTH_URLS+=("http://localhost:9000/health")
$ENABLE_WORKFLOWS && HEALTH_NAMES+=("n8n (Workflows)") && HEALTH_URLS+=("http://localhost:5678/healthz")
[[ -x "$OPENCODE_BIN" ]] && HEALTH_NAMES+=("OpenCode (IDE)") && HEALTH_URLS+=("http://localhost:${OPENCODE_PORT}")

for ((idx=0; idx<${#HEALTH_NAMES[@]}; idx++)); do
    NAME="${HEALTH_NAMES[$idx]}"
    URL="${HEALTH_URLS[$idx]}"
    HEALTHY=false

    for ((attempt=1; attempt<=MAX_ATTEMPTS; attempt++)); do
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || echo "000")
        if [[ "$HTTP_CODE" -ge 200 ]] && [[ "$HTTP_CODE" -lt 400 ]]; then
            HEALTHY=true
            break
        fi
        # 401/403 means service is responding (auth-protected) -- treat as healthy
        if [[ "$HTTP_CODE" == "401" ]] || [[ "$HTTP_CODE" == "403" ]]; then
            HEALTHY=true
            break
        fi
        if (( attempt <= 3 || attempt % 5 == 0 )); then
            ai "  Waiting for ${NAME}... (${attempt}/${MAX_ATTEMPTS})"
        fi
        sleep 2
    done

    if $HEALTHY; then
        ai_ok "${NAME}: healthy"
    else
        ai_warn "${NAME}: not responding after ${MAX_ATTEMPTS} attempts"
        ALL_HEALTHY=false
    fi
done

# ── Auto-configure Perplexica ──
ai "Configuring Perplexica..."
if configure_perplexica 3004 "$LLM_MODEL"; then
    ai_ok "Perplexica configured (model: ${LLM_MODEL})"
else
    ai_warn "Perplexica auto-config skipped -- complete setup at http://localhost:3004"
fi

# ── Success card ──
if ! $ALL_HEALTHY; then
    echo ""
    ai_warn "Some services may still be starting. Check with:"
    echo -e "  ${GRN}./dream-macos.sh status${NC}"
    echo ""
fi

show_success_card
