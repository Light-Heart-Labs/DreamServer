# ============================================================================
# Dream Server Windows Installer -- Main Orchestrator
# ============================================================================
# Standalone Windows installer. Does not modify any Linux installer files.
#
# NVIDIA: Docker Desktop handles GPU passthrough via WSL2. Existing
#         docker-compose.base.yml + docker-compose.nvidia.yml work unchanged.
#
# AMD Strix Halo: llama-server runs natively with Vulkan on Windows.
#         Everything else runs in Docker. Containers reach the host via
#         host.docker.internal.
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

# ── Locate script directory and source tree root ──
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
# NOTE: Nested Join-Path required -- PS 5.1 only accepts 2 arguments
$SourceRoot  = (Resolve-Path (Join-Path (Join-Path $ScriptDir "..") "..")).Path

# ── Source libraries ──
$LibDir = Join-Path $ScriptDir "lib"
. (Join-Path $LibDir "constants.ps1")
. (Join-Path $LibDir "ui.ps1")
. (Join-Path $LibDir "tier-map.ps1")
. (Join-Path $LibDir "detection.ps1")
. (Join-Path $LibDir "env-generator.ps1")

# ── Resolve install directory ──
$InstallDir = $script:DS_INSTALL_DIR

# ============================================================================
# STEP 1 -- PREFLIGHT
# ============================================================================
Write-DreamBanner
Write-Phase -Phase 1 -Total 6 -Name "PREFLIGHT CHECKS" -Estimate "30 seconds"

# PowerShell version
$psVer = Test-PowerShellVersion
Write-InfoBox "PowerShell:" "$($psVer.Version)"
if (-not $psVer.Sufficient) {
    Write-AIError "PowerShell 5.1 or later is required. Please update."
    exit 1
}
Write-AISuccess "PowerShell version OK"

# Docker Desktop
$docker = Test-DockerDesktop
if (-not $docker.Installed) {
    Write-AIError "Docker Desktop not found. Install from https://docs.docker.com/desktop/install/windows-install/"
    Write-AI "After installing, enable the WSL2 backend in Docker Desktop settings."
    exit 1
}
Write-AISuccess "Docker CLI found"

if (-not $docker.Running) {
    Write-AIError "Docker Desktop is not running."
    Write-AI "Start it from the Start Menu, or run:"
    Write-Host "  & 'C:\Program Files\Docker\Docker\Docker Desktop.exe'" -ForegroundColor Cyan
    Write-AI "Then re-run this installer."
    exit 1
}
Write-AISuccess "Docker Desktop running (v$($docker.Version))"

if (-not $docker.WSL2Backend) {
    Write-AIWarn "WSL2 backend not detected. GPU passthrough requires WSL2."
    Write-AI "Enable WSL2 in Docker Desktop > Settings > General > Use WSL 2 based engine"
    if (-not $Force) { exit 1 }
}

# Disk space
$disk = Test-DiskSpace -Path $InstallDir -RequiredGB 20
Write-InfoBox "Disk free:" "$($disk.FreeGB) GB on $($disk.Drive)"
if (-not $disk.Sufficient) {
    Write-AIError "At least $($disk.RequiredGB) GB free space required. Found $($disk.FreeGB) GB."
    exit 1
}
Write-AISuccess "Disk space OK"

# Ollama conflict detection
# Ollama Desktop defaults to port 11434 which conflicts with llama-server's
# host port mapping on NVIDIA. If both run, 127.0.0.1 traffic hits Ollama
# while Docker-internal traffic hits llama-server, causing model-not-found
# errors in host-side tools (OpenCode, browsers).
$ollamaProc = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if ($ollamaProc) {
    Write-AIWarn "Ollama is running (PID $($ollamaProc.Id)) and may conflict with Dream Server."
    Write-AI "  Both use port 11434. Ollama on 127.0.0.1 will shadow llama-server,"
    Write-AI "  causing 'model not found' errors in OpenCode and other host tools."
    Write-Host ""
    if (-not $NonInteractive) {
        $ollamaChoice = Read-Host "  Stop Ollama for this session? [Y/n]"
        if ($ollamaChoice -notmatch "^[nN]") {
            Stop-Process -Name "ollama" -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            # Check if it respawned (Windows Startup shortcut)
            $ollamaStill = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
            if ($ollamaStill) {
                Write-AIWarn "Ollama restarted automatically (likely in Windows Startup)."
                Write-AI "  To permanently fix: remove Ollama from Startup apps, or uninstall it."
                Write-AI "  Settings > Apps > Startup, or delete the shortcut from:"
                Write-AI "  $env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Ollama.lnk"
                # Try removing the startup shortcut
                $ollamaLnk = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Ollama.lnk"
                if (Test-Path $ollamaLnk) {
                    Remove-Item $ollamaLnk -Force -ErrorAction SilentlyContinue
                    Stop-Process -Name "ollama" -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 2
                    $ollamaFinal = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
                    if (-not $ollamaFinal) {
                        Write-AISuccess "Ollama stopped and removed from Startup"
                    } else {
                        Write-AIWarn "Could not stop Ollama. Port 11434 may have conflicts."
                    }
                }
            } else {
                Write-AISuccess "Ollama stopped"
            }
        } else {
            Write-AIWarn "Ollama left running. Port 11434 may have conflicts."
        }
    } else {
        Write-AIWarn "Ollama detected. Run without --NonInteractive to resolve, or stop Ollama manually."
    }
}

# ============================================================================
# STEP 2 -- GPU DETECTION & TIER SELECTION
# ============================================================================
Write-Phase -Phase 2 -Total 6 -Name "HARDWARE DETECTION" -Estimate "10 seconds"

$gpuInfo = Get-GpuInfo
$systemRamGB = Get-SystemRamGB

Write-InfoBox "GPU:" "$($gpuInfo.Name)"
Write-InfoBox "VRAM:" "$($gpuInfo.VramMB) MB ($($gpuInfo.MemoryType))"
Write-InfoBox "System RAM:" "$systemRamGB GB"
Write-InfoBox "Backend:" "$($gpuInfo.Backend)"

if ($gpuInfo.Backend -eq "nvidia") {
    Write-InfoBox "Driver:" "$($gpuInfo.DriverVersion)"
    Write-InfoBox "Compute:" "sm_$($gpuInfo.ComputeCap -replace '\.', '')"
    if ($gpuInfo.DriverMajor -lt $script:MIN_NVIDIA_DRIVER) {
        Write-AIWarn "NVIDIA driver $($gpuInfo.DriverVersion) is below minimum ($($script:MIN_NVIDIA_DRIVER))."
        Write-AI "Update at https://www.nvidia.com/Download/index.aspx"
        if (-not $Force) { exit 1 }
    }
    if ($docker.GpuSupport) {
        Write-AISuccess "Docker GPU support detected"
    } else {
        Write-AIWarn "Docker GPU support not confirmed. NVIDIA Container Toolkit may need configuration."
    }
    if ($gpuInfo.IsBlackwell) {
        Write-AISuccess "Blackwell GPU detected (sm_120). Supported via PTX JIT in standard CUDA image."
    }
}

# Track llama-server image override (reserved for future use)
$llamaServerImage = ""

# Auto-select tier (or use override)
if ($Cloud) {
    $selectedTier = "CLOUD"
} elseif ($Tier) {
    $selectedTier = $Tier.ToUpper()
    # Normalize T-prefix: T1 -> 1, T2 -> 2, etc.
    if ($selectedTier -match "^T(\d)$") { $selectedTier = $Matches[1] }
} else {
    $selectedTier = ConvertTo-TierFromGpu -GpuInfo $gpuInfo -SystemRamGB $systemRamGB
}

$tierConfig = Resolve-TierConfig -Tier $selectedTier
Write-AISuccess "Selected tier: $selectedTier ($($tierConfig.TierName))"
Write-InfoBox "Model:" "$($tierConfig.LlmModel)"
Write-InfoBox "GGUF:" "$($tierConfig.GgufFile)"
Write-InfoBox "Context:" "$($tierConfig.MaxContext)"

# Re-check disk space now that tier (and model size) is known
# Tier 1-2: ~5GB model, Tier 3: ~9GB, Tier 4+: ~18GB, plus ~15GB for Docker images
$modelGB = $(if ($tierConfig.GgufFile -match "14B") { 12 } elseif ($tierConfig.GgufFile -match "30B") { 20 } else { 8 })
$neededGB = $modelGB + 15  # model + Docker images headroom
$disk2 = Test-DiskSpace -Path $InstallDir -RequiredGB $neededGB
if (-not $disk2.Sufficient) {
    Write-AIWarn "Tier $selectedTier needs ~$neededGB GB (model + Docker images). Only $($disk2.FreeGB) GB free on $($disk2.Drive)."
    if (-not $Force) { exit 1 }
}

# ============================================================================
# STEP 3 -- FEATURE SELECTION
# ============================================================================
Write-Phase -Phase 3 -Total 6 -Name "FEATURES" -Estimate "interactive"

# Default features
$enableVoice     = $Voice.IsPresent -or $All.IsPresent
$enableWorkflows = $Workflows.IsPresent -or $All.IsPresent
$enableRag       = $Rag.IsPresent -or $All.IsPresent
$enableOpenClaw  = $OpenClaw.IsPresent -or $All.IsPresent

if (-not $NonInteractive -and -not $All -and -not $DryRun) {
    Write-Chapter "Select Features"
    Write-AI "Choose your Dream Server configuration:"
    Write-Host ""
    Write-Host "  [1] Full Stack   -- Everything enabled (voice, workflows, RAG, agents)" -ForegroundColor Green
    Write-Host "  [2] Core Only    -- Chat + LLM inference (lean and fast)" -ForegroundColor White
    Write-Host "  [3] Custom       -- Choose individually" -ForegroundColor White
    Write-Host ""

    $choice = Read-Host "  Selection (1/2/3)"
    switch ($choice) {
        "1" {
            $enableVoice = $true; $enableWorkflows = $true
            $enableRag = $true; $enableOpenClaw = $true
        }
        "2" {
            $enableVoice = $false; $enableWorkflows = $false
            $enableRag = $false; $enableOpenClaw = $false
        }
        "3" {
            $enableVoice     = (Read-Host "  Enable Voice (Whisper + Kokoro)? [y/N]") -match "^[yY]"
            $enableWorkflows = (Read-Host "  Enable Workflows (n8n)?           [y/N]") -match "^[yY]"
            $enableRag       = (Read-Host "  Enable RAG (Qdrant + embeddings)? [y/N]") -match "^[yY]"
            $enableOpenClaw  = (Read-Host "  Enable OpenClaw (AI agents)?      [y/N]") -match "^[yY]"
        }
        default {
            $enableVoice = $true; $enableWorkflows = $true
            $enableRag = $true; $enableOpenClaw = $true
        }
    }
}

Write-AI "Features:"
Write-InfoBox "  Voice:"     $(if ($enableVoice)     { "enabled" } else { "disabled" })
Write-InfoBox "  Workflows:" $(if ($enableWorkflows) { "enabled" } else { "disabled" })
Write-InfoBox "  RAG:"       $(if ($enableRag)       { "enabled" } else { "disabled" })
Write-InfoBox "  OpenClaw:"  $(if ($enableOpenClaw)  { "enabled" } else { "disabled" })

# ============================================================================
# STEP 4 -- SETUP (directories, copy source, generate .env)
# ============================================================================
Write-Phase -Phase 4 -Total 6 -Name "SETUP" -Estimate "1-2 minutes"

if ($DryRun) {
    Write-AI "[DRY RUN] Would create: $InstallDir"
    Write-AI "[DRY RUN] Would copy source files via robocopy"
    Write-AI "[DRY RUN] Would generate .env with secrets"
    Write-AI "[DRY RUN] Would generate SearXNG config"
    if ($enableOpenClaw) { Write-AI "[DRY RUN] Would configure OpenClaw" }
} else {
    # Create directory structure
    # NOTE: Nested Join-Path required -- PS 5.1 only accepts 2 arguments
    $configDir = Join-Path $InstallDir "config"
    $dataDir   = Join-Path $InstallDir "data"
    $dirs = @(
        (Join-Path $configDir "searxng"),
        (Join-Path $configDir "n8n"),
        (Join-Path $configDir "litellm"),
        (Join-Path $configDir "openclaw"),
        (Join-Path $configDir "llama-server"),
        (Join-Path $dataDir "open-webui"),
        (Join-Path $dataDir "whisper"),
        (Join-Path $dataDir "tts"),
        (Join-Path $dataDir "n8n"),
        (Join-Path $dataDir "qdrant"),
        (Join-Path $dataDir "models")
    )
    foreach ($d in $dirs) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
    }
    Write-AISuccess "Created directory structure"

    # Copy source tree (skip .git, data, logs, .env, models)
    if ($SourceRoot -ne $InstallDir) {
        Write-AI "Copying source files to $InstallDir..."
        $robocopyArgs = @(
            $SourceRoot, $InstallDir,
            "/E", "/NFL", "/NDL", "/NJH", "/NJS",
            "/XD", ".git", "data", "logs", "models", "node_modules", "dist",
            "/XF", ".env", "*.log", ".current-mode", ".profiles",
                   ".target-model", ".target-quantization", ".offline-mode"
        )
        & robocopy @robocopyArgs | Out-Null
        # robocopy exit codes 0-7 are success
        if ($LASTEXITCODE -gt 7) {
            Write-AIError "File copy failed (robocopy exit code: $LASTEXITCODE)"
            exit 1
        }
        Write-AISuccess "Source files installed"
    } else {
        Write-AI "Running in-place, skipping file copy"
    }

    # Copy dream.ps1 CLI to install root so users can run .\dream.ps1
    $dreamSrc = Join-Path $ScriptDir "dream.ps1"
    $dreamDst = Join-Path $InstallDir "dream.ps1"
    if (Test-Path $dreamSrc) {
        Copy-Item -Path $dreamSrc -Destination $dreamDst -Force
        # Also copy the lib/ directory dream.ps1 needs
        $libSrc = Join-Path $ScriptDir "lib"
        $libDst = Join-Path $InstallDir "lib"
        New-Item -ItemType Directory -Path $libDst -Force | Out-Null
        Copy-Item -Path (Join-Path $libSrc "*") -Destination $libDst -Recurse -Force
        Write-AISuccess "Installed dream.ps1 CLI"
    }

    # Generate .env
    # NOTE: $(if ...) syntax required for PS 5.1 compatibility
    $dreamMode = $(if ($Cloud) { "cloud" } else { "local" })
    $envResult = New-DreamEnv -InstallDir $InstallDir -TierConfig $tierConfig `
        -Tier $selectedTier -GpuBackend $gpuInfo.Backend -DreamMode $dreamMode `
        -LlamaServerImage $llamaServerImage
    Write-AISuccess "Generated .env with secure secrets"

    # Generate SearXNG config
    $searxngPath = New-SearxngConfig -InstallDir $InstallDir -SecretKey $envResult.SearxngSecret
    Write-AISuccess "Generated SearXNG config"

    # Generate OpenClaw configs (if enabled)
    if ($enableOpenClaw) {
        $providerUrl = $(if ($gpuInfo.Backend -eq "amd") {
            "http://host.docker.internal:8080"
        } else {
            "http://llama-server:8080"
        })
        New-OpenClawConfig -InstallDir $InstallDir `
            -LlmModel $tierConfig.LlmModel `
            -MaxContext $tierConfig.MaxContext `
            -Token $envResult.OpenclawToken `
            -ProviderUrl $providerUrl
        Write-AISuccess "Generated OpenClaw configs"
    }

    # Create llama-server models.ini (empty -- populated later)
    $modelsIni = Join-Path (Join-Path $InstallDir "config") "llama-server\models.ini"
    if (-not (Test-Path $modelsIni)) {
        Write-Utf8NoBom -Path $modelsIni -Content "# Dream Server model registry"
    }
}

# ============================================================================
# STEP 5 -- LAUNCH (download model, start services)
# ============================================================================
Write-Phase -Phase 5 -Total 6 -Name "LAUNCH" -Estimate "2-30 minutes (model download)"

if ($DryRun) {
    if ($tierConfig.GgufUrl) {
        Write-AI "[DRY RUN] Would download: $($tierConfig.GgufFile)"
    }
    if ($gpuInfo.Backend -eq "amd") {
        Write-AI "[DRY RUN] Would download llama-server.exe (Vulkan build)"
        Write-AI "[DRY RUN] Would start native llama-server on port 8080"
    }
    Write-AI "[DRY RUN] Would run: docker compose up -d"
    if (-not $Cloud) {
        Write-AI "[DRY RUN] Would install OpenCode v$($script:OPENCODE_VERSION) to $($script:OPENCODE_EXE)"
        Write-AI "[DRY RUN] Would configure OpenCode for local llama-server (port $($script:OPENCODE_PORT))"
        Write-AI "[DRY RUN] Would add OpenCode to Windows Startup folder"
    }
} else {
    # Change to install directory for docker compose
    Push-Location $InstallDir

    try {
        # ── Download GGUF model (if not cloud-only) ──
        if ($tierConfig.GgufUrl -and -not $Cloud) {
            $modelPath = Join-Path (Join-Path $InstallDir "data\models") $tierConfig.GgufFile
            $needsDownload = -not (Test-Path $modelPath)

            # If file exists and we have a hash, verify integrity
            if ((Test-Path $modelPath) -and $tierConfig.GgufSha256) {
                Write-AI "Verifying model integrity (SHA256)..."
                $integrity = Test-ModelIntegrity -Path $modelPath -ExpectedHash $tierConfig.GgufSha256
                if ($integrity.Valid) {
                    Write-AISuccess "Model verified: $($tierConfig.GgufFile)"
                } else {
                    Write-AIWarn "Model file is corrupt (hash mismatch)."
                    Write-AI "  Expected: $($integrity.ExpectedHash)"
                    Write-AI "  Got:      $($integrity.ActualHash)"
                    Write-AI "Removing corrupt file and re-downloading..."
                    Remove-Item -Path $modelPath -Force
                    $needsDownload = $true
                }
            } elseif (Test-Path $modelPath) {
                Write-AISuccess "Model already downloaded: $($tierConfig.GgufFile)"
            }

            if ($needsDownload) {
                $downloadOk = Show-ProgressDownload -Url $tierConfig.GgufUrl `
                    -Destination $modelPath -Label "Downloading $($tierConfig.GgufFile)"
                if (-not $downloadOk) {
                    Write-AIError "Model download failed. Re-run the installer to resume."
                    exit 1
                }

                # Verify freshly downloaded file
                if ($tierConfig.GgufSha256) {
                    Write-AI "Verifying download integrity (SHA256)..."
                    $integrity = Test-ModelIntegrity -Path $modelPath -ExpectedHash $tierConfig.GgufSha256
                    if ($integrity.Valid) {
                        Write-AISuccess "Download verified OK"
                    } else {
                        Write-AIError "Downloaded file is corrupt (SHA256 mismatch)."
                        Write-AI "  Expected: $($integrity.ExpectedHash)"
                        Write-AI "  Got:      $($integrity.ActualHash)"
                        Write-AI "This may be caused by a partial download. Removing file."
                        Remove-Item -Path $modelPath -Force
                        Write-AIError "Re-run the installer to download again (without resume)."
                        exit 1
                    }
                }
            }
        }

        # ── AMD: Download and start native llama-server.exe ──
        if ($gpuInfo.Backend -eq "amd" -and -not $Cloud) {
            Write-Chapter "NATIVE LLAMA-SERVER (VULKAN)"

            # Download llama.cpp Vulkan build
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

                # Validate zip integrity before extraction
                Write-AI "Validating llama-server archive..."
                $zipValid = Test-ZipIntegrity -Path $llamaZip
                if (-not $zipValid.Valid) {
                    Write-AIWarn "Archive is corrupt: $($zipValid.ErrorMessage)"
                    Remove-Item -Path $llamaZip -Force -ErrorAction SilentlyContinue
                    Write-AIError "Corrupted download. Please re-run the installer."
                    exit 1
                }

                # Extract with retry
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
                    # Move files from subdirectory to llama-server root
                    Get-ChildItem -Path $exeFound.DirectoryName -Force |
                        Move-Item -Destination $script:LLAMA_SERVER_DIR -Force
                }
                if (-not (Test-Path $script:LLAMA_SERVER_EXE)) {
                    Write-AIError "llama-server.exe not found after extraction."
                    exit 1
                }
                Write-AISuccess "llama-server extracted successfully"
            } else {
                Write-AISuccess "llama-server.exe already present"
            }

            # Start native llama-server
            Write-AI "Starting native llama-server (Vulkan)..."
            $modelFullPath = Join-Path (Join-Path $InstallDir "data\models") $tierConfig.GgufFile
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

            # Wait for health endpoint
            Write-AI "Waiting for llama-server to load model..."
            $maxWait = 120
            $waited = 0
            $healthy = $false
            while ($waited -lt $maxWait) {
                Start-Sleep -Seconds 2
                $waited += 2
                try {
                    $req = [System.Net.HttpWebRequest]::Create("http://localhost:8080/health")
                    $req.Timeout = 3000
                    $req.Method = "GET"
                    $resp = $req.GetResponse()
                    $code = [int]$resp.StatusCode
                    $resp.Close()
                    if ($code -eq 200) {
                        $healthy = $true
                        break
                    }
                } catch { }
                if ($waited % 10 -eq 0) {
                    Write-AI "  Still loading... ($waited seconds)"
                }
            }

            if ($healthy) {
                Write-AISuccess "Native llama-server healthy (PID $($proc.Id))"
            } else {
                Write-AIWarn "llama-server did not become healthy within ${maxWait}s. It may still be loading."
            }
        }

        # NOTE: Blackwell GPUs (sm_120) work with the standard server-cuda image
        # via PTX JIT compilation. No special image override is needed.

        # ── Assemble Docker Compose flags ──
        $composeFlags = @("-f", "docker-compose.base.yml")

        if ($Cloud) {
            # Cloud mode: disable llama-server (no GPU overlay, no local model)
            $composeFlags += @("-f", "installers/windows/docker-compose.windows-amd.yml")
        } elseif ($gpuInfo.Backend -eq "nvidia") {
            $composeFlags += @("-f", "docker-compose.nvidia.yml")
        } elseif ($gpuInfo.Backend -eq "amd") {
            $composeFlags += @("-f", "installers/windows/docker-compose.windows-amd.yml")
        }

        # Discover enabled extension compose fragments via manifests
        # Mirrors resolve-compose-stack.sh: reads manifest.yaml, checks schema_version
        # and gpu_backends before including a service's compose file.
        $extDir = Join-Path (Join-Path $InstallDir "extensions") "services"
        $currentBackend = $(if ($Cloud) { "none" } else { $gpuInfo.Backend })

        if (Test-Path $extDir) {
            $extServices = Get-ChildItem -Path $extDir -Directory | Sort-Object Name
            foreach ($svcDir in $extServices) {
                # Read manifest (YAML parsed as simple key-value -- no YAML lib needed)
                $manifestPath = Join-Path $svcDir.FullName "manifest.yaml"
                if (-not (Test-Path $manifestPath)) {
                    $manifestPath = Join-Path $svcDir.FullName "manifest.yml"
                }
                if (-not (Test-Path $manifestPath)) { continue }

                $manifestLines = Get-Content $manifestPath -ErrorAction SilentlyContinue
                if (-not $manifestLines) { continue }

                # Quick manifest validation: must contain schema_version: dream.services.v1
                $hasSchema = $manifestLines | Where-Object { $_ -match "schema_version:\s*dream\.services\.v1" }
                if (-not $hasSchema) { continue }

                # Check gpu_backends compatibility
                $backendsLine = $manifestLines | Where-Object { $_ -match "gpu_backends:" }
                if ($backendsLine -and $currentBackend -ne "none") {
                    $backendsStr = ($backendsLine -split "gpu_backends:")[1]
                    if ($backendsStr -notmatch $currentBackend -and $backendsStr -notmatch "all") {
                        continue  # Service not compatible with current GPU
                    }
                }

                # Find compose file reference in manifest
                $composeFile = "compose.yaml"  # default
                $composeRefLine = $manifestLines | Where-Object { $_ -match "compose_file:" }
                if ($composeRefLine) {
                    $composeFile = (($composeRefLine -split "compose_file:")[1]).Trim().Trim('"').Trim("'")
                }

                $composePath = Join-Path $svcDir.FullName $composeFile
                if (-not (Test-Path $composePath)) { continue }

                # Check feature flags
                $svcName = $svcDir.Name
                $skip = $false
                switch ($svcName) {
                    "whisper"    { if (-not $enableVoice) { $skip = $true } }
                    "tts"        { if (-not $enableVoice) { $skip = $true } }
                    "n8n"        { if (-not $enableWorkflows) { $skip = $true } }
                    "qdrant"     { if (-not $enableRag) { $skip = $true } }
                    "embeddings" { if (-not $enableRag) { $skip = $true } }
                    "openclaw"   { if (-not $enableOpenClaw) { $skip = $true } }
                }
                if ($skip) { continue }

                $relPath = $composePath.Substring($InstallDir.Length + 1) -replace "\\", "/"
                $composeFlags += @("-f", $relPath)

                # GPU-specific overlay for this extension (filesystem discovery)
                if ($currentBackend -eq "nvidia") {
                    $gpuOverlay = Join-Path $svcDir.FullName "compose.nvidia.yaml"
                    if (Test-Path $gpuOverlay) {
                        $relOverlay = $gpuOverlay.Substring($InstallDir.Length + 1) -replace "\\", "/"
                        $composeFlags += @("-f", $relOverlay)
                    }
                }
            }
        }

        # Docker compose override (user customizations)
        if (Test-Path (Join-Path $InstallDir "docker-compose.override.yml")) {
            $composeFlags += @("-f", "docker-compose.override.yml")
        }

        # ── Validate compose files exist before launching ──
        for ($fi = 0; $fi -lt $composeFlags.Count; $fi++) {
            if ($composeFlags[$fi] -eq "-f" -and ($fi + 1) -lt $composeFlags.Count) {
                $cf = $composeFlags[$fi + 1]
                if (-not (Test-Path $cf)) {
                    Write-AIError "Compose file not found: $cf"
                    Write-AI "The source tree may not have copied correctly. Try re-running with --Force."
                    exit 1
                }
            }
        }

        # ── Start Docker services ──
        Write-Chapter "STARTING SERVICES"
        Write-AI "Running: docker compose $($composeFlags -join ' ') up -d"
        # NOTE: docker compose sends pull progress to stderr. PowerShell 5.1
        # treats ANY stderr output as NativeCommandError, corrupting $LASTEXITCODE.
        # Temporarily silence stderr-as-error so $LASTEXITCODE reflects the real exit code.
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'
        & docker compose @composeFlags up -d 2>&1 | ForEach-Object { Write-Host "  $_" }
        $composeExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP
        if ($composeExit -ne 0) {
            Write-AIError "docker compose up failed (exit code: $composeExit)"
            exit 1
        }
        Write-AISuccess "Docker services started"

        # Save compose flags for dream.ps1 (BOM-free for reliable parsing)
        $flagsFile = Join-Path $InstallDir ".compose-flags"
        Write-Utf8NoBom -Path $flagsFile -Content ($composeFlags -join " ")

        # ── Install OpenCode (host-level AI coding IDE) ──
        if (-not $Cloud) {
            Write-Chapter "OPENCODE (IDE)"

            # Download OpenCode binary if not already present
            if (-not (Test-Path $script:OPENCODE_EXE)) {
                Write-AI "Installing OpenCode v$($script:OPENCODE_VERSION)..."
                $ocZipPath = Join-Path $env:TEMP $script:OPENCODE_ZIP
                if (-not (Test-Path $ocZipPath)) {
                    $dlOk = Invoke-DownloadWithRetry -Url $script:OPENCODE_URL `
                        -Destination $ocZipPath -Label "Downloading OpenCode"
                    if (-not $dlOk) {
                        Write-AIWarn "OpenCode download failed after retries -- skipping (install later manually)"
                    }
                }
                if (Test-Path $ocZipPath) {
                    # Validate zip integrity
                    Write-AI "Validating OpenCode archive..."
                    $zipValid = Test-ZipIntegrity -Path $ocZipPath
                    if (-not $zipValid.Valid) {
                        Write-AIWarn "OpenCode archive is corrupt: $($zipValid.ErrorMessage)"
                        Remove-Item -Path $ocZipPath -Force -ErrorAction SilentlyContinue
                        Write-AIWarn "Skipping OpenCode installation (install later manually)"
                    } else {
                        # Extract with retry
                        New-Item -ItemType Directory -Path $script:OPENCODE_BIN -Force | Out-Null

                        if (Invoke-ExtractionWithRetry -ZipPath $ocZipPath -DestinationPath $script:OPENCODE_BIN) {
                            # Zip may contain a subdirectory -- find the exe
                            $ocFound = Get-ChildItem -Path $script:OPENCODE_BIN -Recurse -Filter "opencode.exe" |
                                Select-Object -First 1
                            if ($ocFound -and $ocFound.DirectoryName -ne $script:OPENCODE_BIN) {
                                Move-Item -Path $ocFound.FullName -Destination $script:OPENCODE_EXE -Force
                            }
                            if (Test-Path $script:OPENCODE_EXE) {
                                Write-AISuccess "OpenCode extracted successfully"
                            } else {
                                Write-AIWarn "opencode.exe not found after extraction -- skipping"
                            }
                        } else {
                            Write-AIWarn "OpenCode extraction failed after retries -- skipping"
                        }
                    }
                }
            } else {
                Write-AISuccess "OpenCode already installed"
            }

            # Generate OpenCode config (points to local llama-server)
            if (Test-Path $script:OPENCODE_EXE) {
                New-Item -ItemType Directory -Path $script:OPENCODE_CONFIG_DIR -Force | Out-Null
                $ocConfigFile = Join-Path $script:OPENCODE_CONFIG_DIR "opencode.json"
                if (-not (Test-Path $ocConfigFile)) {
                    # OLLAMA_PORT in .env is always 8080; AMD native also uses 8080
                    $llamaPort = "8080"
                    # NOTE: llama-server exposes models by GGUF filename, not friendly name
                    $ocModelId = $tierConfig.GgufFile
                    $ocConfig = @"
{
  "`$schema": "https://opencode.ai/config.json",
  "model": "llama-server/$ocModelId",
  "provider": {
    "llama-server": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama-server (local)",
      "options": {
        "baseURL": "http://127.0.0.1:${llamaPort}/v1",
        "apiKey": "no-key"
      },
      "models": {
        "$ocModelId": {
          "name": "$($tierConfig.LlmModel)",
          "limit": {
            "context": $($tierConfig.MaxContext),
            "output": 32768
          }
        }
      }
    }
  }
}
"@
                    Write-Utf8NoBom -Path $ocConfigFile -Content $ocConfig
                    Write-AISuccess "Configured OpenCode for local llama-server (model: $($tierConfig.LlmModel))"
                } else {
                    Write-AISuccess "OpenCode config already exists -- skipping"
                }

                # Create VBS launcher for hidden startup (no console window)
                # Binds to 127.0.0.1 (localhost only) -- no auth needed for local access
                # NOTE: WshShell.Run expands %USERPROFILE% natively, no ExpandEnvironmentStrings needed
                $vbsContent = @"
' Dream Server -- OpenCode Web Server (hidden startup)
' Launches opencode.exe in web mode without a visible console window
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = WshShell.ExpandEnvironmentStrings("%USERPROFILE%\.opencode")
WshShell.Run """%USERPROFILE%\.opencode\bin\opencode.exe"" web --port $($script:OPENCODE_PORT) --hostname 127.0.0.1", 0, False
"@
                $vbsPath = Join-Path $script:OPENCODE_DIR "start-opencode.vbs"
                Write-Utf8NoBom -Path $vbsPath -Content $vbsContent

                # Copy to Windows Startup folder
                $startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
                $startupVbs = Join-Path $startupDir "DreamServer-OpenCode.vbs"
                Copy-Item -Path $vbsPath -Destination $startupVbs -Force
                Write-AISuccess "Added OpenCode to Windows Startup"

                # Stop any existing OpenCode process before starting fresh
                $existingOc = Get-Process -Name "opencode" -ErrorAction SilentlyContinue
                if ($existingOc) {
                    Stop-Process -Name "opencode" -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 1
                }

                # Start OpenCode now (localhost-only, no password)
                Write-AI "Starting OpenCode web server on port $($script:OPENCODE_PORT)..."
                $ocProc = Start-Process -FilePath $script:OPENCODE_EXE `
                    -ArgumentList "web --port $($script:OPENCODE_PORT) --hostname 127.0.0.1" `
                    -WindowStyle Hidden -PassThru
                Write-AISuccess "OpenCode started (PID $($ocProc.Id))"
            }
        }

    } finally {
        Pop-Location
    }
}

# ============================================================================
# STEP 6 -- VERIFY
# ============================================================================
Write-Phase -Phase 6 -Total 6 -Name "VERIFICATION" -Estimate "30 seconds"

if ($DryRun) {
    Write-AI "[DRY RUN] Would health-check all services"
    Write-AI "[DRY RUN] Would auto-configure Perplexica for $($tierConfig.LlmModel)"
    Write-AI "[DRY RUN] Install validation complete"
    Write-AISuccess "Dry run finished -- no changes made"
    exit 0
}

# Health check loop
# NOTE: OLLAMA_PORT is always 8080 in .env; both NVIDIA Docker and AMD native use 8080
$llamaHealthPort = "8080"
$healthChecks = @(
    @{ Name = "LLM (llama-server)"; Url = "http://localhost:${llamaHealthPort}/health" }
    @{ Name = "Chat UI (Open WebUI)"; Url = "http://localhost:3000" }
)

# Add optional service checks
if ($enableVoice) {
    $healthChecks += @{ Name = "Whisper (STT)"; Url = "http://localhost:9000/health" }
}
if ($enableWorkflows) {
    $healthChecks += @{ Name = "n8n (Workflows)"; Url = "http://localhost:5678/healthz" }
}
if (-not $Cloud -and (Test-Path $script:OPENCODE_EXE)) {
    $healthChecks += @{ Name = "OpenCode (IDE)"; Url = "http://localhost:$($script:OPENCODE_PORT)/" }
}

Write-AI "Running health checks..."
$maxAttempts = 60
$allHealthy = $true

foreach ($check in $healthChecks) {
    $healthy = $false
    for ($i = 1; $i -le $maxAttempts; $i++) {
        try {
            # Use HttpWebRequest directly to avoid PS 5.1 credential dialog on 401
            $req = [System.Net.HttpWebRequest]::Create($check.Url)
            $req.Timeout = 3000
            $req.Method = "GET"
            $resp = $req.GetResponse()
            $code = [int]$resp.StatusCode
            $resp.Close()
            if ($code -ge 200 -and $code -lt 400) {
                $healthy = $true
                break
            }
        } catch [System.Net.WebException] {
            # 401/403 means the service IS responding (auth-protected) -- treat as healthy
            $webResp = $_.Exception.Response
            if ($webResp) {
                $code = [int]$webResp.StatusCode
                if ($code -eq 401 -or $code -eq 403) {
                    $healthy = $true
                    break
                }
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

# ── Auto-configure Perplexica (seed chat model, bypass wizard) ──
Write-AI "Configuring Perplexica..."
$perplexicaOk = Set-PerplexicaConfig -PerplexicaPort 3004 -LlmModel $tierConfig.LlmModel
if ($perplexicaOk) {
    Write-AISuccess "Perplexica configured (model: $($tierConfig.LlmModel))"
} else {
    Write-AIWarn "Perplexica auto-config skipped -- complete setup at http://localhost:3004"
}

# ── Create Desktop & Start Menu shortcuts (link to Dashboard) ──
try {
    $dashboardUrl = "http://localhost:3001"
    $shortcutName = "Dream Server"

    # Desktop shortcut (.url -- opens in default browser)
    $desktopDir = [Environment]::GetFolderPath("Desktop")
    $desktopUrl = Join-Path $desktopDir "$shortcutName.url"
    $urlContent = @"
[InternetShortcut]
URL=$dashboardUrl
IconIndex=0
"@
    Write-Utf8NoBom -Path $desktopUrl -Content $urlContent

    # Start Menu shortcut (Programs folder)
    $startMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
    $startMenuUrl = Join-Path $startMenuDir "$shortcutName.url"
    Write-Utf8NoBom -Path $startMenuUrl -Content $urlContent

    # Attempt taskbar pin via Shell COM verb (works on most Win 11 builds, silent no-op if not)
    try {
        $shell = New-Object -ComObject Shell.Application
        $folder = $shell.Namespace($desktopDir)
        $item = $folder.ParseName("$shortcutName.url")
        if ($item) {
            $verbs = $item.Verbs() | Where-Object { $_.Name -match "pin.*taskbar|Taskbar" }
            if ($verbs) { $verbs | ForEach-Object { $_.DoIt() } }
        }
    } catch { }

    Write-AISuccess "Added Dream Server shortcut to Desktop and Start Menu"
} catch {
    Write-AIWarn "Could not create shortcuts: $_"
}

# ── Success card ──
if ($allHealthy) {
    Write-SuccessCard
} else {
    Write-Host ""
    Write-AIWarn "Some services may still be starting. Check with:"
    Write-Host "  .\dream.ps1 status" -ForegroundColor Cyan
    Write-Host ""
    Write-SuccessCard
}

# ── Summary JSON (for CI/automation) ──
if ($SummaryJsonPath) {
    $summary = @{
        version     = $script:DS_VERSION
        tier        = $selectedTier
        tierName    = $tierConfig.TierName
        model       = $tierConfig.LlmModel
        gpuBackend  = $gpuInfo.Backend
        gpuName     = $gpuInfo.Name
        installDir  = $InstallDir
        features    = @{
            voice     = $enableVoice
            workflows = $enableWorkflows
            rag       = $enableRag
            openclaw  = $enableOpenClaw
        }
        healthy     = $allHealthy
        timestamp   = (Get-Date -Format "o")
    }
    $jsonContent = $summary | ConvertTo-Json -Depth 3
    Write-Utf8NoBom -Path $SummaryJsonPath -Content $jsonContent
    Write-AI "Summary written to $SummaryJsonPath"
}
