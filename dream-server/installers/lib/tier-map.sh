#!/bin/bash
# ============================================================================
# Dream Server Installer — Tier Map
# ============================================================================
# Part of: installers/lib/
# Purpose: Map hardware tier to model name, GGUF file, URL, and context size
#
# Expects: TIER (set by detection phase), error()
# Provides: resolve_tier_config() → sets TIER_NAME, LLM_MODEL, GGUF_FILE,
#           GGUF_URL, MAX_CONTEXT
#
# Modder notes:
#   Add new tiers or change model assignments here.
#   Each tier maps to a specific GGUF quantization and context window.
# ============================================================================

resolve_tier_config() {
    case $TIER in
        CLOUD)
            TIER_NAME="Cloud (API)"
            LLM_MODEL="anthropic/claude-sonnet-4-5-20250514"
            GGUF_FILE=""
            GGUF_URL=""
            GGUF_SHA256=""
            MAX_CONTEXT=200000
            ;;
        NV_ULTRA)
            TIER_NAME="NVIDIA Ultra (90GB+)"
            LLM_MODEL="qwen3-coder-next"
            GGUF_FILE="qwen3-coder-next-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3-Coder-Next-GGUF/resolve/main/Qwen3-Coder-Next-Q4_K_M.gguf"
            GGUF_SHA256="9e6032d2f3b50a60f17ce8bf5a1d85c71af9b53b89c7978020ae7c660f29b090"
            MAX_CONTEXT=131072
            ;;
        SH_LARGE)
            TIER_NAME="Strix Halo 90+"
            LLM_MODEL="qwen3-coder-next"
            GGUF_FILE="qwen3-coder-next-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3-Coder-Next-GGUF/resolve/main/Qwen3-Coder-Next-Q4_K_M.gguf"
            GGUF_SHA256="9e6032d2f3b50a60f17ce8bf5a1d85c71af9b53b89c7978020ae7c660f29b090"
            MAX_CONTEXT=131072
            ;;
        SH_COMPACT)
            TIER_NAME="Strix Halo Compact"
            LLM_MODEL="qwen3-30b-a3b"
            GGUF_FILE="Qwen3-30B-A3B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf"
            GGUF_SHA256="9f1a24700a339b09c06009b729b5c809e0b64c213b8af5b711b3dbdfd0c5ba48"
            MAX_CONTEXT=131072
            ;;
        1)
            TIER_NAME="Entry Level"
            LLM_MODEL="qwen3-8b"
            GGUF_FILE="Qwen3-8B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf"
            GGUF_SHA256="120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4"
            MAX_CONTEXT=16384
            ;;
        2)
            TIER_NAME="Prosumer"
            LLM_MODEL="qwen3-8b"
            GGUF_FILE="Qwen3-8B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf"
            GGUF_SHA256="120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4"
            MAX_CONTEXT=32768
            ;;
        3)
            TIER_NAME="Pro"
            LLM_MODEL="qwen3-14b"
            GGUF_FILE="Qwen3-14B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf"
            GGUF_SHA256="5eaa0870bd81ed3b58a630a271234cfa604e43ffb3a19cd68e54a80dd9d52a66"
            MAX_CONTEXT=32768
            ;;
        4)
            TIER_NAME="Enterprise"
            LLM_MODEL="qwen3-30b-a3b"
            GGUF_FILE="Qwen3-30B-A3B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf"
            GGUF_SHA256="9f1a24700a339b09c06009b729b5c809e0b64c213b8af5b711b3dbdfd0c5ba48"
            MAX_CONTEXT=131072
            ;;
        *)
            error "Invalid tier: $TIER. Valid tiers: 1, 2, 3, 4, CLOUD, NV_ULTRA, SH_LARGE, SH_COMPACT"
            # NOTE for modders: add your tier above this line and update this message.
            ;;
    esac
}

# Map a tier name to its LLM_MODEL value (used by dream model swap)
tier_to_model() {
    local t="$1"
    case "$t" in
        CLOUD)      echo "anthropic/claude-sonnet-4-5-20250514" ;;
        NV_ULTRA)   echo "qwen3-coder-next" ;;
        SH_LARGE)   echo "qwen3-coder-next" ;;
        SH_COMPACT|SH) echo "qwen3-30b-a3b" ;;
        1|T1)       echo "qwen3-8b" ;;
        2|T2)       echo "qwen3-8b" ;;
        3|T3)       echo "qwen3-14b" ;;
        4|T4)       echo "qwen3-30b-a3b" ;;
        *)          echo "" ;;
    esac
}
