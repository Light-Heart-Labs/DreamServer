# ============================================================================
# Dream Server Windows Installer -- Main Orchestrator
# ============================================================================
# Standalone Windows installer. Does not modify any Linux installer files.
#
# NVIDIA:           Docker Desktop handles GPU passthrough via WSL2.
#                   docker-compose.base.yml + docker-compose.nvidia.yml used unchanged.
#
# AMD Strix Halo:   llama-server runs natively with Vulkan on Windows.
#                   Everything else runs in Docker. Containers reach the host
#                   via host.docker.internal.
#
# Architecture:
#   This file is the orchestrator only. It sources lib/ helpers, sets phase
#   context variables, then dot-sources each numbered phase from phases/:
#
#     phases/01-preflight.ps1    -- admin, PS version, Docker, disk, Ollama
#     phases/02-detection.ps1    -- GPU, RAM, tier selection, driver check
#     phases/03-features.ps1     -- interactive feature selection menu
#     phases/04-requirements.ps1 -- tier RAM/disk minimums, port conflicts
#     phases/05-docker.ps1       -- Docker daemon health, Compose detection
#     phases/06-directories.ps1  -- dirs, robocopy, .env, SearXNG, OpenClaw
#     phases/07-devtools.ps1     -- OpenCode, Claude Code, Codex CLI
#
#   Phases 08 (LAUNCH) and 09 (VERIFY) remain inline here pending extraction.
#
# Usage:
#   .\install-windows.ps1                  # Interactive install
#   .\install-windows.ps1 --Tier 3         # Force tier 3
#   .\install-windows.ps1 --Cloud          # Cloud-only (no local GPU)
#   .\install-windows.ps1 --DryRun         # Validate without installing
#   .\install-windows.ps1 --All            # Enable all optional services
#   .\install-windows.ps1 --NonInteractive # Headless install (defaults)
#
# ============================================================================

[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$Force,
    [switch]$NonInteractive,
    [string]$Tier = "",
    [switch]$Voice,
    [switch]$Workflows,
    [switch]$Rag,
    [switch]$OpenClaw,
    [switch]$All,
    [switch]$Cloud,
    [string]$SummaryJsonPath = ""
)

$ErrorActionPreference = "Stop"

# ── Locate directories ────────────────────────────────────────────────────────
$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
# NOTE: Nested Join-Path required -- PS 5.1 only accepts 2 arguments
$SourceRoot = (Resolve-Path (Join-Path (Join-Path $ScriptDir "..") "..")).Path

# ── Source libraries ──────────────────────────────────────────────────────────
$LibDir = Join-Path $ScriptDir "lib"
. (Join-Path $LibDir "constants.ps1")
. (Join-Path $LibDir "ui.ps1")
. (Join-Path $LibDir "tier-map.ps1")
. (Join-Path $LibDir "detection.ps1")
. (Join-Path $LibDir "env-generator.ps1")

# ── Phase context variables ───────────────────────────────────────────────────
# These are plain (non-$script:) variables set in the orchestrator scope.
# Because phases are dot-sourced, they run in this same scope and can both
# read these inputs and write back their own output variables.
$dryRun         = $DryRun.IsPresent
$force          = $Force.IsPresent
$nonInteractive = $NonInteractive.IsPresent
$cloudMode      = $Cloud.IsPresent
$tierOverride   = $Tier
$voiceFlag      = $Voice.IsPresent
$workflowsFlag  = $Workflows.IsPresent
$ragFlag        = $Rag.IsPresent
$openClawFlag   = $OpenClaw.IsPresent
$allFlag        = $All.IsPresent
$installDir     = $script:DS_INSTALL_DIR
$sourceRoot     = $SourceRoot

# ── Phase dispatcher ──────────────────────────────────────────────────────────
$PhasesDir = Join-Path $ScriptDir "phases"

Write-DreamBanner

# Variables produced by each phase and consumed by downstream phases:
#
#  Phase 01 → $preflight_docker (hashtable)
#  Phase 02 → $gpuInfo, $systemRamGB, $selectedTier, $tierConfig, $llamaServerImage
#  Phase 03 → $enableVoice, $enableWorkflows, $enableRag, $enableOpenClaw, $openClawConfig
#  Phase 04 → $requirementsMet
#  Phase 05 → $dockerComposeCmd
#  Phase 06 → $envResult (EnvPath, SearxngSecret, OpenclawToken, DashboardKey)
#  Phase 07 → (no output -- tools installed to $env:USERPROFILE)

. (Join-Path $PhasesDir "01-preflight.ps1")
. (Join-Path $PhasesDir "02-detection.ps1")
. (Join-Path $PhasesDir "03-features.ps1")
. (Join-Path $PhasesDir "04-requirements.ps1")
. (Join-Path $PhasesDir "05-docker.ps1")
. (Join-Path $PhasesDir "06-directories.ps1")
. (Join-Path $PhasesDir "07-devtools.ps1")

# ============================================================================
# PHASE 8 -- LAUNCH (download model, start Docker services)
# ============================================================================
Write-Phase -Phase 8 -Total 13 -Name "LAUNCH" -Estimate "2-30 minutes (model download)"

if ($dryRun) {
    if ($tierConfig.GgufUrl) {
        Write-AI "[DRY RUN] Would download: $($tierConfig.GgufFile)"
    }
    if ($gpuInfo.Backend -eq "amd") {
        Write-AI "[DRY RUN] Would download llama-server.exe (Vulkan build)"
        Write-AI "[DRY RUN] Would start native llama-server on port 8080"
    }
    Write-AI "[DRY RUN] Would run: docker compose up -d"
} else {
    Push-Location $installDir

    try {
        # ── Download GGUF model ───────────────────────────────────────────────
        if ($tierConfig.GgufUrl -and -not $cloudMode) {
            $modelPath    = Join-Path (Join-Path $installDir "data\models") $tierConfig.GgufFile
            $needsDownload = -not (Test-Path $modelPath)

            if ((Test-Path $modelPath) -and $tierConfig.GgufSha256) {
                Write-AI "Verifying model integrity (SHA256)..."
                $integrity = Test-ModelIntegrity -Path $modelPath -ExpectedHash $tierConfig.GgufSha256
                if ($integrity.Valid) {
                    Write-AISuccess "Model verified: $($tierConfig.GgufFile)"
                } else {
                    Write-AIWarn "Model file is corrupt (hash mismatch). Removing and re-downloading..."
                    Remove-Item $modelPath -Force
                    $needsDownload = $true
                }
            } elseif (Test-Path $modelPath) {
                Write-AISuccess "Model already present: $($tierConfig.GgufFile)"
            }

            if ($needsDownload) {
                $dlOk = Show-ProgressDownload -Url $tierConfig.GgufUrl `
                    -Destination $modelPath -Label "Downloading $($tierConfig.GgufFile)"
                if (-not $dlOk) {
                    Write-AIError "Model download failed. Re-run the installer to resume."
                    exit 1
                }
                if ($tierConfig.GgufSha256) {
                    Write-AI "Verifying download integrity (SHA256)..."
                    $integrity = Test-ModelIntegrity -Path $modelPath -ExpectedHash $tierConfig.GgufSha256
                    if ($integrity.Valid) {
                        Write-AISuccess "Download verified OK"
                    } else {
                        Write-AIError "Downloaded file is corrupt (SHA256 mismatch)."
                        Write-AI "  Expected: $($integrity.ExpectedHash)"
                        Write-AI "  Got:      $($integrity.ActualHash)"
                        Remove-Item $modelPath -Force
                        Write-AIError "Re-run the installer to download again."
                        exit 1
                    }
                }
            }
        }

        # ── AMD: native llama-server.exe (Vulkan) ─────────────────────────────
        if ($gpuInfo.Backend -eq "amd" -and -not $cloudMode) {
            Write-Chapter "NATIVE LLAMA-SERVER (VULKAN)"

            $llamaZip = Join-Path $env:TEMP $script:LLAMA_CPP_VULKAN_ASSET
            if (-not (Test-Path $script:LLAMA_SERVER_EXE)) {
                if (-not (Test-Path $llamaZip)) {
                    $dlOk = Invoke-DownloadWithRetry -Url $script:LLAMA_CPP_VULKAN_URL `
                        -Destination $llamaZip -Label "Downloading llama-server (Vulkan)"
                    if (-not $dlOk) {
                        Write-AIError "Failed to download llama-server after retries."
                        exit 1
                    }
                }

                Write-AI "Validating llama-server archive..."
                $zipValid = Test-ZipIntegrity -Path $llamaZip
                if (-not $zipValid.Valid) {
                    Write-AIWarn "Archive is corrupt: $($zipValid.ErrorMessage)"
                    Remove-Item $llamaZip -Force -ErrorAction SilentlyContinue
                    Write-AIError "Corrupted download. Re-run the installer."
                    exit 1
                }

                Write-AI "Extracting llama-server..."
                New-Item -ItemType Directory -Path $script:LLAMA_SERVER_DIR -Force | Out-Null
                if (-not (Invoke-ExtractionWithRetry -ZipPath $llamaZip -DestinationPath $script:LLAMA_SERVER_DIR)) {
                    Write-AIError "Failed to extract llama-server after retries."
                    exit 1
                }

                # The zip may contain a subdirectory -- find llama-server.exe
                $exeFound = Get-ChildItem -Path $script:LLAMA_SERVER_DIR -Recurse -Filter "llama-server.exe" |
                    Select-Object -First 1
                if ($exeFound -and $exeFound.DirectoryName -ne $script:LLAMA_SERVER_DIR) {
                    Get-ChildItem -Path $exeFound.DirectoryName -Force |
                        Move-Item -Destination $script:LLAMA_SERVER_DIR -Force
                }
                if (-not (Test-Path $script:LLAMA_SERVER_EXE)) {
                    Write-AIError "llama-server.exe not found after extraction."
                    exit 1
                }
                Write-AISuccess "llama-server (Vulkan) extracted"
            } else {
                Write-AISuccess "llama-server.exe already present"
            }

            # Start native llama-server
            Write-AI "Starting native llama-server (Vulkan)..."
            $modelFullPath = Join-Path (Join-Path $installDir "data\models") $tierConfig.GgufFile
            $llamaArgs = @(
                "--model", $modelFullPath,
                "--host", "0.0.0.0",
                "--port", "8080",
                "--n-gpu-layers", "999",
                "--ctx-size", "$($tierConfig.MaxContext)"
            )
            $pidDir = Split-Path $script:LLAMA_SERVER_PID_FILE
            New-Item -ItemType Directory -Path $pidDir -Force | Out-Null

            $proc = Start-Process -FilePath $script:LLAMA_SERVER_EXE `
                -ArgumentList $llamaArgs -WindowStyle Hidden -PassThru
            Set-Content -Path $script:LLAMA_SERVER_PID_FILE -Value $proc.Id

            Write-AI "Waiting for llama-server to load model..."
            $maxWait = 120; $waited = 0; $healthy = $false
            while ($waited -lt $maxWait) {
                Start-Sleep -Seconds 2; $waited += 2
                try {
                    $req = [System.Net.HttpWebRequest]::Create("http://localhost:8080/health")
                    $req.Timeout = 3000; $req.Method = "GET"
                    $resp = $req.GetResponse(); $code = [int]$resp.StatusCode; $resp.Close()
                    if ($code -eq 200) { $healthy = $true; break }
                } catch { }
                if ($waited % 10 -eq 0) { Write-AI "  Still loading... ($waited s)" }
            }
            if ($healthy) {
                Write-AISuccess "Native llama-server healthy (PID $($proc.Id))"
            } else {
                Write-AIWarn "llama-server did not respond within ${maxWait}s. It may still be loading."
            }
        }

        # ── Assemble Docker Compose flags ─────────────────────────────────────
        # NOTE: Blackwell GPUs (sm_120) work with the standard server-cuda image
        # via PTX JIT compilation. No special image override is needed.
        $composeFlags = @("-f", "docker-compose.base.yml")

        if ($cloudMode) {
            $composeFlags += @("-f", "installers/windows/docker-compose.windows-amd.yml")
        } elseif ($gpuInfo.Backend -eq "nvidia") {
            $composeFlags += @("-f", "docker-compose.nvidia.yml")
        } elseif ($gpuInfo.Backend -eq "amd") {
            $composeFlags += @("-f", "installers/windows/docker-compose.windows-amd.yml")
        }

        # Discover enabled extension compose fragments via manifests
        # Mirrors resolve-compose-stack.sh: reads manifest.yaml, checks schema_version
        # and gpu_backends before including a service's compose file.
        $extDir        = Join-Path (Join-Path $installDir "extensions") "services"
        $currentBackend = $(if ($cloudMode) { "none" } else { $gpuInfo.Backend })

        if (Test-Path $extDir) {
            $extServices = Get-ChildItem -Path $extDir -Directory | Sort-Object Name
            foreach ($svcDir in $extServices) {
                $manifestPath = Join-Path $svcDir.FullName "manifest.yaml"
                if (-not (Test-Path $manifestPath)) {
                    $manifestPath = Join-Path $svcDir.FullName "manifest.yml"
                }
                if (-not (Test-Path $manifestPath)) { continue }

                $manifestLines = Get-Content $manifestPath -ErrorAction SilentlyContinue
                if (-not $manifestLines) { continue }

                $hasSchema = $manifestLines | Where-Object { $_ -match "schema_version:\s*dream\.services\.v1" }
                if (-not $hasSchema) { continue }

                $backendsLine = $manifestLines | Where-Object { $_ -match "gpu_backends:" }
                if ($backendsLine -and $currentBackend -ne "none") {
                    $backendsStr = ($backendsLine -split "gpu_backends:")[1]
                    if ($backendsStr -notmatch $currentBackend -and $backendsStr -notmatch "all") {
                        continue
                    }
                }

                $composeFile    = "compose.yaml"
                $composeRefLine = $manifestLines | Where-Object { $_ -match "compose_file:" }
                if ($composeRefLine) {
                    $composeFile = (($composeRefLine -split "compose_file:")[1]).Trim().Trim('"').Trim("'")
                }

                $composePath = Join-Path $svcDir.FullName $composeFile
                if (-not (Test-Path $composePath)) { continue }

                $svcName = $svcDir.Name
                $skip    = $false
                switch ($svcName) {
                    "whisper"    { if (-not $enableVoice)     { $skip = $true } }
                    "tts"        { if (-not $enableVoice)     { $skip = $true } }
                    "n8n"        { if (-not $enableWorkflows) { $skip = $true } }
                    "qdrant"     { if (-not $enableRag)       { $skip = $true } }
                    "embeddings" { if (-not $enableRag)       { $skip = $true } }
                    "openclaw"   { if (-not $enableOpenClaw)  { $skip = $true } }
                }
                if ($skip) { continue }

                $relPath = $composePath.Substring($installDir.Length + 1) -replace "\\", "/"
                $composeFlags += @("-f", $relPath)

                if ($currentBackend -eq "nvidia") {
                    $gpuOverlay = Join-Path $svcDir.FullName "compose.nvidia.yaml"
                    if (Test-Path $gpuOverlay) {
                        $relOverlay = $gpuOverlay.Substring($installDir.Length + 1) -replace "\\", "/"
                        $composeFlags += @("-f", $relOverlay)
                    }
                }
            }
        }

        # Tier 0 memory overlay
        if ($selectedTier -eq "0" -and (Test-Path (Join-Path $installDir "docker-compose.tier0.yml"))) {
            $composeFlags += @("-f", "docker-compose.tier0.yml")
            Write-AI "Applying lightweight memory limits for Tier 0"
        }

        # User override
        if (Test-Path (Join-Path $installDir "docker-compose.override.yml")) {
            $composeFlags += @("-f", "docker-compose.override.yml")
        }

        # Validate compose files exist before launching
        for ($fi = 0; $fi -lt $composeFlags.Count; $fi++) {
            if ($composeFlags[$fi] -eq "-f" -and ($fi + 1) -lt $composeFlags.Count) {
                $cf = $composeFlags[$fi + 1]
                if (-not (Test-Path $cf)) {
                    Write-AIError "Compose file not found: $cf"
                    Write-AI "  Re-run with --Force or check that $installDir is intact."
                    exit 1
                }
            }
        }

        # ── Start Docker services ─────────────────────────────────────────────
        Write-Chapter "STARTING SERVICES"
        Write-AI "Running: docker compose $($composeFlags -join ' ') up -d"
        # PS 5.1 treats ANY stderr output from native commands as NativeCommandError.
        # Silence stderr-as-error so $LASTEXITCODE reflects the real compose exit code.
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        & docker compose @composeFlags up -d 2>&1 | ForEach-Object { Write-Host "  $_" }
        $composeExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP
        if ($composeExit -ne 0) {
            Write-AIError "docker compose up failed (exit code: $composeExit)"
            exit 1
        }
        Write-AISuccess "Docker services started"

        # Save compose flags for dream.ps1 (BOM-free for reliable parsing)
        $flagsFile = Join-Path $installDir ".compose-flags"
        Write-Utf8NoBom -Path $flagsFile -Content ($composeFlags -join " ")

    } finally {
        Pop-Location
    }
}

# ============================================================================
# PHASE 9 -- VERIFY (health checks, Perplexica config, shortcuts, summary)
# ============================================================================
Write-Phase -Phase 9 -Total 13 -Name "VERIFICATION" -Estimate "~30 seconds"

if ($dryRun) {
    Write-AI "[DRY RUN] Would health-check all services"
    Write-AI "[DRY RUN] Would auto-configure Perplexica for $($tierConfig.LlmModel)"
    Write-AI "[DRY RUN] Install validation complete"
    Write-AISuccess "Dry run finished -- no changes made"
    exit 0
}

# ── Service health checks ─────────────────────────────────────────────────────
$llamaHealthPort = "8080"
$healthChecks    = @(
    @{ Name = "LLM (llama-server)";   Url = "http://localhost:${llamaHealthPort}/health" }
    @{ Name = "Chat UI (Open WebUI)"; Url = "http://localhost:3000" }
)
if ($enableVoice)     { $healthChecks += @{ Name = "Whisper (STT)";    Url = "http://localhost:9000/health" } }
if ($enableWorkflows) { $healthChecks += @{ Name = "n8n (Workflows)";   Url = "http://localhost:5678/healthz" } }
if (Test-Path $script:OPENCODE_EXE) {
    $healthChecks += @{ Name = "OpenCode (IDE)"; Url = "http://localhost:$($script:OPENCODE_PORT)/" }
}

Write-AI "Running health checks..."
$maxAttempts = 60; $allHealthy = $true

foreach ($check in $healthChecks) {
    $healthy = $false
    for ($i = 1; $i -le $maxAttempts; $i++) {
        try {
            $req = [System.Net.HttpWebRequest]::Create($check.Url)
            $req.Timeout = 3000; $req.Method = "GET"
            $resp = $req.GetResponse(); $code = [int]$resp.StatusCode; $resp.Close()
            if ($code -ge 200 -and $code -lt 400) { $healthy = $true; break }
        } catch [System.Net.WebException] {
            # 401/403 means the service IS up (auth-protected) -- treat as healthy
            $webResp = $_.Exception.Response
            if ($webResp) {
                $code = [int]$webResp.StatusCode
                if ($code -eq 401 -or $code -eq 403) { $healthy = $true; break }
            }
        } catch { }
        if ($i -le 3 -or $i % 5 -eq 0) {
            Write-AI "  Waiting for $($check.Name)... ($i/$maxAttempts)"
        }
        Start-Sleep -Seconds 2
    }
    if ($healthy) {
        Write-AISuccess "$($check.Name): healthy"
    } else {
        Write-AIWarn "$($check.Name): not responding after $maxAttempts attempts"
        $allHealthy = $false
    }
}

# ── Auto-configure Perplexica ─────────────────────────────────────────────────
Write-AI "Configuring Perplexica..."
$perplexicaOk = Set-PerplexicaConfig -PerplexicaPort 3004 -LlmModel $tierConfig.LlmModel
if ($perplexicaOk) {
    Write-AISuccess "Perplexica configured (model: $($tierConfig.LlmModel))"
} else {
    Write-AIWarn "Perplexica auto-config skipped -- complete setup at http://localhost:3004"
}

# ── Desktop & Start Menu shortcuts ───────────────────────────────────────────
try {
    $dashboardUrl  = "http://localhost:3001"
    $shortcutName  = "Dream Server"
    $urlContent    = "[InternetShortcut]`nURL=$dashboardUrl`nIconIndex=0`n"

    $desktopDir    = [Environment]::GetFolderPath("Desktop")
    Write-Utf8NoBom -Path (Join-Path $desktopDir   "$shortcutName.url") -Content $urlContent

    $startMenuDir  = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
    Write-Utf8NoBom -Path (Join-Path $startMenuDir "$shortcutName.url") -Content $urlContent

    # Attempt taskbar pin via Shell COM verb (silent no-op on builds that block it)
    try {
        $shell = New-Object -ComObject Shell.Application
        $folder = $shell.Namespace($desktopDir)
        $item = $folder.ParseName("$shortcutName.url")
        if ($item) {
            $item.Verbs() | Where-Object { $_.Name -match "pin.*taskbar|Taskbar" } |
                ForEach-Object { $_.DoIt() }
        }
    } catch { }

    Write-AISuccess "Added Dream Server shortcut to Desktop and Start Menu"
} catch {
    Write-AIWarn "Could not create shortcuts: $_"
}

# ── Success card ──────────────────────────────────────────────────────────────
if ($allHealthy) {
    Write-SuccessCard
} else {
    Write-Host ""
    Write-AIWarn "Some services may still be starting. Check status with:"
    Write-Host "  .\dream.ps1 status" -ForegroundColor Cyan
    Write-Host ""
    Write-SuccessCard
}

# ── Summary JSON (for CI / automation) ───────────────────────────────────────
if ($SummaryJsonPath) {
    $summary = @{
        version    = $script:DS_VERSION
        tier       = $selectedTier
        tierName   = $tierConfig.TierName
        model      = $tierConfig.LlmModel
        gpuBackend = $gpuInfo.Backend
        gpuName    = $gpuInfo.Name
        installDir = $installDir
        features   = @{
            voice     = $enableVoice
            workflows = $enableWorkflows
            rag       = $enableRag
            openclaw  = $enableOpenClaw
        }
        healthy    = $allHealthy
        timestamp  = (Get-Date -Format "o")
    }
    Write-Utf8NoBom -Path $SummaryJsonPath -Content ($summary | ConvertTo-Json -Depth 3)
    Write-AI "Summary written to $SummaryJsonPath"
}
