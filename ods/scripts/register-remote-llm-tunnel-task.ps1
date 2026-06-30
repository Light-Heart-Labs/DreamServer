# Register the remote LLM SSH tunnel supervisor to start at Windows logon.
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$TaskName = ""
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
    return $Default
}

if ([string]::IsNullOrWhiteSpace($TaskName)) {
    $TaskName = Get-OdsEnvValue -Name "REMOTE_LLM_TUNNEL_TASK_NAME" -Default "ODS Remote LLM Tunnel"
}

$scriptPath = Join-Path $InstallDir "scripts\start-remote-llm-tunnel.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Missing tunnel supervisor script: $scriptPath"
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $scriptPath)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Days 0)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Keeps the ODS remote LLM SSH tunnel alive on user logon." `
    -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName |
    Select-Object TaskName, State, @{Name = "UserId"; Expression = { $_.Principal.UserId } }, @{Name = "RunLevel"; Expression = { $_.Principal.RunLevel } }
