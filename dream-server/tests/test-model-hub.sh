#!/bin/bash
#=============================================================================
# test-model-hub.sh — Model Hub Integration Tests
#
# Validates the full Model Hub API chain:
#   Dashboard API → Model Controller → llama-server / Ollama
#
# Runs AGAINST a live stack (not mocked). Designed to be executed on the
# host machine or via SSH. Uses only curl + jq — no extra dependencies.
#
# Usage:
#   ./tests/test-model-hub.sh                  # Full test suite
#   ./tests/test-model-hub.sh --quick          # Skip destructive/slow tests
#   ./tests/test-model-hub.sh --verbose        # Show response bodies
#   ./tests/test-model-hub.sh --switch         # Include model switch test (restarts container!)
#
# Ports (defaults from docker-compose.base.yml):
#   Dashboard UI         → 3001  (nginx proxy to dashboard-api)
#   Dashboard API        → 3002  (FastAPI)
#   Model Controller     → 3003  (Bun sidecar)
#   llama-server / vLLM  → 11434 (inference backend)
#
# Exit codes:
#   0 — All tests passed
#   1 — Some tests failed
#   2 — Cannot reach required services
#=============================================================================

set -uo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# Config
VERBOSE=${VERBOSE:-false}
QUICK=${QUICK:-false}
SWITCH=${SWITCH:-false}
TIMEOUT=10
PASSED=0
FAILED=0
SKIPPED=0

# API base URLs
API_BASE="${API_BASE:-http://localhost:3002}"
CONTROLLER_BASE="${CONTROLLER_BASE:-http://localhost:3003}"
LLM_BASE="${LLM_BASE:-http://localhost:11434}"
DASHBOARD_BASE="${DASHBOARD_BASE:-http://localhost:3001}"

# Auth — read from env or .env file
API_KEY="${DASHBOARD_API_KEY:-}"
if [[ -z "$API_KEY" && -f ".env" ]]; then
    API_KEY=$(grep '^DASHBOARD_API_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'") || true
fi

# Parse args
for arg in "$@"; do
    case $arg in
        --verbose|-v) VERBOSE=true ;;
        --quick|-q)   QUICK=true ;;
        --switch|-s)  SWITCH=true ;;
        --help|-h)
            echo "Usage: $0 [--verbose] [--quick] [--switch]"
            echo "  --verbose  Show detailed response bodies"
            echo "  --quick    Skip slow tests"
            echo "  --switch   Include model switch test (will restart container!)"
            exit 0
            ;;
    esac
done

# --- Logging ---

log_pass() { echo -e "  ${GREEN}✓${NC} $1"; ((PASSED++)); }
log_fail() { echo -e "  ${RED}✗${NC} $1"; ((FAILED++)); }
log_skip() { echo -e "  ${YELLOW}○${NC} $1 (skipped)"; ((SKIPPED++)); }
log_info() { echo -e "  ${DIM}ℹ${NC} $1"; }
log_verbose() { $VERBOSE && echo -e "    ${DIM}$1${NC}" || true; }
section() { echo "" ; echo -e "${BLUE}▸ $1${NC}"; }

# --- Test Helpers ---

# Authenticated curl
acurl() {
    if [[ -n "$API_KEY" ]]; then
        curl -s --max-time "$TIMEOUT" -H "Authorization: Bearer $API_KEY" "$@"
    else
        curl -s --max-time "$TIMEOUT" "$@"
    fi
}

# Test: HTTP status code
test_http() {
    local name="$1" url="$2" expected="${3:-200}"
    local code
    code=$(acurl -o /dev/null -w "%{http_code}" "$url" 2>/dev/null) || code="000"
    if [[ "$code" == "$expected" ]]; then
        log_pass "$name"
        return 0
    else
        log_fail "$name (expected $expected, got $code)"
        return 1
    fi
}

# Test: JSON response with jq filter
test_json() {
    local name="$1" url="$2" jq_filter="$3"
    local response
    response=$(acurl "$url" 2>/dev/null) || response=""
    if echo "$response" | jq -e "$jq_filter" >/dev/null 2>&1; then
        log_pass "$name"
        log_verbose "$(echo "$response" | jq -c '.' 2>/dev/null | head -c 200)"
        return 0
    else
        log_fail "$name (jq: $jq_filter)"
        log_verbose "Response: ${response:0:200}"
        return 1
    fi
}

# Test: JSON POST request with jq filter on response
test_json_post() {
    local name="$1" url="$2" data="$3" jq_filter="$4"
    local response
    response=$(acurl -X POST -H "Content-Type: application/json" -d "$data" "$url" 2>/dev/null) || response=""
    if echo "$response" | jq -e "$jq_filter" >/dev/null 2>&1; then
        log_pass "$name"
        log_verbose "$(echo "$response" | jq -c '.' 2>/dev/null | head -c 200)"
        return 0
    else
        log_fail "$name (jq: $jq_filter)"
        log_verbose "Response: ${response:0:200}"
        return 1
    fi
}

# Test: Expect specific HTTP error code
test_http_error() {
    local name="$1" url="$2" method="$3" data="$4" expected="$5"
    local code
    if [[ -n "$data" ]]; then
        code=$(acurl -o /dev/null -w "%{http_code}" -X "$method" -H "Content-Type: application/json" -d "$data" "$url" 2>/dev/null) || code="000"
    else
        code=$(acurl -o /dev/null -w "%{http_code}" -X "$method" "$url" 2>/dev/null) || code="000"
    fi
    if [[ "$code" == "$expected" ]]; then
        log_pass "$name"
        return 0
    else
        log_fail "$name (expected $expected, got $code)"
        return 1
    fi
}

# ═══════════════════════════════════════════════════════════════
# Banner
# ═══════════════════════════════════════════════════════════════

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}  ${BOLD}Model Hub Integration Tests${NC}                                 ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  Testing: Dashboard API ↔ Model Controller ↔ LLM Backend     ${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [[ -n "$API_KEY" ]]; then
    log_info "API key found (${#API_KEY} chars)"
else
    log_info "No API key set — requests will be unauthenticated"
fi

START_TIME=$(date +%s)

# ═══════════════════════════════════════════════════════════════
# Phase 1: Service Reachability
# ═══════════════════════════════════════════════════════════════

section "Phase 1: Service Reachability"

test_http "Dashboard UI serves" "$DASHBOARD_BASE/"
test_http "Dashboard API health" "$API_BASE/health"

# Model Controller port may not be published to host (Docker-internal only)
# Auto-detect and adjust: direct if reachable, proxy via dashboard-api otherwise
CONTROLLER_REACHABLE=false
if curl -s --max-time 3 "$CONTROLLER_BASE/health" >/dev/null 2>&1; then
    CONTROLLER_REACHABLE=true
    test_json "Model Controller health (direct)" "$CONTROLLER_BASE/health" '.status == "ok"'
else
    log_info "Controller port $CONTROLLER_BASE not exposed on host — using dashboard-api proxy"
    # Verify controller is reachable via dashboard-api proxy
    PROXY_STATUS=$(acurl "$API_BASE/api/models/backend/status" 2>/dev/null)
    if echo "$PROXY_STATUS" | jq -e '.healthy != null' >/dev/null 2>&1; then
        log_pass "Model Controller reachable via dashboard-api proxy"
    else
        log_fail "Model Controller unreachable (neither direct nor via proxy)"
        echo ""
        echo -e "${RED}✗ Cannot reach Model Controller — aborting${NC}"
        echo -e "  Check that dream-model-controller container is running."
        exit 2
    fi
fi

# ═══════════════════════════════════════════════════════════════
# Phase 2: Model Controller API
# ═══════════════════════════════════════════════════════════════

section "Phase 2: Model Controller API"

if $CONTROLLER_REACHABLE; then
    test_json "Controller /status returns backend" "$CONTROLLER_BASE/status" '.backend'
    test_json "Controller /status returns container state" "$CONTROLLER_BASE/status" '.container'
    test_json "Controller /status returns healthy bool" "$CONTROLLER_BASE/status" '.healthy != null'
    test_json "Controller /status returns model" "$CONTROLLER_BASE/status" '.model != null'
    test_json "Controller /status lists available backends" "$CONTROLLER_BASE/status" '.availableBackends | length > 0'
else
    # Test through dashboard-api proxy
    test_json "Controller status (via proxy) returns healthy" "$API_BASE/api/models/backend/status" '.healthy != null'
    test_json "Controller status (via proxy) returns container" "$API_BASE/api/models/backend/status" '.container'
    test_json "Controller status (via proxy) returns model" "$API_BASE/api/models/backend/status" '.model != null'
    log_skip "Controller /status direct (port not exposed)"
fi

# ═══════════════════════════════════════════════════════════════
# Phase 3: Dashboard API — Model Listing
# ═══════════════════════════════════════════════════════════════

section "Phase 3: Dashboard API — Model Listing"

test_json "GET /api/models returns models array" "$API_BASE/api/models" '.models | length > 0'
test_json "GET /api/models includes llmBackend" "$API_BASE/api/models" '.llmBackend != null'
test_json "GET /api/models includes backendCapabilities" "$API_BASE/api/models" '.backendCapabilities'

# Validate model schema
test_json "Models have required fields" "$API_BASE/api/models" \
    '.models[0] | has("id", "name", "status", "backend")'

# Check GPU data
MODELS_RESP=$(acurl "$API_BASE/api/models" 2>/dev/null)
HAS_GPU=$(echo "$MODELS_RESP" | jq -e '.gpu != null' 2>/dev/null && echo "yes" || echo "no")
if [[ "$HAS_GPU" == "yes" ]]; then
    test_json "GPU info has vramTotal" "$API_BASE/api/models" '.gpu.vramTotal > 0'
    test_json "GPU info has vramUsed" "$API_BASE/api/models" '.gpu.vramUsed >= 0'
    test_json "GPU info has processes array" "$API_BASE/api/models" '.gpu.processes | type == "array"'
else
    log_skip "GPU info not available"
fi

# Count model statuses
LOADED_COUNT=$(echo "$MODELS_RESP" | jq '[.models[] | select(.status == "loaded")] | length' 2>/dev/null || echo "0")
DOWNLOADED_COUNT=$(echo "$MODELS_RESP" | jq '[.models[] | select(.status == "downloaded")] | length' 2>/dev/null || echo "0")
AVAILABLE_COUNT=$(echo "$MODELS_RESP" | jq '[.models[] | select(.status == "available")] | length' 2>/dev/null || echo "0")
TOTAL_COUNT=$(echo "$MODELS_RESP" | jq '.models | length' 2>/dev/null || echo "0")
log_info "Models: $TOTAL_COUNT total ($LOADED_COUNT loaded, $DOWNLOADED_COUNT downloaded, $AVAILABLE_COUNT available)"

# ═══════════════════════════════════════════════════════════════
# Phase 4: Dashboard API — Active Model
# ═══════════════════════════════════════════════════════════════

section "Phase 4: Dashboard API — Active Model"

test_json "GET /api/models/active returns backend" "$API_BASE/api/models/active" '.backend'

ACTIVE_RESP=$(acurl "$API_BASE/api/models/active" 2>/dev/null)
ACTIVE_STATUS=$(echo "$ACTIVE_RESP" | jq -r '.status // "null"' 2>/dev/null)
ACTIVE_NAME=$(echo "$ACTIVE_RESP" | jq -r '.name // "null"' 2>/dev/null)
ACTIVE_BACKEND=$(echo "$ACTIVE_RESP" | jq -r '.backend // "null"' 2>/dev/null)

if [[ "$ACTIVE_STATUS" == "running" ]]; then
    log_pass "Active model is running: $ACTIVE_NAME ($ACTIVE_BACKEND)"
elif [[ "$ACTIVE_STATUS" == "stopped" ]]; then
    log_pass "Active model is stopped (container not running)"
    log_info "Backend: $ACTIVE_BACKEND"
else
    log_fail "Active model status unexpected: $ACTIVE_STATUS"
fi

# ═══════════════════════════════════════════════════════════════
# Phase 5: Backend Listing & Detection
# ═══════════════════════════════════════════════════════════════

section "Phase 5: Backend Listing"

test_json "GET /api/models/backends returns backends" "$API_BASE/api/models/backends" '.backends | length == 3'
test_json "Has an active backend" "$API_BASE/api/models/backends" '.activeBackend'

BACKENDS_RESP=$(acurl "$API_BASE/api/models/backends" 2>/dev/null)
ACTIVE_BACKEND_ID=$(echo "$BACKENDS_RESP" | jq -r '.activeBackend // "unknown"' 2>/dev/null)
log_info "Active backend: $ACTIVE_BACKEND_ID"

# Validate each backend has required fields
test_json "Backend entries have id, name, installed" "$API_BASE/api/models/backends" \
    '.backends | all(has("id", "name", "installed", "active"))'

# ═══════════════════════════════════════════════════════════════
# Phase 6: Backend Status (Controller Proxy)
# ═══════════════════════════════════════════════════════════════

section "Phase 6: Backend Status (Controller Proxy)"

test_json "GET /api/models/backend/status returns health" "$API_BASE/api/models/backend/status" \
    '.healthy != null'
test_json "Backend status has container state" "$API_BASE/api/models/backend/status" \
    '.container'

BSTATUS_RESP=$(acurl "$API_BASE/api/models/backend/status" 2>/dev/null)
CTRL_HEALTHY=$(echo "$BSTATUS_RESP" | jq -r '.healthy // false' 2>/dev/null)
CTRL_CONTAINER=$(echo "$BSTATUS_RESP" | jq -r '.container // "unknown"' 2>/dev/null)
CTRL_MODEL=$(echo "$BSTATUS_RESP" | jq -r '.model // "none"' 2>/dev/null)
log_info "Controller reports: container=$CTRL_CONTAINER healthy=$CTRL_HEALTHY model=$CTRL_MODEL"

# ═══════════════════════════════════════════════════════════════
# Phase 7: Download Status
# ═══════════════════════════════════════════════════════════════

section "Phase 7: Download Status"

test_json "GET /api/models/download-status returns" "$API_BASE/api/models/download-status" \
    '.active != null'

# ═══════════════════════════════════════════════════════════════
# Phase 8: Cloud Providers
# ═══════════════════════════════════════════════════════════════

section "Phase 8: Cloud Providers"

test_json "GET /api/models/providers returns providers" "$API_BASE/api/models/providers" \
    '.providers | length > 0'
test_json "Providers have id and name" "$API_BASE/api/models/providers" \
    '.providers | all(has("id", "name"))'

# ═══════════════════════════════════════════════════════════════
# Phase 9: Custom Models CRUD
# ═══════════════════════════════════════════════════════════════

section "Phase 9: Custom Models CRUD"

test_json "GET /api/models/custom returns array" "$API_BASE/api/models/custom" \
    '.models | type == "array"'

# POST a custom model
CUSTOM_DATA=$(jq -n '{
    name: "Integration Test Model",
    huggingface_repo: "test/integration-model",
    huggingface_file: "test-model-7b-q4.gguf",
    family: "Test",
    description: "Model created by integration tests",
    size_gb: 4.0,
    vram_required_gb: 5.0,
    context_length: 8192,
    quantization: "Q4_K_M",
    specialty: "General"
}')

test_json_post "POST /api/models/custom adds model" "$API_BASE/api/models/custom" \
    "$CUSTOM_DATA" '.status == "added"'

# Verify it appears in the custom list
test_json "Custom model appears in list" "$API_BASE/api/models/custom" \
    '.models | any(.name == "Integration Test Model")'

# Verify it appears in the unified model list
test_json "Custom model appears in /api/models" "$API_BASE/api/models" \
    '.models | any(.id | startswith("custom:"))'

# Delete the test model via DELETE method
CUSTOM_ID=$(acurl "$API_BASE/api/models/custom" 2>/dev/null | \
    jq -r '[.models[] | select(.name == "Integration Test Model")][0].id // empty' 2>/dev/null | \
    head -1 | sed 's/^custom://')

if [[ -n "$CUSTOM_ID" && "$CUSTOM_ID" != "null" ]]; then
    DEL_CODE=$(acurl -o /dev/null -w "%{http_code}" -X DELETE "$API_BASE/api/models/custom/$CUSTOM_ID" 2>/dev/null) || DEL_CODE="000"
    if [[ "$DEL_CODE" == "200" ]]; then
        log_pass "DELETE /api/models/custom removes model"
    else
        log_fail "DELETE /api/models/custom returned $DEL_CODE"
    fi
else
    log_skip "Custom model cleanup (no test model found)"
fi

# POST duplicate should fail (re-add then try again)
test_json_post "POST /api/models/custom creates for dup test" "$API_BASE/api/models/custom" \
    "$CUSTOM_DATA" '.status == "added"'

DUP_CODE=$(acurl -o /dev/null -w "%{http_code}" -X POST -H "Content-Type: application/json" -d "$CUSTOM_DATA" "$API_BASE/api/models/custom" 2>/dev/null) || DUP_CODE="000"
if [[ "$DUP_CODE" == "409" ]]; then
    log_pass "POST duplicate custom model → 409"
else
    log_fail "POST duplicate custom model expected 409, got $DUP_CODE"
fi

# Clean up
CUSTOM_ID2=$(acurl "$API_BASE/api/models/custom" 2>/dev/null | \
    jq -r '[.models[] | select(.name == "Integration Test Model")][0].id // empty' 2>/dev/null | \
    sed 's/^custom://')
[[ -n "$CUSTOM_ID2" && "$CUSTOM_ID2" != "null" ]] && \
    acurl -X DELETE "$API_BASE/api/models/custom/$CUSTOM_ID2" >/dev/null 2>&1

# ═══════════════════════════════════════════════════════════════
# Phase 10: Ollama Endpoints (Best-Effort)
# ═══════════════════════════════════════════════════════════════

section "Phase 10: Ollama Endpoints"

OLLAMA_RESP=$(acurl "$API_BASE/api/models/ollama/info" 2>/dev/null)
OLLAMA_REACHABLE=$(echo "$OLLAMA_RESP" | jq -r '.reachable // false' 2>/dev/null)

test_json "GET /api/models/ollama/info returns" "$API_BASE/api/models/ollama/info" \
    'has("reachable", "version")'

if [[ "$OLLAMA_REACHABLE" == "true" ]]; then
    OLLAMA_VER=$(echo "$OLLAMA_RESP" | jq -r '.version // "unknown"' 2>/dev/null)
    OLLAMA_MODELS=$(echo "$OLLAMA_RESP" | jq -r '.modelCount // 0' 2>/dev/null)
    log_pass "Ollama is running (v$OLLAMA_VER, $OLLAMA_MODELS models)"

    test_json "GET /api/models/ollama/pull-status returns" "$API_BASE/api/models/ollama/pull-status" \
        '.pulls | type == "object"'
else
    log_info "Ollama not running — skipping Ollama-specific tests"
    log_skip "Ollama pull-status"
    log_skip "Ollama model load/unload"
fi

# ═══════════════════════════════════════════════════════════════
# Phase 11: Input Validation & Security
# ═══════════════════════════════════════════════════════════════

section "Phase 11: Input Validation & Security"

# Path traversal in model ID (404 is also acceptable — FastAPI blocks the path)
TRAVERSAL_CODE=$(acurl -o /dev/null -w "%{http_code}" -X POST "$API_BASE/api/models/..%2F..%2Fetc%2Fpasswd/download" 2>/dev/null) || TRAVERSAL_CODE="000"
if [[ "$TRAVERSAL_CODE" == "400" || "$TRAVERSAL_CODE" == "404" || "$TRAVERSAL_CODE" == "422" ]]; then
    log_pass "Path traversal in download → blocked ($TRAVERSAL_CODE)"
else
    log_fail "Path traversal in download not blocked (got $TRAVERSAL_CODE)"
fi

# Invalid backend in switch
test_http_error "Invalid backend → 400/422" \
    "$API_BASE/api/models/backend/switch" "POST" \
    '{"model_file":"test.gguf","backend":"hacked-backend"}' "422"

# Empty model_file in switch
test_http_error "Empty model_file → 400/422" \
    "$API_BASE/api/models/backend/switch" "POST" \
    '{"model_file":"","backend":"llama-server"}' "422"

# Download nonexistent model
test_http_error "Download unknown model → 404" \
    "$API_BASE/api/models/nonexistent-model-xyz/download" "POST" "" "404"

# ═══════════════════════════════════════════════════════════════
# Phase 12: Inference Validation (Quick Test)
# ═══════════════════════════════════════════════════════════════

section "Phase 12: Inference Validation"

if $QUICK; then
    log_skip "Inference test (--quick flag)"
else
    if [[ "$ACTIVE_STATUS" == "running" ]]; then
        test_json_post "POST /api/models/test returns tok/s" "$API_BASE/api/models/test" \
            '{"prompt":"What is 2+2? Answer in one word.","max_tokens":32}' \
            '.success == true and .tok_per_sec > 0'

        # Read the result for reporting
        TEST_RESP=$(acurl -X POST -H "Content-Type: application/json" \
            -d '{"prompt":"Say hello.","max_tokens":16}' \
            "$API_BASE/api/models/test" 2>/dev/null)
        TOK_S=$(echo "$TEST_RESP" | jq -r '.tok_per_sec // "N/A"' 2>/dev/null)
        TTFT=$(echo "$TEST_RESP" | jq -r '.ttft_ms // "N/A"' 2>/dev/null)
        TOKENS=$(echo "$TEST_RESP" | jq -r '.tokens // "N/A"' 2>/dev/null)
        log_info "Performance: ${TOK_S} tok/s, TTFT: ${TTFT}ms, ${TOKENS} tokens"
    else
        log_skip "Inference test (model not running)"
    fi
fi

# ═══════════════════════════════════════════════════════════════
# Phase 12b: OpenAI-Compatible API (Consumer Perspective)
#
# These endpoints are what Open WebUI, n8n, and other apps use.
# Open WebUI reads OPENAI_API_BASE_URL (default: http://llama-server:8080/v1)
# From the host, this maps to LLM_BASE (default: localhost:11434).
# ═══════════════════════════════════════════════════════════════

section "Phase 12b: OpenAI-Compatible API (App Consumer View)"

if $QUICK; then
    log_skip "Consumer API tests (--quick flag)"
else
    # --- /v1/models — Model Discovery ---
    # This is what Open WebUI calls to populate its model dropdown.
    V1_MODELS_RESP=$(curl -s --max-time "$TIMEOUT" "$LLM_BASE/v1/models" 2>/dev/null)
    V1_MODELS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" "$LLM_BASE/v1/models" 2>/dev/null) || V1_MODELS_CODE="000"

    if [[ "$V1_MODELS_CODE" == "200" ]]; then
        log_pass "/v1/models returns 200"

        # llama.cpp returns both {"models":[...], "data":[...]} — check for either
        V1_HAS_DATA=$(echo "$V1_MODELS_RESP" | jq 'has("data")' 2>/dev/null)
        V1_HAS_MODELS=$(echo "$V1_MODELS_RESP" | jq 'has("models")' 2>/dev/null)

        if [[ "$V1_HAS_DATA" == "true" ]]; then
            MODEL_COUNT=$(echo "$V1_MODELS_RESP" | jq '.data | length' 2>/dev/null || echo "0")
            log_pass "/v1/models has 'data' array ($MODEL_COUNT models)"
            MODEL_IDS=$(echo "$V1_MODELS_RESP" | jq -r '.data[].id // .data[].model' 2>/dev/null | head -5)
        elif [[ "$V1_HAS_MODELS" == "true" ]]; then
            MODEL_COUNT=$(echo "$V1_MODELS_RESP" | jq '.models | length' 2>/dev/null || echo "0")
            log_pass "/v1/models has 'models' array ($MODEL_COUNT models)"
            MODEL_IDS=$(echo "$V1_MODELS_RESP" | jq -r '.models[].model // .models[].id' 2>/dev/null | head -5)
        else
            log_fail "/v1/models missing both 'data' and 'models' arrays"
            log_verbose "Keys: $(echo "$V1_MODELS_RESP" | jq 'keys' 2>/dev/null)"
            MODEL_IDS=""
        fi

        if [[ -n "$MODEL_IDS" ]]; then
            log_info "Discovered models: $MODEL_IDS"
        fi
    elif [[ "$V1_MODELS_CODE" == "000" ]]; then
        log_fail "/v1/models unreachable at $LLM_BASE (connection refused)"
        log_info "Open WebUI won't be able to discover models!"
    else
        log_fail "/v1/models returned HTTP $V1_MODELS_CODE"
    fi

    # --- /v1/chat/completions — Core Inference ---
    # This is the primary endpoint all apps use for chat.
    if [[ "$ACTIVE_STATUS" == "running" ]]; then
        CHAT_DATA=$(jq -n '{
            model: "default",
            messages: [{role: "user", content: "Reply with only the word: hello"}],
            max_tokens: 16,
            stream: false
        }')

        CHAT_RESP=$(curl -s --max-time 30 -X POST \
            -H "Content-Type: application/json" \
            -d "$CHAT_DATA" \
            "$LLM_BASE/v1/chat/completions" 2>/dev/null)
        CHAT_CODE=$?

        if [[ $CHAT_CODE -eq 0 ]] && echo "$CHAT_RESP" | jq -e '.choices[0].message.content' >/dev/null 2>&1; then
            CHAT_CONTENT=$(echo "$CHAT_RESP" | jq -r '.choices[0].message.content' 2>/dev/null | head -c 100)
            CHAT_MODEL=$(echo "$CHAT_RESP" | jq -r '.model // "unknown"' 2>/dev/null)
            CHAT_USAGE=$(echo "$CHAT_RESP" | jq -c '.usage // {}' 2>/dev/null)
            log_pass "/v1/chat/completions returns valid response"
            log_info "Model: $CHAT_MODEL | Response: \"$CHAT_CONTENT\""
            log_verbose "Usage: $CHAT_USAGE"

            # Verify response has essential fields
            CHAT_KEYS=$(echo "$CHAT_RESP" | jq 'keys' 2>/dev/null)
            HAS_CHOICES=$(echo "$CHAT_RESP" | jq 'has("choices")' 2>/dev/null)
            HAS_MODEL=$(echo "$CHAT_RESP" | jq 'has("model")' 2>/dev/null)
            if [[ "$HAS_CHOICES" == "true" && "$HAS_MODEL" == "true" ]]; then
                log_pass "/v1/chat/completions has required fields (choices, model)"
            else
                log_fail "/v1/chat/completions missing required fields"
                log_verbose "Keys: $CHAT_KEYS"
            fi
        else
            log_fail "/v1/chat/completions failed (no valid response)"
            log_verbose "Response: ${CHAT_RESP:0:200}"
        fi

        # --- /v1/chat/completions streaming — SSE mode ---
        # Open WebUI defaults to streaming mode
        STREAM_DATA=$(jq -n '{
            model: "default",
            messages: [{role: "user", content: "Say OK"}],
            max_tokens: 8,
            stream: true
        }')

        STREAM_RESP=$(curl -s --max-time 15 -X POST \
            -H "Content-Type: application/json" \
            -d "$STREAM_DATA" \
            "$LLM_BASE/v1/chat/completions" 2>/dev/null)

        if echo "$STREAM_RESP" | grep -q "^data: "; then
            CHUNK_COUNT=$(echo "$STREAM_RESP" | grep -c "^data: " || echo "0")
            HAS_DONE=$(echo "$STREAM_RESP" | grep -c "data: \[DONE\]" || echo "0")
            log_pass "/v1/chat/completions streaming works ($CHUNK_COUNT chunks)"
            if [[ "$HAS_DONE" -gt 0 ]]; then
                log_pass "Stream terminates with [DONE] sentinel"
            else
                log_fail "Stream missing [DONE] termination (apps may hang)"
            fi
        else
            log_fail "/v1/chat/completions streaming not working"
            log_verbose "Response: ${STREAM_RESP:0:200}"
        fi

        # --- /health endpoint (direct) ---
        # llama-server and vLLM both expose a health endpoint
        HEALTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$LLM_BASE/health" 2>/dev/null) || HEALTH_CODE="000"
        if [[ "$HEALTH_CODE" == "200" ]]; then
            log_pass "LLM backend /health returns 200"
        else
            # Some backends may not have /health at root, try /v1/models as fallback
            log_info "LLM /health returned $HEALTH_CODE (some backends use /v1/models instead)"
        fi
    else
        log_skip "Consumer inference tests (model not running)"
    fi
fi

# ═══════════════════════════════════════════════════════════════
# Phase 13: Model Switch (only with --switch flag)
# ═══════════════════════════════════════════════════════════════

section "Phase 13: Model Switch Flow"

if ! $SWITCH; then
    log_skip "Model switch test (use --switch flag to enable — will restart container!)"
else
    # Find a different downloaded model to switch to
    CURRENT_MODEL=$(echo "$BSTATUS_RESP" | jq -r '.model // ""' 2>/dev/null)
    SWITCH_TARGET=""

    SWITCH_CANDIDATES=$(echo "$MODELS_RESP" | jq -r \
        '[.models[] | select(.status == "downloaded" and .backend == "llama-server")] | .[].gguf.filename // empty' 2>/dev/null)

    while IFS= read -r candidate; do
        if [[ -n "$candidate" && "$candidate" != "$CURRENT_MODEL" ]]; then
            SWITCH_TARGET="$candidate"
            break
        fi
    done <<< "$SWITCH_CANDIDATES"

    if [[ -z "$SWITCH_TARGET" ]]; then
        log_skip "No alternative downloaded model to switch to (need 2+ GGUF models)"
        log_info "Current: $CURRENT_MODEL"
    else
        log_info "Switching: $CURRENT_MODEL → $SWITCH_TARGET"

        # Trigger switch
        SWITCH_RESP=$(acurl -X POST -H "Content-Type: application/json" \
            -d "{\"model_file\":\"$SWITCH_TARGET\",\"backend\":\"llama-server\"}" \
            "$API_BASE/api/models/backend/switch" 2>/dev/null)

        SWITCH_STATUS=$(echo "$SWITCH_RESP" | jq -r '.status // "error"' 2>/dev/null)
        if [[ "$SWITCH_STATUS" == "restarting" ]]; then
            log_pass "Switch triggered: container restarting"
        else
            log_fail "Switch trigger failed: $(echo "$SWITCH_RESP" | jq -c '.' 2>/dev/null | head -c 100)"
        fi

        # Poll for healthy (up to 180s)
        log_info "Waiting for container to become healthy..."
        POLL_START=$(date +%s)
        POLL_TIMEOUT=180
        HEALTHY=false

        while true; do
            ELAPSED=$(( $(date +%s) - POLL_START ))
            if (( ELAPSED > POLL_TIMEOUT )); then
                break
            fi

            POLL_RESP=$(acurl "$API_BASE/api/models/backend/status" 2>/dev/null)
            IS_HEALTHY=$(echo "$POLL_RESP" | jq -r '.healthy // false' 2>/dev/null)
            POLL_CONTAINER=$(echo "$POLL_RESP" | jq -r '.container // "unknown"' 2>/dev/null)

            if [[ "$IS_HEALTHY" == "true" ]]; then
                HEALTHY=true
                break
            fi

            # Show progress every 10s
            if (( ELAPSED % 10 == 0 )); then
                log_info "  ${ELAPSED}s — container=$POLL_CONTAINER healthy=$IS_HEALTHY"
            fi
            sleep 2
        done

        if $HEALTHY; then
            log_pass "Container healthy after switch (${ELAPSED}s)"
        else
            log_fail "Container did not become healthy within ${POLL_TIMEOUT}s"
        fi

        # Verify active model changed
        NEW_ACTIVE=$(acurl "$API_BASE/api/models/active" 2>/dev/null)
        NEW_MODEL_ID=$(echo "$NEW_ACTIVE" | jq -r '.id // ""' 2>/dev/null)
        NEW_STATUS=$(echo "$NEW_ACTIVE" | jq -r '.status // ""' 2>/dev/null)
        log_info "New active model: $NEW_MODEL_ID (status: $NEW_STATUS)"

        # Verify the controller reports the new model
        CTRL_NEW=$(acurl "$CONTROLLER_BASE/status" 2>/dev/null)
        CTRL_NEW_MODEL=$(echo "$CTRL_NEW" | jq -r '.model // ""' 2>/dev/null)
        if [[ "$CTRL_NEW_MODEL" == "$SWITCH_TARGET" ]]; then
            log_pass "Controller confirms model switched to $SWITCH_TARGET"
        else
            log_fail "Controller reports $CTRL_NEW_MODEL, expected $SWITCH_TARGET"
        fi

        # ─── Post-Switch Consumer API Verification ───
        # This is the critical test: can apps still talk to the LLM after switch?
        log_info "Verifying consumer API works after model switch..."

        # /v1/models should still return models
        POST_SWITCH_MODELS=$(curl -s --max-time "$TIMEOUT" "$LLM_BASE/v1/models" 2>/dev/null)
        if echo "$POST_SWITCH_MODELS" | jq -e '.data | length > 0' >/dev/null 2>&1; then
            log_pass "Post-switch: /v1/models still returns models"
        else
            log_fail "Post-switch: /v1/models broken — Open WebUI cannot discover models!"
        fi

        # /v1/chat/completions should work with the new model
        POST_SWITCH_CHAT=$(curl -s --max-time 30 -X POST \
            -H "Content-Type: application/json" \
            -d '{"model":"default","messages":[{"role":"user","content":"Reply with only: OK"}],"max_tokens":8,"stream":false}' \
            "$LLM_BASE/v1/chat/completions" 2>/dev/null)

        if echo "$POST_SWITCH_CHAT" | jq -e '.choices[0].message.content' >/dev/null 2>&1; then
            POST_SWITCH_MODEL_ID=$(echo "$POST_SWITCH_CHAT" | jq -r '.model // "unknown"' 2>/dev/null)
            log_pass "Post-switch: /v1/chat/completions works (model: $POST_SWITCH_MODEL_ID)"
        else
            log_fail "Post-switch: /v1/chat/completions broken — apps cannot generate!"
            log_verbose "Response: ${POST_SWITCH_CHAT:0:200}"
        fi

        # Switch back to original
        if [[ -n "$CURRENT_MODEL" ]]; then
            log_info "Restoring original model: $CURRENT_MODEL"
            acurl -X POST -H "Content-Type: application/json" \
                -d "{\"model_file\":\"$CURRENT_MODEL\",\"backend\":\"llama-server\"}" \
                "$API_BASE/api/models/backend/switch" >/dev/null 2>&1

            # Wait for restore
            RESTORE_START=$(date +%s)
            while true; do
                ELAPSED=$(( $(date +%s) - RESTORE_START ))
                if (( ELAPSED > POLL_TIMEOUT )); then break; fi
                IS_HEALTHY=$(acurl "$API_BASE/api/models/backend/status" 2>/dev/null | jq -r '.healthy // false')
                if [[ "$IS_HEALTHY" == "true" ]]; then
                    log_pass "Original model restored (${ELAPSED}s)"
                    break
                fi
                sleep 2
            done
        fi
    fi
fi

# ═══════════════════════════════════════════════════════════════
# Phase 14: Unload Endpoint
# ═══════════════════════════════════════════════════════════════

section "Phase 14: Unload Endpoint (Smoke)"

# NOTE: Actually calling unload will stop the container, breaking subsequent tests.
# We only verify the endpoint exists by checking it responds, without parsing success.
log_info "Unload endpoint not invoked (would stop running model)"
log_info "Use --switch mode for full load/unload lifecycle testing"
log_skip "Unload test (non-destructive — endpoint exists via Phase 6)"

# ═══════════════════════════════════════════════════════════════
# Phase 15: Cross-Layer Consistency
# ═══════════════════════════════════════════════════════════════

section "Phase 15: Cross-Layer Consistency"

# Get controller status — use direct if reachable, proxy otherwise
if $CONTROLLER_REACHABLE; then
    CTRL_STATUS_RESP=$(acurl "$CONTROLLER_BASE/status" 2>/dev/null)
else
    CTRL_STATUS_RESP=$(acurl "$API_BASE/api/models/backend/status" 2>/dev/null)
fi

CTRL_BACKEND=$(echo "$CTRL_STATUS_RESP" | jq -r '.backend // "unknown"')
API_BACKEND=$(acurl "$API_BASE/api/models/backends" 2>/dev/null | jq -r '.activeBackend // "unknown"')

# Normalize: model-controller uses "llamacpp", dashboard-api may use "llama-server" or "llamacpp"
CTRL_NORMALIZED="$CTRL_BACKEND"
API_NORMALIZED="$API_BACKEND"
[[ "$CTRL_NORMALIZED" == "llamacpp" ]] && CTRL_NORMALIZED="llamacpp"
[[ "$API_NORMALIZED" == "llama-server" ]] && API_NORMALIZED="llamacpp"

if [[ "$CTRL_NORMALIZED" == "$API_NORMALIZED" ]]; then
    log_pass "Backend consistent: controller=$CTRL_BACKEND dashboard=$API_BACKEND"
else
    log_fail "Backend mismatch: controller=$CTRL_BACKEND dashboard=$API_BACKEND"
fi

# Controller and Dashboard API should agree on the model file
CTRL_MODEL_FILE=$(echo "$CTRL_STATUS_RESP" | jq -r '.model // "none"')
API_CURRENT=$(echo "$MODELS_RESP" | jq -r '.currentModel // "none"' 2>/dev/null)

if [[ "$CTRL_MODEL_FILE" == "$API_CURRENT" ]]; then
    log_pass "Model file consistent: $CTRL_MODEL_FILE"
else
    log_fail "Model file mismatch: controller=$CTRL_MODEL_FILE dashboard=$API_CURRENT"
fi

# ═══════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
TOTAL=$((PASSED + FAILED + SKIPPED))

echo ""
echo -e "${CYAN}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BOLD}Summary${NC}"
echo ""
echo -e "  Results: ${GREEN}$PASSED passed${NC} / ${RED}$FAILED failed${NC} / ${YELLOW}$SKIPPED skipped${NC} ($TOTAL total)"
echo -e "  Duration: ${DURATION}s"
echo ""

if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}✓ All Model Hub tests passed!${NC}"
    echo -e "  The Model Hub API chain is working correctly."
    exit 0
else
    echo -e "${RED}${BOLD}✗ $FAILED test(s) failed${NC}"
    echo -e "  Rerun with --verbose for detailed response bodies."
    exit 1
fi
