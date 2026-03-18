# ============================================================================
# Dream Server Windows Installer -- Phase 01: Pre-flight Checks
# ============================================================================
# Part of: installers/windows/phases/
# Purpose: Admin check, PowerShell version, Windows version, Docker Desktop,
#          initial disk space, Ollama conflict, compose file presence.
#
# Reads (set by install-windows.ps1 before dot-sourcing):
#   $installDir    -- target install path (for disk check)
#   $sourceRoot    -- cloned repo root (for compose file check)
#   $force         -- skip non-fatal failures
#   $nonInteractive -- suppress interactive prompts
#
# Writes:
#   $preflight_docker  -- result hashtable from Test-DockerDesktop
#                         (consumed by phase 02 for GPU support status)
#
# Modder notes:
#   Add new pre-flight checks (e.g., minimum Windows build) here.
#   All fatal exits use `exit 1`. Non-fatal issues use Write-AIWarn.
# ============================================================================

Write-Phase -Phase 1 -Total 13 -Name "PRE-FLIGHT CHECKS" -Estimate "~30 seconds"
Write-AI "Scanning your system for required components..."

# ── Admin check ─────────────────────────────────────────────────────────────
# Dream Server should NOT run as Administrator. User-level paths
# ($USERPROFILE\.opencode, data/, .env) created as admin become inaccessible
# to the normal user account, breaking OpenCode and dream-cli.
$_isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if ($_isAdmin) {
    Write-AIWarn "Running as Administrator is not recommended."
    Write-AI "  User-level paths (.opencode, data/, .env) created as admin may be"
    Write-AI "  inaccessible to your normal account. Re-run without 'Run as Administrator'."
    if (-not $nonInteractive) {
        $adminChoice = Read-Host "  Continue as Administrator anyway? [y/N]"
        if ($adminChoice -notmatch "^[yY]") {
            Write-AI "Exiting. Re-run this installer as your normal user account."
            exit 0
        }
    }
    Write-AIWarn "Continuing as Administrator. You may need to fix ownership later."
}

# ── PowerShell version ───────────────────────────────────────────────────────
$_psVer = Test-PowerShellVersion
Write-InfoBox "PowerShell:" "$($_psVer.Version)"
if (-not $_psVer.Sufficient) {
    Write-AIError "PowerShell 5.1 or later is required."
    Write-AI "  Download: https://github.com/PowerShell/PowerShell/releases"
    exit 1
}
Write-AISuccess "PowerShell $($_psVer.Version) OK"

# ── Windows version ──────────────────────────────────────────────────────────
# WSL2 requires Windows 10 build 18362 (version 1903) or later.
try {
    $_build = [System.Environment]::OSVersion.Version.Build
    if ($_build -lt 18362) {
        Write-AIError "Windows 10 build 18362 (version 1903) or later is required for WSL2."
        Write-AI "  Your build: $_build. Update Windows and re-run."
        exit 1
    }
    $_winVer = [System.Environment]::OSVersion.Version
    Write-AISuccess "Windows $($_winVer.Major).$($_winVer.Minor) (build $_build) OK"
} catch {
    Write-AIWarn "Could not determine Windows build -- continuing"
}

# ── Docker Desktop ───────────────────────────────────────────────────────────
$preflight_docker = Test-DockerDesktop

if (-not $preflight_docker.Installed) {
    Write-AIError "Docker Desktop is not installed."
    Write-AI "  Download: https://docs.docker.com/desktop/install/windows-install/"
    Write-AI "  After installing, enable WSL2: Docker Desktop > Settings > General > Use WSL 2 based engine"
    exit 1
}
Write-AISuccess "Docker CLI found"

if (-not $preflight_docker.Running) {
    Write-AIError "Docker Desktop is not running."
    Write-AI "  Start it from the Start Menu, then re-run this installer."
    Write-Host "  & 'C:\Program Files\Docker\Docker\Docker Desktop.exe'" -ForegroundColor Cyan
    exit 1
}
Write-AISuccess "Docker Desktop running (v$($preflight_docker.Version))"

if (-not $preflight_docker.WSL2Backend) {
    Write-AIWarn "WSL2 backend not detected. GPU passthrough requires WSL2."
    Write-AI "  Enable: Docker Desktop > Settings > General > Use WSL 2 based engine"
    if (-not $force) { exit 1 }
    Write-AIWarn "--Force specified, continuing without confirmed WSL2 backend."
}

# ── Initial disk space check ─────────────────────────────────────────────────
# 20 GB minimum before model size is known (tier-aware check happens in phase 04).
$_disk = Test-DiskSpace -Path $installDir -RequiredGB 20
Write-InfoBox "Disk free:" "$($_disk.FreeGB) GB on $($_disk.Drive)"
if (-not $_disk.Sufficient) {
    Write-AIError "At least 20 GB free space is required. Found $($_disk.FreeGB) GB."
    Write-AI "  Free up space on $($_disk.Drive) and re-run."
    exit 1
}
Write-AISuccess "Disk space OK ($($_disk.FreeGB) GB free)"

# ── Source file existence check ──────────────────────────────────────────────
# Verify the compose base file is present in the source tree.
$_composeBase = Join-Path $sourceRoot "docker-compose.base.yml"
if (-not (Test-Path $_composeBase)) {
    Write-AIError "docker-compose.base.yml not found in: $sourceRoot"
    Write-AI "  Make sure you are running this installer from the DreamServer clone:"
    Write-AI "  git clone https://github.com/Light-Heart-Labs/DreamServer.git"
    Write-AI "  cd DreamServer && .\install.ps1"
    exit 1
}
Write-AISuccess "Source tree OK"

# ── Ollama conflict detection ────────────────────────────────────────────────
# Ollama defaults to port 11434. On Windows, it runs as a tray app and
# Open WebUI may auto-discover it (shadowing llama-server on 8080).
$_ollamaProc = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if ($_ollamaProc) {
    Write-AIWarn "Ollama is running (PID $($_ollamaProc.Id)) and may conflict with Dream Server."
    Write-AI "  Open WebUI can auto-discover Ollama and prefer it over llama-server,"
    Write-AI "  causing 'model not found' errors in OpenCode and other host tools."
    Write-Host ""
    if (-not $nonInteractive) {
        $ollamaChoice = Read-Host "  Stop Ollama for this session? [Y/n]"
        if ($ollamaChoice -notmatch "^[nN]") {
            Stop-Process -Name "ollama" -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            $_ollamaStill = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
            if ($_ollamaStill) {
                Write-AIWarn "Ollama restarted automatically (likely in Windows Startup)."
                # Remove the startup shortcut so it does not respawn on next login
                $_lnk = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Ollama.lnk"
                if (Test-Path $_lnk) {
                    Remove-Item $_lnk -Force -ErrorAction SilentlyContinue
                    Stop-Process -Name "ollama" -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 2
                    if (-not (Get-Process -Name "ollama" -ErrorAction SilentlyContinue)) {
                        Write-AISuccess "Ollama stopped and removed from Windows Startup"
                    } else {
                        Write-AIWarn "Could not fully stop Ollama. Port conflicts may occur."
                        Write-AI "  Fix: Settings > Apps > Startup > disable Ollama"
                    }
                } else {
                    Write-AIWarn "Remove Ollama from Startup: Settings > Apps > Startup"
                }
            } else {
                Write-AISuccess "Ollama stopped"
            }
        } else {
            Write-AIWarn "Ollama left running. Open WebUI may prefer it over llama-server."
        }
    } else {
        Write-AIWarn "Ollama detected (PID $($_ollamaProc.Id)). Stop it manually to avoid conflicts."
    }
}

Write-AISuccess "Pre-flight checks passed"
