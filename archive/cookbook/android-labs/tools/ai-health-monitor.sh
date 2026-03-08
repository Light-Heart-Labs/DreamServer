#!/bin/bash
# AI Health Monitor v1.0
# Mission: M7 (OpenClaw Frontier Pushing)
# Addresses: Problem #3 (Maintenance Burden) from UNSOLVED-LOCAL-AI-PROBLEMS-2026.md
#
# Usage:
#   ./ai-health-monitor.sh              # Check all services
#   ./ai-health-monitor.sh --json       # JSON output for parsing
#   ./ai-health-monitor.sh --quiet      # Only output on errors
#   ./ai-health-monitor.sh --webhook URL # Post to Discord/Slack on failure
#
# Schedule via cron:
#   */5 * * * * /path/to/ai-health-monitor.sh --quiet --webhook "https://discord.com/..."

set -uo pipefail
# Note: -e removed intentionally - we want to continue checking even if individual checks fail

#=============================================================================
# Configuration
#=============================================================================
VERSION="1.0.0"

# Default endpoints (override via environment)
VLLM_URL="${VLLM_URL:-http://localhost:8000}"
WHISPER_URL="${WHISPER_URL:-http://localhost:8001}"
TTS_URL="${TTS_URL:-http://localhost:8002}"
EMBEDDINGS_URL="${EMBEDDINGS_URL:-http://localhost:8083}"
CLUSTER_URL="${CLUSTER_URL:-http://localhost:9199}"

# Thresholds
VRAM_WARN_PCT=95
LATENCY_WARN_MS=5000
TEMP_WARN_C=80

#=============================================================================
# Colors (disabled in quiet mode)
#=============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

#=============================================================================
# Argument Parsing
#=============================================================================
JSON_OUTPUT=false
QUIET_MODE=false
WEBHOOK_URL=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --json) JSON_OUTPUT=true; shift ;;
        --quiet) QUIET_MODE=true; shift ;;
        --webhook) WEBHOOK_URL="$2"; shift 2 ;;
        -h|--help)
            echo "AI Health Monitor v${VERSION}"
            echo "Usage: $0 [--json] [--quiet] [--webhook URL]"
            exit 0
            ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

#=============================================================================
# Helpers
#=============================================================================
CHECKS_PASSED=0
CHECKS_FAILED=0
CHECKS_WARNED=0
ISSUES=()

log() {
    if [[ "$JSON_OUTPUT" == "false" ]] && [[ "$QUIET_MODE" == "false" ]]; then
        echo -e "$1"
    fi
}

check_pass() {
    ((CHECKS_PASSED++))
    log "${GREEN}✓${NC} $1"
}

check_fail() {
    ((CHECKS_FAILED++))
    ISSUES+=("❌ $1")
    log "${RED}✗${NC} $1"
}

check_warn() {
    ((CHECKS_WARNED++))
    ISSUES+=("⚠️ $1")
    log "${YELLOW}!${NC} $1"
}

#=============================================================================
# Health Checks
#=============================================================================

check_vllm() {
    log "${BLUE}Checking vLLM...${NC}"
    
    # Try /health endpoint first
    if response=$(curl -s -m 5 "${VLLM_URL}/health" 2>/dev/null); then
        check_pass "vLLM responding at ${VLLM_URL}"
        
        # Check if we can list models
        if models=$(curl -s -m 5 "${VLLM_URL}/v1/models" 2>/dev/null); then
            model_count=$(echo "$models" | jq -r '.data | length' 2>/dev/null || echo "0")
            if [[ "$model_count" -gt 0 ]]; then
                check_pass "vLLM has $model_count model(s) loaded"
            else
                check_warn "vLLM running but no models loaded"
            fi
        fi
    else
        check_fail "vLLM not responding at ${VLLM_URL}"
    fi
}

check_whisper() {
    log "${BLUE}Checking Whisper STT...${NC}"
    
    # Try health endpoint
    if curl -s -m 5 "${WHISPER_URL}/health" >/dev/null 2>&1; then
        check_pass "Whisper STT responding at ${WHISPER_URL}"
    elif curl -s -m 5 "${WHISPER_URL}/" >/dev/null 2>&1; then
        check_pass "Whisper STT responding at ${WHISPER_URL}"
    else
        check_warn "Whisper STT not responding at ${WHISPER_URL} (may be optional)"
    fi
}

check_tts() {
    log "${BLUE}Checking TTS...${NC}"
    
    if curl -s -m 5 "${TTS_URL}/health" >/dev/null 2>&1; then
        check_pass "TTS responding at ${TTS_URL}"
    elif curl -s -m 5 "${TTS_URL}/" >/dev/null 2>&1; then
        check_pass "TTS responding at ${TTS_URL}"
    else
        check_warn "TTS not responding at ${TTS_URL} (may be optional)"
    fi
}

check_embeddings() {
    log "${BLUE}Checking Embeddings...${NC}"
    
    if curl -s -m 5 "${EMBEDDINGS_URL}/health" >/dev/null 2>&1; then
        check_pass "Embeddings responding at ${EMBEDDINGS_URL}"
    elif curl -s -m 5 "${EMBEDDINGS_URL}/" >/dev/null 2>&1; then
        check_pass "Embeddings responding at ${EMBEDDINGS_URL}"
    else
        check_warn "Embeddings not responding at ${EMBEDDINGS_URL} (may be optional)"
    fi
}

check_cluster() {
    log "${BLUE}Checking Cluster Status...${NC}"
    
    if cluster_status=$(curl -s -m 5 "${CLUSTER_URL}/status" 2>/dev/null); then
        # Parse cluster health
        node_count=$(echo "$cluster_status" | jq -r '.nodes | length' 2>/dev/null || echo "0")
        
        if [[ "$node_count" -gt 0 ]]; then
            check_pass "Cluster proxy responding with $node_count node(s)"
            
            # Check each node
            for node in $(echo "$cluster_status" | jq -r '.nodes | keys[]' 2>/dev/null); do
                healthy=$(echo "$cluster_status" | jq -r ".nodes[\"$node\"].healthy" 2>/dev/null)
                vram_pct=$(echo "$cluster_status" | jq -r ".nodes[\"$node\"].gpu.vram_used_pct // 0" 2>/dev/null)
                temp=$(echo "$cluster_status" | jq -r ".nodes[\"$node\"].gpu.temperature_c // 0" 2>/dev/null)
                
                if [[ "$healthy" == "true" ]]; then
                    check_pass "Node $node: healthy"
                else
                    check_fail "Node $node: unhealthy"
                fi
                
                # VRAM warning
                if (( $(echo "$vram_pct > $VRAM_WARN_PCT" | bc -l 2>/dev/null || echo 0) )); then
                    check_warn "Node $node: VRAM at ${vram_pct}% (>${VRAM_WARN_PCT}%)"
                fi
                
                # Temperature warning
                if (( $(echo "$temp > $TEMP_WARN_C" | bc -l 2>/dev/null || echo 0) )); then
                    check_warn "Node $node: GPU temp ${temp}°C (>${TEMP_WARN_C}°C)"
                fi
            done
        else
            check_warn "Cluster proxy responding but no nodes found"
        fi
    else
        check_warn "Cluster proxy not responding at ${CLUSTER_URL} (standalone mode?)"
    fi
}

check_gpu() {
    log "${BLUE}Checking Local GPU...${NC}"
    
    if command -v nvidia-smi &>/dev/null; then
        if gpu_info=$(nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>/dev/null); then
            while IFS=',' read -r name util mem_used mem_total temp; do
                name=$(echo "$name" | xargs)
                util=$(echo "$util" | xargs)
                mem_used=$(echo "$mem_used" | xargs)
                mem_total=$(echo "$mem_total" | xargs)
                temp=$(echo "$temp" | xargs)
                
                mem_pct=$((mem_used * 100 / mem_total))
                
                check_pass "GPU: $name (${mem_pct}% VRAM, ${util}% util, ${temp}°C)"
                
                if [[ "$mem_pct" -gt "$VRAM_WARN_PCT" ]]; then
                    check_warn "GPU VRAM at ${mem_pct}% (>${VRAM_WARN_PCT}%)"
                fi
                
                if [[ "$temp" -gt "$TEMP_WARN_C" ]]; then
                    check_warn "GPU temp ${temp}°C (>${TEMP_WARN_C}°C)"
                fi
            done <<< "$gpu_info"
        else
            check_fail "nvidia-smi failed"
        fi
    else
        check_warn "nvidia-smi not found (no NVIDIA GPU or drivers not installed)"
    fi
}

check_disk() {
    log "${BLUE}Checking Disk Space...${NC}"
    
    # Check common model directories
    for dir in "/var/lib/docker" "$HOME/.cache/huggingface" "/models" "."; do
        if [[ -d "$dir" ]]; then
            usage=$(df "$dir" 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%')
            if [[ -n "$usage" ]] && [[ "$usage" -gt 90 ]]; then
                check_warn "Disk usage at ${usage}% for $dir"
            fi
        fi
    done
    check_pass "Disk space OK"
}

check_docker() {
    log "${BLUE}Checking Docker...${NC}"
    
    if command -v docker &>/dev/null; then
        if docker info >/dev/null 2>&1; then
            container_count=$(docker ps -q 2>/dev/null | wc -l)
            check_pass "Docker running with $container_count container(s)"
        else
            check_fail "Docker daemon not accessible"
        fi
    else
        check_warn "Docker not installed"
    fi
}

#=============================================================================
# Main
#=============================================================================

main() {
    START_TIME=$(date +%s)
    
    log ""
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log "${BLUE}  AI Health Monitor v${VERSION}${NC}"
    log "${BLUE}  $(date '+%Y-%m-%d %H:%M:%S %Z')${NC}"
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    log ""
    
    # Run all checks
    check_docker
    check_gpu
    check_vllm
    check_whisper
    check_tts
    check_embeddings
    check_cluster
    check_disk
    
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    
    log ""
    log "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Summary
    TOTAL=$((CHECKS_PASSED + CHECKS_FAILED + CHECKS_WARNED))
    
    if [[ "$JSON_OUTPUT" == "true" ]]; then
        # JSON output
        cat << EOF
{
  "version": "${VERSION}",
  "timestamp": "$(date -Iseconds)",
  "duration_seconds": ${DURATION},
  "summary": {
    "total": ${TOTAL},
    "passed": ${CHECKS_PASSED},
    "failed": ${CHECKS_FAILED},
    "warned": ${CHECKS_WARNED}
  },
  "healthy": $([ $CHECKS_FAILED -eq 0 ] && echo "true" || echo "false"),
  "issues": $(printf '%s\n' "${ISSUES[@]:-}" | jq -R . | jq -s .)
}
EOF
    else
        log ""
        log "Summary: ${CHECKS_PASSED} passed, ${CHECKS_WARNED} warnings, ${CHECKS_FAILED} failed (${DURATION}s)"
        
        if [[ $CHECKS_FAILED -eq 0 ]]; then
            log ""
            log "${GREEN}All critical checks passed!${NC}"
        else
            log ""
            log "${RED}ISSUES DETECTED:${NC}"
            for issue in "${ISSUES[@]}"; do
                log "  $issue"
            done
        fi
    fi
    
    # Webhook notification on failure
    if [[ -n "$WEBHOOK_URL" ]] && [[ $CHECKS_FAILED -gt 0 ]]; then
        issue_text=$(printf '%s\\n' "${ISSUES[@]}")
        webhook_payload=$(cat << EOF
{
  "content": "🚨 **AI Health Monitor Alert**\n\nHost: $(hostname)\nTime: $(date '+%Y-%m-%d %H:%M:%S %Z')\n\n**Issues:**\n${issue_text}\n\nPassed: ${CHECKS_PASSED} | Warnings: ${CHECKS_WARNED} | Failed: ${CHECKS_FAILED}"
}
EOF
)
        curl -s -X POST -H "Content-Type: application/json" -d "$webhook_payload" "$WEBHOOK_URL" >/dev/null 2>&1 || true
    fi
    
    # Exit code
    if [[ $CHECKS_FAILED -gt 0 ]]; then
        exit 1
    else
        exit 0
    fi
}

main "$@"
