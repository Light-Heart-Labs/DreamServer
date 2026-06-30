# Configure an ODS install to use a remote OpenAI-compatible LLM endpoint.
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [Parameter(Mandatory = $true)][string]$Model,
    [int]$Context = 65536,
    [string]$EndpointRoot = "",
    [switch]$UseSshTunnel,
    [string]$SshHost = "",
    [string]$RemoteAddress = "127.0.0.1",
    [int]$RemotePort = 8000,
    [int]$LocalPort = 18080,
    [switch]$RegisterTask,
    [string]$TaskName = "ODS Remote LLM Tunnel",
    [int]$WhisperPort = 0
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}
$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
$EnvPath = Join-Path $InstallDir ".env"
if (-not (Test-Path -LiteralPath $EnvPath)) {
    throw "Missing .env at $EnvPath"
}

if ($UseSshTunnel) {
    if ([string]::IsNullOrWhiteSpace($SshHost)) {
        throw "-SshHost is required with -UseSshTunnel"
    }
    if ([string]::IsNullOrWhiteSpace($EndpointRoot)) {
        $EndpointRoot = "http://host.docker.internal:$LocalPort"
    }
} elseif ([string]::IsNullOrWhiteSpace($EndpointRoot)) {
    throw "-EndpointRoot is required unless -UseSshTunnel is set"
}

$EndpointRoot = $EndpointRoot.TrimEnd("/")
$EndpointBaseUrl = "$EndpointRoot/v1"

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path (Join-Path $InstallDir "logs") "remote-llm-backup-$timestamp"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

function Copy-IfExists {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (Test-Path -LiteralPath $Path) {
        $leaf = Split-Path -Leaf $Path
        Copy-Item -LiteralPath $Path -Destination (Join-Path $backupDir $leaf) -Force
    }
}

function Set-EnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Value
    )
    $lines = New-Object System.Collections.Generic.List[string]
    if (Test-Path -LiteralPath $EnvPath) {
        foreach ($line in Get-Content -LiteralPath $EnvPath) {
            $lines.Add($line) | Out-Null
        }
    }
    $pattern = "^{0}=" -f [regex]::Escape($Name)
    $updated = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $pattern) {
            $lines[$i] = "$Name=$Value"
            $updated = $true
        }
    }
    if (-not $updated) {
        $lines.Add("$Name=$Value") | Out-Null
    }
    Set-Content -LiteralPath $EnvPath -Value $lines -Encoding UTF8
}

function Write-LiteLlmConfig {
    param([Parameter(Mandatory = $true)][string]$Path)
    $text = @"
model_list:
  - model_name: default
    litellm_params:
      model: openai/$Model
      api_base: $EndpointBaseUrl
      api_key: sk-ods-hermes-local
      extra_body:
        chat_template_kwargs:
          enable_thinking: false

  - model_name: "*"
    litellm_params:
      model: openai/$Model
      api_base: $EndpointBaseUrl
      api_key: sk-ods-hermes-local
      extra_body:
        chat_template_kwargs:
          enable_thinking: false

router_settings:
  routing_strategy: simple-shuffle

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY

litellm_settings:
  drop_params: true
  set_verbose: false
  request_timeout: 900
  stream_timeout: 900
"@
    Set-Content -LiteralPath $Path -Value $text -Encoding UTF8
}

function Update-HermesConfig {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    $text = Get-Content -LiteralPath $Path -Raw
    $text = [regex]::Replace($text, '(?m)^(\s*default:\s*).+$', ('$1"{0}"' -f $Model), 1)
    $text = [regex]::Replace($text, '(?m)^(\s*base_url:\s*).+$', ('$1"{0}"' -f $EndpointBaseUrl), 1)
    $text = [regex]::Replace($text, '(?m)^(\s*context_length:\s*)\d+', ('$1{0}' -f $Context), 1)
    Set-Content -LiteralPath $Path -Value $text -Encoding UTF8
}

function Get-ComposeFlagsText {
    $flagsFile = Join-Path $InstallDir ".compose-flags"
    if (Test-Path -LiteralPath $flagsFile) {
        return (Get-Content -LiteralPath $flagsFile -Raw).Trim()
    }
    $launchRecord = Join-Path (Join-Path $InstallDir "logs") "compose-launch.txt"
    if (Test-Path -LiteralPath $launchRecord) {
        $line = Get-Content -LiteralPath $launchRecord |
            Where-Object { $_ -match "^compose_flags=" } |
            Select-Object -First 1
        if ($line) {
            return ($line -replace "^compose_flags=", "").Trim()
        }
    }
    return "--env-file .env -f docker-compose.base.yml -f docker-compose.cloud.yml -f extensions/services/litellm/compose.yaml"
}

function Set-RemoteComposeFlags {
    $tokens = @(Get-ComposeFlagsText -split "\s+" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    $hasCloud = $tokens -contains "docker-compose.cloud.yml"
    if (-not $hasCloud) {
        $updated = New-Object System.Collections.Generic.List[string]
        $inserted = $false
        for ($i = 0; $i -lt $tokens.Count; $i++) {
            $updated.Add($tokens[$i]) | Out-Null
            if ($tokens[$i] -eq "docker-compose.base.yml") {
                $updated.Add("-f") | Out-Null
                $updated.Add("docker-compose.cloud.yml") | Out-Null
                $inserted = $true
            }
        }
        if (-not $inserted) {
            $updated.Add("-f") | Out-Null
            $updated.Add("docker-compose.cloud.yml") | Out-Null
        }
        $tokens = @($updated)
    }
    Set-Content -LiteralPath (Join-Path $InstallDir ".compose-flags") -Value ($tokens -join " ") -Encoding ASCII
}

Copy-IfExists -Path $EnvPath
Copy-IfExists -Path (Join-Path $InstallDir ".compose-flags")
Copy-IfExists -Path (Join-Path $InstallDir "config\litellm\local.yaml")
Copy-IfExists -Path (Join-Path $InstallDir "config\litellm\cloud.yaml")
Copy-IfExists -Path (Join-Path $InstallDir "extensions\services\hermes\cli-config.yaml.template")
Copy-IfExists -Path (Join-Path $InstallDir "data\hermes\config.yaml")

$litellmDir = Join-Path $InstallDir "config\litellm"
New-Item -ItemType Directory -Path $litellmDir -Force | Out-Null
$tunnelEnabled = if ($UseSshTunnel) { "true" } else { "false" }

Set-EnvValue -Name "ODS_MODE" -Value "cloud"
Set-EnvValue -Name "LLM_BACKEND" -Value "llama-server"
Set-EnvValue -Name "LLM_API_URL" -Value $EndpointRoot
Set-EnvValue -Name "LLM_URL" -Value $EndpointRoot
Set-EnvValue -Name "OLLAMA_URL" -Value $EndpointRoot
Set-EnvValue -Name "LLM_API_BASE_PATH" -Value "/v1"
Set-EnvValue -Name "LLM_MODEL" -Value $Model
Set-EnvValue -Name "GGUF_FILE" -Value $Model
Set-EnvValue -Name "MAX_CONTEXT" -Value ([string]$Context)
Set-EnvValue -Name "CTX_SIZE" -Value ([string]$Context)
Set-EnvValue -Name "MODEL_RECOMMENDED_MODEL" -Value $Model
Set-EnvValue -Name "MODEL_RECOMMENDED_GGUF" -Value $Model
Set-EnvValue -Name "MODEL_RECOMMENDED_CONTEXT" -Value ([string]$Context)
Set-EnvValue -Name "MODEL_RECOMMENDATION_SOURCE" -Value "remote-openai-compatible"
Set-EnvValue -Name "MODEL_RECOMMENDATION_POLICY" -Value "remote-openai-compatible"
Set-EnvValue -Name "MODEL_RECOMMENDATION_CONFIDENCE" -Value "operator-configured"
Set-EnvValue -Name "MODEL_RECOMMENDATION_REASON" -Value "Operator configured a remote OpenAI-compatible endpoint."
Set-EnvValue -Name "HERMES_LLM_BASE_URL" -Value $EndpointBaseUrl
Set-EnvValue -Name "HERMES_LLM_API_KEY" -Value "sk-ods-hermes-local"
Set-EnvValue -Name "ODS_TALK_VISION_URL" -Value $EndpointBaseUrl
Set-EnvValue -Name "ODS_TALK_VISION_MODEL" -Value $Model
Set-EnvValue -Name "REMOTE_LLM_TUNNEL_ENABLED" -Value $tunnelEnabled
Set-EnvValue -Name "REMOTE_LLM_TUNNEL_SSH_HOST" -Value $SshHost
Set-EnvValue -Name "REMOTE_LLM_TUNNEL_LOCAL_ADDRESS" -Value "127.0.0.1"
Set-EnvValue -Name "REMOTE_LLM_TUNNEL_LOCAL_PORT" -Value ([string]$LocalPort)
Set-EnvValue -Name "REMOTE_LLM_TUNNEL_REMOTE_ADDRESS" -Value $RemoteAddress
Set-EnvValue -Name "REMOTE_LLM_TUNNEL_REMOTE_PORT" -Value ([string]$RemotePort)
Set-EnvValue -Name "REMOTE_LLM_TUNNEL_EXPECTED_MODEL" -Value $Model
Set-EnvValue -Name "REMOTE_LLM_TUNNEL_TASK_NAME" -Value $TaskName
if ($WhisperPort -gt 0) {
    Set-EnvValue -Name "WHISPER_PORT" -Value ([string]$WhisperPort)
}

Write-LiteLlmConfig -Path (Join-Path $litellmDir "local.yaml")
Write-LiteLlmConfig -Path (Join-Path $litellmDir "cloud.yaml")
Update-HermesConfig -Path (Join-Path $InstallDir "extensions\services\hermes\cli-config.yaml.template")
Update-HermesConfig -Path (Join-Path $InstallDir "data\hermes\config.yaml")
Set-RemoteComposeFlags

if ($RegisterTask) {
    & (Join-Path $InstallDir "scripts\register-remote-llm-tunnel-task.ps1") -InstallDir $InstallDir -TaskName $TaskName | Out-Host
}

Write-Host "Remote LLM configuration written."
Write-Host "Backup: $backupDir"
Write-Host "Endpoint root: $EndpointRoot"
Write-Host "Model: $Model"
if ($UseSshTunnel) {
    Write-Host "Tunnel: 127.0.0.1:$LocalPort -> $SshHost $RemoteAddress`:$RemotePort"
}
Write-Host "Next:"
Write-Host "  cd $InstallDir"
Write-Host "  `$flags = (Get-Content .compose-flags -Raw).Trim() -split '\s+'"
Write-Host "  docker compose @flags up -d --remove-orphans --no-build"
Write-Host "  powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\check-remote-llm.ps1"
