# Self-healing SSH tunnel supervisor for ODS remote OpenAI-compatible inference.
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$SshHost = "",
    [string]$LocalAddress = "",
    [int]$LocalPort = 0,
    [string]$RemoteAddress = "",
    [int]$RemotePort = 0,
    [string]$ExpectedModel = "",
    [int]$HealthySleepSeconds = 20,
    [int]$RetrySleepSeconds = 10
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}
$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
$EnvPath = Join-Path $InstallDir ".env"

function Get-OdsEnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$Default = ""
    )
    if (Test-Path -LiteralPath $EnvPath) {
        foreach ($line in Get-Content -LiteralPath $EnvPath) {
            if ($line -match ("^{0}=" -f [regex]::Escape($Name))) {
                return ($line -replace ("^{0}=" -f [regex]::Escape($Name)), "").Trim().Trim('"').Trim("'")
            }
        }
    }
    $envValue = [Environment]::GetEnvironmentVariable($Name)
    if (-not [string]::IsNullOrWhiteSpace($envValue)) {
        return $envValue
    }
    return $Default
}

if ([string]::IsNullOrWhiteSpace($SshHost)) {
    $SshHost = Get-OdsEnvValue -Name "REMOTE_LLM_TUNNEL_SSH_HOST"
}
if ([string]::IsNullOrWhiteSpace($LocalAddress)) {
    $LocalAddress = Get-OdsEnvValue -Name "REMOTE_LLM_TUNNEL_LOCAL_ADDRESS" -Default "127.0.0.1"
}
if ($LocalPort -le 0) {
    $LocalPort = [int](Get-OdsEnvValue -Name "REMOTE_LLM_TUNNEL_LOCAL_PORT" -Default "18080")
}
if ([string]::IsNullOrWhiteSpace($RemoteAddress)) {
    $RemoteAddress = Get-OdsEnvValue -Name "REMOTE_LLM_TUNNEL_REMOTE_ADDRESS" -Default "127.0.0.1"
}
if ($RemotePort -le 0) {
    $RemotePort = [int](Get-OdsEnvValue -Name "REMOTE_LLM_TUNNEL_REMOTE_PORT" -Default "8000")
}
if ([string]::IsNullOrWhiteSpace($ExpectedModel)) {
    $ExpectedModel = Get-OdsEnvValue -Name "REMOTE_LLM_TUNNEL_EXPECTED_MODEL" -Default (Get-OdsEnvValue -Name "LLM_MODEL")
}
if ([string]::IsNullOrWhiteSpace($SshHost)) {
    throw "REMOTE_LLM_TUNNEL_SSH_HOST is required, or pass -SshHost."
}

$LogDir = Join-Path $InstallDir "logs"
$LogPath = Join-Path $LogDir "remote-llm-tunnel.log"
$StdOutPath = Join-Path $LogDir "remote-llm-tunnel-ssh.out.log"
$StdErrPath = Join-Path $LogDir "remote-llm-tunnel-ssh.err.log"
$PidPath = Join-Path $LogDir "remote-llm-tunnel.pid"
$HealthUrl = "http://$LocalAddress`:$LocalPort/v1/models"
$ForwardSpec = "{0}:{1}:{2}:{3}" -f $LocalAddress, $LocalPort, $RemoteAddress, $RemotePort
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Write-TunnelLog {
    param([Parameter(Mandatory = $true)][string]$Message)
    try {
        if ((Test-Path -LiteralPath $LogPath) -and ((Get-Item -LiteralPath $LogPath).Length -gt 1048576)) {
            $rotated = "$LogPath.1"
            Remove-Item -LiteralPath $rotated -Force -ErrorAction SilentlyContinue
            Move-Item -LiteralPath $LogPath -Destination $rotated -Force
        }
    } catch {
    }
    Add-Content -LiteralPath $LogPath -Value ("{0} {1}" -f (Get-Date).ToString("s"), $Message) -Encoding UTF8
}

function Get-ProcessCommandLine {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    try {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
        return [string]$proc.CommandLine
    } catch {
        return ""
    }
}

function Test-TunnelCommandLine {
    param([string]$CommandLine)
    if ([string]::IsNullOrWhiteSpace($CommandLine)) {
        return $false
    }
    return ($CommandLine -like "*$LocalPort`:$RemoteAddress`:$RemotePort*" -or
            $CommandLine -like "*$ForwardSpec*")
}

function Get-PortListener {
    try {
        $listeners = @(Get-NetTCPConnection -LocalAddress $LocalAddress -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue)
        if (-not $listeners) {
            $listeners = @(Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue)
        }
        $listener = $listeners | Select-Object -First 1
        if (-not $listener) {
            return $null
        }
        $processName = "unknown"
        try {
            $processName = (Get-Process -Id $listener.OwningProcess -ErrorAction Stop).ProcessName
        } catch {
        }
        return [pscustomobject]@{
            ProcessId = [int]$listener.OwningProcess
            ProcessName = $processName
            CommandLine = Get-ProcessCommandLine -ProcessId ([int]$listener.OwningProcess)
        }
    } catch {
        Write-TunnelLog "port listener check failed: $($_.Exception.Message)"
        return $null
    }
}

function Test-RemoteModelEndpoint {
    try {
        $response = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 5
        $ids = @($response.data | ForEach-Object { $_.id })
        if ([string]::IsNullOrWhiteSpace($ExpectedModel)) {
            return ($ids.Count -gt 0)
        }
        return ($ids -contains $ExpectedModel)
    } catch {
        Write-TunnelLog "health check failed: $($_.Exception.Message)"
        return $false
    }
}

function Stop-SshTunnelProcess {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction Stop
        if ($proc.ProcessName -ne "ssh") {
            Write-TunnelLog "refusing to stop non-ssh process $ProcessId ($($proc.ProcessName))"
            return
        }
        $commandLine = Get-ProcessCommandLine -ProcessId $ProcessId
        if (-not (Test-TunnelCommandLine -CommandLine $commandLine)) {
            Write-TunnelLog "refusing to stop ssh process $ProcessId because it does not match this tunnel"
            return
        }
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        Write-TunnelLog "stopped stale ssh tunnel process $ProcessId"
    } catch {
        Write-TunnelLog "failed to stop ssh tunnel process $ProcessId`: $($_.Exception.Message)"
    }
}

function Stop-TrackedTunnel {
    if (-not (Test-Path -LiteralPath $PidPath)) {
        return
    }
    try {
        $pidText = (Get-Content -LiteralPath $PidPath -Raw).Trim()
        if ($pidText -match "^\d+$") {
            Stop-SshTunnelProcess -ProcessId ([int]$pidText)
        }
    } catch {
        Write-TunnelLog "failed to process pid file: $($_.Exception.Message)"
    }
    Remove-Item -LiteralPath $PidPath -Force -ErrorAction SilentlyContinue
}

function Start-SshTunnel {
    $sshArgs = @(
        "-N",
        "-T",
        "-L", $ForwardSpec,
        "-o", "ExitOnForwardFailure=yes",
        "-o", "ServerAliveInterval=30",
        "-o", "ServerAliveCountMax=3",
        "-o", "StrictHostKeyChecking=yes",
        "-o", "BatchMode=yes",
        $SshHost
    )
    Write-TunnelLog "starting ssh tunnel: $LocalAddress`:$LocalPort -> $SshHost $RemoteAddress`:$RemotePort"
    try {
        $proc = Start-Process -FilePath "ssh.exe" -ArgumentList $sshArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput $StdOutPath -RedirectStandardError $StdErrPath
        Set-Content -LiteralPath $PidPath -Value ([string]$proc.Id) -Encoding ASCII
        Write-TunnelLog "started ssh tunnel process $($proc.Id)"
    } catch {
        Write-TunnelLog "failed to start ssh tunnel: $($_.Exception.Message)"
    }
}

$mutexName = "Local\ODS_Remote_LLM_Tunnel_Supervisor_$LocalPort"
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0)) {
    Write-TunnelLog "another remote LLM tunnel supervisor is already running for port $LocalPort; exiting"
    exit 0
}

Write-TunnelLog "supervisor started for $HealthUrl expecting '$ExpectedModel'"
try {
    while ($true) {
        if (Test-RemoteModelEndpoint) {
            Start-Sleep -Seconds $HealthySleepSeconds
            continue
        }

        $listener = Get-PortListener
        if ($listener) {
            if ($listener.ProcessName -eq "ssh" -and (Test-TunnelCommandLine -CommandLine $listener.CommandLine)) {
                Write-TunnelLog "port $LocalPort has an unhealthy ssh listener; recycling process $($listener.ProcessId)"
                Stop-SshTunnelProcess -ProcessId $listener.ProcessId
            } else {
                Write-TunnelLog "port $LocalPort is occupied by $($listener.ProcessName) pid=$($listener.ProcessId); waiting"
                Start-Sleep -Seconds $RetrySleepSeconds
                continue
            }
        } else {
            Stop-TrackedTunnel
        }

        Start-SshTunnel
        Start-Sleep -Seconds 4
        if (Test-RemoteModelEndpoint) {
            Write-TunnelLog "tunnel healthy"
        } else {
            Write-TunnelLog "tunnel not healthy yet; will retry"
            try {
                $recent = Get-Content -LiteralPath $StdErrPath -Tail 3 -ErrorAction SilentlyContinue
                foreach ($line in $recent) {
                    if (-not [string]::IsNullOrWhiteSpace($line)) {
                        Write-TunnelLog "ssh stderr: $line"
                    }
                }
            } catch {
            }
        }
        Start-Sleep -Seconds $RetrySleepSeconds
    }
} finally {
    try {
        $mutex.ReleaseMutex()
    } catch {
    }
    $mutex.Dispose()
}
