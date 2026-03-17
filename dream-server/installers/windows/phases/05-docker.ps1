# ============================================================================
# Dream Server Windows Installer -- Phase 05: Docker Validation
# ============================================================================
# Part of: installers/windows/phases/
# Purpose: Deep Docker health check -- daemon responsiveness, Compose v1/v2
#          detection, NVIDIA GPU passthrough smoke test, compose file syntax
#          validation. On Windows, Docker Desktop is a prerequisite (installed
#          by the user); this phase does NOT install Docker.
#
# Reads:
#   $gpuInfo     -- from phase 02, for GPU passthrough test
#   $sourceRoot  -- from orchestrator, for compose syntax validation
#   $dryRun      -- skip live checks
#   $script:DOCKER_COMPOSE_CMD  -- from constants.ps1 (default: "docker compose")
#
# Writes:
#   $dockerComposeCmd  -- string: resolved compose command
#                         ("docker compose" or "docker-compose")
#
# Modder notes:
#   To add Podman support, add a Podman detection branch after the Docker
#   Compose v1 fallback.
# ============================================================================

Write-Phase -Phase 5 -Total 13 -Name "DOCKER VALIDATION" -Estimate "~15 seconds"
Write-AI "Validating container runtime..."

# ── Docker daemon health ──────────────────────────────────────────────────────
if ($dryRun) {
    Write-AI "[DRY RUN] Would verify Docker daemon is responsive (docker info)"
    Write-AI "[DRY RUN] Would detect Docker Compose v1 vs v2"
    $dockerComposeCmd = $script:DOCKER_COMPOSE_CMD
} else {
    # Suppress stderr -- `docker info` emits warnings to stderr on first run
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $null = & docker info 2>&1
    $dockerInfoExit = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP

    if ($dockerInfoExit -ne 0) {
        Write-AIError "Docker daemon is not responding (docker info exit code: $dockerInfoExit)."
        Write-AI "  Make sure Docker Desktop is running and the WSL2 backend is active."
        Write-AI "  Start Docker Desktop from the Start Menu, wait for it to fully initialize,"
        Write-AI "  then re-run this installer."
        exit 1
    }
    Write-AISuccess "Docker daemon healthy"

    # ── Docker Compose detection (prefer v2, fall back to v1) ─────────────────
    $dockerComposeCmd = ""
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"

    # Try v2: `docker compose version`
    $null = & docker compose version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $dockerComposeCmd = "docker compose"
    } else {
        # Try v1: standalone `docker-compose`
        $dcCmd = Get-Command docker-compose -ErrorAction SilentlyContinue
        if ($dcCmd) {
            $dockerComposeCmd = "docker-compose"
            Write-AIWarn "Docker Compose v1 (docker-compose) detected. Upgrade to v2 is recommended."
        }
    }
    $ErrorActionPreference = $prevEAP

    if (-not $dockerComposeCmd) {
        Write-AIError "Docker Compose not found (tried: 'docker compose' and 'docker-compose')."
        Write-AI "  Install Docker Desktop, which bundles Compose v2:"
        Write-AI "  https://docs.docker.com/desktop/install/windows-install/"
        exit 1
    }
    Write-AISuccess "Docker Compose available: $dockerComposeCmd"

    # ── Compose file syntax validation ────────────────────────────────────────
    # Quick config check on the base compose file to catch syntax errors early.
    $_baseCompose = Join-Path $sourceRoot "docker-compose.base.yml"
    if (Test-Path $_baseCompose) {
        Push-Location $sourceRoot
        try {
            $prevEAP = $ErrorActionPreference
            $ErrorActionPreference = "SilentlyContinue"
            $null = & docker compose -f "docker-compose.base.yml" config 2>&1
            $composeConfigExit = $LASTEXITCODE
            $ErrorActionPreference = $prevEAP

            if ($composeConfigExit -ne 0) {
                Write-AIWarn "Compose stack syntax check returned non-zero (may be OK if overlays are missing at this stage)."
            } else {
                Write-AISuccess "docker-compose.base.yml syntax OK"
            }
        } finally {
            Pop-Location
        }
    }

    # ── NVIDIA GPU passthrough smoke test ─────────────────────────────────────
    # Only run if NVIDIA GPU detected AND WSL2 backend is confirmed.
    # This test starts a minimal container with --gpus all and checks that
    # nvidia-smi is accessible. It is non-fatal -- some valid configurations
    # (e.g., very new drivers + WSL2) pass at runtime even if this quick test fails.
    if ($gpuInfo.Backend -eq "nvidia" -and $preflight_docker -and $preflight_docker.WSL2Backend) {
        Write-AI "Testing NVIDIA GPU passthrough in Docker (non-fatal)..."
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        $gpuTestOutput = & docker run --rm --gpus all nvidia/cuda:12.0-base-ubuntu22.04 nvidia-smi 2>&1
        $gpuTestExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP

        if ($gpuTestExit -eq 0) {
            Write-AISuccess "NVIDIA GPU passthrough confirmed in Docker"
        } else {
            Write-AIWarn "NVIDIA GPU passthrough smoke test failed (exit: $gpuTestExit)."
            Write-AI "  This may be a false alarm on first run while Docker Desktop initializes."
            Write-AI "  If inference fails later, check: docker run --rm --gpus all nvidia/cuda:12.0-base-ubuntu22.04 nvidia-smi"
        }
    }
}
