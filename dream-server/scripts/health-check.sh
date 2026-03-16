#!/bin/bash
# Dream Server Comprehensive Health Check
# Tests each component with actual API calls, not just connectivity
# Exit codes: 0=healthy, 1=degraded (some services down), 2=critical (core services down)
#
# Usage: ./health-check.sh [--json] [--quiet]

# ── Bash 4+ guard ─────────────────────────────────────────────────────────────
# service-registry.sh requires associative arrays (declare -A) which need Bash 4+.
# macOS ships Bash 3.2; if running there, re-exec under Homebrew bash.
if [ "${BASH_VERSINFO[0]}" -lt 4 ]; then
    for _brew_bash in /opt/homebrew/bin/bash /usr/local/bin/bash; do
        if [ -x "$_brew_bash" ] && [ "$("$_brew_bash" -c 'echo "${BASH_VERSINFO[0]}"')" -ge 4 ]; then
            exec "$_brew_bash" "$0" "$@"
        fi
    done
    echo "Error: Bash 4+ required. macOS ships Bash 3.2. Install newer bash: brew install bash" >&2
    exit 2
fi

set -euo pipefail

# Parse args
JSON_OUTPUT=false
QUIET=false
for arg in "$@"; do
    case $arg in
        --json) JSON_OUTPUT=true ;;
        --quiet) QUIET=true ;;
    esac
done

# Config (defaults; .env overrides after load_env_file below)
INSTALL_DIR="${INSTALL_DIR:-$HOME/dream-server}"
LLM_HOST="${LLM_HOST:-localhost}"
LLM_PORT="${LLM_PORT:-8080}"
TIMEOUT="${TIMEOUT:-5}"

# Source service registry
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$SCRIPT_DIR/lib/service-registry.sh"
sr_load

# Safe .env loading for port overrides (no eval; use lib/safe-env.sh)
[[ -f "$SCRIPT_DIR/lib/safe-env.sh" ]] && . "$SCRIPT_DIR/lib/safe-env.sh"
load_env_file "${INSTALL_DIR}/.env"

# Colors (disabled for JSON/quiet)
if $JSON_OUTPUT || $QUIET; then
    GREEN="" RED="" YELLOW="" CYAN="" NC=""
else
    GREEN='\033[0;32m' RED='\033[0;31m' YELLOW='\033[1;33m' CYAN='\033[0;36m' NC='\033[0m'
fi

# Track results (indexed arrays — Bash 3.2 compatible as defense-in-depth)
declare -a RESULT_KEYS=()
declare -a RESULT_VALS=()
CRITICAL_FAIL=false
ANY_FAIL=false

# Set a result: result_set key value
result_set() {
    local key="$1" val="$2" i
    for i in "${!RESULT_KEYS[@]}"; do
        if [[ "${RESULT_KEYS[$i]}" == "$key" ]]; then
            RESULT_VALS[i]="$val"
            return
        fi
    done
    RESULT_KEYS+=("$key")
    RESULT_VALS+=("$val")
}

# Get a result: result_get key
result_get() {
    local key="$1" i
    for i in "${!RESULT_KEYS[@]}"; do
        if [[ "${RESULT_KEYS[$i]}" == "$key" ]]; then
            echo "${RESULT_VALS[$i]}"
            return
        fi
    done
}

log() { $QUIET || echo -e "$1"; }

# ── Test functions ──────────────────────────────────────────────────────────

# llama-server: critical path — performs an actual inference test
test_llm() {
    local start=$(date +%s%3N)
    local response=$(curl -sf --max-time $TIMEOUT \
        -H "Content-Type: application/json" \
        -d '{"model":"default","prompt":"Hi","max_tokens":1}' \
        "http://${LLM_HOST}:${LLM_PORT}/v1/completions" 2>/dev/null)
    local end=$(date +%s%3N)

    if echo "$response" | grep -q '"text"'; then
        result_set "llm" "ok"
        result_set "llm_latency" "$((end - start))"
        return 0
    fi
    result_set "llm" "fail"
    CRITICAL_FAIL=true
    ANY_FAIL=true
    return 1
}

# Generic registry-driven service health check
test_service() {
    local sid="$1"
    local port_env="${SERVICE_PORT_ENVS[$sid]}"
    local default_port="${SERVICE_PORTS[$sid]}"
    local health="${SERVICE_HEALTH[$sid]}"

    # Resolve port
    local port="$default_port"
    [[ -n "$port_env" ]] && port="${!port_env:-$default_port}"

    [[ -z "$health" || "$port" == "0" ]] && return 1

    if curl -sf --max-time $TIMEOUT "http://localhost:${port}${health}" >/dev/null 2>&1; then
        result_set "$sid" "ok"
        return 0
    fi
    result_set "$sid" "fail"
    ANY_FAIL=true
    return 1
}

# System-level: GPU
test_gpu() {
    if command -v nvidia-smi &>/dev/null; then
        local gpu_info=$(nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu,temperature.gpu --format=csv,noheader,nounits 2>/dev/null | head -1)
        if [ -n "$gpu_info" ]; then
            IFS=',' read -r mem_used mem_total gpu_util temp <<< "$gpu_info"
            result_set "gpu" "ok"
            result_set "gpu_mem_used" "${mem_used// /}"
            result_set "gpu_mem_total" "${mem_total// /}"
            result_set "gpu_util" "${gpu_util// /}"
            result_set "gpu_temp" "${temp// /}"

            # Warn if GPU memory > 95% or temp > 80C
            if [ "$(result_get "gpu_util")" -gt 95 ] 2>/dev/null; then
                result_set "gpu" "warn"
            fi
            if [ "$(result_get "gpu_temp")" -gt 80 ] 2>/dev/null; then
                result_set "gpu" "warn"
            fi
            return 0
        fi
    fi
    result_set "gpu" "unavailable"
    return 1
}

# System-level: Disk
test_disk() {
    local usage=$(df -h "$INSTALL_DIR" 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%')
    if [ -n "$usage" ]; then
        result_set "disk" "ok"
        result_set "disk_usage" "$usage"
        if [ "$usage" -gt 90 ]; then
            result_set "disk" "warn"
        fi
        return 0
    fi
    result_set "disk" "unavailable"
    return 1
}

# Helper: run test_service for a service ID and log the result
check_service() {
    local sid="$1"
    local name="${SERVICE_NAMES[$sid]:-$sid}"
    if test_service "$sid" 2>/dev/null; then
        log "  ${GREEN}✓${NC} $name - healthy"
    else
        log "  ${YELLOW}!${NC} $name - not responding"
    fi
}

# ── Run tests ───────────────────────────────────────────────────────────────

log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
log "${CYAN}  Dream Server Health Check${NC}"
log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
log ""

log "${CYAN}Core Services:${NC}"

# llama-server (critical — does inference test, not just health)
if test_llm 2>/dev/null; then
    log "  ${GREEN}✓${NC} llama-server - inference working ($(result_get "llm_latency")ms)"
else
    log "  ${RED}✗${NC} llama-server - CRITICAL: inference failed"
fi

# All other core services
for sid in "${SERVICE_IDS[@]}"; do
    [[ "$sid" == "llama-server" ]] && continue
    [[ "${SERVICE_CATEGORIES[$sid]}" != "core" ]] && continue
    check_service "$sid"
done

log ""
log "${CYAN}Extension Services:${NC}"

# All non-core services
for sid in "${SERVICE_IDS[@]}"; do
    [[ "${SERVICE_CATEGORIES[$sid]}" == "core" ]] && continue
    check_service "$sid"
done

log ""
log "${CYAN}System Resources:${NC}"

# GPU
if test_gpu 2>/dev/null; then
    status_icon="${GREEN}✓${NC}"
    [ "$(result_get "gpu")" = "warn" ] && status_icon="${YELLOW}!${NC}"
    log "  ${status_icon} GPU - $(result_get "gpu_mem_used")/$(result_get "gpu_mem_total") MiB, $(result_get "gpu_util")% util, $(result_get "gpu_temp")°C"
else
    log "  ${YELLOW}?${NC} GPU - status unavailable"
fi

# Disk
if test_disk 2>/dev/null; then
    status_icon="${GREEN}✓${NC}"
    [ "$(result_get "disk")" = "warn" ] && status_icon="${YELLOW}!${NC}"
    log "  ${status_icon} Disk - $(result_get "disk_usage")% used"
else
    log "  ${YELLOW}?${NC} Disk - status unavailable"
fi

log ""

# Summary
if $CRITICAL_FAIL; then
    log "${RED}Status: CRITICAL - Core services down${NC}"
    EXIT_CODE=2
elif $ANY_FAIL; then
    log "${YELLOW}Status: DEGRADED - Some services unavailable${NC}"
    EXIT_CODE=1
else
    log "${GREEN}Status: HEALTHY - All services operational${NC}"
    EXIT_CODE=0
fi

log ""

# JSON output
if $JSON_OUTPUT; then
    echo "{"
    echo "  \"timestamp\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\","
    echo "  \"status\": \"$([ $EXIT_CODE -eq 0 ] && echo "healthy" || ([ $EXIT_CODE -eq 1 ] && echo "degraded" || echo "critical"))\","
    echo "  \"services\": {"
    first=true
    for i in "${!RESULT_KEYS[@]}"; do
        $first || echo ","
        first=false
        echo -n "    \"${RESULT_KEYS[$i]}\": \"${RESULT_VALS[$i]}\""
    done
    echo ""
    echo "  }"
    echo "}"
fi

exit $EXIT_CODE
