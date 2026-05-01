#!/bin/bash
# ============================================================================
# Dream Server Installer — Hardware Detection
# ============================================================================
# Part of: installers/lib/
# Purpose: GPU detection, capability profile loading, backend contract
#          loading, Secure Boot NVIDIA auto-fix
#
# Expects: SCRIPT_DIR, LOG_FILE, CAPABILITY_PROFILE_FILE, color codes,
#           INTERACTIVE, TIER, OFFLINE_MODE, ENABLE_VOICE, ENABLE_WORKFLOWS,
#           ENABLE_RAG, ENABLE_OPENCLAW (all used by fix_nvidia_secure_boot),
#           log/warn/ai/ai_ok/ai_warn/ai_bad helpers
# Provides: detect_gpu(), load_capability_profile(),
#           normalize_profile_tier(), tier_rank(), load_backend_contract(),
#           fix_nvidia_secure_boot(), MIN_DRIVER_VERSION
#
# Modder notes:
#   Add new GPU vendors or APU detection logic here.
#   The fix_nvidia_secure_boot() function handles Secure Boot key enrollment.
# ============================================================================

# Safe env loading (no eval) for script output KEY="value" lines
[[ -f "${SCRIPT_DIR:-}/lib/safe-env.sh" ]] && . "${SCRIPT_DIR}/lib/safe-env.sh"

load_capability_profile() {
    CAP_PROFILE_LOADED="false"
    local builder="$SCRIPT_DIR/scripts/build-capability-profile.sh"
    if [[ ! -x "$builder" ]]; then
        log "Capability profile builder not found, using installer-local detection."
        return 1
    fi

    local env_out
    if env_out="$("$builder" --output "$CAPABILITY_PROFILE_FILE" --env 2>>"$LOG_FILE")"; then
        load_env_from_output <<< "$env_out"
        CAP_PROFILE_LOADED="true"
        log "Capability profile loaded: ${CAP_PROFILE_FILE:-$CAPABILITY_PROFILE_FILE}"
        log "Capability profile: platform=${CAP_PLATFORM_ID:-unknown}, gpu=${CAP_GPU_VENDOR:-unknown}, tier=${CAP_RECOMMENDED_TIER:-unknown}"
        [[ -n "${CAP_HARDWARE_CLASS_ID:-}" ]] && log "Hardware class: ${CAP_HARDWARE_CLASS_ID} (${CAP_HARDWARE_CLASS_LABEL:-unknown})"
        return 0
    fi

    warn "Capability profile generation failed, falling back to installer-local detection."
    return 1
}

normalize_profile_tier() {
    case "$1" in
        T0) echo "0" ;;
        T1) echo "1" ;;
        T2) echo "2" ;;
        T3) echo "3" ;;
        T4) echo "4" ;;
        NV_ULTRA|SH_LARGE|SH_COMPACT|ARC|ARC_LITE) echo "$1" ;;
        *) echo "" ;;
    esac
}

tier_rank() {
    case "$1" in
        NV_ULTRA|SH_LARGE) echo 5 ;;
        4) echo 4 ;;
        SH_COMPACT|3) echo 3 ;;
        ARC|2) echo 2 ;;
        ARC_LITE|1) echo 1 ;;
        0) echo 0 ;;
        *) echo 1 ;;
    esac
}

load_backend_contract() {
    local backend="$1"
    local loader="$SCRIPT_DIR/scripts/load-backend-contract.sh"
    BACKEND_CONTRACT_LOADED="false"
    if [[ ! -x "$loader" ]]; then
        warn "Backend contract loader missing, using built-in backend defaults."
        return 1
    fi
    local env_out
    if env_out="$("$loader" --backend "$backend" --env 2>>"$LOG_FILE")"; then
        load_env_from_output <<< "$env_out"
        BACKEND_CONTRACT_LOADED="true"
        log "Backend contract loaded: ${BACKEND_CONTRACT_FILE:-unknown}"
        log "Backend runtime: ${BACKEND_CONTRACT_ID:-$backend} (${BACKEND_LLM_ENGINE:-unknown})"
        return 0
    fi
    warn "Could not load backend contract for '$backend', using built-in defaults."
    return 1
}

get_host_logical_cpus() {
    local cores
    cores=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo "1")
    if [[ "$cores" =~ ^[0-9]+$ ]] && [[ "$cores" -gt 0 ]]; then
        echo "$cores"
    else
        echo "1"
    fi
}

get_docker_available_cpus() {
    local cores=""
    if command -v docker &>/dev/null; then
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
    local backend="${1:-cpu}"
    local available="${2:-$(get_docker_available_cpus)}"
    local desired_limit=8
    local desired_reservation=1

    case "$backend" in
        amd)
            desired_limit=16
            desired_reservation=4
            ;;
        nvidia|intel|sycl)
            desired_limit=16
            desired_reservation=2
            ;;
        apple)
            desired_limit=8
            desired_reservation=2
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

detect_gpu() {
    GPU_BACKEND="cpu"  # default to CPU-only fallback
    GPU_MEMORY_TYPE="none"
    GPU_DEVICE_ID=""

    # Try NVIDIA first — validate hardware via sysfs vendor ID (0x10de)
    # before trusting nvidia-smi, which may be installed without NVIDIA hardware
    # (e.g. nvidia-container-toolkit on AMD-only systems).
    # DREAM_DRM_SYS can be overridden in tests to point at a mock sysfs tree.
    local _drm_sys="${DREAM_DRM_SYS:-/sys/class/drm}"
    local _nvidia_hw=false
    for _v in "$_drm_sys"/card*/device/vendor; do
        [[ "$(cat "$_v" 2>/dev/null)" == "0x10de" ]] && _nvidia_hw=true && break
    done
    # WSL2: /sys/class/drm/ only contains a 'version' file — no card* entries exist.
    # Fall back to nvidia-smi as the sole hardware witness on WSL2.
    if ! $_nvidia_hw && grep -qiE "microsoft|wsl" /proc/sys/kernel/osrelease 2>/dev/null; then
        command -v nvidia-smi &>/dev/null && _nvidia_hw=true
    fi
    if $_nvidia_hw && command -v nvidia-smi &> /dev/null; then
        local raw
        if raw=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null) && [[ -n "$raw" ]]; then
            GPU_BACKEND="nvidia"
            GPU_MEMORY_TYPE="discrete"
            GPU_INFO="$raw"
            GPU_NAME=$(echo "$GPU_INFO" | head -1 | cut -d',' -f1 | xargs)
            GPU_COUNT=$(echo "$GPU_INFO" | wc -l)
            # Sum VRAM across all GPUs (each line = one GPU)
            GPU_VRAM=$(echo "$GPU_INFO" | cut -d',' -f2 | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')
            # Check for unified memory (GB10, GB200): nvidia-smi reports [N/A]
            # for memory.total when GPU shares system RAM.
            if [[ $GPU_VRAM -eq 0 ]]; then
                local vram_field
                vram_field=$(echo "$GPU_INFO" | head -1 | cut -d',' -f2 | xargs)
                if [[ "$vram_field" == "[N/A]" || "$vram_field" == "N/A" ]]; then
                    GPU_MEMORY_TYPE="unified"
                    local ram_kb
                    ram_kb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}')
                    if [[ -n "$ram_kb" && "$ram_kb" -gt 0 ]]; then
                        GPU_VRAM=$((ram_kb / 1024))
                        log "GPU: $GPU_NAME — unified memory detected ([N/A] from nvidia-smi)"
                        log "Using system RAM as VRAM budget: ${GPU_VRAM}MB"
                    else
                        warn "Cannot determine system RAM for unified memory GPU"
                    fi
                fi
            fi
            # Extract PCI device ID from first GPU
            local pci_id
            pci_id=$(nvidia-smi --query-gpu=pci.device_id --format=csv,noheader 2>/dev/null | head -1 | xargs)
            [[ -n "$pci_id" ]] && GPU_DEVICE_ID="${pci_id:0:6}"
            if [[ $GPU_COUNT -gt 1 ]]; then
                # Build a display name for multi-GPU (e.g. "RTX 3090 + RTX 4090" or "RTX 4090 × 2")
                local first_name second_name
                first_name=$(echo "$GPU_INFO" | sed -n '1p' | cut -d',' -f1 | xargs)
                second_name=$(echo "$GPU_INFO" | sed -n '2p' | cut -d',' -f1 | xargs)
                if [[ "$first_name" == "$second_name" ]]; then
                    GPU_NAME="${first_name} × ${GPU_COUNT}"
                else
                    GPU_NAME="${first_name} + ${second_name}"
                    [[ $GPU_COUNT -gt 2 ]] && GPU_NAME="${GPU_NAME} + $((GPU_COUNT - 2)) more"
                fi
                log "GPU: ${GPU_COUNT}x NVIDIA (${GPU_VRAM}MB total VRAM) — ${GPU_NAME}"
            else
                log "GPU: $GPU_NAME (${GPU_VRAM}MB VRAM)"
            fi
            return 0
        fi
    fi

    # Try Intel Arc via lspci + sysfs
    if lspci 2>/dev/null | grep -qi 'VGA.*Intel.*Arc'; then
        for card_dir in "$_drm_sys"/card*/device; do
            [[ -d "$card_dir" ]] || continue
            local vendor device
            vendor=$(cat "$card_dir/vendor" 2>/dev/null) || continue
            device=$(cat "$card_dir/device" 2>/dev/null) || continue
            # Intel vendor ID: 0x8086, Arc device IDs: 0x56a0-0x56c1 (Alchemist), 0x5690-0x569f (DG2)
            if [[ "$vendor" == "0x8086" ]] && [[ "$device" =~ ^0x(56[a-c][0-9a-f]|569[0-9a-f])$ ]]; then
                GPU_BACKEND="intel"
                GPU_MEMORY_TYPE="discrete"
                GPU_DEVICE_ID="$device"
                GPU_COUNT=1
                # Try to get VRAM size from sysfs (lmem_total_bytes on Arc)
                local vram_bytes
                vram_bytes=$(cat "$card_dir/lmem_total_bytes" 2>/dev/null) || vram_bytes=0
                GPU_VRAM=$(( vram_bytes / 1048576 ))  # in MB
                # Try marketing name from sysfs or lspci
                if [[ -f "$card_dir/product_name" ]]; then
                    GPU_NAME=$(cat "$card_dir/product_name" 2>/dev/null) || GPU_NAME="Intel Arc"
                else
                    GPU_NAME=$(lspci | grep -i 'VGA.*Intel.*Arc' | sed 's/.*: //' | head -1)
                    [[ -z "$GPU_NAME" ]] && GPU_NAME="Intel Arc ($GPU_DEVICE_ID)"
                fi
                log "GPU: $GPU_NAME (${GPU_VRAM}MB VRAM, Intel Arc)"
                return 0
            fi
        done
    fi

    # Try AMD APU (Strix Halo / unified memory) via sysfs
    for card_dir in "$_drm_sys"/card*/device; do
        [[ -d "$card_dir" ]] || continue
        local vendor
        vendor=$(cat "$card_dir/vendor" 2>/dev/null) || continue
        if [[ "$vendor" == "0x1002" ]]; then
            local vram_bytes gtt_bytes
            vram_bytes=$(cat "$card_dir/mem_info_vram_total" 2>/dev/null) || vram_bytes=0
            gtt_bytes=$(cat "$card_dir/mem_info_gtt_total" 2>/dev/null) || gtt_bytes=0
            local gtt_gb=$(( gtt_bytes / 1073741824 ))
            local vram_gb=$(( vram_bytes / 1073741824 ))

            # Read device ID from sysfs
            GPU_DEVICE_ID=$(cat "$card_dir/device" 2>/dev/null) || GPU_DEVICE_ID="unknown"

            # Detect APU: small VRAM + large GTT = unified memory.
            # GTT is the reliable signal — it represents system RAM available to
            # the GPU and is large on APUs (Strix Halo). VRAM alone is not a
            # safe gate: a future discrete 32 GB+ AMD card would be misidentified
            # as unified memory if vram_gb >= 32 were kept as an OR branch.
            if [[ $gtt_gb -ge 16 && $vram_gb -le 4 ]] || [[ $gtt_gb -ge 32 ]]; then
                GPU_BACKEND="amd"
                GPU_MEMORY_TYPE="unified"
                GPU_VRAM=$(( vram_bytes / 1048576 ))  # in MB
                GPU_COUNT=1
                # Try marketing name
                if [[ -f "$card_dir/product_name" ]]; then
                    GPU_NAME=$(cat "$card_dir/product_name" 2>/dev/null) || GPU_NAME="AMD APU"
                else
                    GPU_NAME="AMD APU ($GPU_DEVICE_ID)"
                fi
                log "GPU: $GPU_NAME (unified memory, AMD APU, device_id=$GPU_DEVICE_ID)"

                # Check for NPU (Ryzen AI) for Lemonade hybrid mode
                HAS_NPU=false
                if [[ -d /sys/class/misc/amdnpu ]] || lspci 2>/dev/null | grep -qi 'AMD.*NPU\|AMD.*IPU'; then
                    HAS_NPU=true
                    log "NPU detected: Ryzen AI Neural Processing Unit"
                fi
                return 0
            fi
        fi
    done

    # No GPU detected - fall back to CPU-only mode
    GPU_NAME="None (CPU-only mode)"
    GPU_VRAM=0
    GPU_COUNT=0
    GPU_BACKEND="cpu"
    GPU_MEMORY_TYPE="none"
    warn "No GPU detected. Falling back to CPU-only mode (inference will be slow)."
    log "CPU-only mode: llama.cpp will use CPU inference. Consider adding a GPU for better performance."
    return 1
}

MIN_DRIVER_VERSION=570

fix_nvidia_secure_boot() {
    # Step 1: Is there even NVIDIA hardware on this machine?
    if ! lspci 2>/dev/null | grep -qi 'nvidia'; then
        return 1  # No hardware — nothing to fix
    fi

    ai "NVIDIA GPU hardware detected but driver not responding."

    # Step 2: Ensure a driver package is installed
    local installed_driver
    installed_driver=$(dpkg-query -W -f='${Package}\n' 'nvidia-driver-*' 2>/dev/null \
                       | sed -n 's/.*nvidia-driver-\([0-9][0-9]*\).*/\1/p' | sort -n | tail -1 || true)

    if [[ -z "$installed_driver" ]]; then
        ai "No NVIDIA driver package found. Installing recommended driver..."
        if command -v ubuntu-drivers &>/dev/null; then
            sudo ubuntu-drivers install 2>>"$LOG_FILE" || \
            sudo apt-get install -y "nvidia-driver-${MIN_DRIVER_VERSION}" 2>>"$LOG_FILE" || true
        else
            sudo apt-get install -y "nvidia-driver-${MIN_DRIVER_VERSION}" 2>>"$LOG_FILE" || true
        fi
        installed_driver=$(dpkg-query -W -f='${Package}\n' 'nvidia-driver-*' 2>/dev/null \
                           | sed -n 's/.*nvidia-driver-\([0-9][0-9]*\).*/\1/p' | sort -n | tail -1 || true)
        if [[ -z "$installed_driver" ]]; then
            ai_bad "Failed to install NVIDIA driver."
            return 1
        fi
        ai_ok "Installed nvidia-driver-${installed_driver}"
    else
        ai "Driver nvidia-driver-${installed_driver} is installed."
    fi

    # Step 3: Try loading the module — see why it fails
    local modprobe_err
    modprobe_err=$(sudo modprobe nvidia 2>&1) || true

    if nvidia-smi &>/dev/null; then
        ai_ok "NVIDIA driver loaded successfully"
        # Regenerate CDI spec so Docker sees the correct driver libraries
        if command -v nvidia-ctk &>/dev/null; then
            sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml 2>>"$LOG_FILE" || true
        fi
        detect_gpu || true
        return 0
    fi

    # Step 4: If it's not a Secure Boot issue, bail out
    if ! echo "$modprobe_err" | grep -qi "key was rejected"; then
        ai_bad "NVIDIA module failed to load: $modprobe_err"
        return 1
    fi

    # Step 5: Secure Boot is blocking the module — ensure it's properly signed
    ai_warn "Secure Boot is blocking the NVIDIA kernel module."
    ai "Preparing module signing..."

    local kver mok_dir sign_file
    kver=$(uname -r)
    mok_dir="/var/lib/shim-signed/mok"
    sudo mkdir -p "$mok_dir"

    # Ensure linux-headers are present (needed for sign-file)
    if [[ ! -d "/usr/src/linux-headers-${kver}" ]]; then
        ai "Installing kernel headers for ${kver}..."
        sudo apt-get install -y "linux-headers-${kver}" 2>>"$LOG_FILE" || true
    fi

    # Generate MOK keypair if not already present
    if [[ ! -f "$mok_dir/MOK.priv" ]] || [[ ! -f "$mok_dir/MOK.der" ]]; then
        sudo openssl req -new -x509 -newkey rsa:2048 \
            -keyout "$mok_dir/MOK.priv" \
            -outform DER -out "$mok_dir/MOK.der" \
            -nodes -days 36500 \
            -subj "/CN=Dream Server Module Signing/" 2>>"$LOG_FILE"
        sudo chmod 600 "$mok_dir/MOK.priv"
        ai_ok "Generated MOK signing key"
    else
        ai_ok "Using existing MOK signing key"
    fi

    # Locate the sign-file tool
    sign_file=""
    for candidate in \
        "/usr/src/linux-headers-${kver}/scripts/sign-file" \
        "/usr/lib/linux-kbuild-${kver%.*}/scripts/sign-file"; do
        if [[ -x "$candidate" ]]; then
            sign_file="$candidate"
            break
        fi
    done
    if [[ -z "$sign_file" ]]; then
        sign_file=$(find /usr/src /usr/lib -name sign-file -executable -print -quit 2>/dev/null)
    fi
    if [[ -z "$sign_file" ]]; then
        ai_bad "Cannot find kernel sign-file tool."
        ai "Try: sudo apt install linux-headers-${kver}"
        return 1
    fi

    # Sign every nvidia DKMS module (handles .ko, .ko.zst, .ko.xz)
    local signed_count=0
    for mod_path in /lib/modules/${kver}/updates/dkms/nvidia*.ko*; do
        [[ -f "$mod_path" ]] || continue
        case "$mod_path" in
            *.zst)
                sudo zstd -d -f "$mod_path" -o "${mod_path%.zst}" 2>>"$LOG_FILE"
                sudo "$sign_file" sha256 "$mok_dir/MOK.priv" "$mok_dir/MOK.der" "${mod_path%.zst}" 2>>"$LOG_FILE"
                sudo zstd -f --rm "${mod_path%.zst}" -o "$mod_path" 2>>"$LOG_FILE"
                ;;
            *.xz)
                sudo xz -d -f -k "$mod_path" 2>>"$LOG_FILE"
                sudo "$sign_file" sha256 "$mok_dir/MOK.priv" "$mok_dir/MOK.der" "${mod_path%.xz}" 2>>"$LOG_FILE"
                sudo xz -f "${mod_path%.xz}" 2>>"$LOG_FILE"
                sudo mv "${mod_path%.xz}.xz" "$mod_path" 2>>"$LOG_FILE"
                ;;
            *)
                sudo "$sign_file" sha256 "$mok_dir/MOK.priv" "$mok_dir/MOK.der" "$mod_path" 2>>"$LOG_FILE"
                ;;
        esac
        signed_count=$((signed_count + 1))
    done
    sudo depmod -a 2>>"$LOG_FILE"
    ai_ok "Signed $signed_count NVIDIA module(s)"

    # Step 6: Try loading — if MOK key is already enrolled, this works immediately
    if sudo modprobe nvidia 2>>"$LOG_FILE" && nvidia-smi &>/dev/null; then
        ai_ok "NVIDIA driver loaded — GPU is online"
        # Regenerate CDI spec so Docker sees the correct driver libraries
        if command -v nvidia-ctk &>/dev/null; then
            sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml 2>>"$LOG_FILE" || true
        fi
        detect_gpu || true
        return 0
    fi

    # Step 7: MOK key needs firmware enrollment — one reboot required
    # This is the standard Ubuntu Secure Boot flow (same thing Ubuntu's
    # "Additional Drivers" tool does).  It only happens once per machine.

    local mok_pass
    mok_pass=$(openssl rand -hex 4)
    printf '%s\n%s\n' "$mok_pass" "$mok_pass" | sudo mokutil --import "$mok_dir/MOK.der" 2>>"$LOG_FILE"

    # --- Auto-resume: create a systemd oneshot so the install continues
    #     automatically after reboot (user doesn't have to re-run manually)
    local svc_name="dream-server-install-resume"
    local resume_args="--force --non-interactive"
    $ENABLE_VOICE && resume_args="$resume_args --voice"
    $ENABLE_WORKFLOWS && resume_args="$resume_args --workflows"
    $ENABLE_RAG && resume_args="$resume_args --rag"
    $ENABLE_OPENCLAW && resume_args="$resume_args --openclaw"
    [[ -n "$TIER" ]] && resume_args="$resume_args --tier $TIER"
    [[ "$OFFLINE_MODE" == "true" ]] && resume_args="$resume_args --offline"

    sudo tee /etc/systemd/system/${svc_name}.service > /dev/null << SVCEOF
[Unit]
Description=Dream Server Install (auto-resume after Secure Boot enrollment)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash ${SCRIPT_DIR}/install.sh ${resume_args}
ExecStartPost=/bin/rm -f /etc/systemd/system/${svc_name}.service
ExecStartPost=/bin/systemctl daemon-reload
WorkingDirectory=${SCRIPT_DIR}
Environment="HOME=${HOME}"
Environment="USER=${USER}"
StandardOutput=journal+console
StandardError=journal+console

[Install]
WantedBy=multi-user.target
SVCEOF
    sudo systemctl daemon-reload
    sudo systemctl enable "${svc_name}.service" 2>>"$LOG_FILE"
    log "Auto-resume service installed: ${svc_name}.service"

    # --- Show a clean, friendly reboot screen ---
    echo ""
    echo ""
    echo -e "${GRN}+--------------------------------------------------------------+${NC}"
    echo -e "${GRN}|${NC}                                                              ${GRN}|${NC}"
    echo -e "${GRN}|${NC}   ${AMB}One-time reboot needed${NC}                                    ${GRN}|${NC}"
    echo -e "${GRN}|${NC}                                                              ${GRN}|${NC}"
    echo -e "${GRN}|${NC}   Your GPU requires a Secure Boot key enrollment.            ${GRN}|${NC}"
    echo -e "${GRN}|${NC}   This is normal and only happens once.                      ${GRN}|${NC}"
    echo -e "${GRN}|${NC}                                                              ${GRN}|${NC}"
    echo -e "${GRN}+--------------------------------------------------------------+${NC}"
    echo -e "${GRN}|${NC}                                                              ${GRN}|${NC}"
    echo -e "${GRN}|${NC}   After reboot a ${AMB}blue screen${NC} will appear:                  ${GRN}|${NC}"
    echo -e "${GRN}|${NC}                                                              ${GRN}|${NC}"
    echo -e "${GRN}|${NC}     ${BGRN}1.${NC} Select \"Enroll MOK\"                                  ${GRN}|${NC}"
    echo -e "${GRN}|${NC}     ${BGRN}2.${NC} Select \"Continue\"                                    ${GRN}|${NC}"
    echo -e "${GRN}|${NC}     ${BGRN}3.${NC} Type password:  ${BGRN}${mok_pass}${NC}                            ${GRN}|${NC}"
    echo -e "${GRN}|${NC}     ${BGRN}4.${NC} Select \"Reboot\"                                     ${GRN}|${NC}"
    echo -e "${GRN}|${NC}                                                              ${GRN}|${NC}"
    echo -e "${GRN}|${NC}   Installation will ${BGRN}continue automatically${NC} after reboot.    ${GRN}|${NC}"
    echo -e "${GRN}|${NC}                                                              ${GRN}|${NC}"
    echo -e "${GRN}+--------------------------------------------------------------+${NC}"
    echo ""

    if $INTERACTIVE; then
        read -p "  Press Enter to reboot (or Ctrl+C to do it later)... " -r < /dev/tty
        sudo reboot
    fi

    # Non-interactive mode: exit cleanly (not an error — reboot is a normal install phase)
    ai "Reboot this machine to continue installation."
    exit 0
}
