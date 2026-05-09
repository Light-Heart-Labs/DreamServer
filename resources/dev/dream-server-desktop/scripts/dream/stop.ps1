param([string]$InstallDir = "")
$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($InstallDir)) { $InstallDir = Join-Path $env:LOCALAPPDATA "DreamServerHermesDesktop\dreamserver" }
$DreamPs1 = Join-Path $InstallDir "DreamServer\dream-server\installers\windows\dream.ps1"
if (Test-Path $DreamPs1) { & $DreamPs1 stop; exit $LASTEXITCODE }
Write-Host "DreamServer stack not installed."
