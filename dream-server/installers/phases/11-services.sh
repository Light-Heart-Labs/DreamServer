#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 11: Start Services
# ============================================================================
# Part of: installers/phases/
# Purpose: Download GGUF model, FLUX models, generate models.ini, launch
#          Docker Compose stack
#
# Expects: DRY_RUN, INSTALL_DIR, LOG_FILE, GPU_BACKEND,
#           GGUF_FILE, GGUF_URL, LLM_MODEL, MAX_CONTEXT,
#           DOCKER_COMPOSE_CMD, COMPOSE_FLAGS, BGRN, RED, AMB, NC,
#           show_phase(), bootline(), signal(), ai(), ai_ok(), ai_bad(),
#           ai_warn(), log(), spin_task()
# Provides: Running Docker Compose stack
#
# Modder notes:
#   Change model download logic or compose launch flags here.
# ============================================================================

show_phase 5 6 "Starting Services" "~2-3 minutes"

if $DRY_RUN; then
    log "[DRY RUN] Would start services: $DOCKER_COMPOSE_CMD $COMPOSE_FLAGS up -d"
else
    cd "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR/logs"

    # Cloud mode: skip model downloads, auto-enable litellm
    if [[ "${DREAM_MODE:-local}" == "cloud" ]]; then
        ai "Cloud mode — skipping model download"
        # Auto-enable litellm extension
        litellm_cf="$INSTALL_DIR/extensions/services/litellm/compose.yaml"
        litellm_disabled="${litellm_cf}.disabled"
        if [[ -f "$litellm_disabled" && ! -f "$litellm_cf" ]]; then
            mv "$litellm_disabled" "$litellm_cf"
            ai_ok "Auto-enabled litellm for cloud mode"
        fi
    fi

    # Ensure model directory exists
    mkdir -p "$INSTALL_DIR/data/models"

    # Download GGUF model if not already present (with retry)
    GGUF_DIR="$INSTALL_DIR/data/models"
    if [[ "${DREAM_MODE:-local}" != "cloud" && ! -f "$GGUF_DIR/$GGUF_FILE" && -n "$GGUF_URL" ]]; then
        ai "Downloading GGUF model: $GGUF_FILE"
        signal "This is the big one. I've got it — sit back."
        echo ""

        # Retry loop: up to 3 attempts with resume support (-c flag)
        _dl_success=false
        for _attempt in 1 2 3; do
            [[ $_attempt -gt 1 ]] && ai "Retry attempt $_attempt of 3..."
            wget -c -q -O "$GGUF_DIR/$GGUF_FILE.part" "$GGUF_URL" \
                >> "$INSTALL_DIR/logs/model-download.log" 2>&1 &
            dl_pid=$!

            if spin_task $dl_pid "Downloading $GGUF_FILE"; then
                mv "$GGUF_DIR/$GGUF_FILE.part" "$GGUF_DIR/$GGUF_FILE"
                printf "\r  ${BGRN}✓${NC} %-60s\n" "Model downloaded: $GGUF_FILE"
                _dl_success=true
                break
            fi
            printf "\r  ${AMB}⚠${NC} %-60s\n" "Download attempt $_attempt failed"
            sleep 3
        done

        if [[ "$_dl_success" != "true" ]]; then
            printf "\r  ${RED}✗${NC} %-60s\n" "Download failed after 3 attempts: $GGUF_FILE"
            ai "Manual retry: wget -c -O '$GGUF_DIR/$GGUF_FILE.part' '$GGUF_URL' && mv '$GGUF_DIR/$GGUF_FILE.part' '$GGUF_DIR/$GGUF_FILE'"
        fi
    elif [[ -f "$GGUF_DIR/$GGUF_FILE" ]]; then
        ai_ok "GGUF model already present: $GGUF_FILE"
    fi

    # ── FLUX.1-schnell model download (ComfyUI image generation) ──
    if [[ "${DREAM_MODE:-local}" == "cloud" ]]; then
        ai "Cloud mode — skipping FLUX model download"
    elif [[ "$GPU_BACKEND" == "amd" ]]; then
        COMFYUI_BASE="$INSTALL_DIR/data/comfyui/ComfyUI/models"
    elif [[ "$GPU_BACKEND" == "nvidia" ]]; then
        COMFYUI_BASE="$INSTALL_DIR/data/comfyui/models"
    fi
    if [[ "$GPU_BACKEND" == "amd" || "$GPU_BACKEND" == "nvidia" ]]; then
        FLUX_DIFFUSION_DIR="$COMFYUI_BASE/diffusion_models"
        FLUX_ENCODER_DIR="$COMFYUI_BASE/text_encoders"
        FLUX_VAE_DIR="$COMFYUI_BASE/vae"
        mkdir -p "$FLUX_DIFFUSION_DIR" "$FLUX_ENCODER_DIR" "$FLUX_VAE_DIR"
        # NVIDIA ComfyUI also needs output/input/workflows bind-mount dirs
        if [[ "$GPU_BACKEND" == "nvidia" ]]; then
            mkdir -p "$INSTALL_DIR/data/comfyui"/{output,input,workflows}
        fi

        FLUX_NEEDED=false
        [[ ! -f "$FLUX_DIFFUSION_DIR/flux1-schnell.safetensors" ]] && FLUX_NEEDED=true
        [[ ! -f "$FLUX_ENCODER_DIR/clip_l.safetensors" ]] && FLUX_NEEDED=true
        [[ ! -f "$FLUX_ENCODER_DIR/t5xxl_fp16.safetensors" ]] && FLUX_NEEDED=true
        [[ ! -f "$FLUX_VAE_DIR/ae.safetensors" ]] && FLUX_NEEDED=true

        if [[ "$FLUX_NEEDED" == "true" ]]; then
            ai "Downloading FLUX.1-schnell models (~34GB) for image generation..."
            nohup env \
                FLUX_DIFFUSION_DIR="$FLUX_DIFFUSION_DIR" \
                FLUX_ENCODER_DIR="$FLUX_ENCODER_DIR" \
                FLUX_VAE_DIR="$FLUX_VAE_DIR" \
                bash -c '
                    echo "[FLUX] Starting FLUX.1-schnell model downloads..."

                    # Diffusion model (~24GB)
                    if [[ ! -f "$FLUX_DIFFUSION_DIR/flux1-schnell.safetensors" ]]; then
                        echo "[FLUX] Downloading flux1-schnell.safetensors (~24GB)..."
                        wget -c -q --show-progress -O "$FLUX_DIFFUSION_DIR/flux1-schnell.safetensors.part" \
                            "https://huggingface.co/Comfy-Org/flux1-schnell/resolve/main/flux1-schnell.safetensors" 2>&1 && \
                            mv "$FLUX_DIFFUSION_DIR/flux1-schnell.safetensors.part" "$FLUX_DIFFUSION_DIR/flux1-schnell.safetensors" && \
                            echo "[FLUX] flux1-schnell.safetensors complete" || \
                            echo "[FLUX] ERROR: Failed to download flux1-schnell.safetensors"
                    fi

                    # CLIP-L text encoder (~246MB)
                    if [[ ! -f "$FLUX_ENCODER_DIR/clip_l.safetensors" ]]; then
                        echo "[FLUX] Downloading clip_l.safetensors (~246MB)..."
                        wget -c -q --show-progress -O "$FLUX_ENCODER_DIR/clip_l.safetensors.part" \
                            "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors" 2>&1 && \
                            mv "$FLUX_ENCODER_DIR/clip_l.safetensors.part" "$FLUX_ENCODER_DIR/clip_l.safetensors" && \
                            echo "[FLUX] clip_l.safetensors complete" || \
                            echo "[FLUX] ERROR: Failed to download clip_l.safetensors"
                    fi

                    # T5-XXL text encoder (~10GB)
                    if [[ ! -f "$FLUX_ENCODER_DIR/t5xxl_fp16.safetensors" ]]; then
                        echo "[FLUX] Downloading t5xxl_fp16.safetensors (~10GB)..."
                        wget -c -q --show-progress -O "$FLUX_ENCODER_DIR/t5xxl_fp16.safetensors.part" \
                            "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors" 2>&1 && \
                            mv "$FLUX_ENCODER_DIR/t5xxl_fp16.safetensors.part" "$FLUX_ENCODER_DIR/t5xxl_fp16.safetensors" && \
                            echo "[FLUX] t5xxl_fp16.safetensors complete" || \
                            echo "[FLUX] ERROR: Failed to download t5xxl_fp16.safetensors"
                    fi

                    # VAE (~335MB)
                    if [[ ! -f "$FLUX_VAE_DIR/ae.safetensors" ]]; then
                        echo "[FLUX] Downloading ae.safetensors (~335MB)..."
                        wget -c -q --show-progress -O "$FLUX_VAE_DIR/ae.safetensors.part" \
                            "https://huggingface.co/Comfy-Org/Lumina_Image_2.0_Repackaged/resolve/main/split_files/vae/ae.safetensors" 2>&1 && \
                            mv "$FLUX_VAE_DIR/ae.safetensors.part" "$FLUX_VAE_DIR/ae.safetensors" && \
                            echo "[FLUX] ae.safetensors complete" || \
                            echo "[FLUX] ERROR: Failed to download ae.safetensors"
                    fi

                    echo "[FLUX] All FLUX.1-schnell model downloads finished."
                ' > "$INSTALL_DIR/logs/flux-download.log" 2>&1 &
            log "Background FLUX download started. Check: tail -f $INSTALL_DIR/logs/flux-download.log"
            ai "FLUX.1-schnell models downloading in background (~34GB). ComfyUI will be ready once complete."
        else
            ai_ok "FLUX.1-schnell models already present"
        fi
    fi

    # Generate models.ini for llama-server (skip in cloud mode)
    if [[ "${DREAM_MODE:-local}" != "cloud" ]]; then
        mkdir -p "$INSTALL_DIR/config/llama-server"
        cat > "$INSTALL_DIR/config/llama-server/models.ini" << MODELS_INI_EOF
[${LLM_MODEL}]
filename = ${GGUF_FILE}
load-on-startup = true
n-ctx = ${MAX_CONTEXT}
MODELS_INI_EOF
        ai_ok "Generated models.ini for llama-server"
    fi

    # Launch containers
    echo ""
    signal "Waking the stack..."
    ai "I'm bringing systems online. You can breathe."
    echo ""
    compose_ok=false
    $DOCKER_COMPOSE_CMD $COMPOSE_FLAGS up --build -d >> "$LOG_FILE" 2>&1 &
    compose_pid=$!
    if spin_task $compose_pid "Launching containers..."; then
        compose_ok=true
    else
        printf "\r  ${AMB}⚠${NC} %-60s\n" "Some services still starting..."
        echo ""
        ai_warn "Some containers need more time. Retrying..."
        $DOCKER_COMPOSE_CMD $COMPOSE_FLAGS up --build -d >> "$LOG_FILE" 2>&1 &
        compose_pid=$!
        if spin_task $compose_pid "Waiting for remaining services..."; then
            compose_ok=true
        fi
    fi
    # Final safety net: start any containers stuck in Created state
    $DOCKER_COMPOSE_CMD $COMPOSE_FLAGS up -d >> "$LOG_FILE" 2>&1 || true

    if $compose_ok; then
        printf "\r  ${BGRN}✓${NC} %-60s\n" "All containers launched"
        echo ""
        ai_ok "Services started (llama-server)"
    else
        printf "\r  ${RED}✗${NC} %-60s\n" "Some containers failed to launch"
        echo ""
        ai_warn "Some services failed. Check: docker compose logs"
        ai_warn "Log file: $LOG_FILE"
    fi

    # ── Run extension setup hooks ──
    if [[ -f "$INSTALL_DIR/lib/service-registry.sh" ]]; then
        _HOOK_DIR="$INSTALL_DIR"
        . "$_HOOK_DIR/lib/service-registry.sh"
        sr_load
        _hook_count=0
        for sid in "${SERVICE_IDS[@]}"; do
            hook="${SERVICE_SETUP_HOOKS[$sid]:-}"
            [[ -z "$hook" || ! -f "$hook" ]] && continue
            [[ -x "$hook" ]] || chmod +x "$hook"
            log "Running setup hook for $sid: $hook"
            if bash "$hook" "$INSTALL_DIR" "$GPU_BACKEND" >> "$LOG_FILE" 2>&1; then
                _hook_count=$((_hook_count + 1))
            else
                ai_warn "Setup hook for $sid exited with error (non-fatal)"
            fi
        done
        [[ $_hook_count -gt 0 ]] && ai_ok "Ran $_hook_count extension setup hook(s)" || true
    fi
fi
