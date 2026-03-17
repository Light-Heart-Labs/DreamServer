#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 05: Docker Setup
# ============================================================================
# Part of: installers/phases/
# Purpose: Install Docker, Docker Compose, and NVIDIA Container Toolkit
#
# Expects: SKIP_DOCKER, DRY_RUN, INTERACTIVE, GPU_COUNT, GPU_BACKEND,
#           LOG_FILE, MIN_DRIVER_VERSION, PKG_MANAGER,
#           show_phase(), ai(), ai_ok(), ai_warn(), log(), warn(), error(),
#           detect_pkg_manager(), pkg_install(), pkg_update(), pkg_resolve()
# Provides: DOCKER_CMD, DOCKER_COMPOSE_CMD
#
# Modder notes:
#   Change Docker installation method or add Podman support here.
#   Multi-distro: uses packaging.sh for distro-agnostic package installs.
# ============================================================================

show_phase 3 6 "Docker Setup" "~2 minutes"
ai "Preparing container runtime..."

# Ensure package manager is detected
[[ -z "$PKG_MANAGER" ]] && detect_pkg_manager

if [[ "$SKIP_DOCKER" == "true" ]]; then
    log "Skipping Docker installation (--skip-docker)"
elif command -v docker &> /dev/null; then
    ai_ok "Docker already installed: $(docker --version)"
else
    ai "Installing Docker..."

    if $DRY_RUN; then
        log "[DRY RUN] Would install Docker via official script"
    else
        tmpfile=$(mktemp /tmp/install-docker.XXXXXX.sh)
        if ! curl -fsSL https://get.docker.com -o "$tmpfile" || ! sh "$tmpfile"; then
            rm -f "$tmpfile"
            error "Docker installation failed. Check network connectivity and try again."
        fi
        rm -f "$tmpfile"
        target_user="${SUDO_USER:-$USER}"
        sudo usermod -aG docker "$target_user"

        # Check the current shell's effective groups, not the updated account record.
        # usermod updates future login sessions immediately, but this shell usually
        # cannot use the new docker group until re-login or newgrp.
        if ! id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
            warn "Docker installed! Group membership requires re-login."
            warn "Option 1: Log out and back in, then re-run this script with --skip-docker"
            warn "Option 2: Run 'newgrp docker' in a new terminal, then re-run"
            if [[ "${INTERACTIVE:-true}" == "false" ]]; then
                warn "Non-interactive mode: automatically using sudo docker for this run."
                DOCKER_CMD="sudo docker"
                DOCKER_COMPOSE_CMD="sudo docker compose"
            else
                echo ""
                read -p "  Try to continue with 'sudo docker' for now? [Y/n] " -r
                if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                    # Use sudo for remaining docker commands in this session
                    DOCKER_CMD="sudo docker"
                    DOCKER_COMPOSE_CMD="sudo docker compose"
                else
                    log "Please re-run after logging out and back in."
                    exit 0
                fi
            fi
        fi
    fi
fi

# Set docker command (use sudo if needed)
DOCKER_CMD="${DOCKER_CMD:-docker}"
DOCKER_COMPOSE_CMD="${DOCKER_COMPOSE_CMD:-docker compose}"

# Docker Compose check (v2 preferred, v1 fallback)
if $DOCKER_COMPOSE_CMD version &> /dev/null 2>&1; then
    ai_ok "Docker Compose v2 available"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="${DOCKER_CMD%-*}-compose"
    [[ "$DOCKER_CMD" == "sudo docker" ]] && DOCKER_COMPOSE_CMD="sudo docker-compose"
    ai_ok "Docker Compose v1 available (using docker-compose)"
else
    if ! $DRY_RUN; then
        ai "Installing Docker Compose plugin..."
        pkg_update
        # shellcheck disable=SC2046
        pkg_install $(pkg_resolve docker-compose-plugin)
    fi
fi

# NVIDIA Container Toolkit (skip for AMD — uses /dev/dri + /dev/kfd passthrough)
if [[ $GPU_COUNT -gt 0 && "$GPU_BACKEND" == "nvidia" ]]; then
    if command -v nvidia-container-cli &> /dev/null 2>&1; then
        ai_ok "NVIDIA Container Toolkit installed"
        # Always regenerate CDI spec — driver version may have changed since last run
        if command -v nvidia-ctk &>/dev/null && ! $DRY_RUN; then
            sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml 2>>"$LOG_FILE" || true
        fi
    else
        ai "Installing NVIDIA Container Toolkit..."
        if ! $DRY_RUN; then
            # Add NVIDIA GPG key (used by apt and as trust anchor)
            curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null || true

            # Distro-aware repo setup + install
            case "$PKG_MANAGER" in
                apt)
                    curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
                        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
                        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
                    # Verify we got a valid repo file, not an HTML 404
                    if grep -q '<html' /etc/apt/sources.list.d/nvidia-container-toolkit.list 2>/dev/null; then
                        warn "Failed to download NVIDIA Container Toolkit repo list. Trying fallback..."
                        echo "deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://nvidia.github.io/libnvidia-container/stable/deb/\$(ARCH) /" | \
                            sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
                    fi
                    sudo apt-get update
                    if ! sudo apt-get install -y nvidia-container-toolkit; then
                        error "Failed to install NVIDIA Container Toolkit. Check network connectivity and GPU drivers."
                    fi
                    ;;
                dnf)
                    curl -s -L https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo | \
                        sudo tee /etc/yum.repos.d/nvidia-container-toolkit.repo > /dev/null
                    if ! sudo dnf install -y nvidia-container-toolkit 2>>"$LOG_FILE"; then
                        error "Failed to install NVIDIA Container Toolkit. Check network connectivity and NVIDIA repo configuration."
                    fi
                    ;;
                pacman)
                    # nvidia-container-toolkit is in AUR; check for common AUR helpers
                    if command -v yay &>/dev/null; then
                        yay -S --noconfirm nvidia-container-toolkit 2>>"$LOG_FILE" || \
                            error "Failed to install nvidia-container-toolkit via yay."
                    elif command -v paru &>/dev/null; then
                        paru -S --noconfirm nvidia-container-toolkit 2>>"$LOG_FILE" || \
                            error "Failed to install nvidia-container-toolkit via paru."
                    else
                        warn "nvidia-container-toolkit requires an AUR helper (yay or paru)."
                        warn "Install one, then run: yay -S nvidia-container-toolkit"
                        error "No AUR helper found. Install yay or paru first."
                    fi
                    ;;
                zypper)
                    sudo zypper addrepo https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo 2>/dev/null || true
                    sudo zypper --non-interactive --gpg-auto-import-keys refresh 2>>"$LOG_FILE"
                    if ! sudo zypper --non-interactive install nvidia-container-toolkit 2>>"$LOG_FILE"; then
                        error "Failed to install NVIDIA Container Toolkit."
                    fi
                    ;;
                *)
                    error "Cannot install NVIDIA Container Toolkit: unsupported package manager '${PKG_MANAGER}'. Install it manually: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html"
                    ;;
            esac

            sudo nvidia-ctk runtime configure --runtime=docker
            sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml 2>>"$LOG_FILE" || true
            sudo systemctl restart docker
        fi
        if command -v nvidia-container-cli &> /dev/null 2>&1; then
            ai_ok "NVIDIA Container Toolkit installed"
        else
            $DRY_RUN && ai_ok "[DRY RUN] Would install NVIDIA Container Toolkit" || error "NVIDIA Container Toolkit installation failed — nvidia-container-cli not found after install."
        fi
    fi
fi
