#!/bin/bash
# ============================================================================
# bootstrap-upgrade.sh — Background Model Download + Auto Hot-Swap
# ============================================================================
# Runs in the background after the installer starts services with the
# bootstrap model. Downloads the full tier-appropriate model, then swaps
# llama-server to the new model with minimal downtime.
#
# Usage (called by phase 11, not directly by users):
#   nohup bash bootstrap-upgrade.sh \
#       <install_dir> <gguf_file> <gguf_url> <gguf_sha256> \
#       <llm_model> <max_context> \
#       > logs/model-upgrade.log 2>&1 &
#
# On failure: logs the error and exits. The bootstrap model continues
# running — the user can retry via re-running the installer.
# ============================================================================

set -uo pipefail
# Note: no set -e — we handle errors explicitly to avoid killing the
# background process on transient failures.

# ── Arguments ──
INSTALL_DIR="$1"
FULL_GGUF_FILE="$2"
FULL_GGUF_URL="$3"
FULL_GGUF_SHA256="$4"
FULL_LLM_MODEL="$5"
FULL_MAX_CONTEXT="$6"

MODELS_DIR="$INSTALL_DIR/data/models"
ENV_FILE="$INSTALL_DIR/.env"
MODELS_INI="$INSTALL_DIR/config/llama-server/models.ini"
LOG_TAG="[BOOTSTRAP-UPGRADE]"

log()  { echo "$LOG_TAG $(date '+%H:%M:%S') $*"; }
fail() { log "ERROR: $*"; exit 1; }

STATUS_FILE="$INSTALL_DIR/data/bootstrap-status.json"

# Cross-platform file size (GNU stat on Linux/WSL2, BSD stat on macOS)
# IMPORTANT: Try GNU stat -c %s FIRST (Linux). stat -f on Linux returns filesystem
# block count (not file size). BSD stat -f %z is the macOS fallback.
file_size() {
    if stat -c %s "$1" 2>/dev/null; then
        return
    fi
    stat -f %z "$1" 2>/dev/null || echo 0
}

# Get total size via HTTP HEAD request
get_remote_size() {
    local url="$1"
    curl -sI -L --connect-timeout 10 "$url" 2>/dev/null \
        | grep -i '^content-length:' | tail -1 | tr -dc '0-9'
}

# Write status JSON (atomic via mv)
write_status() {
    local status="$1" percent="${2:-}" downloaded="${3:-0}" total="${4:-0}" speed="${5:-0}" eta="${6:-}"
    local _safe_model="${FULL_GGUF_FILE//\"/\\\"}"
    cat > "$STATUS_FILE.tmp" << STATUSEOF
{
  "status": "$status",
  "model": "$_safe_model",
  "percent": ${percent:-null},
  "bytesDownloaded": $downloaded,
  "bytesTotal": $total,
  "speedBytesPerSec": $speed,
  "eta": "${eta:-}",
  "updatedAt": "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date '+%Y-%m-%dT%H:%M:%SZ')"
}
STATUSEOF
    mv "$STATUS_FILE.tmp" "$STATUS_FILE"
}

# Background monitor: polls .part file size every 2s
monitor_download() {
    local part_file="$1" total_bytes="$2"

    # Wait for curl to create the .part file (up to 30s)
    for _wait in $(seq 1 30); do
        [[ -f "$part_file" ]] && break
        sleep 1
    done
    [[ -f "$part_file" ]] || return 0

    local prev_bytes=0 prev_time
    prev_time=$(date +%s)

    while [[ -f "$part_file" ]]; do
        sleep 2
        [[ -f "$part_file" ]] || break

        local current_bytes
        current_bytes=$(file_size "$part_file")
        local now
        now=$(date +%s)
        local elapsed=$((now - prev_time))

        local speed=0
        if [[ $elapsed -gt 0 && $current_bytes -ge $prev_bytes ]]; then
            speed=$(( (current_bytes - prev_bytes) / elapsed ))
        fi

        local percent="null"
        local eta=""
        if [[ $total_bytes -gt 0 ]]; then
            percent=$(awk "BEGIN { printf \"%.1f\", ($current_bytes / $total_bytes) * 100 }")
            if [[ $speed -gt 0 ]]; then
                local remaining=$(( total_bytes - current_bytes ))
                local eta_secs=$(( remaining / speed ))
                local eta_min=$(( eta_secs / 60 ))
                local eta_sec=$(( eta_secs % 60 ))
                eta="${eta_min}m ${eta_sec}s"
            else
                eta="calculating..."
            fi
        fi

        write_status "downloading" "$percent" "$current_bytes" "$total_bytes" "$speed" "$eta"
        prev_bytes=$current_bytes
        prev_time=$now
    done
}

log "Starting full model download: $FULL_GGUF_FILE"
log "URL: $FULL_GGUF_URL"
log "Target: $MODELS_DIR/$FULL_GGUF_FILE"

# ── Phase 1: Download the full model ──
mkdir -p "$MODELS_DIR"

# Get total file size for progress calculation
TOTAL_BYTES=$(get_remote_size "$FULL_GGUF_URL")
[[ -z "$TOTAL_BYTES" ]] && TOTAL_BYTES=0
log "Expected file size: $TOTAL_BYTES bytes"

# Write initial status
write_status "starting" "" 0 "$TOTAL_BYTES" 0 "calculating..."

if [[ -f "$MODELS_DIR/$FULL_GGUF_FILE" ]]; then
    log "Full model already exists on disk, skipping download"
    write_status "complete"
else
    # Start background download monitor
    monitor_download "$MODELS_DIR/$FULL_GGUF_FILE.part" "$TOTAL_BYTES" &
    _monitor_pid=$!
    trap 'kill $_monitor_pid 2>/dev/null || true; write_status "failed"; exit 1' EXIT TERM INT

    # Download with resume support, retry up to 3 times
    _dl_success=false
    for _attempt in 1 2 3; do
        [[ $_attempt -gt 1 ]] && log "Retry attempt $_attempt of 3..." && sleep 5
        if curl -fSL -C - --connect-timeout 30 --max-time 3600 \
                -o "$MODELS_DIR/$FULL_GGUF_FILE.part" "$FULL_GGUF_URL" 2>&1; then
            mv "$MODELS_DIR/$FULL_GGUF_FILE.part" "$MODELS_DIR/$FULL_GGUF_FILE"
            _dl_success=true
            break
        fi
        log "Download attempt $_attempt failed"
    done

    # Stop background monitor
    kill $_monitor_pid 2>/dev/null || true
    trap - EXIT TERM INT

    if [[ "$_dl_success" != "true" ]]; then
        rm -f "$MODELS_DIR/$FULL_GGUF_FILE.part"
        write_status "failed"
        fail "Download failed after 3 attempts. Bootstrap model will continue running."
    fi

    write_status "complete"
    log "Download complete: $FULL_GGUF_FILE"
fi

# ── Phase 2: Verify integrity (if SHA256 provided) ──
if [[ -n "$FULL_GGUF_SHA256" ]]; then
    write_status "verifying" 100 "$TOTAL_BYTES" "$TOTAL_BYTES" 0 ""
    log "Verifying SHA256..."
    if command -v sha256sum &>/dev/null; then
        ACTUAL_HASH=$(sha256sum "$MODELS_DIR/$FULL_GGUF_FILE" 2>/dev/null | awk '{print $1}')
    elif command -v shasum &>/dev/null; then
        ACTUAL_HASH=$(shasum -a 256 "$MODELS_DIR/$FULL_GGUF_FILE" 2>/dev/null | awk '{print $1}')
    else
        log "WARNING: No checksum tool available — skipping SHA256 verification"
        ACTUAL_HASH=""
    fi
    if [[ -n "$ACTUAL_HASH" ]]; then
        if [[ "$ACTUAL_HASH" != "$FULL_GGUF_SHA256" ]]; then
            rm -f "$MODELS_DIR/$FULL_GGUF_FILE"
            write_status "failed"
            fail "SHA256 mismatch (expected: $FULL_GGUF_SHA256, got: $ACTUAL_HASH). Deleted corrupt file."
        fi
        log "SHA256 verified"
    fi
    write_status "complete"
fi

# ── Phase 3: Update .env ──
log "Updating .env..."
if [[ -f "$ENV_FILE" ]]; then
    # Update GGUF_FILE
    if grep -q '^GGUF_FILE=' "$ENV_FILE"; then
        awk -v v="$FULL_GGUF_FILE" '{ if (index($0, "GGUF_FILE=") == 1) print "GGUF_FILE=" v; else print }' \
            "$ENV_FILE" > "${ENV_FILE}.tmp" && cat "${ENV_FILE}.tmp" > "$ENV_FILE" && rm -f "${ENV_FILE}.tmp"
    fi
    # Update LLM_MODEL
    if grep -q '^LLM_MODEL=' "$ENV_FILE"; then
        awk -v v="$FULL_LLM_MODEL" '{ if (index($0, "LLM_MODEL=") == 1) print "LLM_MODEL=" v; else print }' \
            "$ENV_FILE" > "${ENV_FILE}.tmp" && cat "${ENV_FILE}.tmp" > "$ENV_FILE" && rm -f "${ENV_FILE}.tmp"
    fi
    # Update MAX_CONTEXT / CTX_SIZE
    if grep -q '^MAX_CONTEXT=' "$ENV_FILE"; then
        awk -v v="$FULL_MAX_CONTEXT" '{ if (index($0, "MAX_CONTEXT=") == 1) print "MAX_CONTEXT=" v; else print }' \
            "$ENV_FILE" > "${ENV_FILE}.tmp" && cat "${ENV_FILE}.tmp" > "$ENV_FILE" && rm -f "${ENV_FILE}.tmp"
    fi
    if grep -q '^CTX_SIZE=' "$ENV_FILE"; then
        awk -v v="$FULL_MAX_CONTEXT" '{ if (index($0, "CTX_SIZE=") == 1) print "CTX_SIZE=" v; else print }' \
            "$ENV_FILE" > "${ENV_FILE}.tmp" && cat "${ENV_FILE}.tmp" > "$ENV_FILE" && rm -f "${ENV_FILE}.tmp"
    fi
    log ".env updated"
else
    fail ".env not found at $ENV_FILE"
fi

# ── Phase 4: Update models.ini ──
log "Updating models.ini..."
mkdir -p "$(dirname "$MODELS_INI")"
cat > "$MODELS_INI" << EOF
[${FULL_LLM_MODEL}]
filename = ${FULL_GGUF_FILE}
load-on-startup = true
n-ctx = ${FULL_MAX_CONTEXT}
EOF
log "models.ini updated"

# ── Phase 4b: Remove bootstrap model ──
# Lemonade's --extra-models-dir auto-discovers all GGUFs in /models and may
# load the bootstrap model instead of the full one specified in models.ini.
# Remove the bootstrap file to prevent this.
BOOTSTRAP_GGUF="Qwen3.5-2B-Q4_K_M.gguf"
BOOTSTRAP_PATH="$MODELS_DIR/$BOOTSTRAP_GGUF"
if [[ -f "$BOOTSTRAP_PATH" && "$FULL_GGUF_FILE" != "$BOOTSTRAP_GGUF" ]]; then
    log "Removing bootstrap model: $BOOTSTRAP_GGUF"
    rm -f "$BOOTSTRAP_PATH"
    log "Bootstrap model removed"
fi

# ── Phase 5: Hot-swap llama-server (if running) ──
# Read OLLAMA_PORT from .env (nohup doesn't inherit env vars from parent)
if [[ -f "$ENV_FILE" ]]; then
    OLLAMA_PORT=$(grep -E '^OLLAMA_PORT=' "$ENV_FILE" | cut -d= -f2)
fi

if command -v docker &>/dev/null && docker ps --filter name=dream-llama-server --format '{{.Names}}' 2>/dev/null | grep -q dream-llama-server; then
    log "Restarting llama-server with full model..."

    # Read GPU backend from .env (needed for health endpoint and restart strategy)
    _gpu_backend=""
    if [[ -f "$ENV_FILE" ]]; then
        _gpu_backend=$(grep -E '^GPU_BACKEND=' "$ENV_FILE" | cut -d= -f2 | tr -d '"'"'")
    fi

    # Detect compose files
    COMPOSE_ARGS=()
    if [[ -f "$INSTALL_DIR/.compose-flags" ]]; then
        read -ra COMPOSE_ARGS <<< "$(cat "$INSTALL_DIR/.compose-flags")"
    elif [[ -f "$INSTALL_DIR/docker-compose.base.yml" ]]; then
        COMPOSE_ARGS=(-f "$INSTALL_DIR/docker-compose.base.yml")
        case "${_gpu_backend}" in
            nvidia) [[ -f "$INSTALL_DIR/docker-compose.nvidia.yml" ]] && COMPOSE_ARGS+=(-f "$INSTALL_DIR/docker-compose.nvidia.yml") ;;
            amd)    [[ -f "$INSTALL_DIR/docker-compose.amd.yml" ]]    && COMPOSE_ARGS+=(-f "$INSTALL_DIR/docker-compose.amd.yml") ;;
            apple)  [[ -f "$INSTALL_DIR/docker-compose.apple.yml" ]]  && COMPOSE_ARGS+=(-f "$INSTALL_DIR/docker-compose.apple.yml") ;;
            # cpu or unknown: base only, no GPU overlay
        esac
    fi

    cd "$INSTALL_DIR" || fail "Cannot cd to $INSTALL_DIR"

    # Restart llama-server — strategy depends on GPU backend:
    # - AMD (Lemonade): use 'restart' to preserve cached llama-server build.
    #   Lemonade reads models.ini at startup, so it picks up the new model.
    # - NVIDIA/CPU (llama.cpp): use 'stop + up -d' to recreate the container.
    #   The model path is in the compose command (--model /models/${GGUF_FILE}),
    #   which is only resolved from .env when the container is created.
    log "Restarting llama-server container (backend: ${_gpu_backend:-unknown})..."
    if [[ "$_gpu_backend" == "amd" ]]; then
        # Lemonade: restart preserves cached binary, reads models.ini on boot
        if [[ ${#COMPOSE_ARGS[@]} -gt 0 ]]; then
            docker compose "${COMPOSE_ARGS[@]}" restart llama-server 2>&1 || true
        else
            docker restart dream-llama-server 2>&1 || true
        fi
    else
        # llama.cpp: recreate to pick up new GGUF_FILE from .env
        if [[ ${#COMPOSE_ARGS[@]} -gt 0 ]]; then
            docker compose "${COMPOSE_ARGS[@]}" stop llama-server 2>&1 || true
            docker compose "${COMPOSE_ARGS[@]}" up -d llama-server 2>&1 || true
        else
            docker stop dream-llama-server 2>&1 || true
            docker start dream-llama-server 2>&1 || true
        fi
    fi

    # Pick health endpoint based on GPU backend — Lemonade (AMD) serves
    # /api/v1/health, llama.cpp (NVIDIA/Apple/CPU) serves /health.
    if [[ "$_gpu_backend" == "amd" ]]; then
        _health_url="http://localhost:${OLLAMA_PORT:-8080}/api/v1/health"
    else
        _health_url="http://localhost:${OLLAMA_PORT:-8080}/health"
    fi

    # Wait for health (up to 5 minutes for the larger model to load)
    # For AMD/Lemonade: check that model_loaded is non-null in the JSON response.
    # Lemonade returns 200 with "model_loaded": null when no model is loaded yet.
    # For llama.cpp: a simple 200 check is sufficient — the server only starts
    # after loading the model specified in --model.
    log "Waiting for llama-server health at $_health_url ..."
    _healthy=false
    for _i in $(seq 1 60); do
        _resp=$(curl -sf --max-time 5 "$_health_url" 2>/dev/null || echo "")
        if [[ -n "$_resp" ]]; then
            if [[ "$_gpu_backend" == "amd" ]]; then
                # Lemonade: verify a model is actually loaded, not just "status: ok"
                if echo "$_resp" | grep -q '"model_loaded"' && ! echo "$_resp" | grep -q '"model_loaded": *null'; then
                    _healthy=true
                    break
                fi
                log "Lemonade healthy but no model loaded yet (attempt $_i/60)"
            else
                # llama.cpp: 200 means model is loaded
                _healthy=true
                break
            fi
        fi
        sleep 5
    done

    if $_healthy; then
        log "SUCCESS: llama-server is running with $FULL_LLM_MODEL"
        # Restart LiteLLM so it picks up the new model context.
        # The lemonade.yaml wildcard config passes any model name through,
        # but LiteLLM caches routing state and may hold stale model references.
        if docker ps --filter name=dream-litellm --format '{{.Names}}' 2>/dev/null | grep -q dream-litellm; then
            log "Restarting LiteLLM to pick up model change..."
            docker restart dream-litellm 2>&1 || log "WARNING: LiteLLM restart failed (non-fatal)"
        fi
    else
        log "WARNING: llama-server health check timed out. The model may still be loading."
        log "Check: docker logs dream-llama-server"
    fi
elif [[ -f "$INSTALL_DIR/data/.llama-server.pid" ]]; then
    # macOS native llama-server (Metal) — restart with new model
    log "Detected native llama-server (macOS Metal mode)"

    LLAMA_SERVER_BIN="$INSTALL_DIR/bin/llama-server"
    LLAMA_SERVER_PID_FILE="$INSTALL_DIR/data/.llama-server.pid"
    LLAMA_SERVER_LOG="$INSTALL_DIR/data/llama-server.log"

    if [[ ! -x "$LLAMA_SERVER_BIN" ]]; then
        log "WARNING: llama-server binary not found at $LLAMA_SERVER_BIN. Cannot hot-swap."
        log "Run './dream-macos.sh restart' to load the new model manually."
    else
        # Read updated model config from .env
        _gguf_file=$(grep '^GGUF_FILE=' "$ENV_FILE" | cut -d= -f2 | tr -d '"'"'")
        _ctx_size=$(grep '^CTX_SIZE=' "$ENV_FILE" | cut -d= -f2 | tr -d '"'"'" || echo "")
        [[ -z "$_ctx_size" ]] && _ctx_size=$(grep '^MAX_CONTEXT=' "$ENV_FILE" | cut -d= -f2 | tr -d '"'"'" || echo "")
        [[ -z "$_ctx_size" ]] && _ctx_size="16384"
        _model_path="$MODELS_DIR/${_gguf_file}"

        if [[ ! -f "$_model_path" ]]; then
            log "WARNING: Model file not found at $_model_path"
        else
            # Capture old model path for rollback before we kill the process
            _old_pid=$(cat "$LLAMA_SERVER_PID_FILE" 2>/dev/null | tr -d '[:space:]')
            _old_model_path=""
            if [[ -n "$_old_pid" ]] && kill -0 "$_old_pid" 2>/dev/null; then
                _old_model_path=$(ps -p "$_old_pid" -o args= 2>/dev/null | grep -oE '\-\-model [^ ]+' | awk '{print $2}') || true
            fi

            # Stop existing native llama-server
            if [[ -n "$_old_pid" ]] && kill -0 "$_old_pid" 2>/dev/null; then
                # Verify it's actually llama-server (PID could have been reused)
                if ps -p "$_old_pid" -o comm= 2>/dev/null | grep -q llama; then
                    log "Stopping native llama-server (PID $_old_pid)..."
                    kill "$_old_pid" 2>/dev/null || true
                    sleep 2
                    if kill -0 "$_old_pid" 2>/dev/null; then
                        kill -9 "$_old_pid" 2>/dev/null || true
                    fi
                else
                    log "PID $_old_pid is no longer llama-server, skipping kill"
                fi
            fi

            # Read reasoning mode from .env (default off to prevent thinking models
            # from consuming the entire token budget on internal reasoning)
            _reasoning=$(grep '^LLAMA_REASONING=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "")
            [[ -z "$_reasoning" ]] && _reasoning="off"
            case "$_reasoning" in
                off)  _reasoning_fmt="none" ;;
                on)   _reasoning_fmt="deepseek" ;;
                *)    _reasoning_fmt="$_reasoning" ;;
            esac

            # Relaunch with new model
            log "Starting native llama-server with ${_gguf_file}..."
            "$LLAMA_SERVER_BIN" \
                --host 0.0.0.0 --port 8080 \
                --model "$_model_path" \
                --ctx-size "$_ctx_size" \
                --n-gpu-layers 999 \
                --reasoning-format "$_reasoning_fmt" \
                --metrics \
                > "$LLAMA_SERVER_LOG" 2>&1 &
            _new_pid=$!
            echo "$_new_pid" > "$LLAMA_SERVER_PID_FILE"

            # Wait for health
            log "Waiting for native llama-server health..."
            _healthy=false
            for _i in $(seq 1 60); do
                if curl -sf --max-time 5 "http://127.0.0.1:8080/health" &>/dev/null; then
                    _healthy=true
                    break
                fi
                sleep 5
            done

            if $_healthy; then
                log "SUCCESS: Native llama-server running with ${_gguf_file} (PID $_new_pid)"
            else
                log "WARNING: New model failed to load. Attempting rollback..."
                kill "$_new_pid" 2>/dev/null || true
                sleep 2
                if kill -0 "$_new_pid" 2>/dev/null; then
                    kill -9 "$_new_pid" 2>/dev/null || true
                fi
                if [[ -n "${_old_model_path:-}" && -f "$_old_model_path" ]]; then
                    "$LLAMA_SERVER_BIN" \
                        --host 0.0.0.0 --port 8080 \
                        --model "$_old_model_path" \
                        --ctx-size "$_ctx_size" \
                        --n-gpu-layers 999 \
                        --reasoning-format "${_reasoning_fmt:-none}" \
                        --metrics \
                        > "$LLAMA_SERVER_LOG" 2>&1 &
                    _rollback_pid=$!
                    echo "$_rollback_pid" > "$LLAMA_SERVER_PID_FILE"
                    log "Rolled back to previous model: $(basename "$_old_model_path") (PID $_rollback_pid)"
                else
                    log "WARNING: Could not rollback — previous model not found."
                    log "Run './dream-macos.sh restart' to manually recover."
                fi
            fi
        fi
    fi
else
    log "Docker services not running. Config updated — full model will load on next start."
fi

# ── Phase 6: Restart host agent (if running) ──
# The host agent may cache stale state — restart it so it picks up the new
# model config and any updated endpoints.
if command -v systemctl &>/dev/null && systemctl --user is-active dream-host-agent.service &>/dev/null; then
    log "Restarting dream-host-agent (systemd)..."
    systemctl --user restart dream-host-agent.service 2>&1 || \
        log "WARNING: Could not restart host agent (non-fatal)"
elif [[ -f "$HOME/Library/LaunchAgents/com.dreamserver.host-agent.plist" ]]; then
    log "Restarting dream-host-agent (launchctl)..."
    launchctl kickstart -k "gui/$(id -u)/com.dreamserver.host-agent" 2>&1 || \
        log "WARNING: Could not restart host agent (non-fatal)"
fi

log "Bootstrap upgrade complete."
