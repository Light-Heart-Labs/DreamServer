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

dream_progress 30 "docker" "Setting up Docker"
show_phase 3 6 "Docker Setup" "~2 minutes"
ai "Preparing container runtime..."

# Ensure package manager is detected
[[ -z "${PKG_MANAGER:-}" ]] && detect_pkg_manager

# Helper wrappers that are safe even if DOCKER_CMD contains spaces (e.g. "sudo docker")
_docker_cmd_arr() {
    case "${DOCKER_CMD:-docker}" in
        "sudo docker") echo "sudo" "docker" ;;
        *)             echo "docker" ;;
    esac
}

docker_run() {
    # shellcheck disable=SC2207
    local -a cmd=($(_docker_cmd_arr))
    "${cmd[@]}" "$@"
}

docker_compose_run() {
    # shellcheck disable=SC2207
    local -a cmd=($(_docker_cmd_arr))
    "${cmd[@]}" compose "$@"
}

# Track whether docker group membership is active in this shell
DOCKER_NEEDS_SUDO=false

if [[ "$SKIP_DOCKER" == "true" ]]; then
    log "Skipping Docker installation (--skip-docker)"
elif command -v docker >/dev/null 2>&1; then
    docker_ver_exit=0
    docker_version=$(docker --version 2>&1) || docker_ver_exit=$?
    [[ $docker_ver_exit -eq 0 ]] && ai_ok "Docker already installed: $docker_version" || ai_ok "Docker already installed"
else
    dream_progress 31 "docker" "Installing Docker engine"
    ai "Installing Docker..."

    if $DRY_RUN; then
        log "[DRY RUN] Would install Docker via official script"
    else
        tmpfile=$(mktemp /tmp/install-docker.XXXXXX.sh)
        if ! curl -fsSL --max-time 300 https://get.docker.com -o "$tmpfile" || ! sh "$tmpfile"; then
            rm -f "$tmpfile"
            error "Docker installation failed. Check network connectivity and try again."
        fi
        rm -f "$tmpfile"

        # Add the invoking user (not root) to the docker group
        target_user="${SUDO_USER:-$USER}"
        sudo usermod -aG docker "$target_user"

        # In most cases group membership won't take effect until a new login shell.
        id_exit=0
        id -nG "$target_user" 2>/dev/null | tr ' ' '\n' | grep -qx docker || id_exit=$?
        if [[ $id_exit -ne 0 ]]; then
            DOCKER_NEEDS_SUDO=true
        fi
    fi
fi

# Decide whether to use sudo for the rest of this installer session
if [[ "${DOCKER_CMD:-}" == "" ]]; then
    if $DOCKER_NEEDS_SUDO; then
        warn "Docker installed, but group membership may not be active yet (re-login required)."
        if [[ "${INTERACTIVE:-true}" == "true" ]]; then
            echo ""
            read -p "  Continue this installer using 'sudo docker' for now? [Y/n] " -r
            if [[ $REPLY =~ ^[Nn]$ ]]; then
                log "Please re-run after logging out and back in (or after 'newgrp docker')."
                exit 0
            fi
        else
            warn "Non-interactive mode: continuing with 'sudo docker'."
        fi
        DOCKER_CMD="sudo docker"
        DOCKER_COMPOSE_CMD="sudo docker compose"
    fi
fi

# Set docker command (use sudo if needed)
DOCKER_CMD="${DOCKER_CMD:-docker}"
DOCKER_COMPOSE_CMD="${DOCKER_COMPOSE_CMD:-docker compose}"

# Docker Compose check (v2 preferred, v1 fallback)
dream_progress 33 "docker" "Checking Docker Compose"
compose_v2_exit=0
docker_compose_run version >/dev/null 2>&1 || compose_v2_exit=$?
if [[ $compose_v2_exit -eq 0 ]]; then
    ai_ok "Docker Compose v2 available"
elif command -v docker-compose >/dev/null 2>&1; then
    if [[ "$DOCKER_CMD" == "sudo docker" ]]; then
        DOCKER_COMPOSE_CMD="sudo docker-compose"
    else
        DOCKER_COMPOSE_CMD="docker-compose"
    fi
    ai_ok "Docker Compose v1 available (using docker-compose)"
else
    if [[ "$SKIP_DOCKER" == "true" ]]; then
        warn "Docker Compose not found (docker compose / docker-compose). Install manually or re-run without --skip-docker."
    elif $DRY_RUN; then
        log "[DRY RUN] Would install Docker Compose plugin"
    else
        ai "Installing Docker Compose plugin..."
        pkg_update
        # shellcheck disable=SC2046
        pkg_install $(pkg_resolve docker-compose-plugin)
    fi
fi

# ---------------------------------------------------------------------------
# Runtime sanity checks
# ---------------------------------------------------------------------------
# Goal: make this phase resilient across:
# - fresh installs (daemon not started yet)
# - non-interactive runs (can't prompt)
# - sudo-required sessions (docker group not applied yet)
# - systems where docker exists but user permissions are wrong

_docker_try_with_optional_sudo() {
    # If DOCKER_CMD isn't already sudo docker, try docker first and fall back to sudo docker.
    docker_try_exit=0
    docker_run "$@" >/dev/null 2>&1 || docker_try_exit=$?
    if [[ $docker_try_exit -eq 0 ]]; then
        return 0
    fi

    if [[ "$DOCKER_CMD" != "sudo docker" ]] && command -v sudo >/dev/null 2>&1; then
        DOCKER_CMD="sudo docker"
        DOCKER_COMPOSE_CMD="sudo docker compose"
        sudo_docker_try_exit=0
        docker_run "$@" >/dev/null 2>&1 || sudo_docker_try_exit=$?
        if [[ $sudo_docker_try_exit -eq 0 ]]; then
            return 0
        fi
    fi

    return 1
}

_docker_daemon_start_hint() {
    warn "Docker daemon does not appear to be running or accessible."
    warn "Common fixes:"
    warn "  - Linux (systemd): sudo systemctl enable --now docker"
    warn "  - Linux (non-systemd): start dockerd using your init system"
    warn "  - WSL2: ensure Docker Desktop is running"
}

_docker_ensure_daemon() {
    # Returns 0 if docker responds to 'info' (with optional sudo fallback).
    # If not, tries to start docker on systemd systems, then retries.

    if _docker_try_with_optional_sudo info; then
        return 0
    fi

    # Try to start docker service if systemd is present
    if command -v systemctl >/dev/null 2>&1; then
        ai_warn "Docker not responding; attempting to start docker service..."
        if ! $DRY_RUN; then
            systemctl_exit=0
            sudo systemctl start docker 2>>"$LOG_FILE" || systemctl_exit=$?
            [[ $systemctl_exit -ne 0 ]] && log "systemctl start docker failed (exit $systemctl_exit)"
        fi
        if _docker_try_with_optional_sudo info; then
            return 0
        fi
    fi

    _docker_daemon_start_hint
    return 1
}

_docker_compose_detect_cmd() {
    # Prefer v2 (docker compose). If docker requires sudo, wrapper will handle it.
    compose_detect_exit=0
    docker_compose_run version >/dev/null 2>&1 || compose_detect_exit=$?
    if [[ $compose_detect_exit -eq 0 ]]; then
        echo "docker compose"
        return 0
    fi

    # v1 fallback
    if command -v docker-compose >/dev/null 2>&1; then
        echo "docker-compose"
        return 0
    fi

    echo ""
    return 1
}

_docker_compose_verify() {
    local detected
    compose_verify_exit=0
    detected="$(_docker_compose_detect_cmd)" || compose_verify_exit=$?

    if [[ $compose_verify_exit -eq 0 && -n "$detected" ]]; then
        ai_ok "Compose detected: $detected"
        return 0
    fi

    return 1
}

_docker_post_install_checks() {
    # Best-effort checks. Should not hard-fail in dry-run.
    if $DRY_RUN; then
        log "[DRY RUN] Skipping docker runtime checks"
        return 0
    fi

    # Ensure daemon is reachable (and set DOCKER_CMD to sudo docker if needed)
    if ! _docker_ensure_daemon; then
        error "Docker is installed but not usable (daemon not running or permissions issue)."
    fi

    # Show effective docker command (for later phases)
    log "Using docker command: $DOCKER_CMD"

    # Verify compose availability; if missing, install compose plugin when possible.
    if ! _docker_compose_verify; then
        if [[ "$SKIP_DOCKER" == "true" ]]; then
            warn "Compose missing and --skip-docker set; cannot install compose automatically."
            return 0
        fi

        ai_warn "Docker Compose not detected; attempting install of compose plugin..."
        pkg_update
        # shellcheck disable=SC2046
        pkg_install_exit=0
        pkg_install $(pkg_resolve docker-compose-plugin) || pkg_install_exit=$?
        [[ $pkg_install_exit -ne 0 ]] && log "pkg_install docker-compose-plugin failed (exit $pkg_install_exit)"

        compose_verify2_exit=0
        _docker_compose_verify || compose_verify2_exit=$?
        if [[ $compose_verify2_exit -ne 0 ]]; then
            warn "Compose still not detected after install attempt."
            warn "You may need to install Docker Compose manually for your distro."
        fi
    fi

    # Basic engine health
    docker_version_exit=0
    docker_run version >/dev/null 2>&1 || docker_version_exit=$?
    if [[ $docker_version_exit -eq 0 ]]; then
        ai_ok "Docker engine responding"
    else
        warn "Docker engine did not respond to 'docker version'"
    fi

    # Optional: give the user a clear hint if they are likely missing group perms
    if [[ "$DOCKER_CMD" == "sudo docker" ]]; then
        warn "Docker commands are running via sudo in this installer session."
        warn "After the install finishes, log out/in (or run 'newgrp docker') to use docker without sudo."
    fi
}

dream_progress 35 "docker" "Running Docker post-install checks"
_docker_post_install_checks

# NVIDIA Container Toolkit (skip for AMD — uses /dev/dri + /dev/kfd passthrough)
if [[ $GPU_COUNT -gt 0 && "$GPU_BACKEND" == "nvidia" ]]; then
    dream_progress 36 "docker" "Checking NVIDIA Container Toolkit"
    if command -v nvidia-container-cli >/dev/null 2>&1; then
        ai_ok "NVIDIA Container Toolkit installed"
        # Always regenerate CDI spec — driver version may have changed since last run
        if command -v nvidia-ctk >/dev/null 2>&1 && ! $DRY_RUN; then
            cdi_exit=0
            sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml 2>>"$LOG_FILE" || cdi_exit=$?
            [[ $cdi_exit -ne 0 ]] && log "nvidia-ctk cdi generate failed (exit $cdi_exit)"
        fi
    else
        ai "Installing NVIDIA Container Toolkit..."
        if ! $DRY_RUN; then
            # Add NVIDIA GPG key (used by apt and as trust anchor)
            gpg_exit=0
            curl -fsSL --max-time 60 https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>>"$LOG_FILE" || gpg_exit=$?
            [[ $gpg_exit -ne 0 ]] && log "NVIDIA GPG key import failed (exit $gpg_exit)"

            # Distro-aware repo setup + install
            case "$PKG_MANAGER" in
                apt)
                    curl -s -L --max-time 60 https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
                        sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
                        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
                    # Verify we got a valid repo file, not an HTML 404
                    grep_html_exit=0
                    grep -q '<html' /etc/apt/sources.list.d/nvidia-container-toolkit.list 2>/dev/null || grep_html_exit=$?
                    if [[ $grep_html_exit -eq 0 ]]; then
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
                    curl -s -L --max-time 60 https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo | \
                        sudo tee /etc/yum.repos.d/nvidia-container-toolkit.repo > /dev/null
                    if ! sudo dnf install -y nvidia-container-toolkit 2>>"$LOG_FILE"; then
                        error "Failed to install NVIDIA Container Toolkit. Check network connectivity and NVIDIA repo configuration."
                    fi
                    ;;
                pacman)
                    # nvidia-container-toolkit is in AUR; check for common AUR helpers
                    if command -v yay >/dev/null 2>&1; then
                        yay_exit=0
                        yay -S --noconfirm nvidia-container-toolkit 2>>"$LOG_FILE" || yay_exit=$?
                        [[ $yay_exit -ne 0 ]] && error "Failed to install nvidia-container-toolkit via yay."
                    elif command -v paru >/dev/null 2>&1; then
                        paru_exit=0
                        paru -S --noconfirm nvidia-container-toolkit 2>>"$LOG_FILE" || paru_exit=$?
                        [[ $paru_exit -ne 0 ]] && error "Failed to install nvidia-container-toolkit via paru."
                    else
                        warn "nvidia-container-toolkit requires an AUR helper (yay or paru)."
                        warn "Install one, then run: yay -S nvidia-container-toolkit"
                        error "No AUR helper found. Install yay or paru first."
                    fi
                    ;;
                zypper)
                    zypper_add_exit=0
                    sudo zypper addrepo https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo 2>>"$LOG_FILE" || zypper_add_exit=$?
                    [[ $zypper_add_exit -ne 0 ]] && log "zypper addrepo failed (exit $zypper_add_exit)"
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
            cdi_gen_exit=0
            sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml 2>>"$LOG_FILE" || cdi_gen_exit=$?
            [[ $cdi_gen_exit -ne 0 ]] && log "nvidia-ctk cdi generate failed (exit $cdi_gen_exit)"
            sudo systemctl restart docker
        fi
        if command -v nvidia-container-cli >/dev/null 2>&1; then
            ai_ok "NVIDIA Container Toolkit installed"
        else
            $DRY_RUN && ai_ok "[DRY RUN] Would install NVIDIA Container Toolkit" || error "NVIDIA Container Toolkit installation failed — nvidia-container-cli not found after install."
        fi
    fi
fi
