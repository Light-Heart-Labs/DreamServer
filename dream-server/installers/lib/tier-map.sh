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
        ARC)
            # Intel Arc A770 (16 GB) and future Arc B-series (≥12 GB VRAM)
            # llama.cpp SYCL backend: N_GPU_LAYERS=99 offloads all layers to GPU
            TIER_NAME="Intel Arc"
            LLM_MODEL="qwen3.5-9b"
            GGUF_FILE="Qwen3.5-9B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf"
            GGUF_SHA256="03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8"
            MAX_CONTEXT=32768
            GPU_BACKEND="sycl"
            N_GPU_LAYERS=99
            ;;
        ARC_LITE)
            # Intel Arc A750 (8 GB), A380 (6 GB) — smaller VRAM, lighter model
            # llama.cpp SYCL backend: N_GPU_LAYERS=99 offloads all layers to GPU
            TIER_NAME="Intel Arc Lite"
            LLM_MODEL="qwen3.5-4b"
            GGUF_FILE="Qwen3.5-4B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf"
            GGUF_SHA256="00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4"
            MAX_CONTEXT=16384
            GPU_BACKEND="sycl"
            N_GPU_LAYERS=99
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
            LLM_MODEL="qwen3.5-9b"
            GGUF_FILE="Qwen3.5-9B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf"
            GGUF_SHA256="03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8"
            MAX_CONTEXT=16384
            ;;
        2)
            TIER_NAME="Prosumer"
            LLM_MODEL="qwen3.5-9b"
            GGUF_FILE="Qwen3.5-9B-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/resolve/main/Qwen3.5-9B-Q4_K_M.gguf"
            GGUF_SHA256="03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8"
            MAX_CONTEXT=32768
            ;;
        3)
            TIER_NAME="Pro"
            LLM_MODEL="gpt-oss-20b"
            GGUF_FILE="gpt-oss-20b-Q4_K_M.gguf"
            GGUF_URL="https://huggingface.co/unsloth/gpt-oss-20b-GGUF/resolve/main/gpt-oss-20b-Q4_K_M.gguf"
            GGUF_SHA256="c27536640e410032865dc68781d80a08b98f8db5e93575919af8ccc0568aeb4f"
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
            error "Invalid tier: $TIER. Valid tiers: 0, 1, 2, 3, 4, CLOUD, NV_ULTRA, SH_LARGE, SH_COMPACT, ARC, ARC_LITE"
            # NOTE for modders: add your tier above this line and update this message.
            ;;
    esac
}

# Map a tier name to its LLM_MODEL value (used by dream model swap)
tier_to_model() {
    local t="$1"
    case "$t" in
        CLOUD)          echo "anthropic/claude-sonnet-4-5-20250514" ;;
        NV_ULTRA)       echo "qwen3-coder-next" ;;
        SH_LARGE)       echo "qwen3-coder-next" ;;
        SH_COMPACT|SH)  echo "qwen3-30b-a3b" ;;
        ARC)            echo "qwen3.5-9b" ;;
        ARC_LITE)       echo "qwen3.5-4b" ;;
        0|T0)           echo "qwen3.5-2b" ;;
        1|T1)           echo "qwen3.5-9b" ;;
        2|T2)           echo "qwen3.5-9b" ;;
        3|T3)           echo "gpt-oss-20b" ;;
        4|T4)           echo "qwen3-30b-a3b" ;;
        *)              echo "" ;;
    esac
}
