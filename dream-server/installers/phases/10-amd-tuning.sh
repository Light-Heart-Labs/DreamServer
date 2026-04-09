#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 10: AMD System Tuning
# ============================================================================
# Part of: installers/phases/
# Purpose: AMD APU (Strix Halo) sysctl, modprobe, GRUB, and tuned setup
#
# Expects: GPU_BACKEND, DRY_RUN, INSTALL_DIR, LOG_FILE, PKG_MANAGER,
#           ai(), ai_ok(), ai_warn(), log()
# Provides: System tuning applied (sysctl, modprobe, timers, tuned)
#
# Modder notes:
#   Add new AMD-specific tuning parameters or kernel options here.
# ============================================================================

dream_progress 70 "amd-tuning" "Tuning AMD GPU settings"
if [[ "$GPU_BACKEND" == "amd" ]] && $DRY_RUN; then
    log "[DRY RUN] Would apply AMD APU system tuning:"
    log "[DRY RUN]   - Install systemd user timers (session cleanup, memory shepherd)"
    log "[DRY RUN]   - Apply sysctl tuning (swappiness=10, vfs_cache_pressure=50)"
    log "[DRY RUN]   - Install amdgpu modprobe options"
    log "[DRY RUN]   - Install GTT memory optimization"
    log "[DRY RUN]   - Configure tuned accelerator-performance profile"
elif [[ "$GPU_BACKEND" == "amd" ]] && ! $DRY_RUN; then
    ai "Applying system tuning for AMD APU..."

    # Ensure user is in render and video groups for ROCm GPU access
    # Without these, containers can't access /dev/kfd and /dev/dri
    if ! groups "$USER" 2>/dev/null | grep -qw render || ! groups "$USER" 2>/dev/null | grep -qw video; then
        if [[ "${INTERACTIVE:-true}" == "true" ]]; then
            sudo usermod -aG render,video "$USER" && \
                ai_ok "Added $USER to render and video groups (needed for GPU access)" || \
                ai_warn "Could not add $USER to render/video groups. Run: sudo usermod -aG render,video $USER"
        else
            sudo -n usermod -aG render,video "$USER" 2>/dev/null && \
                ai_ok "Added $USER to render and video groups (needed for GPU access)" || \
                ai_warn "Could not add $USER to render/video groups. Run: sudo usermod -aG render,video $USER"
        fi
    fi

    # Verify GPU compute devices exist — containers need /dev/kfd and /dev/dri
    if [[ ! -e /dev/kfd ]]; then
        ai "ROCm compute device /dev/kfd not found. Loading kernel module..."
        sudo -n modprobe amdkfd 2>/dev/null || true
        if [[ -e /dev/kfd ]]; then
            ai_ok "/dev/kfd loaded successfully"
        else
            ai_warn "/dev/kfd still not available after modprobe."
            ai_warn "GPU containers (llama-server, comfyui) will fail without it."
            ai_warn "Fix: reboot, or run: sudo modprobe amdkfd"
        fi
    fi

    if [[ ! -d /dev/dri ]]; then
        ai_warn "/dev/dri not found. The amdgpu driver may not be loaded."
        ai_warn "GPU containers will fail. Try: sudo modprobe amdgpu, or reboot."
    elif [[ ! -e /dev/dri/renderD128 ]]; then
        ai_warn "/dev/dri exists but renderD128 is missing. GPU compute may not work."
        ai_warn "Check: ls -la /dev/dri/ — you need at least card0/card1 and renderD128."
    else
        ai_ok "GPU devices verified (/dev/kfd, /dev/dri/renderD128)"
    fi

    # Management scripts and Memory Shepherd already copied by rsync/cp block above
    [[ -d "$INSTALL_DIR/memory-shepherd" ]] && ai_ok "Memory Shepherd installed"

    # ── Install systemd user timers (session cleanup, session manager, memory shepherd) ──
    ai "Installing maintenance timers..."
    SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SYSTEMD_USER_DIR"

    # Ensure scripts are executable
    chmod +x "$INSTALL_DIR/scripts/session-cleanup.sh" \
             "$INSTALL_DIR/memory-shepherd/memory-shepherd.sh" 2>/dev/null || true

    # Copy all systemd unit files
    if [[ -d "$INSTALL_DIR/scripts/systemd" ]]; then
        cp "$INSTALL_DIR/scripts/systemd"/*.service "$INSTALL_DIR/scripts/systemd"/*.timer \
            "$SYSTEMD_USER_DIR/" 2>/dev/null || true
    fi

    # Create archive directories for memory shepherd
    mkdir -p "$INSTALL_DIR/data/memory-archives/dream-agent"/{memory,agents,tools}

    # Reload and enable all timers
    systemctl --user daemon-reload 2>/dev/null || true
    for timer in openclaw-session-cleanup memory-shepherd-workspace memory-shepherd-memory; do
        systemctl --user enable --now "${timer}.timer" >> "$LOG_FILE" 2>&1 || true
    done
    ai_ok "Maintenance timers enabled (session cleanup, memory shepherd)"

    # Enable lingering so user timers survive logout
    loginctl enable-linger "$(whoami)" 2>/dev/null || \
        sudo -n loginctl enable-linger "$(whoami)" 2>/dev/null || \
        ai_warn "Could not enable linger. Timers may stop after logout. Run: loginctl enable-linger $(whoami)"

    # Install sysctl tuning (vm.swappiness, vfs_cache_pressure)
    if [[ -f "$INSTALL_DIR/config/system-tuning/99-dream-server.conf" ]]; then
        if sudo -n cp "$INSTALL_DIR/config/system-tuning/99-dream-server.conf" /etc/sysctl.d/ 2>/dev/null; then
            sudo -n sysctl --system > /dev/null 2>&1 || true
            ai_ok "sysctl tuning applied (swappiness=10, vfs_cache_pressure=50)"
        else
            ai_warn "Could not install sysctl tuning (needs sudo). Copy manually:"
            ai "  sudo cp config/system-tuning/99-dream-server.conf /etc/sysctl.d/"
        fi
    fi

    # Install amdgpu modprobe options
    if [[ -f "$INSTALL_DIR/config/system-tuning/amdgpu.conf" ]]; then
        if sudo -n cp "$INSTALL_DIR/config/system-tuning/amdgpu.conf" /etc/modprobe.d/ 2>/dev/null; then
            ai_ok "amdgpu modprobe tuning installed (ppfeaturemask, gpu_recovery)"
        else
            ai_warn "Could not install amdgpu modprobe config (needs sudo). Copy manually:"
            ai "  sudo cp config/system-tuning/amdgpu.conf /etc/modprobe.d/"
        fi
    fi

    # ── BIOS recommendation for unified memory APU ──
    ai ""
    ai "╔══════════════════════════════════════════════════════════════════╗"
    ai "║  BIOS SETUP (one-time, manual step for best performance):      ║"
    ai "║                                                                ║"
    ai "║  Set UMA Frame Buffer Size → 512 MB (minimum)                 ║"
    ai "║                                                                ║"
    ai "║  This lets Dream Server use your full unified memory pool.     ║"
    ai "║  Location varies by vendor:                                    ║"
    ai "║    HP:   Advanced → Display → UMA Frame Buffer Size            ║"
    ai "║    ASUS: Advanced → AMD CBS → NBIO → GFX → UMA Frame Buffer   ║"
    ai "║    Lenovo: Advanced → AMD PBS → UMA Frame Buffer Size          ║"
    ai "╚══════════════════════════════════════════════════════════════════╝"
    ai ""

    # Install GTT memory optimization for unified memory APU
    # Dynamically calculate GTT size based on total RAM — use ~65% for GPU, leave rest for OS/Docker
    total_ram_mb=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo "0")
    if [[ "$total_ram_mb" -gt 0 ]]; then
        # 65% of total RAM for GTT, in MB (e.g. 128GB → ~83GB, leaves ~45GB for OS/Docker)
        gtt_size=$(( total_ram_mb * 65 / 100 ))
        # pages_limit = gtt_size_bytes / 4096
        pages_limit=$(( gtt_size * 1024 * 1024 / 4096 ))
        # page_pool_size = pages_limit / 2
        page_pool_size=$(( pages_limit / 2 ))

        cat > /tmp/dream-gtt-tuning.conf << GTT_EOF
# /etc/modprobe.d/amdgpu_llm_optimized.conf — GTT memory for LLM inference
# Generated by Dream Server installer for ${total_ram_mb}MB total RAM
# GTT = 65% of RAM (~${gtt_size}MB), leaving ~$((total_ram_mb - gtt_size))MB for OS/Docker
options amdgpu gttsize=${gtt_size}
options ttm pages_limit=${pages_limit}
options ttm page_pool_size=${page_pool_size}
GTT_EOF
        if sudo -n cp /tmp/dream-gtt-tuning.conf /etc/modprobe.d/amdgpu_llm_optimized.conf 2>/dev/null; then
            # Rebuild initramfs so the new modprobe config takes effect on next boot
            sudo -n update-initramfs -u >> "$LOG_FILE" 2>&1 || \
                sudo -n dracut --force >> "$LOG_FILE" 2>&1 || true
            ai_ok "GTT memory tuning installed (gttsize=${gtt_size}MB of ${total_ram_mb}MB, 65%)"
            _amd_needs_reboot=true
        else
            ai_warn "Could not install GTT memory config (needs sudo). Copy manually:"
            ai "  sudo cp /tmp/dream-gtt-tuning.conf /etc/modprobe.d/amdgpu_llm_optimized.conf"
        fi
        rm -f /tmp/dream-gtt-tuning.conf
    else
        ai_warn "Could not detect total RAM — skipping GTT tuning"
    fi

    # Configure kernel boot parameters for optimal GPU memory access
    if [[ -f /etc/default/grub ]]; then
        current_cmdline=$(grep '^GRUB_CMDLINE_LINUX_DEFAULT=' /etc/default/grub 2>/dev/null || true)
        if [[ "${GPU_COUNT:-1}" -gt 1 ]]; then
            # Multi-GPU: iommu=pt is REQUIRED for proper device passthrough
            if [[ -n "$current_cmdline" ]] && ! echo "$current_cmdline" | grep -q 'iommu=pt'; then
                ai_warn "Multi-GPU requires 'iommu=pt' kernel parameter for device passthrough"
                ai "  Add to GRUB_CMDLINE_LINUX_DEFAULT in /etc/default/grub:"
                ai "  sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT=\"\\(.*\\)\"/GRUB_CMDLINE_LINUX_DEFAULT=\"\\1 iommu=pt\"/' /etc/default/grub && sudo update-grub"
                ai "  Then reboot."
            elif [[ -n "$current_cmdline" ]] && echo "$current_cmdline" | grep -q 'iommu=pt'; then
                ai_ok "iommu=pt kernel parameter is set (required for multi-GPU)"
            fi
        else
            # Single GPU APU: amd_iommu=off gives ~2-6% improvement
            if [[ -n "$current_cmdline" ]] && ! echo "$current_cmdline" | grep -q 'amd_iommu=off'; then
                ai "Recommended: add 'amd_iommu=off' to kernel boot parameters for ~2-6% GPU improvement"
                ai "  Run: sudo sed -i 's/iommu=pt/amd_iommu=off/' /etc/default/grub && sudo update-grub"
                ai "  Or if iommu=pt is not set:"
                ai "  sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT=\"\\(.*\\)\"/GRUB_CMDLINE_LINUX_DEFAULT=\"\\1 amd_iommu=off\"/' /etc/default/grub && sudo update-grub"
            fi
        fi
    fi

    # Multi-GPU: verify render nodes for each GPU
    if [[ "${GPU_COUNT:-1}" -gt 1 ]]; then
        render_count=0
        for rn in /dev/dri/renderD*; do
            [[ -e "$rn" ]] && ((render_count++)) || true
        done
        if [[ "$render_count" -ge "${GPU_COUNT:-1}" ]]; then
            ai_ok "Found ${render_count} render nodes for ${GPU_COUNT} GPUs"
        else
            ai_warn "Only ${render_count} render node(s) found but GPU_COUNT=${GPU_COUNT}"
            ai_warn "Some GPUs may not be usable. Check: ls -la /dev/dri/renderD*"
        fi
    fi

    # Enable tuned with accelerator-performance profile for CPU governor optimization
    if command -v tuned-adm &>/dev/null; then
        if ! systemctl is-active --quiet tuned 2>/dev/null; then
            if sudo -n systemctl enable --now tuned 2>/dev/null; then
                sudo -n tuned-adm profile accelerator-performance 2>/dev/null && \
                    ai_ok "tuned profile set to accelerator-performance (5-8% pp improvement)" || \
                    ai_warn "tuned started but could not set profile. Run: sudo tuned-adm profile accelerator-performance"
            else
                ai_warn "Could not start tuned. Run manually:"
                ai "  sudo systemctl enable --now tuned && sudo tuned-adm profile accelerator-performance"
            fi
        else
            active_profile=$(tuned-adm active 2>/dev/null | sed -n 's/^Current active profile: \(.*\)/\1/p' || true)
            if [[ "$active_profile" != "accelerator-performance" ]]; then
                sudo -n tuned-adm profile accelerator-performance 2>/dev/null && \
                    ai_ok "tuned profile changed to accelerator-performance" || \
                    ai_warn "tuned running but wrong profile. Run: sudo tuned-adm profile accelerator-performance"
            else
                ai_ok "tuned already set to accelerator-performance"
            fi
        fi
    else
        ai_warn "tuned not installed. For 5-8% prompt processing improvement:"
        _inst_cmd="sudo apt install"
        case "$PKG_MANAGER" in
            dnf)    _inst_cmd="sudo dnf install" ;;
            pacman) _inst_cmd="sudo pacman -S" ;;
            zypper) _inst_cmd="sudo zypper install" ;;
        esac
        ai "  $_inst_cmd tuned && sudo systemctl enable --now tuned && sudo tuned-adm profile accelerator-performance"
    fi

    # LiteLLM config already copied by rsync/cp block above
    [[ -f "$INSTALL_DIR/config/litellm/strix-halo-config.yaml" ]] && ai_ok "LiteLLM Strix Halo routing config installed"

    # Reboot notice if kernel-level changes were made
    if [[ "${_amd_needs_reboot:-}" == "true" ]]; then
        ai ""
        ai "╔══════════════════════════════════════════════════════════════════╗"
        ai "║  REBOOT REQUIRED                                               ║"
        ai "║                                                                ║"
        ai "║  GPU memory tuning was installed but requires a reboot to      ║"
        ai "║  take effect. Dream Server will work now, but GPU-accelerated  ║"
        ai "║  inference won't use unified memory until you reboot.          ║"
        ai "║                                                                ║"
        ai "║  Run: sudo reboot                                             ║"
        ai "╚══════════════════════════════════════════════════════════════════╝"
        ai ""
    fi
fi
