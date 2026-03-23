# ============================================================================
# Dream Server Windows CLI -- dream.ps1
# ============================================================================
# Day-to-day management of a Dream Server installation on Windows.
# Mirrors the Linux dream-cli command structure.
#
# Usage:
#   .\dream.ps1 status              # Health checks + GPU status
#   .\dream.ps1 start [service]     # Start all or one service
#   .\dream.ps1 stop [service]      # Stop all or one service
#   .\dream.ps1 restart [service]   # Restart all or one service
#   .\dream.ps1 logs <service> [N]  # Tail logs (default 100 lines)
#   .\dream.ps1 config show         # View .env (secrets masked)
#   .\dream.ps1 config edit         # Open .env in notepad
#   .\dream.ps1 chat "message"      # Quick chat via API
#   .\dream.ps1 update              # Pull latest images and restart
#   .\dream.ps1 version             # Show version
#   .\dream.ps1 help                # Show help
#
# ============================================================================

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Command = "help",

    [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
)

$ErrorActionPreference = "Stop"

# ── Locate libraries ──
# NOTE: Nested Join-Path required -- PS 5.1 only accepts 2 arguments
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$LibDir = Join-Path $ScriptDir "lib"
. (Join-Path $LibDir "constants.ps1")
. (Join-Path $LibDir "ui.ps1")
. (Join-Path $LibDir "detection.ps1")

# ── Resolve install directory ──
$InstallDir = $script:DS_INSTALL_DIR

# ============================================================================
# Helpers
# ============================================================================

function Test-DockerRunning {
    <#
    .SYNOPSIS
        Quick check if Docker daemon is responsive. Shows friendly message if not.
    #>
    $null = docker info 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-AIError "Docker Desktop is not running."
        Write-AI "Start it from the Start Menu, then try again."
        return $false
    }
    return $true
}

function Test-Install {
    if (-not (Test-Path $InstallDir)) {
        Write-AIError "Dream Server not found at $InstallDir. Set DREAM_HOME or run installer first."
        exit 1
    }
    $baseCompose = Join-Path $InstallDir "docker-compose.base.yml"
    $monoCompose = Join-Path $InstallDir "docker-compose.yml"
    if (-not (Test-Path $baseCompose) -and -not (Test-Path $monoCompose)) {
        Write-AIError "docker-compose.base.yml not found in $InstallDir"
        exit 1
    }
    if (-not (Test-DockerRunning)) { exit 1 }
}

function Get-ComposeFlags {
    <#
    .SYNOPSIS
        Read saved compose flags from installer, or build default flags.
    #>
    $flagsFile = Join-Path $InstallDir ".compose-flags"
    if (Test-Path $flagsFile) {
        $raw = (Get-Content $flagsFile -Raw).Trim()
        return ($raw -split "\s+")
    }

    # Fallback: detect from available files
    $flags = @()
    $base = Join-Path $InstallDir "docker-compose.base.yml"
    $nvidia = Join-Path $InstallDir "docker-compose.nvidia.yml"
    $mono = Join-Path $InstallDir "docker-compose.yml"

    if (Test-Path $base) {
        $flags += @("-f", "docker-compose.base.yml")
        if (Test-Path $nvidia) {
            $flags += @("-f", "docker-compose.nvidia.yml")
        }
    } elseif (Test-Path $mono) {
        $flags += @("-f", "docker-compose.yml")
    }

    # Add enabled extension compose files
    $extDir = Join-Path (Join-Path $InstallDir "extensions") "services"
    if (Test-Path $extDir) {
        Get-ChildItem -Path $extDir -Directory | ForEach-Object {
            $composePath = Join-Path $_.FullName "compose.yaml"
            if (Test-Path $composePath) {
                $relPath = $composePath.Substring($InstallDir.Length + 1) -replace "\\", "/"
                $flags += @("-f", $relPath)
            }
        }
    }

    return $flags
}

function Read-DreamEnv {
    <#
    .SYNOPSIS
        Safely load .env file into a hashtable (no eval, no injection).
    #>
    $envFile = Join-Path $InstallDir ".env"
    $result = @{}
    if (-not (Test-Path $envFile)) { return $result }

    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -match "^#" -or $line -eq "") { return }
        if ($line -match "^([A-Za-z_][A-Za-z0-9_]*)=(.*)$") {
            $key = $Matches[1]
            $val = $Matches[2].Trim('"').Trim("'")
            $result[$key] = $val
        }
    }
    return $result
}

# ── AMD native llama-server management ──

function Get-NativeLlamaStatus {
    <#
    .SYNOPSIS
        Check if native llama-server is running (AMD Strix Halo path).
    .OUTPUTS
        @{ Running; Pid; Healthy }
    #>
    $result = @{ Running = $false; Pid = 0; Healthy = $false }

    if (-not (Test-Path $script:LLAMA_SERVER_PID_FILE)) { return $result }

    $savedPid = [int](Get-Content $script:LLAMA_SERVER_PID_FILE -Raw).Trim()
    try {
        $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
        if ($proc -and -not $proc.HasExited) {
            $result.Running = $true
            $result.Pid = $savedPid

            # Health check
            try {
                $resp = Invoke-WebRequest -Uri "http://localhost:8080/health" `
                    -TimeoutSec 3 -UseBasicParsing -ErrorAction SilentlyContinue
                if ($resp.StatusCode -eq 200) {
                    $result.Healthy = $true
                }
            } catch { }
        }
    } catch { }

    # Clean up stale PID file
    if (-not $result.Running -and (Test-Path $script:LLAMA_SERVER_PID_FILE)) {
        Remove-Item $script:LLAMA_SERVER_PID_FILE -Force -ErrorAction SilentlyContinue
    }

    return $result
}

function Start-NativeLlamaServer {
    <#
    .SYNOPSIS
        Start native llama-server.exe for AMD Vulkan path.
    #>
    $status = Get-NativeLlamaStatus
    if ($status.Running) {
        Write-AISuccess "Native llama-server already running (PID $($status.Pid))"
        return
    }

    if (-not (Test-Path $script:LLAMA_SERVER_EXE)) {
        Write-AIError "llama-server.exe not found at $($script:LLAMA_SERVER_EXE)"
        Write-AI "Re-run the installer to download it."
        return
    }

    $env = Read-DreamEnv
    $ggufFile = $env["GGUF_FILE"]
    $ctxSize  = $env["CTX_SIZE"]
    if (-not $ggufFile) { $ggufFile = "Qwen3.5-9B-Q4_K_M.gguf" }
    if (-not $ctxSize)  { $ctxSize = "16384" }

    $modelPath = Join-Path (Join-Path $InstallDir "data\models") $ggufFile
    if (-not (Test-Path $modelPath)) {
        Write-AIError "Model not found: $modelPath"
        return
    }

    $llamaArgs = @(
        "--model", $modelPath,
        "--host", "0.0.0.0",
        "--port", "8080",
        "--n-gpu-layers", "999",
        "--ctx-size", $ctxSize
    )

    $pidDir = Split-Path $script:LLAMA_SERVER_PID_FILE
    New-Item -ItemType Directory -Path $pidDir -Force | Out-Null

    $proc = Start-Process -FilePath $script:LLAMA_SERVER_EXE `
        -ArgumentList $llamaArgs -WindowStyle Hidden -PassThru
    Set-Content -Path $script:LLAMA_SERVER_PID_FILE -Value $proc.Id

    Write-AISuccess "Native llama-server started (PID $($proc.Id))"
    Write-AI "Waiting for health..."

    $maxWait = 60
    $waited = 0
    while ($waited -lt $maxWait) {
        Start-Sleep -Seconds 2
        $waited += 2
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:8080/health" `
                -TimeoutSec 3 -UseBasicParsing -ErrorAction SilentlyContinue
            if ($resp.StatusCode -eq 200) {
                Write-AISuccess "Native llama-server healthy"
                return
            }
        } catch { }
    }
    Write-AIWarn "llama-server may still be loading model..."
}

function Stop-NativeLlamaServer {
    $status = Get-NativeLlamaStatus
    if (-not $status.Running) {
        Write-AI "Native llama-server not running"
        return
    }

    try {
        Stop-Process -Id $status.Pid -Force -ErrorAction SilentlyContinue
        Write-AISuccess "Native llama-server stopped (PID $($status.Pid))"
    } catch {
        Write-AIWarn "Could not stop PID $($status.Pid): $_"
    }

    if (Test-Path $script:LLAMA_SERVER_PID_FILE) {
        Remove-Item $script:LLAMA_SERVER_PID_FILE -Force -ErrorAction SilentlyContinue
    }
}

# ============================================================================
# Commands
# ============================================================================

function Invoke-Status {
    Test-Install
    Push-Location $InstallDir
    try {
        $flags = Get-ComposeFlags
        Write-Host ""
        Write-Host "  Dream Server Status" -ForegroundColor Cyan
        Write-Host ("  " + ("-" * 40)) -ForegroundColor DarkGray

        # Native llama-server status (AMD)
        if (Test-Path $script:LLAMA_SERVER_PID_FILE) {
            $nativeStatus = Get-NativeLlamaStatus
            if ($nativeStatus.Running) {
                $healthStr = $(if ($nativeStatus.Healthy) { "healthy" } else { "loading" })
                Write-AISuccess "llama-server (native): running PID $($nativeStatus.Pid) ($healthStr)"
            } else {
                Write-AIWarn "llama-server (native): not running (stale PID cleaned)"
            }
        }

        # Docker services
        Write-Host ""
        & docker compose @flags ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>$null

        # Health checks
        Write-Host ""
        Write-Host "  Health Checks" -ForegroundColor Cyan
        Write-Host ("  " + ("-" * 40)) -ForegroundColor DarkGray

        $endpoints = @(
            @{ Name = "LLM API";    Url = "http://localhost:8080/health" }
            @{ Name = "Chat UI";    Url = "http://localhost:3000" }
            @{ Name = "Dashboard";  Url = "http://localhost:3001" }
        )

        foreach ($ep in $endpoints) {
            try {
                $resp = Invoke-WebRequest -Uri $ep.Url -TimeoutSec 3 `
                    -UseBasicParsing -ErrorAction SilentlyContinue
                if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 400) {
                    Write-AISuccess "$($ep.Name): healthy"
                } else {
                    Write-AIWarn "$($ep.Name): $($resp.StatusCode)"
                }
            } catch {
                Write-AIWarn "$($ep.Name): not responding"
            }
        }

        # GPU status
        Write-Host ""
        $gpuInfo = Get-GpuInfo
        if ($gpuInfo.Backend -eq "nvidia") {
            Write-Host "  GPU Status" -ForegroundColor Cyan
            try {
                $gpuStats = & nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits 2>$null
                if ($gpuStats) {
                    $gpuStats -split "`n" | ForEach-Object {
                        $parts = $_ -split ","
                        if ($parts.Count -ge 5) {
                            Write-Host "  $($parts[0].Trim()): $($parts[1].Trim())% GPU | $($parts[2].Trim())MB/$($parts[3].Trim())MB VRAM | $($parts[4].Trim())C" -ForegroundColor White
                        }
                    }
                }
            } catch { }
        } elseif ($gpuInfo.Backend -eq "amd") {
            Write-Host "  GPU: $($gpuInfo.Name) ($($gpuInfo.MemoryType) memory)" -ForegroundColor White
        }

        Write-Host ""
    } finally {
        Pop-Location
    }
}

function Invoke-Start {
    param([string]$Service)
    Test-Install
    Push-Location $InstallDir
    try {
        # Start native llama-server first (AMD path)
        if (-not $Service -and (Test-Path $script:LLAMA_SERVER_EXE)) {
            Start-NativeLlamaServer
        }

        $flags = Get-ComposeFlags
        if ($Service) {
            Write-AI "Starting $Service..."
            & docker compose @flags up -d $Service
            Write-AISuccess "$Service started"
        } else {
            Write-AI "Starting all services..."
            & docker compose @flags up -d
            Write-AISuccess "All services started"
        }
    } finally {
        Pop-Location
    }
}

function Invoke-Stop {
    param([string]$Service)
    Test-Install
    Push-Location $InstallDir
    try {
        $flags = Get-ComposeFlags
        if ($Service) {
            Write-AI "Stopping $Service..."
            & docker compose @flags stop $Service
            Write-AISuccess "$Service stopped"
        } else {
            Write-AI "Stopping all services..."
            & docker compose @flags down

            # Stop native llama-server (AMD path)
            if (Test-Path $script:LLAMA_SERVER_PID_FILE) {
                Stop-NativeLlamaServer
            }

            Write-AISuccess "All services stopped"
        }
    } finally {
        Pop-Location
    }
}

function Invoke-Restart {
    param([string]$Service)
    Test-Install
    Push-Location $InstallDir
    try {
        $flags = Get-ComposeFlags
        if ($Service) {
            Write-AI "Restarting $Service..."
            & docker compose @flags restart $Service
            Write-AISuccess "$Service restarted"
        } else {
            # For AMD, also restart native llama-server
            if (Test-Path $script:LLAMA_SERVER_PID_FILE) {
                Stop-NativeLlamaServer
                Start-NativeLlamaServer
            }
            Write-AI "Restarting all services..."
            & docker compose @flags restart
            Write-AISuccess "All services restarted"
        }
    } finally {
        Pop-Location
    }
}

function Invoke-Logs {
    param(
        [string]$Service,
        [int]$Lines = 100
    )
    if (-not $Service) {
        Write-AI "Usage: .\dream.ps1 logs <service> [lines]"
        Write-AI "Services: llama-server, open-webui, dashboard-api, n8n, whisper, tts, ..."
        return
    }
    Test-Install
    Push-Location $InstallDir
    try {
        $flags = Get-ComposeFlags
        & docker compose @flags logs -f --tail $Lines $Service
    } finally {
        Pop-Location
    }
}

function Invoke-ConfigShow {
    Test-Install
    Write-Host ""
    Write-Host "  Configuration" -ForegroundColor Cyan
    Write-Host "  Install dir: $InstallDir" -ForegroundColor White
    Write-Host ""

    $envFile = Join-Path $InstallDir ".env"
    if (-not (Test-Path $envFile)) {
        Write-AIWarn ".env not found"
        return
    }

    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -match "^#" -or $line -eq "") { return }
        if ($line -match "(SECRET|PASS|TOKEN|KEY)=") {
            $key = ($line -split "=")[0]
            Write-Host "  $key=***" -ForegroundColor DarkGray
        } else {
            Write-Host "  $line" -ForegroundColor White
        }
    }
    Write-Host ""
}

function Invoke-Chat {
    param([string]$Message)
    if (-not $Message) {
        Write-AI "Usage: .\dream.ps1 chat `"your message`""
        return
    }

    $body = @{
        model    = "default"
        messages = @(
            @{ role = "user"; content = $Message }
        )
    } | ConvertTo-Json -Depth 3

    try {
        $resp = Invoke-RestMethod -Uri "http://localhost:8080/v1/chat/completions" `
            -Method POST -Body $body -ContentType "application/json" -TimeoutSec 120

        if ($resp.choices -and $resp.choices[0].message) {
            Write-Host ""
            Write-Host $resp.choices[0].message.content
            Write-Host ""
        }
    } catch {
        Write-AIError "Chat request failed: $_"
        Write-AI "Is llama-server running? Try: .\dream.ps1 status"
    }
}

function Invoke-Update {
    Test-Install
    Push-Location $InstallDir
    try {
        $flags = Get-ComposeFlags
        Write-AI "Pulling latest images..."
        & docker compose @flags pull
        Write-AI "Recreating containers..."
        & docker compose @flags up -d --force-recreate
        Write-AISuccess "Update complete"

        Start-Sleep -Seconds 5
        Invoke-Status
    } finally {
        Pop-Location
    }
}

function Show-Help {
    Write-Host ""
    Write-Host "  Dream Server CLI (Windows)" -ForegroundColor Green
    Write-Host "  Version $($script:DS_VERSION)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  USAGE" -ForegroundColor White
    Write-Host "    .\dream.ps1 <command> [options]" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  COMMANDS" -ForegroundColor White
    Write-Host "    status              " -ForegroundColor Cyan -NoNewline
    Write-Host "Health checks + GPU status" -ForegroundColor DarkGray
    Write-Host "    start [service]     " -ForegroundColor Cyan -NoNewline
    Write-Host "Start all or one service" -ForegroundColor DarkGray
    Write-Host "    stop [service]      " -ForegroundColor Cyan -NoNewline
    Write-Host "Stop all or one service" -ForegroundColor DarkGray
    Write-Host "    restart [service]   " -ForegroundColor Cyan -NoNewline
    Write-Host "Restart all or one service" -ForegroundColor DarkGray
    Write-Host "    logs <svc> [lines]  " -ForegroundColor Cyan -NoNewline
    Write-Host "Tail logs (default 100)" -ForegroundColor DarkGray
    Write-Host "    config show         " -ForegroundColor Cyan -NoNewline
    Write-Host "View .env (secrets masked)" -ForegroundColor DarkGray
    Write-Host "    config edit         " -ForegroundColor Cyan -NoNewline
    Write-Host "Open .env in notepad" -ForegroundColor DarkGray
    Write-Host "    chat `"message`"      " -ForegroundColor Cyan -NoNewline
    Write-Host "Quick chat via API" -ForegroundColor DarkGray
    Write-Host "    update              " -ForegroundColor Cyan -NoNewline
    Write-Host "Pull latest images and restart" -ForegroundColor DarkGray
    Write-Host "    version             " -ForegroundColor Cyan -NoNewline
    Write-Host "Show version" -ForegroundColor DarkGray
    Write-Host "    help                " -ForegroundColor Cyan -NoNewline
    Write-Host "Show this help" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  EXAMPLES" -ForegroundColor White
    Write-Host "    .\dream.ps1 status" -ForegroundColor DarkGray
    Write-Host "    .\dream.ps1 logs llama-server 50" -ForegroundColor DarkGray
    Write-Host "    .\dream.ps1 restart open-webui" -ForegroundColor DarkGray
    Write-Host "    .\dream.ps1 chat `"What is quantum computing?`"" -ForegroundColor DarkGray
    Write-Host ""
}

# ============================================================================
# Command Dispatch
# ============================================================================

switch ($Command.ToLower()) {
    "status"  { Invoke-Status }
    "start"   { Invoke-Start -Service ($Arguments | Select-Object -First 1) }
    "stop"    { Invoke-Stop -Service ($Arguments | Select-Object -First 1) }
    "restart" { Invoke-Restart -Service ($Arguments | Select-Object -First 1) }
    "logs"    {
        $svc = $Arguments | Select-Object -First 1
        $n = $(if ($Arguments.Count -ge 2) { [int]$Arguments[1] } else { 100 })
        Invoke-Logs -Service $svc -Lines $n
    }
    "config"  {
        $action = ($Arguments | Select-Object -First 1)
        if ($action -eq "edit") {
            Test-Install
            & notepad (Join-Path $InstallDir ".env")
        } else {
            Invoke-ConfigShow
        }
    }
    "chat"    { Invoke-Chat -Message ($Arguments -join " ") }
    "update"  { Invoke-Update }
    "version" { Write-Host "Dream Server v$($script:DS_VERSION) (Windows)" -ForegroundColor Green }
    "help"    { Show-Help }
    default   {
        Write-AIWarn "Unknown command: $Command"
        Show-Help
    }
}
