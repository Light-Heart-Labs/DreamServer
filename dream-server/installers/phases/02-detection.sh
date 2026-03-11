#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 02: System Detection
# ============================================================================
# Part of: installers/phases/
# Purpose: Orchestrate hardware detection → tier assignment → compose config
#
# Expects: SCRIPT_DIR, LOG_FILE, TIER, GPU_BACKEND, GPU_VRAM, GPU_COUNT,
#           INTERACTIVE, DRY_RUN, CAP_PROFILE_LOADED, detect_gpu(),
#           load_capability_profile(), load_backend_contract(),
#           fix_nvidia_secure_boot(), normalize_profile_tier(), tier_rank(),
#           resolve_tier_config(), resolve_compose_config(),
#           show_hardware_summary(), show_tier_recommendation(),
#           chapter(), ai(), ai_ok(), log(), warn(), success()
# Provides: GPU_BACKEND, GPU_NAME, GPU_VRAM, GPU_COUNT, GPU_MEMORY_TYPE,
#           TIER, TIER_NAME, LLM_MODEL, GGUF_FILE, GGUF_URL, MAX_CONTEXT,
#           COMPOSE_FILE, COMPOSE_FLAGS, RAM_GB, DISK_AVAIL, BACKEND_ID,
#           LLM_HEALTHCHECK_URL, LLM_PUBLIC_API_PORT,
#           OPENCLAW_PROVIDER_NAME_DEFAULT, OPENCLAW_PROVIDER_URL_DEFAULT
#
# Modder notes:
#   Change tier auto-detection thresholds or add new hardware classes here.
# ============================================================================

chapter "SYSTEM DETECTION"

# Cloud mode: skip GPU detection entirely
if [[ "${DREAM_MODE:-local}" == "cloud" ]]; then
    ai "Cloud mode — skipping GPU detection"
    GPU_BACKEND="cpu"
    GPU_NAME="Cloud (no local GPU)"
    GPU_VRAM=0
    GPU_COUNT=0
    GPU_MEMORY_TYPE="none"
    TIER="CLOUD"
    RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    RAM_GB=$((RAM_KB / 1024 / 1024))
    DISK_AVAIL=$(df -BG "$HOME" | tail -1 | awk '{print $4}' | tr -d 'G')
    BACKEND_ID="cpu"
    LLM_HEALTHCHECK_URL="http://localhost:4000/health/readiness"
    LLM_PUBLIC_API_PORT="4000"
    OPENCLAW_PROVIDER_NAME_DEFAULT="litellm-cloud"
    OPENCLAW_PROVIDER_URL_DEFAULT="http://litellm:4000/v1"
    resolve_compose_config
    resolve_tier_config
    if [[ "$INTERACTIVE" == "true" ]]; then
        success "Cloud mode: LLM via LiteLLM gateway (no GPU required)"
        log "  RAM: ${RAM_GB}GB, Disk: ${DISK_AVAIL}GB"
    fi
    # Skip rest of detection phase
    return 0 2>/dev/null || true
fi

ai "Reading hardware telemetry..."

load_capability_profile || true

# RAM Detection
RAM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
RAM_GB=$((RAM_KB / 1024 / 1024))
log "RAM: ${RAM_GB}GB"

# Disk Detection
DISK_AVAIL=$(df -BG "$HOME" | tail -1 | awk '{print $4}' | tr -d 'G')
log "Available disk: ${DISK_AVAIL}GB"

# GPU Detection
detect_gpu || true

if [[ "${CAP_PROFILE_LOADED:-false}" == "true" ]]; then
    case "${CAP_LLM_BACKEND:-}" in
        amd) GPU_BACKEND="amd" ;;
        *) GPU_BACKEND="nvidia" ;;
    esac
    [[ -n "${CAP_GPU_MEMORY_TYPE:-}" ]] && GPU_MEMORY_TYPE="${CAP_GPU_MEMORY_TYPE}"
    [[ -n "${CAP_GPU_NAME:-}" ]] && GPU_NAME="${CAP_GPU_NAME}"
    [[ -n "${CAP_GPU_VRAM_MB:-}" ]] && GPU_VRAM="${CAP_GPU_VRAM_MB}"
    [[ -n "${CAP_GPU_COUNT:-}" ]] && GPU_COUNT="${CAP_GPU_COUNT}"
    log "Capabilities override detection: backend=${GPU_BACKEND}, memory=${GPU_MEMORY_TYPE}, tier=${CAP_RECOMMENDED_TIER:-unknown}"
fi

BACKEND_ID="$GPU_BACKEND"
if [[ "${CAP_LLM_BACKEND:-}" == "cpu" || "${CAP_LLM_BACKEND:-}" == "apple" ]]; then
    BACKEND_ID="${CAP_LLM_BACKEND}"
fi
load_backend_contract "$BACKEND_ID" || true
LLM_HEALTHCHECK_URL="${BACKEND_PUBLIC_HEALTH_URL:-http://localhost:8080/health}"
LLM_PUBLIC_API_PORT="${BACKEND_PUBLIC_API_PORT:-8080}"
OPENCLAW_PROVIDER_NAME_DEFAULT="${BACKEND_PROVIDER_NAME:-local-llama}"
OPENCLAW_PROVIDER_URL_DEFAULT="${BACKEND_PROVIDER_URL:-http://llama-server:8080/v1}"

#-----------------------------------------------------------------------------
# Secure Boot + NVIDIA auto-fix
#-----------------------------------------------------------------------------
# If detect_gpu found no working GPU, check if it's a fixable driver/Secure Boot issue
# (Only for NVIDIA — AMD APU is handled above)
if [[ $GPU_COUNT -eq 0 && "$GPU_BACKEND" != "amd" ]] && ! $DRY_RUN; then
    fix_nvidia_secure_boot || true
fi

# NVIDIA Driver Compatibility Check
# llama-server (CUDA) requires driver >= 570
if [[ $GPU_COUNT -gt 0 && "$GPU_BACKEND" == "nvidia" ]]; then
    DRIVER_VERSION=""
    if raw_driver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null); then
        DRIVER_VERSION=$(echo "$raw_driver" | head -1 | cut -d. -f1)
    fi
    if [[ -n "$DRIVER_VERSION" && "$DRIVER_VERSION" =~ ^[0-9]+$ ]]; then
        log "NVIDIA driver: $DRIVER_VERSION"
        if [[ "$DRIVER_VERSION" -lt "$MIN_DRIVER_VERSION" ]]; then
            ai_bad "NVIDIA driver $DRIVER_VERSION is too old. llama-server (CUDA) requires driver >= $MIN_DRIVER_VERSION."
            ai "Attempting to install a compatible driver..."
            if ! $DRY_RUN; then
                if command -v ubuntu-drivers &> /dev/null; then
                    sudo ubuntu-drivers install nvidia:${MIN_DRIVER_VERSION}-server 2>>"$LOG_FILE" || \
                    sudo apt-get install -y nvidia-driver-${MIN_DRIVER_VERSION} 2>>"$LOG_FILE" || true
                else
                    sudo apt-get install -y nvidia-driver-${MIN_DRIVER_VERSION} 2>>"$LOG_FILE" || true
                fi
                # Check if upgrade succeeded
                if dpkg -l "nvidia-driver-${MIN_DRIVER_VERSION}"* 2>/dev/null | grep -q "^ii"; then
                    ai_ok "NVIDIA driver ${MIN_DRIVER_VERSION} installed."
                    ai_warn "A REBOOT is required before continuing."
                    ai "After rebooting, re-run this installer. It will pick up where it left off."
                    echo ""
                    if $INTERACTIVE; then
                        read -p "  Reboot now? [y/N] " -r
                        if [[ $REPLY =~ ^[Yy]$ ]]; then
                            sudo reboot
                        fi
                    fi
                    error "Reboot required to load NVIDIA driver ${MIN_DRIVER_VERSION}. Re-run install.sh after rebooting."
                else
                    ai_bad "Driver install failed. Please install NVIDIA driver >= ${MIN_DRIVER_VERSION} manually."
                    ai "  Try: sudo apt install nvidia-driver-${MIN_DRIVER_VERSION}"
                    error "Compatible NVIDIA driver required."
                fi
            else
                log "[DRY RUN] Would install nvidia-driver-${MIN_DRIVER_VERSION}"
            fi
        else
            ai_ok "NVIDIA driver $DRIVER_VERSION (>= $MIN_DRIVER_VERSION required)"
        fi
    else
        ai_warn "Could not determine driver version — continuing anyway"
    fi
fi

# Auto-detect tier if not specified
if [[ -z "$TIER" ]]; then
    PROFILE_TIER="$(normalize_profile_tier "${CAP_RECOMMENDED_TIER:-}")"
    if [[ -n "$PROFILE_TIER" ]]; then
        TIER="$PROFILE_TIER"
    elif [[ "$GPU_BACKEND" == "amd" && "$GPU_MEMORY_TYPE" == "unified" ]]; then
        # Strix Halo binary tier system
        unified_gb=$((GPU_VRAM / 1024))
        if [[ $unified_gb -ge 90 ]]; then
            TIER="SH_LARGE"
        else
            TIER="SH_COMPACT"
        fi
    elif [[ $GPU_VRAM -ge 90000 ]]; then
        TIER="NV_ULTRA"
    elif [[ $GPU_COUNT -ge 2 ]] || [[ $GPU_VRAM -ge 40000 ]]; then
        TIER=4
    elif [[ $GPU_VRAM -ge 20000 ]] || [[ $RAM_GB -ge 96 ]]; then
        TIER=3
    elif [[ $GPU_VRAM -ge 12000 ]] || [[ $RAM_GB -ge 48 ]]; then
        TIER=2
    else
        TIER=1
    fi
    log "Auto-detected tier: $TIER"
else
    log "Using specified tier: $TIER"
fi

# Resolve compose overlay files
resolve_compose_config

# Resolve tier → model/GGUF/context
resolve_tier_config

# Display hardware summary with nice formatting
CPU_INFO=$(grep "model name" /proc/cpuinfo 2>/dev/null | head -1 | cut -d: -f2 | xargs || echo "Unknown")
if [[ "$INTERACTIVE" == "true" ]]; then
    show_hardware_summary "$GPU_NAME" "$((GPU_VRAM / 1024))" "$CPU_INFO" "$RAM_GB" "$DISK_AVAIL"

    # Estimate tokens/sec and concurrent users based on tier
    case $TIER in
        NV_ULTRA)   SPEED_EST=50; USERS_EST="10-20" ;;
        SH_LARGE)   SPEED_EST=40; USERS_EST="5-10" ;;
        SH_COMPACT) SPEED_EST=80; USERS_EST="5-10" ;;
        1) SPEED_EST=25; USERS_EST="1-2" ;;
        2) SPEED_EST=45; USERS_EST="3-5" ;;
        3) SPEED_EST=55; USERS_EST="5-8" ;;
        4) SPEED_EST=40; USERS_EST="10-15" ;;
        *)          SPEED_EST=30;  USERS_EST="varies" ;;
    esac
    show_tier_recommendation "$TIER" "$LLM_MODEL" "$SPEED_EST" "$USERS_EST"
else
    success "Configuration: Tier $TIER ($TIER_NAME)"
    log "  Model: $LLM_MODEL"
    log "  Context: ${MAX_CONTEXT} tokens"
fi
