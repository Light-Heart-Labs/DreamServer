#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 11: Start Services
# ============================================================================
# Part of: installers/phases/
# Purpose: Download GGUF model, SDXL Lightning model, generate models.ini, launch
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

dream_progress 75 "services" "Starting services"
show_phase 5 6 "Starting Services" "~2-3 minutes"

if $DRY_RUN; then
    log "[DRY RUN] Would start services: $DOCKER_COMPOSE_CMD $COMPOSE_FLAGS up -d"
else
    cd "$INSTALL_DIR" || exit 1

    # Re-resolve compose flags against the actual install directory.
    # Phase 03 may have disabled services (e.g., ComfyUI on Tier 0) after
    # COMPOSE_FLAGS was first set in Phase 02, making the cached value stale.
    if [[ -x "$INSTALL_DIR/scripts/resolve-compose-stack.sh" ]]; then
        _refreshed_flags=$("$INSTALL_DIR/scripts/resolve-compose-stack.sh" \
            --script-dir "$INSTALL_DIR" --tier "${TIER:-1}" --gpu-backend "${GPU_BACKEND:-nvidia}" 2>/dev/null) || true
        if [[ -n "$_refreshed_flags" ]]; then
            COMPOSE_FLAGS="$_refreshed_flags"
            log "Compose flags refreshed from install directory"
        fi
    fi

    # Convert COMPOSE_FLAGS string to array for safe word-splitting
    read -ra COMPOSE_FLAGS_ARR <<< "$COMPOSE_FLAGS"
    mkdir -p "$INSTALL_DIR/logs"

    # Persist compose flags so dream-cli can reuse them without re-resolving
    echo "$COMPOSE_FLAGS" > "$INSTALL_DIR/.compose-flags" || warn "Could not cache compose flags (non-fatal)"
    log "Saved compose flags to $INSTALL_DIR/.compose-flags"

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

    # ── Bootstrap model fast-start ──
    # For Tier 1+ installs, download a tiny model first so the user can chat
    # immediately. The full model downloads in the background and hot-swaps.
    [[ -f "$SCRIPT_DIR/installers/lib/bootstrap-model.sh" ]] && . "$SCRIPT_DIR/installers/lib/bootstrap-model.sh"
    _BOOTSTRAP_ACTIVE=false
    if type bootstrap_needed &>/dev/null && bootstrap_needed; then
        _BOOTSTRAP_ACTIVE=true
        # Save full model config for the background upgrade
        FULL_GGUF_FILE="$GGUF_FILE"
        FULL_GGUF_URL="$GGUF_URL"
        FULL_GGUF_SHA256="$GGUF_SHA256"
        FULL_LLM_MODEL="$LLM_MODEL"
        FULL_MAX_CONTEXT="$MAX_CONTEXT"

        # Swap to bootstrap model for the foreground download
        GGUF_FILE="$BOOTSTRAP_GGUF_FILE"
        GGUF_URL="$BOOTSTRAP_GGUF_URL"
        GGUF_SHA256=""  # No SHA256 for Tier 0 model
        LLM_MODEL="$BOOTSTRAP_LLM_MODEL"
        MAX_CONTEXT="$BOOTSTRAP_MAX_CONTEXT"
        ai "Fast-start mode: downloading bootstrap model (~1.5GB) for instant chat."
        ai "Your full model ($FULL_LLM_MODEL) will download in the background."
    fi


    # Download GGUF model if not already present (with retry and integrity verification)
    dream_progress 76 "services" "Checking AI model"
    GGUF_DIR="$INSTALL_DIR/data/models"
    if [[ "${DREAM_MODE:-local}" != "cloud" && -n "$GGUF_URL" ]]; then
        # Check if model exists and verify integrity
        if [[ -f "$GGUF_DIR/$GGUF_FILE" ]]; then
            if [[ -n "$GGUF_SHA256" ]]; then
                if command -v sha256sum &>/dev/null; then
                    ai "Verifying model integrity (SHA256)..."
                    ACTUAL_HASH=$(sha256sum "$GGUF_DIR/$GGUF_FILE" 2>/dev/null | awk '{print $1}')
                    if [[ -n "$ACTUAL_HASH" && "$ACTUAL_HASH" == "$GGUF_SHA256" ]]; then
                        ai_ok "Model verified: $GGUF_FILE"
                    elif [[ -z "$ACTUAL_HASH" ]]; then
                        ai_warn "Could not compute checksum for existing model file"
                        ai_ok "GGUF model already present: $GGUF_FILE (verification skipped)"
                    else
                        ai_warn "Model file is corrupt (SHA256 mismatch)."
                        ai "  Expected: $GGUF_SHA256"
                        ai "  Got:      $ACTUAL_HASH"
                        ai "Removing corrupt file and re-downloading..."
                        rm -f "$GGUF_DIR/$GGUF_FILE"
                    fi
                else
                    ai_warn "sha256sum not available, skipping integrity check"
                    ai_ok "GGUF model already present: $GGUF_FILE (verification skipped)"
                fi
            else
                ai_ok "GGUF model already present: $GGUF_FILE"
            fi
        fi

        # Download if not present or was removed due to corruption
        if [[ ! -f "$GGUF_DIR/$GGUF_FILE" ]]; then
            dream_progress 77 "services" "Downloading AI model"
            ai "Downloading GGUF model: $GGUF_FILE"
            signal "This is the big one. I've got it — sit back."
            echo ""

            # Retry loop: up to 3 attempts with resume support (-c flag)
            _dl_success=false
            for _attempt in 1 2 3; do
                [[ $_attempt -gt 1 ]] && ai "Retry attempt $_attempt of 3..."
                curl -fSL -C - --connect-timeout 30 --max-time 3600 -o "$GGUF_DIR/$GGUF_FILE.part" "$GGUF_URL" \
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
                ai "Manual retry: curl -fSL -C - -o '$GGUF_DIR/$GGUF_FILE.part' '$GGUF_URL' && mv '$GGUF_DIR/$GGUF_FILE.part' '$GGUF_DIR/$GGUF_FILE'"
            else
                # Verify freshly downloaded file
                if [[ -n "$GGUF_SHA256" ]]; then
                    if command -v sha256sum &>/dev/null; then
                        ai "Verifying download integrity (SHA256)..."
                        ACTUAL_HASH=$(sha256sum "$GGUF_DIR/$GGUF_FILE" 2>/dev/null | awk '{print $1}')
                        if [[ -n "$ACTUAL_HASH" && "$ACTUAL_HASH" == "$GGUF_SHA256" ]]; then
                            ai_ok "Download verified OK"
                        elif [[ -z "$ACTUAL_HASH" ]]; then
                            ai_warn "Could not compute checksum for downloaded file"
                            ai_warn "Proceeding without verification (file may be corrupt)"
                        else
                            printf "\r  ${RED}✗${NC} %-60s\n" "Downloaded file is corrupt (SHA256 mismatch)"
                            ai "  Expected: $GGUF_SHA256"
                            ai "  Got:      $ACTUAL_HASH"
                            rm -f "$GGUF_DIR/$GGUF_FILE"
                            ai_warn "Corrupt file removed. Re-run installer to download again."
                            _dl_success=false
                        fi
                    else
                        ai_warn "sha256sum not available, skipping integrity check"
                        ai_warn "Proceeding without verification (file may be corrupt)"
                    fi
                fi
            fi
        fi

        # Abort if model download/verification failed
        if [[ "${DREAM_MODE:-local}" != "cloud" && -n "$GGUF_URL" && ! -f "$GGUF_DIR/$GGUF_FILE" ]]; then
            ai_bad "Model file missing or verification failed. Cannot proceed without a valid model."
            ai "Re-run the installer to retry the download."
            exit 1
        fi
    fi

    # ── SDXL Lightning model download (ComfyUI image generation) ──
    dream_progress 79 "services" "Checking image generation models"
    if [[ "$ENABLE_COMFYUI" != "true" ]]; then
        ai "Image generation disabled — skipping model download"
    elif [[ "${DREAM_MODE:-local}" == "cloud" ]]; then
        ai "Cloud mode — skipping image model download"
    elif [[ "$GPU_BACKEND" == "amd" ]]; then
        COMFYUI_BASE="$INSTALL_DIR/data/comfyui/ComfyUI/models"
    elif [[ "$GPU_BACKEND" == "nvidia" ]]; then
        COMFYUI_BASE="$INSTALL_DIR/data/comfyui/models"
    fi
    if [[ "$ENABLE_COMFYUI" == "true" && "${DREAM_MODE:-local}" != "cloud" && ( "$GPU_BACKEND" == "amd" || "$GPU_BACKEND" == "nvidia" ) ]]; then
        SDXL_CHECKPOINT_DIR="$COMFYUI_BASE/checkpoints"
        mkdir -p "$SDXL_CHECKPOINT_DIR"
        # NVIDIA ComfyUI also needs output/input/workflows bind-mount dirs
        if [[ "$GPU_BACKEND" == "nvidia" ]]; then
            mkdir -p "$INSTALL_DIR/data/comfyui"/{output,input,workflows}
        fi

        SDXL_MODEL="sdxl_lightning_4step.safetensors"
        SDXL_URL="https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step.safetensors"

        if [[ ! -f "$SDXL_CHECKPOINT_DIR/$SDXL_MODEL" ]]; then
            ai "Downloading SDXL Lightning 4-step (~6.5GB) for image generation..."

            # Source background task tracking
            if [[ -f "$SCRIPT_DIR/installers/lib/background-tasks.sh" ]]; then
                . "$SCRIPT_DIR/installers/lib/background-tasks.sh"
            fi

            nohup env \
                SDXL_CHECKPOINT_DIR="$SDXL_CHECKPOINT_DIR" \
                SDXL_MODEL="$SDXL_MODEL" \
                SDXL_URL="$SDXL_URL" \
                bash -c '
                    echo "[SDXL] Starting SDXL Lightning model download..."
                    if [[ ! -f "$SDXL_CHECKPOINT_DIR/$SDXL_MODEL" ]]; then
                        echo "[SDXL] Downloading $SDXL_MODEL (~6.5GB)..."
                        curl -fSL -C - --connect-timeout 30 --max-time 3600 -o "$SDXL_CHECKPOINT_DIR/$SDXL_MODEL.part" \
                            "$SDXL_URL" 2>&1 && \
                            mv "$SDXL_CHECKPOINT_DIR/$SDXL_MODEL.part" "$SDXL_CHECKPOINT_DIR/$SDXL_MODEL" && \
                            echo "[SDXL] $SDXL_MODEL complete" || \
                            echo "[SDXL] ERROR: Failed to download $SDXL_MODEL"
                    fi
                    echo "[SDXL] SDXL Lightning model download finished."
                ' > "$INSTALL_DIR/logs/sdxl-download.log" 2>&1 &

            sdxl_pid=$!

            # Register background task
            if command -v bg_task_start &>/dev/null; then
                bg_task_start "sdxl-download" "$sdxl_pid" "SDXL Lightning model download" "$INSTALL_DIR/logs/sdxl-download.log"
            fi

            log "Background SDXL download started (PID: $sdxl_pid). Check: tail -f $INSTALL_DIR/logs/sdxl-download.log"
            ai "SDXL Lightning downloading in background (~6.5GB). ComfyUI will be ready once complete."
        else
            ai_ok "SDXL Lightning model already present"
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

        # If bootstrap is active, patch .env so docker compose starts llama-server
        # with the bootstrap model (phase 06 wrote .env with the full model values)
        if [[ "$_BOOTSTRAP_ACTIVE" == "true" ]]; then
            _env_file="$INSTALL_DIR/.env"
            if [[ -f "$_env_file" ]]; then
                _env_patch_ok=true
                for _key_val in "GGUF_FILE=$GGUF_FILE" "LLM_MODEL=$LLM_MODEL" "MAX_CONTEXT=$MAX_CONTEXT"; do
                    _key="${_key_val%%=*}"
                    _val="${_key_val#*=}"
                    if ! awk -v v="$_val" '{ if (index($0, "'"$_key"'=") == 1) print "'"$_key"'=" v; else print }' \
                        "$_env_file" > "${_env_file}.tmp" 2>>"$LOG_FILE" \
                        && cat "${_env_file}.tmp" > "$_env_file" 2>>"$LOG_FILE" \
                        && rm -f "${_env_file}.tmp"; then
                        _env_patch_ok=false
                        warn "Failed to patch $_key in .env"
                    fi
                done
                if [[ "$_env_patch_ok" == "true" ]]; then
                    ai_ok "Patched .env for bootstrap model ($GGUF_FILE)"
                fi
            fi
        fi
    fi

    # Validate service dependencies before launching
    if [[ -f "$INSTALL_DIR/lib/service-registry.sh" && -f "$INSTALL_DIR/lib/validate-dependencies.sh" ]]; then
        . "$INSTALL_DIR/lib/service-registry.sh"
        . "$INSTALL_DIR/lib/validate-dependencies.sh"
        sr_load

        ai "Validating service dependencies..."
        if ! validate_service_dependencies; then
            ai_bad "Service dependency validation failed"
            ai "Some services depend on other services that are not enabled"
            ai "Enable required services or disable dependent services to continue"
            exit 1
        fi
        ai_ok "All service dependencies satisfied"
    fi

    # ── Compose syntax validation ──────────────────────────────
    ai "Validating compose stack configuration..."
    if ! $DOCKER_COMPOSE_CMD "${COMPOSE_FLAGS_ARR[@]}" config --quiet 1>/dev/null 2>"$LOG_FILE.compose-check"; then
        ai_bad "Compose configuration is invalid"
        ai "Check $LOG_FILE.compose-check for details"
        cat "$LOG_FILE.compose-check" >&2
        exit 1
    fi
    ai_ok "Compose configuration valid"

    # Launch containers
    dream_progress 81 "services" "Launching containers"
    echo ""
    signal "Waking the stack..."
    ai "I'm bringing systems online. You can breathe."
    echo ""
    compose_ok=false
    # Build locally-built images individually so one failure doesn't block the rest
    _build_count=0
    _build_services=(dashboard dashboard-api ape token-spy privacy-shield)
    [[ "$ENABLE_COMFYUI" == "true" ]] && _build_services+=(comfyui)
    if [[ "${ENABLE_DREAMFORGE:-}" == "true" ]]; then
        _dreamforge_image="${DREAMFORGE_IMAGE:-ghcr.io/light-heart-labs/dreamforge:v0.1.0}"
        if ! $DOCKER_CMD image inspect "$_dreamforge_image" &>/dev/null; then
            _build_services+=(dreamforge)
        else
            log "DreamForge image found locally — skipping source build"
        fi
    fi
    [[ "$GPU_BACKEND" == "amd" ]] && _build_services+=(llama-server)
    if [[ "$GPU_BACKEND" == "nvidia" && " ${_build_services[*]} " == *" comfyui "* ]]; then
        ai "ComfyUI is compiling from source for NVIDIA — this takes 25-40 minutes on first run."
    fi
    if [[ " ${_build_services[*]} " == *" dreamforge "* ]]; then
        ai "DreamForge is compiling from Rust source — this takes 15-25 minutes on first run."
    fi
    _build_total=${#_build_services[@]}
    for _svc in "${_build_services[@]}"; do
        _build_count=$((_build_count + 1))
        $DOCKER_COMPOSE_CMD "${COMPOSE_FLAGS_ARR[@]}" build --no-cache "$_svc" >> "$LOG_FILE" 2>&1 &
        _build_pid=$!
        if ! spin_task $_build_pid "[$_build_count/$_build_total] Building $_svc"; then
            printf "\r  ${AMB}⚠${NC} %-60s\n" "$_svc build failed (non-critical)"
        else
            printf "\r  ${BGRN}✓${NC} %-60s\n" "$_svc built"
        fi
    done
    # Start everything — --no-build skips services whose images failed to build.
    # Up to 3 attempts with increasing wait between retries. On AMD/Lemonade,
    # the first boot builds a cached llama-server binary which can take 3-5 min.
    for _attempt in 1 2 3; do
        $DOCKER_COMPOSE_CMD "${COMPOSE_FLAGS_ARR[@]}" up -d --no-build >> "$LOG_FILE" 2>&1 &
        compose_pid=$!
        if spin_task $compose_pid "Launching containers (attempt $_attempt/3)..."; then
            compose_ok=true
            break
        fi
        if [[ $_attempt -lt 3 ]]; then
            printf "\r  ${AMB}⚠${NC} %-60s\n" "Some services still starting..."
            ai_warn "Some containers need more time. Waiting 30s before retry..."
            sleep 30
        fi
    done
    # Safety net: when --no-build hits a missing image, compose aborts before
    # starting other containers. Some end up in "Created", others never got
    # past "Creating" because their dependencies weren't ready yet.
    # Step 1: start any containers already in Created state
    $DOCKER_CMD start $($DOCKER_CMD ps -a --filter status=created -q) 2>/dev/null || true
    # Step 2: wait for services to stabilize, then compose pass
    sleep 10
    $DOCKER_COMPOSE_CMD "${COMPOSE_FLAGS_ARR[@]}" up -d --no-build >> "$LOG_FILE" 2>&1 || true
    # Step 3: catch any stragglers from the second pass
    $DOCKER_CMD start $($DOCKER_CMD ps -a --filter status=created -q) 2>/dev/null || true

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

    # ── Bootstrap: launch background full-model download + auto hot-swap ──
    # Runs regardless of compose_ok — the download only needs disk + network.
    # bootstrap-upgrade.sh checks if Docker is running before attempting
    # hot-swap and handles it gracefully if containers aren't ready yet.
    if [[ "$_BOOTSTRAP_ACTIVE" == "true" ]]; then
        ai "Launching background download for $FULL_LLM_MODEL..."

        # Source background task tracking if not already loaded
        if ! command -v bg_task_start &>/dev/null && [[ -f "$SCRIPT_DIR/installers/lib/background-tasks.sh" ]]; then
            . "$SCRIPT_DIR/installers/lib/background-tasks.sh"
        fi

        nohup bash "$SCRIPT_DIR/scripts/bootstrap-upgrade.sh" \
            "$INSTALL_DIR" "$FULL_GGUF_FILE" "$FULL_GGUF_URL" \
            "$FULL_GGUF_SHA256" "$FULL_LLM_MODEL" "$FULL_MAX_CONTEXT" \
            "$BOOTSTRAP_GGUF_FILE" \
            > "$INSTALL_DIR/logs/model-upgrade.log" 2>&1 &
        _upgrade_pid=$!

        if command -v bg_task_start &>/dev/null; then
            bg_task_start "full-model-download" "$_upgrade_pid" \
                "Full model download: $FULL_LLM_MODEL" \
                "$INSTALL_DIR/logs/model-upgrade.log"
        fi

        log "Background model upgrade started (PID: $_upgrade_pid)"
        ai "Full model ($FULL_LLM_MODEL) downloading in background."
        ai "It will auto-swap when ready. Check progress: tail -f $INSTALL_DIR/logs/model-upgrade.log"
    fi

    dream_progress 83 "services" "Running extension setup hooks"
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
