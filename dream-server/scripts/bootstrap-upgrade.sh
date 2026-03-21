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

log "Starting full model download: $FULL_GGUF_FILE"
log "URL: $FULL_GGUF_URL"
log "Target: $MODELS_DIR/$FULL_GGUF_FILE"

# ── Phase 1: Download the full model ──
mkdir -p "$MODELS_DIR"

if [[ -f "$MODELS_DIR/$FULL_GGUF_FILE" ]]; then
    log "Full model already exists on disk, skipping download"
else
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

    if [[ "$_dl_success" != "true" ]]; then
        rm -f "$MODELS_DIR/$FULL_GGUF_FILE.part"
        fail "Download failed after 3 attempts. Bootstrap model will continue running."
    fi

    log "Download complete: $FULL_GGUF_FILE"
fi

# ── Phase 2: Verify integrity (if SHA256 provided) ──
if [[ -n "$FULL_GGUF_SHA256" ]] && command -v sha256sum &>/dev/null; then
    log "Verifying SHA256..."
    ACTUAL_HASH=$(sha256sum "$MODELS_DIR/$FULL_GGUF_FILE" 2>/dev/null | awk '{print $1}')
    if [[ "$ACTUAL_HASH" != "$FULL_GGUF_SHA256" ]]; then
        rm -f "$MODELS_DIR/$FULL_GGUF_FILE"
        fail "SHA256 mismatch (expected: $FULL_GGUF_SHA256, got: $ACTUAL_HASH). Deleted corrupt file."
    fi
    log "SHA256 verified"
fi

# ── Phase 3: Update .env ──
log "Updating .env..."
if [[ -f "$ENV_FILE" ]]; then
    # Update GGUF_FILE
    if grep -q '^GGUF_FILE=' "$ENV_FILE"; then
        awk -v v="$FULL_GGUF_FILE" '{ if (index($0, "GGUF_FILE=") == 1) print "GGUF_FILE=" v; else print }' \
            "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
    fi
    # Update LLM_MODEL
    if grep -q '^LLM_MODEL=' "$ENV_FILE"; then
        awk -v v="$FULL_LLM_MODEL" '{ if (index($0, "LLM_MODEL=") == 1) print "LLM_MODEL=" v; else print }' \
            "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
    fi
    # Update MAX_CONTEXT / CTX_SIZE
    if grep -q '^MAX_CONTEXT=' "$ENV_FILE"; then
        awk -v v="$FULL_MAX_CONTEXT" '{ if (index($0, "MAX_CONTEXT=") == 1) print "MAX_CONTEXT=" v; else print }' \
            "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
    fi
    if grep -q '^CTX_SIZE=' "$ENV_FILE"; then
        awk -v v="$FULL_MAX_CONTEXT" '{ if (index($0, "CTX_SIZE=") == 1) print "CTX_SIZE=" v; else print }' \
            "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
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

# ── Phase 5: Hot-swap llama-server (if running) ──
# Read OLLAMA_PORT from .env (nohup doesn't inherit env vars from parent)
if [[ -f "$ENV_FILE" ]]; then
    OLLAMA_PORT=$(grep -E '^OLLAMA_PORT=' "$ENV_FILE" | cut -d= -f2)
fi

if command -v docker &>/dev/null && docker ps --filter name=dream-llama-server --format '{{.Names}}' 2>/dev/null | grep -q dream-llama-server; then
    log "Restarting llama-server with full model..."

    # Detect compose files
    COMPOSE_ARGS=()
    if [[ -f "$INSTALL_DIR/.compose-flags" ]]; then
        read -ra COMPOSE_ARGS <<< "$(cat "$INSTALL_DIR/.compose-flags")"
    elif [[ -f "$INSTALL_DIR/docker-compose.base.yml" ]]; then
        COMPOSE_ARGS=(-f "$INSTALL_DIR/docker-compose.base.yml")
        [[ -f "$INSTALL_DIR/docker-compose.nvidia.yml" ]] && COMPOSE_ARGS+=(-f "$INSTALL_DIR/docker-compose.nvidia.yml")
        [[ -f "$INSTALL_DIR/docker-compose.amd.yml" ]] && COMPOSE_ARGS+=(-f "$INSTALL_DIR/docker-compose.amd.yml")
    fi

    cd "$INSTALL_DIR" || fail "Cannot cd to $INSTALL_DIR"

    # Stop llama-server
    if [[ ${#COMPOSE_ARGS[@]} -gt 0 ]]; then
        docker compose "${COMPOSE_ARGS[@]}" stop llama-server 2>&1 || true
        docker compose "${COMPOSE_ARGS[@]}" up -d llama-server 2>&1 || true
    else
        docker stop dream-llama-server 2>&1 || true
        docker start dream-llama-server 2>&1 || true
    fi

    # Wait for health (up to 5 minutes for the larger model to load)
    log "Waiting for llama-server health..."
    _healthy=false
    for _i in $(seq 1 60); do
        if curl -sf --max-time 5 "http://localhost:${OLLAMA_PORT:-8080}/health" &>/dev/null; then
            _healthy=true
            break
        fi
        sleep 5
    done

    if $_healthy; then
        log "SUCCESS: llama-server is running with $FULL_LLM_MODEL"
    else
        log "WARNING: llama-server health check timed out. The model may still be loading."
        log "Check: docker logs dream-llama-server"
    fi
else
    log "Docker services not running. Config updated — full model will load on next start."
fi

log "Bootstrap upgrade complete."
