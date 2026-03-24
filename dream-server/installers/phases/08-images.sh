#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 08: Pull Docker Images
# ============================================================================
# Part of: installers/phases/
# Purpose: Build image pull list and download all Docker images
#
# Expects: DRY_RUN, GPU_BACKEND, ENABLE_VOICE, ENABLE_WORKFLOWS,
#           ENABLE_RAG, ENABLE_OPENCLAW, DOCKER_CMD, LOG_FILE, BGRN, AMB, NC,
#           show_phase(), bootline(), signal(), ai(), ai_ok(), ai_warn(),
#           pull_with_progress()
# Provides: (Docker images pulled locally)
#
# Modder notes:
#   Add new container images or change image tags here.
# ============================================================================

dream_progress 48 "images" "Downloading container images"
show_phase 4 6 "Downloading Modules" "~5-10 minutes"

# Build image list with cinematic labels
# Format: "image|friendly_name"
PULL_LIST=()
if [[ "$GPU_BACKEND" == "amd" ]]; then
    PULL_LIST+=("ghcr.io/lemonade-sdk/lemonade-server:v10.0.0|LEMONADE — downloading the brain (AMD ROCm)")
    [[ "$ENABLE_COMFYUI" == "true" ]] && PULL_LIST+=("ignatberesnev/comfyui-gfx1151:v0.2|COMFYUI — image generation engine (gfx1151)")
elif [[ "$GPU_BACKEND" == "cpu" ]]; then
    PULL_LIST+=("ghcr.io/ggml-org/llama.cpp:server-b8248|LLAMA-SERVER — downloading the brain (CPU)")
else
    PULL_LIST+=("ghcr.io/ggml-org/llama.cpp:server-cuda-b8248|LLAMA-SERVER — downloading the brain (NVIDIA CUDA)")
fi
PULL_LIST+=("ghcr.io/open-webui/open-webui:v0.7.2|OPEN WEBUI — interface module")
PULL_LIST+=("itzcrazykns1337/perplexica:slim-latest@sha256:6e399abf4ff587822b0ef0df11f36088fb928e17ac61556fe89beb68d48c378e|PERPLEXICA — deep research engine")
if [[ "$ENABLE_VOICE" == "true" ]]; then
    if [[ "$GPU_BACKEND" == "nvidia" ]]; then
        PULL_LIST+=("ghcr.io/speaches-ai/speaches:0.9.0-rc.3-cuda|WHISPER — ears online (Speaches STT, CUDA)")
    else
        PULL_LIST+=("ghcr.io/speaches-ai/speaches:0.9.0-rc.3-cpu|WHISPER — ears online (Speaches STT)")
    fi
    PULL_LIST+=("ghcr.io/remsky/kokoro-fastapi-cpu:v0.2.4|KOKORO — voice module")
fi
[[ "$ENABLE_WORKFLOWS" == "true" ]] && PULL_LIST+=("n8nio/n8n:2.6.4|N8N — automation engine")
[[ "$ENABLE_RAG" == "true" ]] && PULL_LIST+=("qdrant/qdrant:v1.16.3|QDRANT — memory vault")
[[ "$ENABLE_OPENCLAW" == "true" ]] && PULL_LIST+=("ghcr.io/openclaw/openclaw:2026.3.8|OPENCLAW — agent framework")
[[ "$ENABLE_RAG" == "true" ]] && PULL_LIST+=("ghcr.io/huggingface/text-embeddings-inference:cpu-1.9.1|TEI — embedding engine")

if $DRY_RUN; then
    ai "[DRY RUN] I would download ${#PULL_LIST[@]} modules."
else
    echo ""
    bootline
    echo -e "${BGRN}DOWNLOAD SEQUENCE${NC}"
    echo -e "${AMB}This is the long scene.${NC} (largest module first)"
    bootline
    echo ""
    signal "Take a break for ten minutes. I've got this."
    echo ""

    pull_count=0
    pull_total=${#PULL_LIST[@]}
    pull_failed=0

    for entry in "${PULL_LIST[@]}"; do
        img="${entry%%|*}"
        label="${entry##*|}"
        pull_count=$((pull_count + 1))

        # Sub-milestone: interpolate progress 48-64% across image pulls
        _img_pct=$(( 48 + (pull_count - 1) * 16 / pull_total ))
        dream_progress "$_img_pct" "images" "Pulling image $pull_count/$pull_total"

        if ! pull_with_progress "$img" "$label" "$pull_count" "$pull_total"; then
            ai_warn "Failed to pull $img — will retry on next start"
            pull_failed=$((pull_failed + 1))
        fi
    done

    echo ""
    if [[ $pull_failed -eq 0 ]]; then
        ai_ok "All $pull_total modules downloaded"
    else
        ai_warn "$pull_failed of $pull_total modules failed — services may not start fully"
    fi
fi
