#!/bin/bash
# ============================================================================
# Dream Server macOS Installer -- Hardware Detection
# ============================================================================
# Part of: installers/macos/lib/
# Purpose: Apple Silicon detection, RAM, Docker Desktop validation,
#          disk space, macOS version, port conflicts
#
# Canonical source: installers/lib/detection.sh (keep tier thresholds in sync)
#
# Modder notes:
#   All system RAM is "VRAM" on Apple Silicon (unified memory architecture).
#   Add new chip detection patterns in get_apple_silicon_info().
# ============================================================================

# ── Apple Silicon Detection ──

get_apple_silicon_info() {
    # Returns chip model, variant, and core counts
    local arch
    arch=$(uname -m 2>/dev/null || echo "unknown")

    APPLE_ARCH="$arch"
    APPLE_CHIP=""
    APPLE_CHIP_VARIANT=""
    APPLE_IS_APPLE_SILICON=false

    if [[ "$arch" != "arm64" ]]; then
        return
    fi

    APPLE_IS_APPLE_SILICON=true

    # Get chip brand string (e.g., "Apple M2 Max")
    local chip_brand
    chip_brand=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Apple Silicon")
    APPLE_CHIP="$chip_brand"

    # Parse variant from brand string
    if [[ "$chip_brand" =~ Ultra ]]; then
        APPLE_CHIP_VARIANT="Ultra"
    elif [[ "$chip_brand" =~ Max ]]; then
        APPLE_CHIP_VARIANT="Max"
    elif [[ "$chip_brand" =~ Pro ]]; then
        APPLE_CHIP_VARIANT="Pro"
    else
        APPLE_CHIP_VARIANT="base"
    fi

    # Get core counts
    APPLE_PERF_CORES=$(sysctl -n hw.perflevel0.logicalcpu 2>/dev/null || echo "0")
    APPLE_EFF_CORES=$(sysctl -n hw.perflevel1.logicalcpu 2>/dev/null || echo "0")
    APPLE_GPU_CORES=$(system_profiler SPDisplaysDataType 2>/dev/null | grep -i "Total Number of Cores" | awk '{print $NF}' || echo "unknown")

    # Neural Engine presence (all Apple Silicon has NE, but check anyway)
    if system_profiler SPHardwareDataType 2>/dev/null | grep -qiE "Neural Engine|Apple M"; then
        APPLE_HAS_NEURAL_ENGINE=true
    else
        APPLE_HAS_NEURAL_ENGINE=false
    fi
}

# ── System RAM ──

get_system_ram_gb() {
    local ram_bytes
    ram_bytes=$(sysctl -n hw.memsize 2>/dev/null || echo "0")
    SYSTEM_RAM_GB=$(( ram_bytes / 1073741824 ))
}

# ── macOS Version ──

get_macos_version() {
    MACOS_VERSION=$(sw_vers -productVersion 2>/dev/null || echo "0.0.0")
    MACOS_MAJOR=$(echo "$MACOS_VERSION" | cut -d. -f1)
    MACOS_BUILD=$(sw_vers -buildVersion 2>/dev/null || echo "unknown")

    # Friendly name mapping
    case "$MACOS_MAJOR" in
        15) MACOS_NAME="Sequoia" ;;
        14) MACOS_NAME="Sonoma" ;;
        13) MACOS_NAME="Ventura" ;;
        12) MACOS_NAME="Monterey" ;;
        *)  MACOS_NAME="macOS ${MACOS_MAJOR}" ;;
    esac
}

# ── Docker Desktop ──

test_docker_desktop() {
    DOCKER_INSTALLED=false
    DOCKER_RUNNING=false
    DOCKER_VERSION=""

    # Check if docker CLI is available
    if ! command -v docker >/dev/null 2>&1; then
        return
    fi
    DOCKER_INSTALLED=true

    # Check if Docker daemon is responsive
    if docker version >/dev/null 2>&1; then
        DOCKER_RUNNING=true
        DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "unknown")
    fi
}

get_host_logical_cpus() {
    local cores
    cores=$(sysctl -n hw.ncpu 2>/dev/null || echo "1")
    if [[ "$cores" =~ ^[0-9]+$ ]] && [[ "$cores" -gt 0 ]]; then
        echo "$cores"
    else
        echo "1"
    fi
}

get_docker_available_cpus() {
    local cores=""
    if command -v docker >/dev/null 2>&1; then
        cores=$(docker info --format '{{.NCPU}}' 2>/dev/null || true)
        cores="${cores//[!0-9]/}"
    fi

    if [[ "$cores" =~ ^[0-9]+$ ]] && [[ "$cores" -gt 0 ]]; then
        echo "$cores"
        return 0
    fi

    get_host_logical_cpus
}

calculate_llama_cpu_budget() {
    local backend="${1:-apple}"
    local available="${2:-$(get_docker_available_cpus)}"
    local desired_limit=8
    local desired_reservation=2

    case "$backend" in
        amd)
            desired_limit=16
            desired_reservation=4
            ;;
        nvidia|intel|sycl)
            desired_limit=16
            desired_reservation=2
            ;;
        cpu)
            desired_limit=8
            desired_reservation=1
            ;;
    esac

    if ! [[ "$available" =~ ^[0-9]+$ ]] || [[ "$available" -lt 1 ]]; then
        available=1
    fi

    local limit="$desired_limit"
    local reservation="$desired_reservation"
    [[ "$available" -lt "$limit" ]] && limit="$available"
    [[ "$reservation" -gt "$limit" ]] && reservation="$limit"

    echo "$limit $reservation $available"
}

# ── Disk Space ──

test_disk_space() {
    local path="${1:-$HOME}"
    local required_gb="${2:-30}"

    # Walk up to nearest existing parent if path doesn't exist yet (first install)
    while [[ ! -d "$path" ]]; do path="$(dirname "$path")"; done

    # macOS df with -g flag shows GB
    local free_gb
    free_gb=$(df -g "$path" 2>/dev/null | tail -1 | awk '{print $4}')
    if [[ -z "$free_gb" || "$free_gb" == "0" ]]; then
        # Fallback: use df -BG (Linux-style, unlikely on macOS but safe)
        free_gb=$(df -BG "$path" 2>/dev/null | tail -1 | awk '{gsub(/G/, "", $4); print int($4)}')
    fi
    DISK_FREE_GB="${free_gb:-0}"
    DISK_REQUIRED_GB="$required_gb"
    DISK_SUFFICIENT=false
    if [[ "$DISK_FREE_GB" -ge "$DISK_REQUIRED_GB" ]]; then
        DISK_SUFFICIENT=true
    fi
}

# ── Port Conflict Detection ──

check_port_conflict() {
    local port="$1"
    local name="${2:-unknown}"

    if lsof -i ":${port}" -sTCP:LISTEN >/dev/null 2>&1; then
        local pid
        pid=$(lsof -t -i ":${port}" -sTCP:LISTEN 2>/dev/null | head -1)
        local proc_name
        proc_name=$(ps -p "$pid" -o comm= 2>/dev/null || echo "unknown")
        PORT_CONFLICT=true
        PORT_CONFLICT_PID="$pid"
        PORT_CONFLICT_PROC="$proc_name"
        return 0
    fi
    PORT_CONFLICT=false
    PORT_CONFLICT_PID=""
    PORT_CONFLICT_PROC=""
    return 1
}

# ── Ollama Detection ──

check_ollama_conflict() {
    OLLAMA_RUNNING=false
    OLLAMA_PID=""

    if pgrep -x ollama >/dev/null 2>&1; then
        OLLAMA_RUNNING=true
        OLLAMA_PID=$(pgrep -x ollama | head -1)
    fi
}
