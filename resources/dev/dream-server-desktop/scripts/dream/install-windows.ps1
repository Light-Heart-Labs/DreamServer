param(
  [switch]$DryRun,
  [switch]$NonInteractive,
  [string]$Tier = "",
  [switch]$Cloud,
  [switch]$Hybrid,
  [switch]$Voice,
  [switch]$Rag,
  [switch]$Workflows,
  [switch]$Agents,
  [switch]$Image,
  [switch]$NoBootstrap,
  [string]$SummaryJsonPath = "",
  [string]$InstallDir = ""
)
$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/Light-Heart-Labs/DreamServer.git"
$RepoTag = "v2.3.2"
$RepoCommit = "3aa21e658a1cfdf8e7574b6654335454058e3443"
if ([string]::IsNullOrWhiteSpace($InstallDir)) { $InstallDir = Join-Path $env:LOCALAPPDATA "DreamServerHermesDesktop\dreamserver" }
$DreamRoot = Join-Path $InstallDir "DreamServer"
$Installer = Join-Path $DreamRoot "install.ps1"
Write-Host "[INFO] DreamServer wrapper windows tag=$RepoTag dry_run=$($DryRun.IsPresent)"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
if (-not (Test-Path (Join-Path $DreamRoot ".git"))) {
  Write-Host "[INFO] Cloning pinned DreamServer $RepoTag"
  & git clone --depth 1 --branch $RepoTag $RepoUrl $DreamRoot
  if ($LASTEXITCODE -ne 0) { throw "git clone failed with exit code $LASTEXITCODE" }
}
$ActualCommit = (& git -C $DreamRoot rev-parse HEAD).Trim()
if ($ActualCommit -ne $RepoCommit) { throw "DreamServer commit mismatch: expected $RepoCommit got $ActualCommit" }
if (-not (Test-Path $Installer)) { throw "DreamServer installer not found: $Installer" }
$Forward = @{}
if ($DryRun) { $Forward.DryRun = $true }
if ($NonInteractive) { $Forward.NonInteractive = $true }
if ($Tier) { $Forward.Tier = $Tier }
if ($Cloud) { $Forward.Cloud = $true }
if ($Voice) { $Forward.Voice = $true }
if ($Rag) { $Forward.Rag = $true }
if ($Workflows) { $Forward.Workflows = $true }
if ($NoBootstrap) { $Forward.NoBootstrap = $true }
if ($SummaryJsonPath) { $Forward.SummaryJsonPath = $SummaryJsonPath }
if ($Hybrid) { Write-Host "[WARN] Hybrid is recorded by desktop state and installed as local stack." }
if ($Agents) { Write-Host "[INFO] Agents feature selected." }
if ($Image) { Write-Host "[INFO] Image generation feature selected." }
Write-Host "[INFO] Running DreamServer installer safely via PowerShell"
& $Installer @Forward
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($SummaryJsonPath -and -not (Test-Path $SummaryJsonPath)) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $SummaryJsonPath) | Out-Null
  @{ ok = $true; dryRun = [bool]$DryRun; installDir = $InstallDir; dreamServerCommit = $ActualCommit } | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 -Path $SummaryJsonPath
}
