# Validate ODS routing to a remote OpenAI-compatible model endpoint.
[CmdletBinding()]
param(
    [string]$InstallDir = "",
    [string]$ExpectedModel = "",
    [string]$HostBaseUrl = "",
    [string]$ContainerBaseUrl = "",
    [switch]$SkipDockerChecks
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Continue"

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
}
$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
$EnvPath = Join-Path $InstallDir ".env"
$results = New-Object System.Collections.Generic.List[object]

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

function Add-CheckResult {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][bool]$Ok,
        [string]$Detail = ""
    )
    $results.Add([pscustomobject]@{ Name = $Name; Ok = $Ok; Detail = $Detail }) | Out-Null
    $mark = if ($Ok) { "PASS" } else { "FAIL" }
    Write-Host ("{0,-6} {1} {2}" -f $mark, $Name, $Detail)
}

function Invoke-JsonRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [string]$Method = "Get",
        [object]$Body = $null,
        [hashtable]$Headers = @{},
        [int]$TimeoutSec = 60
    )
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 20
        return Invoke-RestMethod -Uri $Uri -Method $Method -ContentType "application/json" -Headers $Headers -Body $json -TimeoutSec $TimeoutSec
    }
    return Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers -TimeoutSec $TimeoutSec
}

if ([string]::IsNullOrWhiteSpace($ExpectedModel)) {
    $ExpectedModel = Get-OdsEnvValue -Name "REMOTE_LLM_TUNNEL_EXPECTED_MODEL" -Default (Get-OdsEnvValue -Name "LLM_MODEL")
}
if ([string]::IsNullOrWhiteSpace($HostBaseUrl)) {
    $localPort = Get-OdsEnvValue -Name "REMOTE_LLM_TUNNEL_LOCAL_PORT" -Default "18080"
    $HostBaseUrl = "http://127.0.0.1:$localPort"
}
if ([string]::IsNullOrWhiteSpace($ContainerBaseUrl)) {
    $remoteUrl = Get-OdsEnvValue -Name "LLM_API_URL"
    if (-not [string]::IsNullOrWhiteSpace($remoteUrl)) {
        $ContainerBaseUrl = $remoteUrl.TrimEnd("/")
    } else {
        $localPort = Get-OdsEnvValue -Name "REMOTE_LLM_TUNNEL_LOCAL_PORT" -Default "18080"
        $ContainerBaseUrl = "http://host.docker.internal:$localPort"
    }
}

try {
    $models = Invoke-JsonRequest -Uri "$HostBaseUrl/v1/models" -TimeoutSec 8
    $modelIds = @($models.data | ForEach-Object { $_.id })
    $ok = if ([string]::IsNullOrWhiteSpace($ExpectedModel)) { $modelIds.Count -gt 0 } else { $modelIds -contains $ExpectedModel }
    Add-CheckResult "host remote models" $ok (($modelIds -join ", "))
} catch {
    Add-CheckResult "host remote models" $false $_.Exception.Message
}

if (-not [string]::IsNullOrWhiteSpace($ExpectedModel)) {
    try {
        $payload = @{
            model = $ExpectedModel
            messages = @(@{ role = "user"; content = "Reply exactly: ods-remote-llm-check" })
            max_tokens = 24
            temperature = 0
            stream = $false
        }
        $chat = Invoke-JsonRequest -Uri "$HostBaseUrl/v1/chat/completions" -Method "Post" -Body $payload -TimeoutSec 120
        $content = [string]$chat.choices[0].message.content
        Add-CheckResult "host remote chat" ($content -match "ods-remote-llm-check") ($content.Trim())
    } catch {
        Add-CheckResult "host remote chat" $false $_.Exception.Message
    }
}

if (-not $SkipDockerChecks) {
    try {
        $python = "import json,urllib.request; data=json.load(urllib.request.urlopen('$ContainerBaseUrl/v1/models', timeout=8)); print(','.join([m.get('id','') for m in data.get('data', [])]))"
        $out = & docker exec ods-dashboard-api python3 -c $python 2>&1
        $ok = ($LASTEXITCODE -eq 0) -and (([string]::IsNullOrWhiteSpace($ExpectedModel) -and -not [string]::IsNullOrWhiteSpace([string]$out)) -or ($out -match [regex]::Escape($ExpectedModel)))
        Add-CheckResult "container remote models" $ok ([string]$out)
    } catch {
        Add-CheckResult "container remote models" $false $_.Exception.Message
    }

    try {
        $llama = & docker ps --filter "name=ods-llama-server" --format "{{.Names}}" 2>$null
        Add-CheckResult "local llama-server stopped" ([string]::IsNullOrWhiteSpace([string]$llama)) ([string]$llama)
    } catch {
        Add-CheckResult "local llama-server stopped" $false $_.Exception.Message
    }

    try {
        $litellmKey = Get-OdsEnvValue -Name "LITELLM_KEY"
        if ([string]::IsNullOrWhiteSpace($litellmKey)) {
            Add-CheckResult "LiteLLM chat" $true "skipped: LITELLM_KEY unset"
        } elseif ([string]::IsNullOrWhiteSpace($ExpectedModel)) {
            Add-CheckResult "LiteLLM chat" $true "skipped: expected model unset"
        } else {
            $payload = @{
                model = "default"
                messages = @(@{ role = "user"; content = "Reply exactly: litellm-remote-llm-check" })
                max_tokens = 24
                temperature = 0
                stream = $false
            }
            $chat = Invoke-JsonRequest -Uri "http://127.0.0.1:4000/v1/chat/completions" -Method "Post" -Headers @{ Authorization = "Bearer $litellmKey" } -Body $payload -TimeoutSec 120
            $content = [string]$chat.choices[0].message.content
            Add-CheckResult "LiteLLM chat" ($content -match "litellm-remote-llm-check") ($content.Trim())
        }
    } catch {
        Add-CheckResult "LiteLLM chat" $false $_.Exception.Message
    }
}

$failed = @($results | Where-Object { -not $_.Ok })
if ($failed.Count -gt 0) {
    exit 1
}
exit 0
