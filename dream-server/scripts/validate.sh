#!/bin/bash
# Dream Server Validation Script
# Run after install to confirm everything is working

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Source service registry
export SCRIPT_DIR="$PROJECT_DIR"
. "$PROJECT_DIR/lib/service-registry.sh"
sr_load

# Safe .env loading (aligns with dream-cli pattern)
load_env_safe() {
    local env_file="$PROJECT_DIR/.env"
    [[ -f "$env_file" ]] || return 0
    set -a
    while IFS='=' read -r key value; do
        # Skip comments and empty lines
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        # Only allow alphanumeric + underscore in key names
        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        # Strip surrounding quotes from value
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"
        value="${value#\'}"
        export "$key=$value"
    done < "$env_file"
    set +a
}

# Load .env for port overrides (if present)
load_env_safe

# Resolve core ports from registry (honoring any env overrides)
LLM_PORT="${LLAMA_SERVER_PORT:-${SERVICE_PORTS[llama-server]:-8080}}"
LLM_HEALTH="${SERVICE_HEALTH[llama-server]:-/health}"
WEBUI_PORT="${WEBUI_PORT:-${SERVICE_PORTS[open-webui]:-3000}}"
WEBUI_HEALTH="${WEBUI_HEALTH:-${SERVICE_HEALTH[open-webui]:-/}}"

echo ""
echo "╔═══════════════════════════════════════════╗"
echo "║     Dream Server Validation Test          ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

PASSED=0
FAILED=0

check() {
    local name="$1"
    local cmd="$2"
    printf "  %-30s " "$name..."
    # Run fixed command string via bash -c (no eval)
    if bash -c "$cmd" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAIL${NC}"
        ((FAILED++))
    fi
}

echo "1. Container Status"
echo "───────────────────"
check "llama-server running" "docker compose ps llama-server 2>/dev/null | grep -q 'Up\|running'"
check "Open WebUI running" "docker compose ps open-webui 2>/dev/null | grep -q 'Up\|running'"

echo ""
echo "2. Health Endpoints"
echo "───────────────────"
check "llama-server health" "curl -sf http://localhost:${LLM_PORT}${LLM_HEALTH}"
check "llama-server models" "curl -sf http://localhost:${LLM_PORT}/v1/models | grep -q model"
check "WebUI reachable" "curl -sf http://localhost:${WEBUI_PORT}${WEBUI_HEALTH} -o /dev/null"

echo ""
echo "3. Inference Test"
echo "─────────────────"
printf "  %-30s " "Chat completion..."
RESPONSE=$(curl -sf "http://localhost:${LLM_PORT}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d '{
        "model": "'"$(curl -sf "http://localhost:${LLM_PORT}/v1/models" | jq -r '.data[0].id // "local"')"'",
        "messages": [{"role": "user", "content": "Say OK"}],
        "max_tokens": 10
    }' 2>/dev/null)

if echo "$RESPONSE" | grep -q "content"; then
    echo -e "${GREEN}✓ PASS${NC}"
    ((PASSED++))
else
    echo -e "${RED}✗ FAIL${NC}"
    ((FAILED++))
fi

# Check optional services
echo ""
echo "4. Optional Services (if enabled)"
echo "──────────────────────────────────"

SCRIPT_DIR_REG="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$SCRIPT_DIR_REG/lib/service-registry.sh"
sr_load

for sid in "${SERVICE_IDS[@]}"; do
    _cat="${SERVICE_CATEGORIES[$sid]}"
    [[ "$_cat" == "core" ]] && continue  # Core already checked above

    _container="${SERVICE_CONTAINERS[$sid]}"
    _health="${SERVICE_HEALTH[$sid]}"
    _port_env="${SERVICE_PORT_ENVS[$sid]}"
    _default_port="${SERVICE_PORTS[$sid]}"
    _name="${SERVICE_NAMES[$sid]:-$sid}"

    # Resolve port
    _port="$_default_port"
    [[ -n "$_port_env" ]] && _port="${!_port_env:-$_default_port}"

    # Skip if no health endpoint or port
    [[ -z "$_health" || "$_port" == "0" ]] && continue

    # Check if container is running
    if docker compose ps "$sid" 2>/dev/null | grep -q "Up\|running"; then
        check "$_name" "curl -sf http://localhost:${_port}${_health}"
    else
        printf "  %-30s ${YELLOW}○ SKIP (not enabled)${NC}\n" "$_name..."
    fi
done

# Summary
echo ""
echo "═══════════════════════════════════════════"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ Dream Server is ready! ($PASSED tests passed)${NC}"
    echo ""
    echo "   Open WebUI:  http://localhost:${WEBUI_PORT}"
    echo "   API:         http://localhost:${LLM_PORT}/v1/..."
    echo ""
else
    echo -e "${RED}⚠️  $FAILED test(s) failed, $PASSED passed${NC}"
    echo ""
    echo "   Troubleshooting:"
    echo "   - Check logs:  docker compose logs -f"
    echo "   - LLM logs:    docker compose logs -f llama-server"
    echo "   - Restart:     docker compose restart"
    echo ""
    exit 1
fi
