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
        T1) echo "1" ;;
        T2) echo "2" ;;
        T3) echo "3" ;;
        T4) echo "4" ;;
        NV_ULTRA|SH_LARGE|SH_COMPACT) echo "$1" ;;
        *) echo "" ;;
    esac
}

tier_rank() {
    case "$1" in
        NV_ULTRA|SH_LARGE) echo 5 ;;
        4) echo 4 ;;
        SH_COMPACT|3) echo 3 ;;
        2) echo 2 ;;
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

detect_gpu() {
    GPU_BACKEND="nvidia"  # default
    GPU_MEMORY_TYPE="discrete"
    GPU_DEVICE_ID=""

    # Try NVIDIA first
    if command -v nvidia-smi &> /dev/null; then
        local raw
        if raw=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null) && [[ -n "$raw" ]]; then
            GPU_INFO="$raw"
            GPU_NAME=$(echo "$GPU_INFO" | head -1 | cut -d',' -f1 | xargs)
            GPU_COUNT=$(echo "$GPU_INFO" | wc -l)
            # Sum VRAM across all GPUs (each line = one GPU)
            GPU_VRAM=$(echo "$GPU_INFO" | cut -d',' -f2 | grep -oP '\d+' | awk '{s+=$1} END {print s+0}')
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

    # Try AMD APU (Strix Halo / unified memory) via sysfs
    for card_dir in /sys/class/drm/card*/device; do
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

            # Detect APU: small VRAM + large GTT = unified memory
            if [[ $gtt_gb -ge 16 && $vram_gb -le 4 ]] || [[ $gtt_gb -ge 32 ]] || [[ $vram_gb -ge 32 ]]; then
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
                return 0
            fi
        fi
    done

    GPU_NAME="None"
    GPU_VRAM=0
    GPU_COUNT=0
    warn "No NVIDIA or AMD GPU detected. CPU-only mode available but slow."
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
                       | grep -oP 'nvidia-driver-\K\d+' | sort -n | tail -1 || true)

    if [[ -z "$installed_driver" ]]; then
        ai "No NVIDIA driver package found. Installing recommended driver..."
        if command -v ubuntu-drivers &>/dev/null; then
            sudo ubuntu-drivers install 2>>"$LOG_FILE" || \
            sudo apt-get install -y "nvidia-driver-${MIN_DRIVER_VERSION}" 2>>"$LOG_FILE" || true
        else
            sudo apt-get install -y "nvidia-driver-${MIN_DRIVER_VERSION}" 2>>"$LOG_FILE" || true
        fi
        installed_driver=$(dpkg-query -W -f='${Package}\n' 'nvidia-driver-*' 2>/dev/null \
                           | grep -oP 'nvidia-driver-\K\d+' | sort -n | tail -1 || true)
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
        sign_file=$(find /usr/src /usr/lib -name sign-file -executable 2>/dev/null | head -1)
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
        read -p "  Press Enter to reboot (or Ctrl+C to do it later)... " -r
        sudo reboot
    fi

    # Non-interactive mode: exit cleanly (not an error — reboot is a normal install phase)
    ai "Reboot this machine to continue installation."
    exit 0
}
