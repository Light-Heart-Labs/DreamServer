# ============================================================================
# Dream Server Windows Installer -- Environment Generator
# ============================================================================
# Part of: installers/windows/lib/
# Purpose: Generate .env file, SearXNG config, OpenClaw configs
#          Uses .NET crypto for secrets (no openssl dependency)
#
# Canonical source: installers/phases/06-directories.sh (keep .env format in sync)
#
# Modder notes:
#   Modify New-DreamEnv to add new environment variables.
#   All secrets use cryptographic RNG -- never use Get-Random for secrets.
# ============================================================================

function Write-Utf8NoBom {
    <#
    .SYNOPSIS
        Write text to file as UTF-8 WITHOUT BOM. PS 5.1's Set-Content -Encoding UTF8
        writes a BOM which corrupts Docker Compose .env parsing and YAML files.
    #>
    param(
        [string]$Path,
        [string]$Content
    )
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function New-SecureHex {
    <#
    .SYNOPSIS
        Generate a cryptographically secure hex string.
    .PARAMETER Bytes
        Number of random bytes (output is 2x chars). Default 32.
    #>
    param([int]$Bytes = 32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buf = New-Object byte[] $Bytes
    $rng.GetBytes($buf)
    return ($buf | ForEach-Object { $_.ToString("x2") }) -join ""
}

function New-SecureBase64 {
    <#
    .SYNOPSIS
        Generate a cryptographically secure Base64 string.
    .PARAMETER Bytes
        Number of random bytes. Default 32.
    #>
    param([int]$Bytes = 32)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $buf = New-Object byte[] $Bytes
    $rng.GetBytes($buf)
    return [Convert]::ToBase64String($buf)
}

function New-DreamEnv {
    <#
    .SYNOPSIS
        Generate the .env file matching Phase 06 output format.
    .PARAMETER InstallDir
        Target installation directory.
    .PARAMETER TierConfig
        Hashtable from Resolve-TierConfig (TierName, LlmModel, GgufFile, MaxContext).
    .PARAMETER Tier
        Tier identifier string (1-4, SH_COMPACT, SH_LARGE, etc.).
    .PARAMETER GpuBackend
        GPU backend: "nvidia", "amd", or "none".
    .PARAMETER DreamMode
        LLM backend mode: "local", "cloud", or "hybrid".
    #>
    param(
        [string]$InstallDir,
        [hashtable]$TierConfig,
        [string]$Tier,
        [string]$GpuBackend = "nvidia",
        [string]$DreamMode = "local",
        [string]$LlamaServerImage = ""
    )

    # Preserve existing secrets on re-install (mirrors Linux _env_get logic)
    $existingEnv = @{}
    $envPath = Join-Path $InstallDir ".env"
    if (Test-Path $envPath) {
        Get-Content $envPath | ForEach-Object {
            if ($_ -match "^([A-Za-z_][A-Za-z0-9_]*)=(.*)$") {
                $existingEnv[$Matches[1]] = $Matches[2]
            }
        }
    }

    # Helper: reuse existing value or generate new
    function Get-EnvOrNew { param([string]$Key, [string]$Default)
        if ($existingEnv.ContainsKey($Key) -and $existingEnv[$Key]) {
            return $existingEnv[$Key]
        }
        return $Default
    }

    # Generate secrets (reuse existing on re-install)
    $webuiSecret     = Get-EnvOrNew "WEBUI_SECRET"       (New-SecureHex -Bytes 32)
    $n8nPass         = Get-EnvOrNew "N8N_PASS"           (New-SecureBase64 -Bytes 16)
    $litellmKey      = Get-EnvOrNew "LITELLM_KEY"        "sk-dream-$(New-SecureHex -Bytes 16)"
    $livekitSecret   = Get-EnvOrNew "LIVEKIT_API_SECRET" (New-SecureBase64 -Bytes 32)
    $livekitApiKey   = Get-EnvOrNew "LIVEKIT_API_KEY"    (New-SecureHex -Bytes 16)
    $dashboardApiKey = Get-EnvOrNew "DASHBOARD_API_KEY"  (New-SecureHex -Bytes 32)
    $openclawToken   = Get-EnvOrNew "OPENCLAW_TOKEN"     (New-SecureHex -Bytes 24)
    $searxngSecret   = Get-EnvOrNew "SEARXNG_SECRET"     (New-SecureHex -Bytes 32)
    $difySecretKey   = Get-EnvOrNew "DIFY_SECRET_KEY"    (New-SecureHex -Bytes 32)

    # Determine LLM API URL based on backend
    # AMD on Windows: llama-server runs natively, containers reach it via host.docker.internal
    # NVIDIA: llama-server runs in Docker, containers reach it via service name
    # NOTE: $(if ...) syntax required for PS 5.1 compatibility
    $llmApiUrl = $(if ($GpuBackend -eq "amd") {
        "http://host.docker.internal:8080"
    } elseif ($DreamMode -eq "cloud") {
        "http://litellm:4000"
    } else {
        "http://llama-server:8080"
    })

    # Timezone -- convert Windows timezone ID to IANA for Docker containers
    $tz = $(try {
        $tzInfo = [System.TimeZoneInfo]::Local
        # .NET 6+ has TimeZoneInfo.TryConvertWindowsIdToIanaId; fall back to common mappings
        $ianaId = $null
        try {
            # Works on .NET 6+ / PS 7+
            # TryConvert returns bool; the IANA ID is written to the [ref] out-param
            $outIana = $null
            $ok = [System.TimeZoneInfo]::TryConvertWindowsIdToIanaId($tzInfo.Id, [ref]$outIana)
            if ($ok -and $outIana) { $ianaId = $outIana }
        } catch { }
        if ($ianaId) { $ianaId } else {
            switch -Wildcard ($tzInfo.Id) {
                "*Eastern*"    { "America/New_York" }
                "*Central*"    { "America/Chicago" }
                "*Mountain*"   { "America/Denver" }
                "*Pacific*"    { "America/Los_Angeles" }
                "*Alaska*"     { "America/Anchorage" }
                "*Hawaii*"     { "Pacific/Honolulu" }
                "*UTC*"        { "UTC" }
                "*GMT*"        { "Europe/London" }
                "*W. Europe*"  { "Europe/Berlin" }
                "*Romance*"    { "Europe/Paris" }
                "*India*"      { "Asia/Kolkata" }
                "*China*"      { "Asia/Shanghai" }
                "*Tokyo*"      { "Asia/Tokyo" }
                "*Korea*"      { "Asia/Seoul" }
                "*AUS Eastern*"  { "Australia/Sydney" }
                "*E. South America*" { "America/Sao_Paulo" }
                "*SE Asia*"    { "Asia/Bangkok" }
                "*Arab*"       { "Asia/Riyadh" }
                "*Egypt*"      { "Africa/Cairo" }
                "*South Africa*" { "Africa/Johannesburg" }
                "*E. Europe*"  { "Europe/Bucharest" }
                "*FLE*"        { "Europe/Kiev" }
                default        { "UTC" }
            }
        }
    } catch { "UTC" })

    $timestamp = Get-Date -Format "o"

    # Build .env content (matches Phase 06 format)
    $envContent = @"
# Dream Server Configuration -- $($TierConfig.TierName) Edition
# Generated by Windows installer v$($script:DS_VERSION) on $timestamp
# Tier: $Tier ($($TierConfig.TierName))

#=== LLM Backend Mode ===
DREAM_MODE=$DreamMode
LLM_API_URL=$llmApiUrl

#=== Cloud API Keys ===
ANTHROPIC_API_KEY=$(Get-EnvOrNew "ANTHROPIC_API_KEY" "")
OPENAI_API_KEY=$(Get-EnvOrNew "OPENAI_API_KEY" "")
TOGETHER_API_KEY=$(Get-EnvOrNew "TOGETHER_API_KEY" "")

#=== LLM Settings (llama-server) ===
LLM_MODEL=$($TierConfig.LlmModel)
GGUF_FILE=$($TierConfig.GgufFile)
MAX_CONTEXT=$($TierConfig.MaxContext)
CTX_SIZE=$($TierConfig.MaxContext)
GPU_BACKEND=$GpuBackend
$(if ($LlamaServerImage) { "LLAMA_SERVER_IMAGE=$LlamaServerImage" } else { "#LLAMA_SERVER_IMAGE=ghcr.io/ggml-org/llama.cpp:server-cuda" })

#=== Ports ===
OLLAMA_PORT=8080
WEBUI_PORT=3000
WHISPER_PORT=9000
TTS_PORT=8880
N8N_PORT=5678
QDRANT_PORT=6333
QDRANT_GRPC_PORT=6334
LITELLM_PORT=4000
OPENCLAW_PORT=7860
SEARXNG_PORT=8888

#=== Security (auto-generated, keep secret!) ===
WEBUI_SECRET=$webuiSecret
DASHBOARD_API_KEY=$dashboardApiKey
N8N_USER=admin
N8N_PASS=$n8nPass
LITELLM_KEY=$litellmKey
LIVEKIT_API_KEY=$livekitApiKey
LIVEKIT_API_SECRET=$livekitSecret
OPENCLAW_TOKEN=$openclawToken
OPENCODE_SERVER_PASSWORD=
OPENCODE_PORT=3003
DIFY_SECRET_KEY=$difySecretKey

#=== Voice Settings ===
WHISPER_MODEL=base
TTS_VOICE=en_US-lessac-medium

#=== Web UI Settings ===
WEBUI_AUTH=true
ENABLE_WEB_SEARCH=true
WEB_SEARCH_ENGINE=searxng

#=== n8n Settings ===
N8N_AUTH=true
N8N_HOST=localhost
N8N_WEBHOOK_URL=http://localhost:5678
TIMEZONE=$tz
"@

    # NOTE: No VIDEO_GID, RENDER_GID, HSA_OVERRIDE_GFX_VERSION on Windows
    # Those are Linux-only for AMD ROCm container device access

    $envPath = Join-Path $InstallDir ".env"
    Write-Utf8NoBom -Path $envPath -Content $envContent

    # Restrict .env to current user only (Windows ACL equivalent of chmod 600)
    try {
        $acl = Get-Acl $envPath
        $acl.SetAccessRuleProtection($true, $false)  # Disable inheritance
        $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $currentUser, "FullControl", "Allow"
        )
        $acl.SetAccessRule($rule)
        Set-Acl -Path $envPath -AclObject $acl
    } catch {
        # ACL restriction failed -- not fatal, just warn
        Write-AIWarn "Could not restrict .env permissions: $_"
    }

    return @{
        EnvPath        = $envPath
        SearxngSecret  = $searxngSecret
        OpenclawToken  = $openclawToken
        DashboardKey   = $dashboardApiKey
    }
}

function New-SearxngConfig {
    <#
    .SYNOPSIS
        Generate SearXNG settings.yml with randomized secret key.
    #>
    param(
        [string]$InstallDir,
        [string]$SecretKey
    )

    $configDir = Join-Path (Join-Path $InstallDir "config") "searxng"
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null

    $config = @"
use_default_settings: true
server:
  secret_key: "$SecretKey"
  bind_address: "0.0.0.0"
  port: 8080
  limiter: false
search:
  safe_search: 0
  formats:
    - html
    - json
engines:
  - name: duckduckgo
    disabled: false
  - name: google
    disabled: false
  - name: brave
    disabled: false
  - name: wikipedia
    disabled: false
  - name: github
    disabled: false
  - name: stackoverflow
    disabled: false
"@

    $settingsPath = Join-Path $configDir "settings.yml"
    Write-Utf8NoBom -Path $settingsPath -Content $config
    return $settingsPath
}

function New-OpenClawConfig {
    <#
    .SYNOPSIS
        Generate OpenClaw home config and auth profiles for local llama-server.
    #>
    param(
        [string]$InstallDir,
        [string]$LlmModel,
        [int]$MaxContext,
        [string]$Token,
        [string]$ProviderName = "local-llama",
        [string]$ProviderUrl  = "http://host.docker.internal:8080"
    )

    # Create directories
    # NOTE: Nested Join-Path required -- PS 5.1 only accepts 2 arguments
    $homeDir  = Join-Path (Join-Path (Join-Path $InstallDir "data") "openclaw") "home"
    $agentDir = Join-Path (Join-Path (Join-Path $homeDir "agents") "main") "agent"
    $sessDir  = Join-Path (Join-Path (Join-Path $homeDir "agents") "main") "sessions"
    New-Item -ItemType Directory -Path $agentDir -Force | Out-Null
    New-Item -ItemType Directory -Path $sessDir -Force | Out-Null

    # Home config
    $homeConfig = @"
{
  "models": {
    "providers": {
      "$ProviderName": {
        "baseUrl": "$ProviderUrl",
        "apiKey": "none",
        "api": "openai-completions",
        "models": [
          {
            "id": "$LlmModel",
            "name": "Dream Server LLM (Local)",
            "reasoning": false,
            "input": ["text"],
            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            "contextWindow": $MaxContext,
            "maxTokens": 8192,
            "compat": {
              "supportsStore": false,
              "supportsDeveloperRole": false,
              "supportsReasoningEffort": false,
              "maxTokensField": "max_tokens"
            }
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {"primary": "$ProviderName/$LlmModel"},
      "models": {"$ProviderName/$LlmModel": {}},
      "compaction": {"mode": "safeguard"},
      "subagents": {"maxConcurrent": 20, "model": "$ProviderName/$LlmModel"}
    }
  },
  "commands": {"native": "auto", "nativeSkills": "auto"},
  "gateway": {
    "mode": "local",
    "bind": "lan",
    "controlUi": {"allowInsecureAuth": true},
    "auth": {"mode": "token", "token": "$Token"}
  }
}
"@
    Write-Utf8NoBom -Path (Join-Path $homeDir "openclaw.json") -Content $homeConfig

    # Auth profiles
    $authProfiles = @"
{
  "version": 1,
  "profiles": {
    "${ProviderName}:default": {
      "type": "api_key",
      "provider": "$ProviderName",
      "key": "none"
    }
  },
  "lastGood": {"$ProviderName": "${ProviderName}:default"},
  "usageStats": {}
}
"@
    Write-Utf8NoBom -Path (Join-Path $agentDir "auth-profiles.json") -Content $authProfiles

    # Models config
    $modelsConfig = @"
{
  "providers": {
    "$ProviderName": {
      "baseUrl": "$ProviderUrl",
      "apiKey": "none",
      "api": "openai-completions",
      "models": [
        {
          "id": "$LlmModel",
          "name": "Dream Server LLM (Local)",
          "reasoning": false,
          "input": ["text"],
          "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
          "contextWindow": $MaxContext,
          "maxTokens": 8192,
          "compat": {
            "supportsStore": false,
            "supportsDeveloperRole": false,
            "supportsReasoningEffort": false,
            "maxTokensField": "max_tokens"
          }
        }
      ]
    }
  }
}
"@
    Write-Utf8NoBom -Path (Join-Path $agentDir "models.json") -Content $modelsConfig

    # Workspace directory (must exist before Docker Compose)
    $workspaceDir = Join-Path (Join-Path (Join-Path (Join-Path $InstallDir "config") "openclaw") "workspace") "memory"
    New-Item -ItemType Directory -Path $workspaceDir -Force | Out-Null
}

function Set-PerplexicaConfig {
    <#
    .SYNOPSIS
        Auto-configure Perplexica to use the local llama-server on first boot.
        Seeds the chat model and embedding model, then marks setup complete
        so the wizard is bypassed. Mirrors installers/phases/12-health.sh logic.
    .PARAMETER PerplexicaPort
        Port where Perplexica is running (default 3004).
    .PARAMETER LlmModel
        Model name to configure as the default chat model.
    #>
    param(
        [int]$PerplexicaPort = 3004,
        [string]$LlmModel
    )

    $baseUrl = "http://localhost:$PerplexicaPort"

    # Helper: POST a key/value pair to the config API
    # Uses HttpWebRequest instead of Invoke-WebRequest to avoid PS 5.1
    # credential dialog on non-200 responses.
    function Post-ConfigValue {
        param([string]$Key, $Value)
        $body = @{ key = $Key; value = $Value } | ConvertTo-Json -Depth 10 -Compress
        $utf8Bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
        $req = [System.Net.HttpWebRequest]::Create("$baseUrl/api/config")
        $req.Method = "POST"
        $req.ContentType = "application/json"
        $req.Timeout = 5000
        $stream = $req.GetRequestStream()
        $stream.Write($utf8Bytes, 0, $utf8Bytes.Length)
        $stream.Close()
        $resp = $req.GetResponse()
        $resp.Close()
    }

    try {
        # GET current config using HttpWebRequest (avoids PS 5.1 credential dialog)
        $req = [System.Net.HttpWebRequest]::Create("$baseUrl/api/config")
        $req.Method = "GET"
        $req.Timeout = 5000
        $httpResp = $req.GetResponse()
        $reader = New-Object System.IO.StreamReader($httpResp.GetResponseStream())
        $respBody = $reader.ReadToEnd()
        $reader.Close()
        $httpResp.Close()
        $config = ($respBody | ConvertFrom-Json).values

        # Already configured -- skip
        if ($config.setupComplete) { return $true }

        $providers = @($config.modelProviders)
        $openaiProv = $providers | Where-Object { $_.type -eq "openai" } | Select-Object -First 1
        $transformersProv = $providers | Where-Object { $_.type -eq "transformers" } | Select-Object -First 1

        if (-not $openaiProv) { return $false }

        # Seed the chat model into the OpenAI provider
        $openaiProv.chatModels = @(@{ key = $LlmModel; name = $LlmModel })
        Post-ConfigValue -Key "modelProviders" -Value $providers

        # Set default providers and models
        $embeddingId = $(if ($transformersProv) { $transformersProv.id } else { $openaiProv.id })
        Post-ConfigValue -Key "preferences" -Value @{
            defaultChatProvider      = $openaiProv.id
            defaultChatModel         = $LlmModel
            defaultEmbeddingProvider = $embeddingId
            defaultEmbeddingModel    = "Xenova/all-MiniLM-L6-v2"
        }

        # Mark setup complete to bypass wizard
        Post-ConfigValue -Key "setupComplete" -Value $true

        return $true
    } catch {
        return $false
    }
}
