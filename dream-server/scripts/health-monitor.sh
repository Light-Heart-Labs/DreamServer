#!/bin/bash
# Dream Server Service Health Monitor
# Monitors service health and automatically restarts failed services
# Can be run as a systemd timer or standalone

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$ROOT_DIR}"

# Configuration
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-60}"  # seconds
MAX_RESTART_ATTEMPTS="${MAX_RESTART_ATTEMPTS:-3}"
RESTART_COOLDOWN="${RESTART_COOLDOWN:-300}"  # 5 minutes
LOG_FILE="${INSTALL_DIR}/logs/health-monitor.log"
STATE_FILE="${INSTALL_DIR}/.health-monitor-state"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log_info() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [INFO] $*"
    echo -e "${BLUE}${msg}${NC}"
    echo "$msg" >> "$LOG_FILE"
}

log_warn() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [WARN] $*"
    echo -e "${YELLOW}${msg}${NC}"
    echo "$msg" >> "$LOG_FILE"
}

log_error() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [ERROR] $*"
    echo -e "${RED}${msg}${NC}" >&2
    echo "$msg" >> "$LOG_FILE"
}

log_success() {
    local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [SUCCESS] $*"
    echo -e "${GREEN}${msg}${NC}"
    echo "$msg" >> "$LOG_FILE"
}

# Source service registry
if [[ -f "$ROOT_DIR/lib/service-registry.sh" ]]; then
    export SCRIPT_DIR="$ROOT_DIR"
    . "$ROOT_DIR/lib/service-registry.sh"
    sr_load
else
    log_error "Service registry not found at $ROOT_DIR/lib/service-registry.sh"
    exit 1
fi

# Create logs directory
mkdir -p "$(dirname "$LOG_FILE")"

# Load state file (tracks restart attempts and cooldowns)
declare -A RESTART_COUNTS=()
declare -A LAST_RESTART=()

load_state() {
    [[ -f "$STATE_FILE" ]] || return 0

    while IFS='=' read -r key value; do
        if [[ "$key" =~ ^restart_count_ ]]; then
            local service="${key#restart_count_}"
            RESTART_COUNTS["$service"]="$value"
        elif [[ "$key" =~ ^last_restart_ ]]; then
            local service="${key#last_restart_}"
            LAST_RESTART["$service"]="$value"
        fi
    done < "$STATE_FILE"
}

save_state() {
    local temp_file="${STATE_FILE}.tmp"

    # Write restart counts
    for service in "${!RESTART_COUNTS[@]}"; do
        echo "restart_count_${service}=${RESTART_COUNTS[$service]}" >> "$temp_file"
    done

    # Write last restart times
    for service in "${!LAST_RESTART[@]}"; do
        echo "last_restart_${service}=${LAST_RESTART[$service]}" >> "$temp_file"
    done

    if ! mv "$temp_file" "$STATE_FILE"; then
        log_error "Failed to save state file: $STATE_FILE"
        rm -f "$temp_file"
    fi
}

# Check if service is healthy
check_service_health() {
    local service="$1"
    local container
    container=$(sr_container "$service" 2>/dev/null || echo "")

    if [[ -z "$container" ]]; then
        return 1  # Service not found
    fi

    # Check if container is running
    if ! docker ps --filter "name=$container" --filter "status=running" --format "{{.Names}}" | grep -q "^$container$"; then
        return 1  # Container not running
    fi

    # Check service-specific health endpoint if available
    local health_endpoint
    health_endpoint=$(sr_health_endpoint "$service" 2>/dev/null || echo "")

    if [[ -n "$health_endpoint" ]]; then
        local port
        port=$(sr_port "$service" 2>/dev/null || echo "")
        if [[ -n "$port" ]]; then
            if ! curl -sf --max-time 5 "http://localhost:${port}${health_endpoint}" >/dev/null 2>&1; then
                return 1  # Health check failed
            fi
        fi
    fi

    return 0  # Service is healthy
}

# Restart a service
restart_service() {
    local service="$1"
    local current_time
    current_time=$(date +%s)

    # Check cooldown period
    local last_restart_time="${LAST_RESTART[$service]:-0}"
    local time_since_restart=$((current_time - last_restart_time))

    if [[ $time_since_restart -lt $RESTART_COOLDOWN ]]; then
        local remaining=$((RESTART_COOLDOWN - time_since_restart))
        log_warn "Service $service in cooldown period (${remaining}s remaining)"
        return 1
    fi

    # Check restart attempt limit
    local restart_count="${RESTART_COUNTS[$service]:-0}"
    if [[ $restart_count -ge $MAX_RESTART_ATTEMPTS ]]; then
        log_error "Service $service has exceeded max restart attempts ($MAX_RESTART_ATTEMPTS)"
        return 1
    fi

    log_info "Restarting unhealthy service: $service (attempt $((restart_count + 1))/$MAX_RESTART_ATTEMPTS)"

    # Get compose flags
    cd "$INSTALL_DIR"
    local flags_str
    flags_str=$(get_compose_flags)
    if [[ -z "$flags_str" ]]; then
        log_error "Failed to get compose flags for restart"
        return 1
    fi
    local -a flags
    read -ra flags <<< "$flags_str"

    # Restart the service
    if docker compose "${flags[@]}" restart "$service" >/dev/null 2>&1; then
        log_success "Successfully restarted service: $service"

        # Update state
        RESTART_COUNTS["$service"]=$((restart_count + 1))
        LAST_RESTART["$service"]="$current_time"
        save_state

        # Wait for service to stabilize
        sleep 10

        # Verify restart was successful
        if check_service_health "$service"; then
            log_success "Service $service is now healthy after restart"
            # Reset restart count on successful recovery
            unset RESTART_COUNTS["$service"]
            save_state
            return 0
        else
            log_warn "Service $service still unhealthy after restart"
            return 1
        fi
    else
        log_error "Failed to restart service: $service"
        return 1
    fi
}

# Get compose flags by calling shared library
get_compose_flags() {
    # Source shared compose-flags library
    if [[ -f "$ROOT_DIR/lib/compose-flags.sh" ]]; then
        . "$ROOT_DIR/lib/compose-flags.sh"
        get_compose_flags
    else
        echo ""
    fi
}

# Main monitoring loop
monitor_services() {
    local daemon_mode="${1:-false}"

    log_info "Starting Dream Server health monitor (daemon: $daemon_mode)"
    load_state

    while true; do
        local unhealthy_services=()
        local total_services=0
        local healthy_services=0

        # Check each enabled service
        while IFS= read -r service; do
            [[ -z "$service" ]] && continue
            ((total_services++))

            if check_service_health "$service"; then
                ((healthy_services++))
            else
                unhealthy_services+=("$service")
                log_warn "Unhealthy service detected: $service"
            fi
        done < <(sr_list_enabled 2>/dev/null || echo "")

        # Restart unhealthy services
        for service in "${unhealthy_services[@]}"; do
            if ! restart_service "$service"; then
                log_error "Failed to restart service: $service"
            fi
        done

        # Log summary
        if [[ ${#unhealthy_services[@]} -eq 0 ]]; then
            log_info "All services healthy ($healthy_services/$total_services)"
        else
            log_warn "Health check complete: $healthy_services/$total_services healthy, ${#unhealthy_services[@]} unhealthy"
        fi

        # Exit if not in daemon mode
        if [[ "$daemon_mode" != "true" ]]; then
            break
        fi

        # Wait for next check
        sleep "$HEALTH_CHECK_INTERVAL"
    done
}

# Reset restart counters for a service or all services
reset_counters() {
    local service="${1:-all}"

    if [[ "$service" == "all" ]]; then
        log_info "Resetting all restart counters"
        RESTART_COUNTS=()
        LAST_RESTART=()
    else
        log_info "Resetting restart counter for service: $service"
        unset RESTART_COUNTS["$service"]
        unset LAST_RESTART["$service"]
    fi

    save_state
}

# Show current status
show_status() {
    echo "Dream Server Health Monitor Status"
    echo "=================================="
    echo ""

    if [[ ${#RESTART_COUNTS[@]} -eq 0 ]]; then
        echo "No services have been restarted recently."
        return 0
    fi

    printf "%-20s %-15s %-20s\n" "SERVICE" "RESTART COUNT" "LAST RESTART"
    printf "%-20s %-15s %-20s\n" "-------" "-------------" "------------"

    for service in "${!RESTART_COUNTS[@]}"; do
        local count="${RESTART_COUNTS[$service]}"
        local last_restart="${LAST_RESTART[$service]:-0}"
        local last_restart_str="Never"

        if [[ $last_restart -gt 0 ]]; then
            last_restart_str=$(date -d "@$last_restart" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r "$last_restart" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "Unknown")
        fi

        printf "%-20s %-15s %-20s\n" "$service" "$count" "$last_restart_str"
    done
}

# Usage information
usage() {
    cat << EOF
Dream Server Health Monitor

Usage: $(basename "$0") [COMMAND] [OPTIONS]

Commands:
    monitor         Run health check once and exit (default)
    daemon          Run continuously as daemon
    status          Show restart counters and last restart times
    reset [service] Reset restart counters (all services if no service specified)
    help            Show this help

Environment Variables:
    HEALTH_CHECK_INTERVAL    Seconds between checks in daemon mode (default: 60)
    MAX_RESTART_ATTEMPTS     Max restart attempts per service (default: 3)
    RESTART_COOLDOWN         Seconds to wait between restart attempts (default: 300)

Examples:
    $(basename "$0")                    # Run health check once
    $(basename "$0") daemon             # Run as daemon
    $(basename "$0") status             # Show restart statistics
    $(basename "$0") reset llama-server # Reset counters for llama-server
    $(basename "$0") reset              # Reset all counters

EOF
}

# Main entry point
main() {
    local command="${1:-monitor}"

    case "$command" in
        monitor)
            monitor_services false
            ;;
        daemon)
            monitor_services true
            ;;
        status)
            load_state
            show_status
            ;;
        reset)
            load_state
            reset_counters "${2:-all}"
            ;;
        help|--help|-h)
            usage
            ;;
        *)
            echo "Unknown command: $command" >&2
            usage >&2
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"