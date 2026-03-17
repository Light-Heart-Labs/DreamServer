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
    for timer in openclaw-session-cleanup openclaw-session-manager memory-shepherd-workspace memory-shepherd-memory; do
        systemctl --user enable --now "${timer}.timer" >> "$LOG_FILE" 2>&1 || true
    done
    ai_ok "Maintenance timers enabled (session cleanup, session manager, memory shepherd)"

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

    # Install GTT memory optimization for unified memory APU
    if [[ -f "$INSTALL_DIR/config/system-tuning/amdgpu_llm_optimized.conf" ]]; then
        if sudo -n cp "$INSTALL_DIR/config/system-tuning/amdgpu_llm_optimized.conf" /etc/modprobe.d/ 2>/dev/null; then
            ai_ok "GTT memory tuning installed (gttsize=120000, pages_limit, page_pool_size)"
        else
            ai_warn "Could not install GTT memory config (needs sudo). Copy manually:"
            ai "  sudo cp config/system-tuning/amdgpu_llm_optimized.conf /etc/modprobe.d/"
        fi
    fi

    # Configure kernel boot parameters for optimal GPU memory access
    if [[ -f /etc/default/grub ]]; then
        current_cmdline=$(grep '^GRUB_CMDLINE_LINUX_DEFAULT=' /etc/default/grub 2>/dev/null || true)
        if [[ -n "$current_cmdline" ]] && ! echo "$current_cmdline" | grep -q 'amd_iommu=off'; then
            ai "Recommended: add 'amd_iommu=off' to kernel boot parameters for ~2-6% GPU improvement"
            ai "  Run: sudo sed -i 's/iommu=pt/amd_iommu=off/' /etc/default/grub && sudo update-grub"
            ai "  Or if iommu=pt is not set:"
            ai "  sudo sed -i 's/GRUB_CMDLINE_LINUX_DEFAULT=\"\\(.*\\)\"/GRUB_CMDLINE_LINUX_DEFAULT=\"\\1 amd_iommu=off\"/' /etc/default/grub && sudo update-grub"
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
            active_profile=$(tuned-adm active 2>/dev/null | grep -oP 'Current active profile: \K.*' || true)
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
fi
