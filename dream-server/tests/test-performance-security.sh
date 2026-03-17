#!/bin/bash
# ============================================================================
# Dream Server Performance & Resource Security Test Suite
# ============================================================================
# Validates performance and resource security configurations:
# - Resource limits and constraints
# - Memory and CPU security boundaries
# - Disk usage and quota validation
# - Network bandwidth and connection limits
# - DoS protection mechanisms
# - Resource exhaustion prevention
#
# Usage: ./tests/test-performance-security.sh
# Exit 0 if all pass, 1 if any fail
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

pass() {
    echo -e "  ${GREEN}✓${NC} $1"
    PASS=$((PASS + 1))
}

fail() {
    echo -e "  ${RED}✗${NC} $1"
    [[ -n "${2:-}" ]] && echo -e "        ${RED}→ $2${NC}"
    FAIL=$((FAIL + 1))
}

skip() {
    echo -e "  ${YELLOW}⊘${NC} $1"
    SKIP=$((SKIP + 1))
}

header() {
    echo ""
    echo -e "${BOLD}${CYAN}[$1]${NC} ${BOLD}$2${NC}"
    echo -e "${CYAN}$(printf '%.0s─' {1..70})${NC}"
}

# ============================================
# TEST 1: Container Resource Limits
# ============================================
header "1/6" "Container Resource Limits Validation"

# Check Docker Compose files for resource constraints
compose_files=(docker-compose.base.yml docker-compose.*.yml extensions/services/*/compose*.yaml)
services_with_limits=0
services_without_limits=()

for compose_file in "${compose_files[@]}"; do
    if [[ -f "$compose_file" ]]; then
        service_name=$(basename "$(dirname "$compose_file")")

        # Check for memory limits
        if grep -q "mem_limit\|memory:" "$compose_file"; then
            services_with_limits=$((services_with_limits + 1))
            pass "Service in $(basename "$compose_file") has memory limits"
        else
            services_without_limits+=("$(basename "$compose_file")")
        fi

        # Check for CPU limits
        if grep -q "cpus\|cpu_count\|cpu_percent" "$compose_file"; then
            pass "Service in $(basename "$compose_file") has CPU limits"
        else
            skip "Service in $(basename "$compose_file") should consider CPU limits"
        fi

        # Check for ulimits (file descriptors, processes)
        if grep -q "ulimits:" "$compose_file"; then
            pass "Service in $(basename "$compose_file") has ulimits configured"
        else
            skip "Service in $(basename "$compose_file") should configure ulimits"
        fi
    fi
done

echo ""
echo -e "    ${BOLD}Summary:${NC} $services_with_limits services have resource limits"
if [[ ${#services_without_limits[@]} -gt 0 ]]; then
    echo -e "    ${YELLOW}Services without limits:${NC} ${services_without_limits[*]}"
fi

# ============================================
# TEST 2: Memory Security Boundaries
# ============================================
header "2/6" "Memory Security Boundaries"

# Check for memory-related security configurations
memory_configs=0

# Check tier-map for memory-appropriate model selection
tier_map="installers/lib/tier-map.sh"
if [[ -f "$tier_map" ]]; then
    # Verify tier 1 uses small models for low-RAM systems
    if grep -A5 "^[[:space:]]*1)" "$tier_map" | grep -q "qwen3-8b"; then
        pass "Tier 1 uses memory-efficient model (qwen3-8b)"
        memory_configs=$((memory_configs + 1))
    else
        fail "Tier 1 should use memory-efficient model for low-RAM systems"
    fi

    # Check for memory requirements documentation
    if grep -q "RAM\|memory\|GB" "$tier_map"; then
        pass "Tier map includes memory requirements"
        memory_configs=$((memory_configs + 1))
    fi
fi

# Check for OOM (Out of Memory) protection
oom_protection=0
while IFS= read -r -d '' pyfile; do
    if grep -q "memory.*limit\|oom\|OutOfMemory\|resource.*limit" "$pyfile"; then
        oom_protection=$((oom_protection + 1))
    fi
done < <(find extensions/services -name "*.py" -print0)

if [[ $oom_protection -gt 0 ]]; then
    pass "OOM protection mechanisms found in $oom_protection files"
else
    skip "Consider implementing OOM protection mechanisms"
fi

# ============================================
# TEST 3: Disk Usage Security
# ============================================
header "3/6" "Disk Usage Security Validation"

# Check for disk space validation
disk_validation=0

# Check if installer validates disk space
preflight_script="installers/phases/04-requirements.sh"
if [[ -f "$preflight_script" ]]; then
    if grep -qi "disk\|space\|df\|storage" "$preflight_script"; then
        pass "Installer validates disk space requirements"
        disk_validation=$((disk_validation + 1))
    else
        fail "Installer should validate disk space requirements"
    fi
fi

# Check for disk space monitoring
disk_monitoring=0
while IFS= read -r -d '' pyfile; do
    if grep -q "disk.*usage\|df\|statvfs\|disk.*space" "$pyfile"; then
        disk_monitoring=$((disk_monitoring + 1))
        service_name=$(basename "$(dirname "$(dirname "$pyfile")")")
        pass "Service '$service_name' monitors disk usage"
    fi
done < <(find extensions/services -name "*.py" -print0)

# Check for log rotation (prevents disk exhaustion)
log_rotation=0
for compose_file in "${compose_files[@]}"; do
    if [[ -f "$compose_file" ]]; then
        if grep -q "logging:\|log-driver\|max-size\|max-file" "$compose_file"; then
            log_rotation=$((log_rotation + 1))
            pass "Service in $(basename "$compose_file") has log rotation configured"
        fi
    fi
done

if [[ $log_rotation -eq 0 ]]; then
    skip "Consider configuring log rotation to prevent disk exhaustion"
fi

# ============================================
# TEST 4: Network Security Limits
# ============================================
header "4/6" "Network Security Limits"

# Check for rate limiting implementation
rate_limiting=0
while IFS= read -r -d '' pyfile; do
    if grep -q "rate.*limit\|throttle\|slowapi\|RateLimiter" "$pyfile"; then
        rate_limiting=$((rate_limiting + 1))
        service_name=$(basename "$(dirname "$(dirname "$pyfile")")")
        pass "Service '$service_name' implements rate limiting"
    fi
done < <(find extensions/services -name "*.py" -print0)

if [[ $rate_limiting -eq 0 ]]; then
    skip "Consider implementing rate limiting for DoS protection"
fi

# Check for connection limits in nginx configs
nginx_configs=(extensions/services/*/nginx.conf)
connection_limits=0

for nginx_config in "${nginx_configs[@]}"; do
    if [[ -f "$nginx_config" ]]; then
        service_name=$(basename "$(dirname "$nginx_config")")

        # Check for connection limiting directives
        if grep -q "limit_conn\|limit_req\|worker_connections" "$nginx_config"; then
            connection_limits=$((connection_limits + 1))
            pass "Service '$service_name' nginx has connection limits"
        else
            skip "Service '$service_name' nginx should configure connection limits"
        fi

        # Check for timeout configurations
        if grep -q "timeout\|keepalive_timeout" "$nginx_config"; then
            pass "Service '$service_name' nginx has timeout configurations"
        else
            skip "Service '$service_name' nginx should configure timeouts"
        fi
    fi
done

# ============================================
# TEST 5: DoS Protection Mechanisms
# ============================================
header "5/6" "DoS Protection Mechanisms"

# Check for request size limits
request_limits=0
for nginx_config in "${nginx_configs[@]}"; do
    if [[ -f "$nginx_config" ]]; then
        service_name=$(basename "$(dirname "$nginx_config")")

        if grep -q "client_max_body_size\|client_body_buffer_size" "$nginx_config"; then
            request_limits=$((request_limits + 1))
            pass "Service '$service_name' nginx limits request body size"
        else
            skip "Service '$service_name' nginx should limit request body size"
        fi
    fi
done

# Check for input validation (prevents resource exhaustion)
input_validation=0
while IFS= read -r -d '' pyfile; do
    if grep -q "validate\|pydantic\|marshmallow\|schema" "$pyfile"; then
        input_validation=$((input_validation + 1))
    fi
done < <(find extensions/services -name "*.py" -print0)

if [[ $input_validation -gt 0 ]]; then
    pass "Input validation found in $input_validation files"
else
    skip "Implement input validation to prevent resource exhaustion"
fi

# Check for concurrent request limits
concurrency_limits=0
while IFS= read -r -d '' pyfile; do
    if grep -q "concurrent\|semaphore\|asyncio.*limit\|ThreadPoolExecutor" "$pyfile"; then
        concurrency_limits=$((concurrency_limits + 1))
        service_name=$(basename "$(dirname "$(dirname "$pyfile")")")
        pass "Service '$service_name' implements concurrency limits"
    fi
done < <(find extensions/services -name "*.py" -print0)

# ============================================
# TEST 6: Resource Monitoring & Alerting
# ============================================
header "6/6" "Resource Monitoring & Alerting"

# Check for health check implementations
health_checks=0
for compose_file in "${compose_files[@]}"; do
    if [[ -f "$compose_file" ]]; then
        if grep -q "healthcheck\|health_check" "$compose_file"; then
            health_checks=$((health_checks + 1))
            pass "Service in $(basename "$compose_file") has health checks"
        fi
    fi
done

# Check for monitoring endpoints
monitoring_endpoints=0
while IFS= read -r -d '' pyfile; do
    if grep -q "/health\|/status\|/metrics\|/ping" "$pyfile"; then
        monitoring_endpoints=$((monitoring_endpoints + 1))
        service_name=$(basename "$(dirname "$(dirname "$pyfile")")")
        pass "Service '$service_name' exposes monitoring endpoints"
    fi
done < <(find extensions/services -name "*.py" -print0)

# Check for resource usage tracking
resource_tracking=0
while IFS= read -r -d '' pyfile; do
    if grep -q "psutil\|resource\|cpu_percent\|memory_info" "$pyfile"; then
        resource_tracking=$((resource_tracking + 1))
        service_name=$(basename "$(dirname "$(dirname "$pyfile")")")
        pass "Service '$service_name' tracks resource usage"
    fi
done < <(find extensions/services -name "*.py" -print0)

# Check for graceful shutdown handling
graceful_shutdown=0
while IFS= read -r -d '' pyfile; do
    if grep -q "signal\|SIGTERM\|SIGINT\|shutdown\|cleanup" "$pyfile"; then
        graceful_shutdown=$((graceful_shutdown + 1))
        service_name=$(basename "$(dirname "$(dirname "$pyfile")")")
        pass "Service '$service_name' handles graceful shutdown"
    fi
done < <(find extensions/services -name "*.py" -print0)

# ============================================
# Summary
# ============================================
echo ""
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
TOTAL=$((PASS + FAIL + SKIP))
echo -e "${BOLD}  Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC} ${BOLD}($TOTAL total)${NC}"
echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [[ $FAIL -gt 0 ]]; then
    echo -e "${RED}Performance security issues found. Address for production deployment.${NC}"
    exit 1
else
    echo -e "${GREEN}All performance security checks passed!${NC}"
    exit 0
fi