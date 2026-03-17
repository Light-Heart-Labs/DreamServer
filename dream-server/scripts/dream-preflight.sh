#!/bin/bash
# dream-preflight.sh — Quick health check before first chat
# Usage: ./scripts/dream-preflight.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

# Source service registry
. "$SCRIPT_DIR/lib/service-registry.sh"
sr_load

# Safe .env loading for port overrides (no eval; use lib/safe-env.sh)
[[ -f "$SCRIPT_DIR/lib/safe-env.sh" ]] && . "$SCRIPT_DIR/lib/safe-env.sh"
load_env_file "$SCRIPT_DIR/.env"

# Resolve compose flags for accurate status checks
COMPOSE_FLAGS=""
if [[ -x "$SCRIPT_DIR/scripts/resolve-compose-stack.sh" ]]; then
    COMPOSE_FLAGS=$("$SCRIPT_DIR/scripts/resolve-compose-stack.sh" \
        --script-dir "$SCRIPT_DIR" --tier "${TIER:-1}" --gpu-backend "${GPU_BACKEND:-nvidia}")
fi

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}Dream Server Preflight Check${NC}"
echo "=============================="
echo ""

# Resolve ports from registry + env overrides
LLM_PORT="${OLLAMA_PORT:-${LLAMA_SERVER_PORT:-${SERVICE_PORTS[llama-server]:-8080}}}"
LLM_HEALTH="${SERVICE_HEALTH[llama-server]:-/health}"
LLM_CONTAINER="${SERVICE_CONTAINERS[llama-server]:-dream-llama-server}"
WEBUI_PORT="${SERVICE_PORTS[open-webui]:-3000}"
WEBUI_HEALTH="${SERVICE_HEALTH[open-webui]:-/}"

# Check Docker is running
echo -n "Docker daemon... "
if docker info >/dev/null 2>&1; then
    echo -e "${GREEN}✓ running${NC}"
else
    echo -e "${RED}✗ not running${NC}"
    echo "  Fix: Start Docker Desktop or run 'sudo systemctl start docker'"
    exit 1
fi

# Check containers are up
echo -n "Core containers... "
if docker compose $COMPOSE_FLAGS ps | grep -q "$LLM_CONTAINER"; then
    echo -e "${GREEN}✓ running${NC}"
else
    echo -e "${RED}✗ not running${NC}"
    echo "  Fix: Run 'docker compose up -d' first"
    exit 1
fi

# Check llama-server health
CURL_HEALTH_FLAGS=(--connect-timeout 3 --max-time 10)

echo -n "llama-server API (port $LLM_PORT)... "
if curl -sf "${CURL_HEALTH_FLAGS[@]}" "http://localhost:${LLM_PORT}${LLM_HEALTH}" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ healthy${NC}"
else
    echo -e "${YELLOW}⚠ starting up${NC}"
    echo "  The model is still loading. Wait 1-2 minutes and retry."
    echo "  Monitor: docker compose logs -f llama-server"
fi

# Check WebUI
echo -n "Open WebUI (port $WEBUI_PORT)... "
if curl -sf "${CURL_HEALTH_FLAGS[@]}" "http://localhost:${WEBUI_PORT}${WEBUI_HEALTH}" >/dev/null 2>&1; then
    echo -e "${GREEN}✓ accessible${NC}"
else
    echo -e "${YELLOW}⚠ not ready${NC}"
fi

# Check GPU if available
echo -n "GPU availability... "
if docker exec "$LLM_CONTAINER" nvidia-smi >/dev/null 2>&1; then
    GPU_MEM=$(docker exec "$LLM_CONTAINER" nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ')
    echo -e "${GREEN}✓ detected (${GPU_MEM}MB free)${NC}"
else
    echo -e "${YELLOW}⚠ not detected (CPU mode)${NC}"
fi

# Check extension services that are running
for sid in "${SERVICE_IDS[@]}"; do
    [[ "${SERVICE_CATEGORIES[$sid]}" == "core" ]] && continue
    container="${SERVICE_CONTAINERS[$sid]}"
    docker compose $COMPOSE_FLAGS ps 2>/dev/null | grep -q "$container" || continue

    port="${SERVICE_PORTS[$sid]:-0}"
    health="${SERVICE_HEALTH[$sid]:-/}"
    name="${SERVICE_NAMES[$sid]:-$sid}"
    [[ "$port" == "0" ]] && continue

    echo -n "$name (port $port)... "
    if curl -sf "${CURL_HEALTH_FLAGS[@]}" "http://localhost:${port}${health}" >/dev/null 2>&1; then
        echo -e "${GREEN}✓ ready${NC}"
    else
        echo -e "${YELLOW}⚠ not ready${NC}"
    fi
done

echo ""
echo -e "${CYAN}Next steps:${NC}"
echo "  1. Open http://localhost:${WEBUI_PORT}"
echo "  2. Sign in (first user becomes admin)"
echo "  3. Type 'What's 2+2?' to test"
echo ""
echo "Need help? See docs/TROUBLESHOOTING.md"
