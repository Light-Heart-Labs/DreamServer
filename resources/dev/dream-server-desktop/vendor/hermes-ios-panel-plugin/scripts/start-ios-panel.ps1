$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not $env:PORT) {
  $env:PORT = "8420"
}

npm start
