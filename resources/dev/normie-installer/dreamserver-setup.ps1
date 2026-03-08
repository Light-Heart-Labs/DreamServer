# ============================================================================
# DreamServer - Windows One-Click Installer (PowerShell)
# ============================================================================
# Handles ONLY Docker prerequisites:
#   1. Verify Windows version (build 19041+ for WSL2)
#   2. Enable WSL2 and install Ubuntu
#   3. Install Docker Desktop
#   4. Hand off to get-dream-server.sh inside WSL
#
# All intelligence (hardware detection, model selection, extensions) lives
# in the main installer which is pulled fresh via git clone inside WSL.
#
# Supports reboot resume: if WSL2 setup requires a reboot, this script
# will automatically re-launch after restart via RunOnce registry key.
# ============================================================================

$ErrorActionPreference = "Stop"

# ── Constants ─────────────────────────────────────────────────────────────────
$MIN_BUILD              = 19041  # Windows 10 2004 (first with WSL2)
$DOCKER_DESKTOP_URL     = "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"
$BOOTSTRAP_URL          = "https://raw.githubusercontent.com/Light-Heart-Labs/DreamServer/main/dream-server/get-dream-server.sh"
$RESUME_REG_KEY         = "HKCU:\Software\DreamServer"
$RESUME_REG_NAME        = "SetupPhase"
$DOCKER_WAIT_TIMEOUT    = 180  # seconds

# ── UI Helpers ────────────────────────────────────────────────────────────────
function Write-Banner {
    Write-Host ""
    Write-Host "    ____                              _____" -ForegroundColor Green
    Write-Host "   / __ \________  ____ _____ ___    / ___/___  ______   _____  _____" -ForegroundColor Green
    Write-Host "  / / / / ___/ _ \/ __ '/ __ '__ \   \__ \/ _ \/ ___/ | / / _ \/ ___/" -ForegroundColor Green
    Write-Host " / /_/ / /  /  __/ /_/ / / / / / /  ___/ /  __/ /   | |/ /  __/ /" -ForegroundColor Green
    Write-Host "/_____/_/   \___/\__,_/_/ /_/ /_/  /____/\___/_/    |___/\___/_/" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Windows Installer " -ForegroundColor White -NoNewline
    Write-Host "- Getting Docker ready for you" -ForegroundColor Gray
    Write-Host ""
}

function Write-Step($num, $total, $msg) {
    Write-Host ""
    Write-Host "[$num/$total] " -ForegroundColor Cyan -NoNewline
    Write-Host "$msg" -ForegroundColor White
}

function Write-OK($msg) {
    Write-Host "  " -NoNewline
    Write-Host "[OK] " -ForegroundColor Green -NoNewline
    Write-Host "$msg"
}

function Write-Warn($msg) {
    Write-Host "  " -NoNewline
    Write-Host "[!] " -ForegroundColor Yellow -NoNewline
    Write-Host "$msg"
}

function Write-Fail($msg) {
    Write-Host "  " -NoNewline
    Write-Host "[X] " -ForegroundColor Red -NoNewline
    Write-Host "$msg"
}

# ── Resume State ──────────────────────────────────────────────────────────────
# Tracks which phase we're on across reboots via registry.
function Get-Phase {
    try {
        $val = (Get-ItemProperty -Path $RESUME_REG_KEY -Name $RESUME_REG_NAME -ErrorAction Stop).$RESUME_REG_NAME
        return $val
    } catch {
        return "check-windows"
    }
}

function Set-Phase($phase) {
    if (-not (Test-Path $RESUME_REG_KEY)) {
        New-Item -Path $RESUME_REG_KEY -Force | Out-Null
    }
    Set-ItemProperty -Path $RESUME_REG_KEY -Name $RESUME_REG_NAME -Value $phase
}

function Clear-Phase {
    Remove-ItemProperty -Path $RESUME_REG_KEY -Name $RESUME_REG_NAME -ErrorAction SilentlyContinue
    # Clean up the key if empty
    try {
        $props = Get-ItemProperty -Path $RESUME_REG_KEY -ErrorAction Stop
        $names = $props.PSObject.Properties | Where-Object { $_.Name -notlike "PS*" }
        if (-not $names) {
            Remove-Item -Path $RESUME_REG_KEY -ErrorAction SilentlyContinue
        }
    } catch { }
}

function Request-RebootAndResume($nextPhase) {
    Set-Phase $nextPhase

    # Register to auto-launch after reboot via RunOnce
    $scriptDir = Split-Path -Parent $MyInvocation.ScriptName
    if (-not $scriptDir) { $scriptDir = Split-Path -Parent $PSCommandPath }
    $batPath = Join-Path $scriptDir "dreamserver-setup.bat"

    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce" `
        -Name "DreamServerSetup" -Value "cmd /c `"$batPath`""

    Write-Host ""
    Write-Host "  A reboot is needed to continue setup." -ForegroundColor Yellow
    Write-Host "  DreamServer setup will resume automatically after restart." -ForegroundColor Yellow
    Write-Host ""
    $null = Read-Host "  Press Enter to reboot now (or close this window to reboot later)"
    Restart-Computer -Force
}

# ── MAIN ──────────────────────────────────────────────────────────────────────
Write-Banner
$phase = Get-Phase

# Check if this is a resume after reboot
if ($phase -ne "check-windows") {
    Write-Host "  Resuming setup after reboot (phase: $phase)..." -ForegroundColor Gray
    Write-Host ""
}

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 1: Windows version check
# ══════════════════════════════════════════════════════════════════════════════
if ($phase -eq "check-windows") {
    Write-Step 1 4 "Checking Windows version..."

    $build = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
    $edition = (Get-CimInstance Win32_OperatingSystem).Caption

    if ($build -lt $MIN_BUILD) {
        Write-Fail "Windows build $build is too old."
        Write-Fail "Build $MIN_BUILD or later required (Windows 10 version 2004+)."
        Write-Host ""
        Write-Host "  Update Windows, then re-run this installer." -ForegroundColor Gray
        exit 1
    }

    Write-OK "$edition (build $build)"

    # Check architecture
    $arch = (Get-CimInstance Win32_Processor).Architecture
    if ($arch -eq 12) {
        Write-OK "ARM64 processor detected"
    } else {
        Write-OK "x64 processor detected"
    }

    $phase = "enable-wsl"
}

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2: Enable WSL2
# ══════════════════════════════════════════════════════════════════════════════
if ($phase -eq "enable-wsl") {
    Write-Step 2 4 "Setting up WSL2..."

    $rebootNeeded = $false

    # Check if WSL is already functional
    $wslWorking = $false
    try {
        $wslStatus = wsl --status 2>&1
        if ($LASTEXITCODE -eq 0) {
            $wslWorking = $true
        }
    } catch { }

    if ($wslWorking) {
        Write-OK "WSL2 already enabled"
    } else {
        Write-Warn "Enabling WSL2 Windows features..."

        # Enable Virtual Machine Platform
        $vmpFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
        if ($vmpFeature.State -ne "Enabled") {
            Write-Warn "Enabling Virtual Machine Platform..."
            Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart | Out-Null
            $rebootNeeded = $true
        }

        # Enable WSL feature
        $wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
        if ($wslFeature.State -ne "Enabled") {
            Write-Warn "Enabling Windows Subsystem for Linux..."
            Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -NoRestart | Out-Null
            $rebootNeeded = $true
        }

        if ($rebootNeeded) {
            Write-OK "Windows features enabled"
            Request-RebootAndResume "install-distro"
            exit 0  # Won't reach here (reboot happens), but just in case
        }
    }

    $phase = "install-distro"
}

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 2b: Install Ubuntu WSL distro
# ══════════════════════════════════════════════════════════════════════════════
if ($phase -eq "install-distro") {
    Write-Step "2b" 4 "Ensuring Ubuntu WSL distro..."

    # Set WSL default version to 2
    wsl --set-default-version 2 2>&1 | Out-Null

    # Check if any Ubuntu distro is installed
    $distros = ""
    try {
        $distros = wsl -l -q 2>&1 | Out-String
    } catch { }

    if ($distros -match "Ubuntu") {
        Write-OK "Ubuntu distro found"
    } else {
        Write-Warn "Installing Ubuntu WSL distro..."
        Write-Host "  (This downloads ~500MB and may take a few minutes)" -ForegroundColor Gray

        wsl --install -d Ubuntu --no-launch 2>&1 | Out-Null

        # Verify installation
        Start-Sleep -Seconds 3
        $distros = wsl -l -q 2>&1 | Out-String
        if ($distros -match "Ubuntu") {
            Write-OK "Ubuntu distro installed"
        } else {
            # On some Windows versions, wsl --install needs a reboot
            Write-Warn "Ubuntu install may need a reboot to complete"
            Request-RebootAndResume "install-distro"
            exit 0
        }
    }

    # Set Ubuntu as default
    wsl --set-default Ubuntu 2>&1 | Out-Null

    $phase = "install-docker"
}

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3: Docker Desktop
# ══════════════════════════════════════════════════════════════════════════════
if ($phase -eq "install-docker") {
    Write-Step 3 4 "Setting up Docker Desktop..."

    $dockerInstalled = $false
    $dockerRunning = $false

    # Check if docker CLI exists
    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if ($dockerCmd) {
        $dockerInstalled = $true
        Write-OK "Docker CLI found"

        # Check if daemon is running
        try {
            docker info 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) {
                $dockerRunning = $true
                Write-OK "Docker daemon running"
            }
        } catch { }
    }

    if (-not $dockerInstalled) {
        Write-Warn "Docker Desktop not found. Downloading..."
        Write-Host "  (This is a ~600MB download)" -ForegroundColor Gray

        $installerPath = Join-Path $env:TEMP "DockerDesktopInstaller.exe"

        # Download Docker Desktop
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $progressPreference = 'SilentlyContinue'
            Invoke-WebRequest -Uri $DOCKER_DESKTOP_URL -OutFile $installerPath -UseBasicParsing
            $progressPreference = 'Continue'
        } catch {
            Write-Fail "Failed to download Docker Desktop."
            Write-Host "  Download manually: https://docs.docker.com/desktop/install/windows-install/" -ForegroundColor Gray
            exit 1
        }

        Write-Warn "Installing Docker Desktop (this may take several minutes)..."

        # Silent install with WSL2 backend
        $process = Start-Process -FilePath $installerPath -ArgumentList "install", "--quiet", "--accept-license" `
            -Wait -PassThru -NoNewWindow

        # Clean up installer
        Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue

        if ($process.ExitCode -ne 0) {
            Write-Warn "Docker Desktop installer exited with code $($process.ExitCode)"
            Write-Warn "This may still be OK - checking if Docker is available..."
        }

        # Docker Desktop install updates PATH but we need to refresh
        $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
        $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
        $env:Path = "$machinePath;$userPath"

        $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
        if ($dockerCmd) {
            $dockerInstalled = $true
            Write-OK "Docker Desktop installed"
        } else {
            Write-Warn "Docker Desktop installed but PATH not updated. A reboot may be needed."
            Request-RebootAndResume "start-docker"
            exit 0
        }
    }

    $phase = "start-docker"
}

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 3b: Start Docker Desktop and wait for daemon
# ══════════════════════════════════════════════════════════════════════════════
if ($phase -eq "start-docker") {
    Write-Step "3b" 4 "Starting Docker Desktop..."

    $dockerRunning = $false

    # Check if already running
    try {
        docker info 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $dockerRunning = $true }
    } catch { }

    if (-not $dockerRunning) {
        # Find and launch Docker Desktop
        $dockerExePaths = @(
            "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
            "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe",
            "$env:LOCALAPPDATA\Docker\Docker Desktop.exe"
        )

        $launched = $false
        foreach ($path in $dockerExePaths) {
            if (Test-Path $path) {
                Start-Process $path
                $launched = $true
                break
            }
        }

        if (-not $launched) {
            Write-Fail "Cannot find Docker Desktop executable."
            Write-Host "  Open Docker Desktop manually, then re-run this script." -ForegroundColor Gray
            exit 1
        }

        # Wait for Docker daemon to be ready
        $waited = 0
        Write-Host "  Waiting for Docker daemon to start..." -ForegroundColor Gray
        while ($waited -lt $DOCKER_WAIT_TIMEOUT) {
            Start-Sleep -Seconds 3
            $waited += 3

            try {
                docker info 2>&1 | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    $dockerRunning = $true
                    break
                }
            } catch { }

            if ($waited % 15 -eq 0) {
                Write-Host "  Still waiting... $waited seconds" -ForegroundColor Gray
            }
        }
    }

    if ($dockerRunning) {
        Write-OK "Docker Desktop is running"
    } else {
        Write-Fail "Docker did not start within $DOCKER_WAIT_TIMEOUT seconds."
        Write-Host "  Open Docker Desktop manually, wait for it to start," -ForegroundColor Gray
        Write-Host "  then re-run this script." -ForegroundColor Gray
        exit 1
    }

    # Verify Docker Compose
    try {
        docker compose version 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Docker Compose available"
        }
    } catch {
        Write-Warn "Docker Compose not detected. Update Docker Desktop to the latest version."
    }

    Write-Host ""
    Write-OK "Docker is ready"

    $phase = "handoff"
}

# ══════════════════════════════════════════════════════════════════════════════
# PHASE 4: Hand off to DreamServer installer inside WSL
# ══════════════════════════════════════════════════════════════════════════════
if ($phase -eq "handoff") {
    Write-Step 4 4 "Launching DreamServer installer..."

    # Clean up resume state - we made it!
    Clear-Phase

    Write-Host ""
    Write-Host "  Downloading latest DreamServer installer inside WSL..." -ForegroundColor Gray
    Write-Host "  Everything from here is pulled fresh - no updates needed." -ForegroundColor Gray
    Write-Host ""
    Write-Host "  ================================================================" -ForegroundColor Cyan

    # Run get-dream-server.sh inside WSL
    # This clones the repo, detects hardware, runs 13-phase installer
    wsl bash -c "curl -fsSL '$BOOTSTRAP_URL' | bash"
    $exitCode = $LASTEXITCODE

    Write-Host "  ================================================================" -ForegroundColor Cyan

    if ($exitCode -eq 0) {
        Write-Host ""
        Write-Host "  ================================================================" -ForegroundColor Green
        Write-Host "  DreamServer is ready!" -ForegroundColor Green
        Write-Host "  Open http://localhost:3000 in your browser" -ForegroundColor White
        Write-Host "  ================================================================" -ForegroundColor Green
        Write-Host ""

        # Open browser
        Start-Process "http://localhost:3000"
    } else {
        Write-Host ""
        Write-Warn "Installer exited with code $exitCode. Check the output above."
        Write-Host "  You can retry with:" -ForegroundColor Gray
        Write-Host "    wsl bash -c `"curl -fsSL $BOOTSTRAP_URL | bash`"" -ForegroundColor Gray
        Write-Host "  Or for help:" -ForegroundColor Gray
        Write-Host "    https://github.com/Light-Heart-Labs/DreamServer/issues" -ForegroundColor Gray
    }
}
