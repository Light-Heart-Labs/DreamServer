#!/bin/bash
# Dream Server Hardware Detection
# Detects GPU, CPU, RAM and recommends tier
# Supports: NVIDIA (nvidia-smi), AMD APU/dGPU (sysfs), Apple Silicon

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Detect OS and environment
detect_os() {
    if [[ -f /proc/version ]] && grep -qi microsoft /proc/version 2>/dev/null; then
        echo "wsl"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    else
        echo "unknown"
    fi
}

# Detect NVIDIA GPU
detect_nvidia() {
    if command -v nvidia-smi &>/dev/null; then
        nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null | head -1
    fi
}

# Detect AMD GPU via sysfs (works without ROCm installed)
# Returns: gpu_name|vram_bytes|gtt_bytes|is_apu|gpu_busy|temp|power|vulkan|rocm|driver|device_id|subsystem_device|revision
detect_amd_sysfs() {
    for card_dir in /sys/class/drm/card*/device; do
        [[ -d "$card_dir" ]] || continue
        local vendor
        vendor=$(cat "$card_dir/vendor" 2>/dev/null) || continue

        # 0x1002 = AMD
        if [[ "$vendor" == "0x1002" ]]; then
            local vram_total gtt_total gpu_name gpu_busy temp power hwmon_dir is_apu
            local device_id subsystem_device revision

            # Read PCI device identifiers
            device_id=$(cat "$card_dir/device" 2>/dev/null) || device_id="unknown"
            subsystem_device=$(cat "$card_dir/subsystem_device" 2>/dev/null) || subsystem_device="unknown"
            revision=$(cat "$card_dir/revision" 2>/dev/null) || revision="unknown"

            # Read memory info
            vram_total=$(cat "$card_dir/mem_info_vram_total" 2>/dev/null) || vram_total=0
            gtt_total=$(cat "$card_dir/mem_info_gtt_total" 2>/dev/null) || gtt_total=0

            # Detect if APU (unified memory)
            # Strix Halo has small VRAM carve-out (UMA frame buffer, often 1GB)
            # but large GTT (actual usable GPU memory from system RAM).
            is_apu="false"
            if [[ $vram_total -gt 0 && $gtt_total -gt 0 ]]; then
                local vram_gb=$(( vram_total / 1073741824 ))
                local gtt_gb=$(( gtt_total / 1073741824 ))
                if [[ $gtt_gb -ge 16 && $vram_gb -le 4 ]]; then
                    # Small VRAM + large GTT = APU with unified memory
                    is_apu="true"
                elif [[ $gtt_gb -ge 32 ]]; then
                    is_apu="true"
                elif [[ $vram_gb -ge 32 ]]; then
                    is_apu="true"
                fi
            fi

            # GPU utilization
            gpu_busy=$(cat "$card_dir/gpu_busy_percent" 2>/dev/null) || gpu_busy=0

            # Find hwmon for temp/power
            temp=0
            power=0
            for hwmon_dir in "$card_dir"/hwmon/hwmon*; do
                if [[ -d "$hwmon_dir" ]]; then
                    local raw_temp raw_power
                    raw_temp=$(cat "$hwmon_dir/temp1_input" 2>/dev/null) || raw_temp=0
                    temp=$(( raw_temp / 1000 ))  # millidegrees → C
                    raw_power=$(cat "$hwmon_dir/power1_average" 2>/dev/null) || raw_power=0
                    power=$(( raw_power / 1000000 ))  # microwatts → W
                    break
                fi
            done

            # Try to get GPU name from various sources
            gpu_name=""
            # Try marketing name first
            if [[ -f "$card_dir/product_name" ]]; then
                gpu_name=$(cat "$card_dir/product_name" 2>/dev/null) || true
            fi
            # Fall back to device ID lookup
            if [[ -z "$gpu_name" ]]; then
                gpu_name="AMD GPU ($device_id)"
            fi

            # Check for Vulkan support
            local vulkan_available="false"
            if command -v vulkaninfo &>/dev/null; then
                if vulkaninfo --summary 2>/dev/null | grep -qiE "radeon|amd|gfx11"; then
                    vulkan_available="true"
                fi
            fi

            # Check for ROCm
            local rocm_available="false"
            if command -v rocminfo &>/dev/null; then
                rocm_available="true"
            fi

            # Check amdgpu driver loaded
            local driver_loaded="false"
            if lsmod 2>/dev/null | grep -q amdgpu; then
                driver_loaded="true"
            fi

            echo "${gpu_name}|${vram_total}|${gtt_total}|${is_apu}|${gpu_busy}|${temp}|${power}|${vulkan_available}|${rocm_available}|${driver_loaded}|${device_id}|${subsystem_device}|${revision}"
            return 0
        fi
    done
    return 1
}

# Detect AMD GPU (legacy ROCm-only path)
detect_amd() {
    # Try sysfs first (works without ROCm)
    local sysfs_out
    if sysfs_out=$(detect_amd_sysfs 2>/dev/null); then
        echo "$sysfs_out"
        return 0
    fi
    # Fall back to rocm-smi
    if command -v rocm-smi &>/dev/null; then
        rocm-smi --showproductname --showmeminfo vram 2>/dev/null | grep -E "GPU|Total Memory" | head -2
    fi
}

# Detect Apple Silicon
detect_apple() {
    if [[ "$(detect_os)" == "macos" ]]; then
        sysctl -n machdep.cpu.brand_string 2>/dev/null
        # Unified memory = system RAM on Apple Silicon
        sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1024/1024/1024)"GB unified"}'
    fi
}

# Get CPU info
detect_cpu() {
    local os=$(detect_os)
    case $os in
        macos)
            sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Unknown"
            ;;
        *)
            grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs || echo "Unknown"
            ;;
    esac
}

# Get CPU cores
detect_cores() {
    local os=$(detect_os)
    case $os in
        macos)
            sysctl -n hw.ncpu 2>/dev/null || echo "0"
            ;;
        *)
            nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo "0"
            ;;
    esac
}

# Get RAM in GB
detect_ram() {
    local os=$(detect_os)
    case $os in
        macos)
            sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1024/1024/1024)}'
            ;;
        *)
            grep MemTotal /proc/meminfo 2>/dev/null | awk '{print int($2/1024/1024)}'
            ;;
    esac
}

# Parse VRAM from nvidia-smi output (in MB)
parse_nvidia_vram() {
    local output="$1"
    echo "$output" | awk -F',' '{gsub(/^ +| +$/,"",$2); print int($2)}'
}

# Determine tier based on VRAM (discrete GPU)
# T4: 48GB+ | T3: 20-47GB | T2: 12-19GB | T1: <12GB
get_tier() {
    local vram_mb=$1
    local vram_gb=$((vram_mb / 1024))

    if [[ $vram_gb -ge 48 ]]; then
        echo "T4"
    elif [[ $vram_gb -ge 20 ]]; then
        echo "T3"
    elif [[ $vram_gb -ge 12 ]]; then
        echo "T2"
    else
        echo "T1"
    fi
}

# Determine Strix Halo tier based on unified memory
# SH_LARGE: 90GB+ | SH_COMPACT: <90GB
get_strix_halo_tier() {
    local unified_gb=$1

    if [[ $unified_gb -ge 90 ]]; then
        echo "SH_LARGE"
    else
        echo "SH_COMPACT"
    fi
}

# Determine Apple Silicon tier based on unified memory
# AP_PRO: 36GB+ | AP_BASE: <36GB
get_apple_tier() {
    local unified_gb=$1
    if [[ $unified_gb -ge 96 ]]; then
        echo "AP_ULTRA"
    elif [[ $unified_gb -ge 36 ]]; then
        echo "AP_PRO"
    else
        echo "AP_BASE"
    fi
}

# Get tier description (supports NVIDIA, Strix Halo, and Apple tiers)
tier_description() {
    case $1 in
        T4)    echo "Ultimate (48GB+): Full 70B models, multi-model serving" ;;
        T3)    echo "Pro (20-47GB): 32B models, comfortable headroom" ;;
        T2)    echo "Starter (12-19GB): 7-14B models, lean configs" ;;
        T1)    echo "Mini (<12GB): Small models or CPU inference" ;;
        SH_LARGE)   echo "Strix Halo 90+: qwen3-coder-next 80B MoE (90GB+ unified)" ;;
        SH_COMPACT) echo "Strix Halo Compact: qwen3:30b-a3b 30B MoE (<90GB unified)" ;;
        AP_ULTRA)   echo "Apple Ultra (96GB+): 70B models via CPU inference in Docker" ;;
        AP_PRO)     echo "Apple Pro (36GB+): 32B models via CPU inference in Docker" ;;
        AP_BASE)    echo "Apple Base (<36GB): 7B models via CPU inference in Docker" ;;
    esac
}

# Get recommended model for tier
tier_model() {
    case $1 in
        T4)    echo "Qwen/Qwen2.5-72B-Instruct-AWQ" ;;
        T3)    echo "Qwen/Qwen2.5-32B-Instruct-AWQ" ;;
        T2)    echo "Qwen/Qwen2.5-7B-Instruct-AWQ" ;;
        T1)    echo "Qwen/Qwen2.5-1.5B-Instruct" ;;
        SH_LARGE)   echo "qwen3-coder-next" ;;
        SH_COMPACT) echo "qwen3:30b-a3b" ;;
        AP_ULTRA)   echo "Qwen/Qwen2.5-72B-Instruct-Q4_K_M.gguf" ;;
        AP_PRO)     echo "Qwen/Qwen2.5-32B-Instruct-Q4_K_M.gguf" ;;
        AP_BASE)    echo "Qwen/Qwen2.5-7B-Instruct-Q4_K_M.gguf" ;;
    esac
}

# Main detection
main() {
    local json_output=false
    [[ "$1" == "--json" ]] && json_output=true

    local os=$(detect_os)
    local cpu=$(detect_cpu)
    local cores=$(detect_cores)
    local ram=$(detect_ram)
    local gpu_name=""
    local gpu_vram_mb=0
    local gpu_type="none"
    local gpu_architecture=""
    local memory_type="discrete"
    local gpu_temp=0
    local gpu_power=0
    local gpu_busy=0
    local vulkan_available="false"
    local rocm_available="false"
    local driver_loaded="false"
    local device_id=""
    local subsystem_device=""
    local revision=""

    # Try NVIDIA first
    local nvidia_out=$(detect_nvidia)
    if [[ -n "$nvidia_out" ]]; then
        gpu_name=$(echo "$nvidia_out" | awk -F',' '{gsub(/^ +| +$/,"",$1); print $1}')
        gpu_vram_mb=$(parse_nvidia_vram "$nvidia_out")
        gpu_type="nvidia"
        gpu_architecture="cuda"
        memory_type="discrete"
        # Extract PCI device ID from nvidia-smi
        if command -v nvidia-smi &>/dev/null; then
            local pci_id
            pci_id=$(nvidia-smi --query-gpu=pci.device_id --format=csv,noheader 2>/dev/null | head -1 | xargs)
            # nvidia-smi returns e.g. "0x26B110DE" — extract device portion (first 6 chars)
            [[ -n "$pci_id" ]] && device_id="${pci_id:0:6}"
        fi
    fi

    # Try AMD if no NVIDIA
    if [[ -z "$gpu_name" ]]; then
        local amd_out
        if amd_out=$(detect_amd_sysfs 2>/dev/null); then
            # Parse pipe-delimited output from detect_amd_sysfs
            IFS='|' read -r gpu_name vram_bytes gtt_bytes is_apu busy temp power vulkan rocm driver dev_id subsys_dev rev <<< "$amd_out"

            local vram_gb=$(( vram_bytes / 1073741824 ))
            gpu_vram_mb=$(( vram_bytes / 1048576 ))
            gpu_type="amd"
            gpu_temp=$temp
            gpu_power=$power
            gpu_busy=$busy
            vulkan_available=$vulkan
            rocm_available=$rocm
            driver_loaded=$driver
            device_id=$dev_id
            subsystem_device=$subsys_dev
            revision=$rev

            if [[ "$is_apu" == "true" ]]; then
                gpu_architecture="apu-unified"
                memory_type="unified"
            else
                gpu_architecture="rdna"
                memory_type="discrete"
            fi
        fi
    fi

    # Try Apple Silicon if macOS
    if [[ -z "$gpu_name" && "$os" == "macos" ]]; then
        local apple_out=$(detect_apple)
        if [[ -n "$apple_out" ]]; then
            gpu_name="Apple Silicon (Unified Memory)"
            gpu_vram_mb=$((ram * 1024))
            gpu_type="apple"
            gpu_architecture="apple-unified"
            memory_type="unified"
        fi
    fi

    # Determine tier
    # For unified memory AMD APUs, use system RAM — VRAM reports only GTT (unreliable)
    local tier tier_desc recommended_model
    if [[ "$memory_type" == "unified" && "$gpu_type" == "amd" ]]; then
        tier=$(get_strix_halo_tier "$ram")
    elif [[ "$gpu_type" == "apple" ]]; then
        local unified_gb=$((gpu_vram_mb / 1024))
        tier=$(get_apple_tier $unified_gb)
    else
        tier=$(get_tier $gpu_vram_mb)
    fi
    tier_desc=$(tier_description $tier)
    recommended_model=$(tier_model $tier)
    local gpu_vram_gb=$((gpu_vram_mb / 1024))

    if $json_output; then
        cat <<EOF
{
  "os": "$os",
  "cpu": "$cpu",
  "cores": $cores,
  "ram_gb": $ram,
  "gpu": {
    "type": "$gpu_type",
    "name": "$gpu_name",
    "architecture": "$gpu_architecture",
    "memory_type": "$memory_type",
    "vram_mb": $gpu_vram_mb,
    "vram_gb": $gpu_vram_gb,
    "device_id": "$device_id",
    "subsystem_device": "$subsystem_device",
    "revision": "$revision",
    "utilization": $gpu_busy,
    "temperature_c": $gpu_temp,
    "power_w": $gpu_power,
    "vulkan": $vulkan_available,
    "rocm": $rocm_available,
    "driver_loaded": $driver_loaded
  },
  "tier": "$tier",
  "tier_description": "$tier_desc",
  "recommended_model": "$recommended_model"
}
EOF
    else
        echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
        echo -e "${BLUE}║      Dream Server Hardware Detection     ║${NC}"
        echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${GREEN}System:${NC}"
        echo "  OS:       $os"
        echo "  CPU:      $cpu"
        echo "  Cores:    $cores"
        echo "  RAM:      ${ram}GB"
        echo ""
        echo -e "${GREEN}GPU:${NC}"
        if [[ -n "$gpu_name" ]]; then
            echo "  Type:     $gpu_type"
            echo "  Name:     $gpu_name"
            if [[ "$memory_type" == "unified" ]]; then
                echo -e "  Memory:   ${CYAN}${gpu_vram_gb}GB (Unified)${NC}"
            else
                echo "  VRAM:     ${gpu_vram_gb}GB"
            fi
            if [[ "$gpu_type" == "amd" ]]; then
                echo "  Arch:     $gpu_architecture"
                [[ $gpu_temp -gt 0 ]] && echo "  Temp:     ${gpu_temp}C"
                [[ $gpu_power -gt 0 ]] && echo "  Power:    ${gpu_power}W"
                [[ $gpu_busy -gt 0 ]] && echo "  Load:     ${gpu_busy}%"
                echo "  Vulkan:   $vulkan_available"
                echo "  ROCm:     $rocm_available"
                echo "  Driver:   $driver_loaded"
            fi
        else
            echo "  No GPU detected (CPU-only mode)"
        fi
        echo ""
        echo -e "${YELLOW}Recommended Tier: ${tier}${NC}"
        echo "  $tier_desc"
        echo -e "  Model: ${CYAN}${recommended_model}${NC}"
        echo ""
    fi
}

main "$@"
