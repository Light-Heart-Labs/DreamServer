#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 12: Health Checks
# ============================================================================
# Part of: installers/phases/
# Purpose: Verify all services are responding, configure Perplexica,
#          pre-download STT model
#
# Expects: DRY_RUN, GPU_BACKEND, ENABLE_VOICE, ENABLE_WORKFLOWS, ENABLE_RAG,
#           ENABLE_HERMES, ENABLE_OPENCLAW, LLM_MODEL, LOG_FILE, BGRN, AMB, NC,
#           WHISPER_PORT, TTS_PORT, OPENCLAW_PORT,
#           PERPLEXICA_PORT (:-3004), COMFYUI_PORT (:-8188),
#           show_phase(), check_service(), ai(), ai_ok(), ai_warn(), signal()
# Provides: Health check results, Perplexica auto-configuration
#
# Modder notes:
#   Add new service health checks or auto-configuration here.
# ============================================================================

# Source service registry for port/health resolution
. "$SCRIPT_DIR/lib/service-registry.sh"
sr_load

# Resolve port overrides from .env (SERVICE_PORTS uses manifest defaults
# but .env may override them, e.g. OLLAMA_PORT=11434 on Strix Halo)
if [[ -f "$INSTALL_DIR/.env" ]]; then
    . "$SCRIPT_DIR/lib/safe-env.sh" 2>/dev/null || true
    load_env_file "$INSTALL_DIR/.env"
    sr_resolve_ports
fi

dream_progress 85 "health" "Checking service health"
show_phase 6 6 "Systems Online" "~1-2 minutes"

if $DRY_RUN; then
    log "[DRY RUN] Would verify service health:"
    log "[DRY RUN]   - llama-server, Open WebUI, Perplexica, ComfyUI"
    log "[DRY RUN]   - Auto-configure Perplexica for ${LLM_MODEL:-default model}"
    [[ "$ENABLE_HERMES" == "true" ]] && log "[DRY RUN]   - Hermes Agent + hermes-proxy"
    [[ "$ENABLE_OPENCLAW" == "true" ]] && log "[DRY RUN]   - OpenClaw"
    [[ "$ENABLE_VOICE" == "true" ]] && log "[DRY RUN]   - Whisper (STT), Kokoro (TTS), pre-download STT model"
    [[ "$ENABLE_WORKFLOWS" == "true" ]] && log "[DRY RUN]   - n8n"
    [[ "$ENABLE_RAG" == "true" ]] && log "[DRY RUN]   - Qdrant"
    echo ""
    signal "All systems nominal. (dry run)"
    ai_ok "Sovereign intelligence is online. (dry run)"
    return 0 2>/dev/null || true
fi

ai "Linking services... standby."

sleep 5

# Health checks are best-effort — track failures but don't let set -e kill the install.
# Services may need more startup time; we report all failures at the end.
HEALTH_FAILURES=0
_check_health() {
    if ! check_service "$@"; then
        HEALTH_FAILURES=$((HEALTH_FAILURES + 1))
    fi
}

_check_container_health() {
    local name=$1
    local container_name=$2
    local max_attempts=${3:-60}
    local docker_cmd="${DOCKER_CMD:-docker}"
    local -a docker_cmd_arr=()
    read -r -a docker_cmd_arr <<< "$docker_cmd"
    [[ ${#docker_cmd_arr[@]} -gt 0 ]] || docker_cmd_arr=(docker)

    printf "  ${GRN}...${NC} Waiting for %-20s " "$name"
    for attempt in $(seq 1 "$max_attempts"); do
        local state=""
        state=$("${docker_cmd_arr[@]}" inspect --format '{{.State.Status}}' "$container_name" 2>/dev/null || echo "missing")
        case "$state" in
            exited|dead|missing)
                printf "\r  ${RED}ERR${NC} %-55s\n" "$name container $state"
                ai_warn "$name container is $state; not retrying health probe."
                return 1
                ;;
        esac

        local health=""
        health=$("${docker_cmd_arr[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_name" 2>/dev/null || echo "missing")
        case "$health" in
            healthy)
                printf "\r  ${BGRN}OK${NC} %-56s\n" "$name healthy"
                return 0
                ;;
            running)
                # No Docker healthcheck declared. Treat running as good enough.
                printf "\r  ${BGRN}OK${NC} %-56s\n" "$name running"
                return 0
                ;;
        esac

        sleep 5
    done

    printf "\r  ${AMB}WARN${NC} %-54s\n" "$name delayed (container health not healthy yet)"
    ai_warn "$name container health is not healthy yet. I will continue."
    return 1
}

# Core service health checks with adaptive timeouts
# Format: _check_health "name" "url" max_attempts timeout_per_request
# llama-server: 150 attempts * adaptive backoff (2s->8s) = up to ~20 minutes (model loading can be slow)
dream_progress 86 "health" "Waiting for LLM engine"
_check_health "llama-server" "http://127.0.0.1:${SERVICE_PORTS[llama-server]:-8080}${SERVICE_HEALTH[llama-server]:-/health}" 150 15 "$(sr_container llama-server)"
# Open WebUI: 150 attempts * adaptive backoff = up to ~20 minutes
dream_progress 89 "health" "Waiting for Chat UI"
_check_health "Open WebUI" "http://127.0.0.1:${SERVICE_PORTS[open-webui]:-3000}${SERVICE_HEALTH[open-webui]:-/}" 150 10 "$(sr_container open-webui)"
# Perplexica: 150 attempts * adaptive backoff = up to ~20 minutes
dream_progress 91 "health" "Waiting for Research engine"
_check_health "Perplexica" "http://127.0.0.1:${SERVICE_PORTS[perplexica]:-3004}${SERVICE_HEALTH[perplexica]:-/}" 150 10 "$(sr_container perplexica)"
# ComfyUI: 150 attempts * adaptive backoff = up to ~20 minutes (FLUX model loading is slow)
if [[ "$ENABLE_COMFYUI" == "true" ]]; then
    dream_progress 93 "health" "Waiting for Image generation"
    _check_health "ComfyUI" "http://127.0.0.1:${SERVICE_PORTS[comfyui]:-8188}${SERVICE_HEALTH[comfyui]:-/}" 150 15 "$(sr_container comfyui)"
fi
# Embeddings (TEI): model load on first run can take 1-2 minutes after start_period
if [[ "$ENABLE_RAG" == "true" ]]; then
    dream_progress 94 "health" "Waiting for Embeddings"
    _check_health "embeddings" "http://127.0.0.1:${SERVICE_PORTS[embeddings]:-7860}${SERVICE_HEALTH[embeddings]:-/health}" 30 10 "$(sr_container embeddings)"
fi

# Perplexica auto-config: seed chat model + embedding model on first boot.
# The slim-latest image stores config in a database, not just config.json.
# We use the /api/config HTTP endpoint to set values after the service starts.
# Retry up to 5 times with 10s delay — Perplexica may still be starting
# (especially if it was stuck in "Created" state and started late).
if $DOCKER_CMD inspect dream-perplexica &>/dev/null; then
    PERPLEXICA_URL="http://127.0.0.1:${SERVICE_PORTS[perplexica]:-3004}"
    PYTHON_CMD="python3"
    if [[ -f "$SCRIPT_DIR/lib/python-cmd.sh" ]]; then
        . "$SCRIPT_DIR/lib/python-cmd.sh"
        PYTHON_CMD="$(ds_detect_python_cmd)"
    elif command -v python >/dev/null 2>&1; then
        PYTHON_CMD="python"
    fi

    PERPLEXICA_SETUP="skip"
    for _attempt in 1 2 3 4 5; do
        PERPLEXICA_SETUP=$(curl -sf --max-time 5 "${PERPLEXICA_URL}/api/config" 2>/dev/null | \
            "$PYTHON_CMD" -c "import sys,json;d=json.load(sys.stdin);print('done' if d['values']['setupComplete'] else 'needed')" 2>/dev/null || echo "skip")
        [[ "$PERPLEXICA_SETUP" != "skip" ]] && break
        [[ $_attempt -lt 5 ]] && sleep 10
    done

    if [[ "$PERPLEXICA_SETUP" == "needed" ]]; then
        ai "Configuring Perplexica for ${LLM_MODEL}..."
        # Query current config to get provider UUIDs, then set model + preferences via API
        curl -sf "${PERPLEXICA_URL}/api/config" 2>/dev/null | \
        "$PYTHON_CMD" -c "
import sys, json, urllib.request

config = json.load(sys.stdin)['values']
providers = config.get('modelProviders', [])
openai_prov = next((p for p in providers if p['type'] == 'openai'), None)
transformers_prov = next((p for p in providers if p['type'] == 'transformers'), None)

if not openai_prov:
    print('no-openai-provider')
    sys.exit(1)

url = '${PERPLEXICA_URL}/api/config'
model = '${LLM_MODEL}'

def post(key, value):
    data = json.dumps({'key': key, 'value': value}).encode()
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
    urllib.request.urlopen(req)

# Seed the chat model into the OpenAI provider and set auth config
openai_prov['chatModels'] = [{'key': model, 'name': model}]
openai_prov['config'] = {
    'apiKey': '${LITELLM_KEY:-no-key}',
    'baseURL': '${LLM_API_URL:-http://llama-server:8080}/v1'
}
post('modelProviders', providers)

# Set default providers and models
post('preferences', {
    'defaultChatProvider': openai_prov['id'],
    'defaultChatModel': model,
    'defaultEmbeddingProvider': transformers_prov['id'] if transformers_prov else openai_prov['id'],
    'defaultEmbeddingModel': 'Xenova/all-MiniLM-L6-v2'
})

# Mark setup complete to bypass the wizard
post('setupComplete', True)
print('ok')
" >> "$LOG_FILE" 2>&1 && \
            printf "\r  ${BGRN}✓${NC} %-60s\n" "Perplexica configured (model: ${LLM_MODEL})" || \
            printf "\r  ${AMB}⚠${NC} %-60s\n" "Perplexica config — complete setup at :${PERPLEXICA_PORT:-3004}"
    fi
fi

# Extension service health checks with adaptive timeouts
dream_progress 94 "health" "Checking extension services"
# Hermes is intentionally internal-only: its port is exposed only inside the
# Docker network, not bound to the host. Wait on the container healthcheck
# instead of curling localhost:9119, which would fail on a correct install.
if [[ "$ENABLE_HERMES" == "true" ]]; then
    if ! _check_container_health "Hermes Agent" "$(sr_container hermes)" 60; then
        HEALTH_FAILURES=$((HEALTH_FAILURES + 1))
    fi
fi
# hermes-proxy is the LAN-facing entry and has an anonymous /health endpoint.
[[ "$ENABLE_HERMES" == "true" ]] && _check_health "Hermes Proxy" "http://127.0.0.1:${SERVICE_PORTS[hermes-proxy]:-9120}${SERVICE_HEALTH[hermes-proxy]:-/health}" 60 5 "$(sr_container hermes-proxy)"
[[ "$ENABLE_OPENCLAW" == "true" ]] && _check_health "OpenClaw" "http://127.0.0.1:${SERVICE_PORTS[openclaw]:-7860}${SERVICE_HEALTH[openclaw]:-/}" 150 10 "$(sr_container openclaw)"
systemctl --user is-active opencode-web &>/dev/null && _check_health "OpenCode Web" "http://127.0.0.1:3003/" 10 5
# Whisper: 150 attempts * adaptive backoff = up to ~20 minutes (model download on first start)
dream_progress 95 "health" "Checking voice services"
[[ "$ENABLE_VOICE" == "true" ]] && _check_health "Whisper (STT)" "http://127.0.0.1:${SERVICE_PORTS[whisper]:-9000}${SERVICE_HEALTH[whisper]:-/health}" 150 10 "$(sr_container whisper)"
[[ "$ENABLE_VOICE" == "true" ]] && _check_health "Kokoro (TTS)" "http://127.0.0.1:${SERVICE_PORTS[tts]:-8880}${SERVICE_HEALTH[tts]:-/health}" 150 10 "$(sr_container tts)"

# Pre-download the Whisper STT model so first transcription is instant.
# Speaches does NOT auto-download on transcription requests — it returns 404.
# We must trigger the download explicitly here, verify it completed, and
# surface a clear recovery command if anything fails.
if [[ "$ENABLE_VOICE" == "true" ]]; then
    # Prefer AUDIO_STT_MODEL from .env (written by Phase 06). Fall back to the
    # GPU_BACKEND switch for backward compat with older .env files missing it.
    if [[ -n "${AUDIO_STT_MODEL:-}" ]]; then
        STT_MODEL="$AUDIO_STT_MODEL"
    elif [[ "$GPU_BACKEND" == "nvidia" ]]; then
        STT_MODEL="deepdml/faster-whisper-large-v3-turbo-ct2"
    else
        STT_MODEL="Systran/faster-whisper-base"
    fi
    STT_MODEL_ENCODED="${STT_MODEL//\//%2F}"
    WHISPER_PORT_RESOLVED="${SERVICE_PORTS[whisper]:-9000}"
    WHISPER_URL="http://127.0.0.1:${WHISPER_PORT_RESOLVED}"
    STT_RECOVERY_CMD="curl --max-time 3600 -X POST ${WHISPER_URL}/v1/models/${STT_MODEL_ENCODED}"

    # Step 1: wait briefly for the models API to be ready. Whisper's /health
    # endpoint can pass before the models endpoint responds, so we probe
    # GET /v1/models with a short retry loop (max 15s total).
    _stt_api_ready=false
    for _i in $(seq 1 15); do
        if curl -sf --max-time 2 "${WHISPER_URL}/v1/models" &>/dev/null; then
            _stt_api_ready=true
            break
        fi
        sleep 1
    done

    if ! $_stt_api_ready; then
        printf "\r  ${AMB}⚠${NC} %-60s\n" "STT models API not ready — download manually:"
        printf "      %s\n" "$STT_RECOVERY_CMD"
    # Step 2: skip download if already cached.
    elif curl -sf --max-time 10 "${WHISPER_URL}/v1/models/${STT_MODEL_ENCODED}" &>/dev/null; then
        printf "\r  ${BGRN}✓${NC} %-60s\n" "STT model already cached (${STT_MODEL})"
    else
        # Step 3: POST to trigger download. Log stdout/stderr to install log.
        ai "Downloading STT model (${STT_MODEL})..."
        curl -s --max-time 3600 -X POST "${WHISPER_URL}/v1/models/${STT_MODEL_ENCODED}" \
            >> "$LOG_FILE" 2>&1

        # Step 4: verify the model is actually cached. POST can return 200
        # even if the download partially fails, so this GET is the real test.
        if curl -sf --max-time 10 "${WHISPER_URL}/v1/models/${STT_MODEL_ENCODED}" &>/dev/null; then
            printf "\r  ${BGRN}✓${NC} %-60s\n" "STT model cached (${STT_MODEL})"
        else
            printf "\r  ${AMB}⚠${NC} %-60s\n" "STT model download failed — run manually:"
            printf "      %s\n" "$STT_RECOVERY_CMD"
            printf "      %s\n" "See $LOG_FILE for details."
        fi
    fi
fi

dream_progress 96 "health" "Checking workflow and RAG services"
[[ "$ENABLE_WORKFLOWS" == "true" ]] && _check_health "n8n" "http://127.0.0.1:${SERVICE_PORTS[n8n]:-5678}${SERVICE_HEALTH[n8n]:-/healthz}" 150 10 "$(sr_container n8n)"
[[ "$ENABLE_RAG" == "true" ]] && _check_health "Qdrant" "http://127.0.0.1:${SERVICE_PORTS[qdrant]:-6333}${SERVICE_HEALTH[qdrant]:-/}" 150 10 "$(sr_container qdrant)"
[[ "${ENABLE_DREAMFORGE:-}" == "true" ]] && _check_health "DreamForge" "http://127.0.0.1:${SERVICE_PORTS[dreamforge]:-3010}${SERVICE_HEALTH[dreamforge]:-/health}" 150 10 "$(sr_container dreamforge)"

dream_progress 97 "health" "Health checks complete"
echo ""
if [[ "$HEALTH_FAILURES" -gt 0 ]]; then
    ai_warn "${HEALTH_FAILURES} service(s) did not pass health checks."
    ai_warn "Some services may still be starting. Check with: dream status"
    ai_warn "Logs: docker compose logs <service-name>"
else
    signal "All systems nominal."
    ai_ok "Sovereign intelligence is online."
fi
