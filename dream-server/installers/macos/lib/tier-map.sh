#!/bin/bash
# ============================================================================
# Dream Server macOS Installer -- Tier Map
# ============================================================================
# Part of: installers/macos/lib/
# Purpose: Map hardware tier to model name, GGUF file, URL, and context size
#
# Canonical source: installers/lib/tier-map.sh (keep values byte-identical)
#
# Modder notes:
#   Add new tiers or change model assignments here.
#   Each tier maps to a specific GGUF quantization and context window.
#
#   Apple Silicon unified memory:
#   All system RAM is shared between macOS, Docker, and the LLM.
#   ~8GB is consumed by system overhead, so tier thresholds are
#   set conservatively compared to discrete-GPU platforms.
# ============================================================================

resolve_tier_config() {
    local tier="$1"

    case "$tier" in
        CLOUD)
            TIER_NAME="Cloud (API)"
            LLM_MODEL="anthropic/claude-sonnet-4-5-20250514"
            GGUF_FILE=""
            GGUF_URL=""
            GGUF_SHA256=""
            MAX_CONTEXT=200000
            ;;
        4)
            TIER_NAME="Enterprise"
            LLM_MODEL="qwen3-30b-a3b"
            GGUF_FILE="Qwen3-30B-A3B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf"
            GGUF_SHA256="9f1a24700a339b09c06009b729b5c809e0b64c213b8af5b711b3dbdfd0c5ba48"
            MAX_CONTEXT=131072
            ;;
        3)
            TIER_NAME="Pro"
            LLM_MODEL="qwen3-30b-a3b"
            GGUF_FILE="Qwen3-30B-A3B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf"
            GGUF_SHA256="9f1a24700a339b09c06009b729b5c809e0b64c213b8af5b711b3dbdfd0c5ba48"
            MAX_CONTEXT=32768
            ;;
        2)
            TIER_NAME="Prosumer"
            LLM_MODEL="qwen3-8b"
            GGUF_FILE="Qwen3-8B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf"
            GGUF_SHA256="120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4"
            MAX_CONTEXT=32768
            ;;
        0)
            TIER_NAME="Lightweight"
            LLM_MODEL="qwen3.5-2b"
            GGUF_FILE="Qwen3.5-2B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf"
            GGUF_SHA256=""
            MAX_CONTEXT=8192
            ;;
        1)
            TIER_NAME="Entry Level"
            LLM_MODEL="qwen3-4b"
            GGUF_FILE="Qwen3-4B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf"
            GGUF_SHA256="f6f851777709861056efcdad3af01da38b31223a3ba26e61a4f8bf3a2195813a"
            MAX_CONTEXT=16384
            ;;
        *)
            ai_err "Invalid tier: $tier. Valid tiers: 0, 1, 2, 3, 4, CLOUD"
            exit 1
            ;;
    esac
}

# Auto-select tier based on Apple Silicon unified memory
#
# Unlike discrete GPUs, Apple Silicon shares all system RAM between
# macOS (~4-5GB), Docker + services (~2-3GB), and the LLM model.
# Effective free memory ≈ total RAM minus ~8GB system overhead.
#
# Thresholds are set conservatively so the model + KV cache fit
# comfortably alongside everything else.
auto_select_tier() {
    local ram_gb="$1"
    local chip_variant="${2:-base}"

    if [[ "$ram_gb" -ge 64 ]]; then
        echo "4"
    elif [[ "$ram_gb" -ge 48 ]]; then
        echo "3"
    elif [[ "$ram_gb" -ge 32 ]]; then
        echo "2"
    elif [[ "$ram_gb" -ge 16 ]]; then
        # 16–31 GB unified → lightweight 4B model
        echo "1"
    else
        # < 16 GB unified → ultra-lightweight 2B model
        echo "0"
    fi
}
