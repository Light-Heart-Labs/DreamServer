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

    # Management scripts and Memory Shepherd already copied by rsync/cp block above
    [[ -d "$INSTALL_DIR/memory-shepherd" ]] && ai_ok "Memory Shepherd installed"

    # ── Install systemd user timers (session cleanup, session manager, memory shepherd) ──
    ai "Installing maintenance timers..."
    SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
    mkdir -p "$SYSTEMD_USER_DIR"

    # Ensure scripts are executable
    chmod_exit=0
    chmod +x "$INSTALL_DIR/scripts/session-cleanup.sh" \
             "$INSTALL_DIR/memory-shepherd/memory-shepherd.sh" 2>/dev/null || chmod_exit=$?
    [[ $chmod_exit -ne 0 ]] && log "chmod scripts failed (exit $chmod_exit)"

    # Copy all systemd unit files
    if [[ -d "$INSTALL_DIR/scripts/systemd" ]]; then
        cp_systemd_exit=0
        cp "$INSTALL_DIR/scripts/systemd"/*.service "$INSTALL_DIR/scripts/systemd"/*.timer \
            "$SYSTEMD_USER_DIR/" 2>/dev/null || cp_systemd_exit=$?
        [[ $cp_systemd_exit -ne 0 ]] && log "cp systemd units failed (exit $cp_systemd_exit)"
    fi

    # Create archive directories for memory shepherd
    mkdir -p "$INSTALL_DIR/data/memory-archives/dream-agent"/{memory,agents,tools}

    # Reload and enable all timers
    systemctl_reload_exit=0
    systemctl --user daemon-reload 2>/dev/null || systemctl_reload_exit=$?
    [[ $systemctl_reload_exit -ne 0 ]] && log "systemctl --user daemon-reload failed (exit $systemctl_reload_exit)"

    for timer in openclaw-session-cleanup openclaw-session-manager memory-shepherd-workspace memory-shepherd-memory; do
        timer_enable_exit=0
        systemctl --user enable --now "${timer}.timer" >> "$LOG_FILE" 2>&1 || timer_enable_exit=$?
        [[ $timer_enable_exit -ne 0 ]] && log "systemctl enable ${timer}.timer failed (exit $timer_enable_exit)"
    done
    ai_ok "Maintenance timers enabled (session cleanup, session manager, memory shepherd)"

    # Enable lingering so user timers survive logout
    linger_exit=0
    loginctl enable-linger "$(whoami)" 2>/dev/null || linger_exit=$?
    if [[ $linger_exit -ne 0 ]]; then
        sudo_linger_exit=0
        sudo -n loginctl enable-linger "$(whoami)" 2>/dev/null || sudo_linger_exit=$?
        if [[ $sudo_linger_exit -ne 0 ]]; then
            ai_warn "Could not enable linger. Timers may stop after logout. Run: loginctl enable-linger $(whoami)"
        fi
    fi

    # Install sysctl tuning (vm.swappiness, vfs_cache_pressure)
    if [[ -f "$INSTALL_DIR/config/system-tuning/99-dream-server.conf" ]]; then
        cp_sysctl_exit=0
        sudo -n cp "$INSTALL_DIR/config/system-tuning/99-dream-server.conf" /etc/sysctl.d/ 2>/dev/null || cp_sysctl_exit=$?
        if [[ $cp_sysctl_exit -eq 0 ]]; then
            sysctl_apply_exit=0
            sudo -n sysctl --system >> "$LOG_FILE" 2>&1 || sysctl_apply_exit=$?
            [[ $sysctl_apply_exit -ne 0 ]] && log "sysctl --system failed (exit $sysctl_apply_exit)"
            ai_ok "sysctl tuning applied (swappiness=10, vfs_cache_pressure=50)"
        else
            ai_warn "Could not install sysctl tuning (needs sudo). Copy manually:"
            ai "  sudo cp config/system-tuning/99-dream-server.conf /etc/sysctl.d/"
        fi
    fi

    # Install amdgpu modprobe options
    if [[ -f "$INSTALL_DIR/config/system-tuning/amdgpu.conf" ]]; then
        cp_amdgpu_exit=0
        sudo -n cp "$INSTALL_DIR/config/system-tuning/amdgpu.conf" /etc/modprobe.d/ 2>/dev/null || cp_amdgpu_exit=$?
        if [[ $cp_amdgpu_exit -eq 0 ]]; then
            ai_ok "amdgpu modprobe tuning installed (ppfeaturemask, gpu_recovery)"
        else
            ai_warn "Could not install amdgpu modprobe config (needs sudo). Copy manually:"
            ai "  sudo cp config/system-tuning/amdgpu.conf /etc/modprobe.d/"
        fi
    fi

    # Install GTT memory optimization for unified memory APU
    if [[ -f "$INSTALL_DIR/config/system-tuning/amdgpu_llm_optimized.conf" ]]; then
        cp_gtt_exit=0
        sudo -n cp "$INSTALL_DIR/config/system-tuning/amdgpu_llm_optimized.conf" /etc/modprobe.d/ 2>/dev/null || cp_gtt_exit=$?
        if [[ $cp_gtt_exit -eq 0 ]]; then
            ai_ok "GTT memory tuning installed (gttsize=120000, pages_limit, page_pool_size)"
        else
            ai_warn "Could not install GTT memory config (needs sudo). Copy manually:"
            ai "  sudo cp config/system-tuning/amdgpu_llm_optimized.conf /etc/modprobe.d/"
        fi
    fi

    # Configure kernel boot parameters for optimal GPU memory access
    if [[ -f /etc/default/grub ]]; then
        grub_cmdline_exit=0
        current_cmdline=$(grep '^GRUB_CMDLINE_LINUX_DEFAULT=' /etc/default/grub 2>/dev/null) || grub_cmdline_exit=$?
        if [[ $grub_cmdline_exit -eq 0 && -n "$current_cmdline" ]]; then
            grep_iommu_exit=0
            echo "$current_cmdline" | grep -q 'amd_iommu=off' || grep_iommu_exit=$?
            if [[ $grep_iommu_exit -ne 0 ]]; then
                ai "Recommended: add 'amd_iommu=off' to kernel boot parameters for ~2-6% GPU improvement"
                ai "  Run: sudo sed -i 's/iommu=pt/amd_iommu=off/' /etc/default/grub && sudo update-grub"
                ai "  Or if iommu=pt is not set:"
                ai "  sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT=\"\\(.*\\)\"/GRUB_CMDLINE_LINUX_DEFAULT=\"\\1 amd_iommu=off\"/' /etc/default/grub && sudo update-grub"
            fi
        fi
    fi

    # Enable tuned with accelerator-performance profile for CPU governor optimization
    if command -v tuned-adm >/dev/null 2>&1; then
        tuned_active_exit=0
        systemctl is-active --quiet tuned 2>/dev/null || tuned_active_exit=$?
        if [[ $tuned_active_exit -ne 0 ]]; then
            tuned_enable_exit=0
            sudo -n systemctl enable --now tuned 2>/dev/null || tuned_enable_exit=$?
            if [[ $tuned_enable_exit -eq 0 ]]; then
                tuned_profile_exit=0
                sudo -n tuned-adm profile accelerator-performance 2>/dev/null || tuned_profile_exit=$?
                if [[ $tuned_profile_exit -eq 0 ]]; then
                    ai_ok "tuned profile set to accelerator-performance (5-8% pp improvement)"
                else
                    ai_warn "tuned started but could not set profile. Run: sudo tuned-adm profile accelerator-performance"
                fi
            else
                ai_warn "Could not start tuned. Run manually:"
                ai "  sudo systemctl enable --now tuned && sudo tuned-adm profile accelerator-performance"
            fi
        else
            tuned_active_profile_exit=0
            active_profile=$(tuned-adm active 2>/dev/null | grep -oP 'Current active profile: \K.*') || tuned_active_profile_exit=$?
            [[ $tuned_active_profile_exit -ne 0 ]] && active_profile=""
            if [[ "$active_profile" != "accelerator-performance" ]]; then
                tuned_change_exit=0
                sudo -n tuned-adm profile accelerator-performance 2>/dev/null || tuned_change_exit=$?
                if [[ $tuned_change_exit -eq 0 ]]; then
                    ai_ok "tuned profile changed to accelerator-performance"
                else
                    ai_warn "tuned running but wrong profile. Run: sudo tuned-adm profile accelerator-performance"
                fi
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
fi
