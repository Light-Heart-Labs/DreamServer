#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 12: Health Checks
# ============================================================================
# Part of: installers/phases/
# Purpose: Verify all services are responding, configure Perplexica,
#          pre-download STT model
#
# Expects: DRY_RUN, GPU_BACKEND, ENABLE_VOICE, ENABLE_WORKFLOWS, ENABLE_RAG,
#           ENABLE_OPENCLAW, LLM_MODEL, LOG_FILE, BGRN, AMB, NC,
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

dream_progress 85 "health" "Checking service health"
show_phase 6 6 "Systems Online" "~1-2 minutes"

if $DRY_RUN; then
    log "[DRY RUN] Would verify service health:"
    log "[DRY RUN]   - llama-server, Open WebUI, Perplexica, ComfyUI"
    log "[DRY RUN]   - Auto-configure Perplexica for ${LLM_MODEL:-default model}"
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

# Core service health checks with adaptive timeouts
# Format: _check_health "name" "url" max_attempts timeout_per_request
# llama-server: 60 attempts * adaptive backoff (2s->8s) = up to 5 minutes (model loading can be slow)
dream_progress 86 "health" "Waiting for LLM engine"
_check_health "llama-server" "http://localhost:${SERVICE_PORTS[llama-server]:-8080}${SERVICE_HEALTH[llama-server]:-/health}" 60 15
# Open WebUI: 30 attempts * adaptive backoff = up to 2 minutes
dream_progress 89 "health" "Waiting for Chat UI"
_check_health "Open WebUI" "http://localhost:${SERVICE_PORTS[open-webui]:-3000}${SERVICE_HEALTH[open-webui]:-/}" 30 10
# Perplexica: 20 attempts * adaptive backoff = up to 1 minute
dream_progress 91 "health" "Waiting for Research engine"
_check_health "Perplexica" "http://localhost:${SERVICE_PORTS[perplexica]:-3004}${SERVICE_HEALTH[perplexica]:-/}" 20 10
# ComfyUI: 60 attempts * adaptive backoff = up to 5 minutes (FLUX model loading is slow)
dream_progress 93 "health" "Waiting for Image generation"
_check_health "ComfyUI" "http://localhost:${SERVICE_PORTS[comfyui]:-8188}${SERVICE_HEALTH[comfyui]:-/}" 60 15

# Perplexica auto-config: seed chat model + embedding model on first boot.
# The slim-latest image stores config in a database, not just config.json.
# We use the /api/config HTTP endpoint to set values after the service starts.
if docker inspect dream-perplexica &>/dev/null; then
    PERPLEXICA_URL="http://localhost:${SERVICE_PORTS[perplexica]:-3004}"
    PYTHON_CMD="python3"
    if [[ -f "$SCRIPT_DIR/lib/python-cmd.sh" ]]; then
        . "$SCRIPT_DIR/lib/python-cmd.sh"
        PYTHON_CMD="$(ds_detect_python_cmd)"
    elif command -v python >/dev/null 2>&1; then
        PYTHON_CMD="python"
    fi

    PERPLEXICA_SETUP=$(curl -sf "${PERPLEXICA_URL}/api/config" 2>/dev/null | \
        "$PYTHON_CMD" -c "import sys,json;d=json.load(sys.stdin);print('done' if d['values']['setupComplete'] else 'needed')" 2>/dev/null || echo "skip")

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

# Seed the chat model into the OpenAI provider
openai_prov['chatModels'] = [{'key': model, 'name': model}]
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
[[ "$ENABLE_OPENCLAW" == "true" ]] && _check_health "OpenClaw" "http://localhost:${SERVICE_PORTS[openclaw]:-7860}${SERVICE_HEALTH[openclaw]:-/}" 20 10
systemctl is-active opencode-web &>/dev/null && _check_health "OpenCode Web" "http://localhost:3003/" 10 5
# Whisper: 40 attempts * adaptive backoff = up to 3 minutes (model download on first start)
dream_progress 95 "health" "Checking voice services"
[[ "$ENABLE_VOICE" == "true" ]] && _check_health "Whisper (STT)" "http://localhost:${SERVICE_PORTS[whisper]:-9000}${SERVICE_HEALTH[whisper]:-/health}" 40 10
[[ "$ENABLE_VOICE" == "true" ]] && _check_health "Kokoro (TTS)" "http://localhost:${SERVICE_PORTS[tts]:-8880}${SERVICE_HEALTH[tts]:-/health}" 20 10

# Pre-download the Whisper STT model so first transcription is instant.
# Speaches lazy-downloads on first request, but that causes a long delay +
# a 404 if the model isn't cached yet. Trigger the download now.
if [[ "$ENABLE_VOICE" == "true" ]]; then
    if [[ "$GPU_BACKEND" == "nvidia" ]]; then
        STT_MODEL="deepdml/faster-whisper-large-v3-turbo-ct2"
    else
        STT_MODEL="Systran/faster-whisper-base"
    fi
    STT_MODEL_ENCODED="${STT_MODEL//\//%2F}"
    WHISPER_URL="http://localhost:${SERVICE_PORTS[whisper]:-9000}"
    # Only download if model isn't already loaded
    if ! curl -sf --max-time 10 "${WHISPER_URL}/v1/models/${STT_MODEL_ENCODED}" &>/dev/null; then
        ai "Downloading STT model (${STT_MODEL})..."
        curl -sf --max-time 120 -X POST "${WHISPER_URL}/v1/models/${STT_MODEL_ENCODED}" >> "$LOG_FILE" 2>&1 && \
            printf "\r  ${BGRN}✓${NC} %-60s\n" "STT model cached (${STT_MODEL})" || \
            printf "\r  ${AMB}⚠${NC} %-60s\n" "STT model will download on first use"
    else
        printf "\r  ${BGRN}✓${NC} %-60s\n" "STT model already cached (${STT_MODEL})"
    fi
fi

dream_progress 96 "health" "Checking workflow and RAG services"
[[ "$ENABLE_WORKFLOWS" == "true" ]] && _check_health "n8n" "http://localhost:${SERVICE_PORTS[n8n]:-5678}${SERVICE_HEALTH[n8n]:-/healthz}" 20 10
[[ "$ENABLE_RAG" == "true" ]] && _check_health "Qdrant" "http://localhost:${SERVICE_PORTS[qdrant]:-6333}${SERVICE_HEALTH[qdrant]:-/}" 20 10

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
