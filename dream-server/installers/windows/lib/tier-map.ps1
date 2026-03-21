# ============================================================================
# Dream Server Windows Installer -- Tier Map
# ============================================================================
# Part of: installers/windows/lib/
# Purpose: Map hardware tier to model name, GGUF file, URL, and context size
#
# Canonical source: installers/lib/tier-map.sh (keep values byte-identical)
#
# Modder notes:
#   Add new tiers or change model assignments here.
#   Each tier maps to a specific GGUF quantization and context window.
# ============================================================================

function Resolve-TierConfig {
    param([string]$Tier)

    switch ($Tier) {
        "CLOUD" {
            return @{
                TierName   = "Cloud (API)"
                LlmModel   = "anthropic/claude-sonnet-4-5-20250514"
                GgufFile   = ""
                GgufUrl    = ""
                GgufSha256 = ""
                MaxContext = 200000
            }
        }
        "NV_ULTRA" {
            return @{
                TierName   = "NVIDIA Ultra (90GB+)"
                LlmModel   = "qwen3-coder-next"
                GgufFile   = "qwen3-coder-next-Q4_K_M.gguf"
                GgufUrl    = "https://huggingface.co/unsloth/Qwen3-Coder-Next-GGUF/resolve/main/Qwen3-Coder-Next-Q4_K_M.gguf"
                GgufSha256 = ""
                MaxContext = 131072
            }
        }
        "SH_LARGE" {
            return @{
                TierName   = "Strix Halo 90+"
                LlmModel   = "qwen3-coder-next"
                GgufFile   = "qwen3-coder-next-Q4_K_M.gguf"
                GgufUrl    = "https://huggingface.co/unsloth/Qwen3-Coder-Next-GGUF/resolve/main/Qwen3-Coder-Next-Q4_K_M.gguf"
                GgufSha256 = ""
                MaxContext = 131072
            }
        }
        "SH_COMPACT" {
            return @{
                TierName   = "Strix Halo Compact"
                LlmModel   = "qwen3-30b-a3b"
                GgufFile   = "Qwen3-30B-A3B-Q4_K_M.gguf"
                GgufUrl    = "https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf"
                GgufSha256 = "9f1a24700a339b09c06009b729b5c809e0b64c213b8af5b711b3dbdfd0c5ba48"
                MaxContext = 131072
            }
        }
        "0" {
            return @{
                TierName   = "Lightweight"
                LlmModel   = "qwen3.5-2b"
                GgufFile   = "Qwen3.5-2B-Q4_K_M.gguf"
                GgufUrl    = "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf"
                GgufSha256 = ""
                MaxContext = 8192
            }
        }
        "1" {
            return @{
                TierName   = "Entry Level"
                LlmModel   = "qwen3-8b"
                GgufFile   = "Qwen3-8B-Q4_K_M.gguf"
                GgufUrl    = "https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf"
                GgufSha256 = "120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4"
                MaxContext = 16384
            }
        }
        "2" {
            return @{
                TierName   = "Prosumer"
                LlmModel   = "qwen3-8b"
                GgufFile   = "Qwen3-8B-Q4_K_M.gguf"
                GgufUrl    = "https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf"
                GgufSha256 = "120307ba529eb2439d6c430d94104dabd578497bc7bfe7e322b5d9933b449bd4"
                MaxContext = 32768
            }
        }
        "3" {
            return @{
                TierName   = "Pro"
                LlmModel   = "qwen3-30b-a3b"
                GgufFile   = "Qwen3-30B-A3B-Q4_K_M.gguf"
                GgufUrl    = "https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf"
                GgufSha256 = "9f1a24700a339b09c06009b729b5c809e0b64c213b8af5b711b3dbdfd0c5ba48"
                MaxContext = 32768
            }
        }
        "4" {
            return @{
                TierName   = "Enterprise"
                LlmModel   = "qwen3-30b-a3b"
                GgufFile   = "Qwen3-30B-A3B-Q4_K_M.gguf"
                GgufUrl    = "https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf"
                GgufSha256 = "9f1a24700a339b09c06009b729b5c809e0b64c213b8af5b711b3dbdfd0c5ba48"
                MaxContext = 131072
            }
        }
        default {
            throw "Invalid tier: $Tier. Valid tiers: 0, 1, 2, 3, 4, CLOUD, NV_ULTRA, SH_LARGE, SH_COMPACT"
        }
    }
}

function ConvertTo-TierFromGpu {
    param(
        [hashtable]$GpuInfo,
        [int]$SystemRamGB
    )

    $backend = $GpuInfo.Backend
    $vramMB  = $GpuInfo.VramMB

    # No GPU detected -- use Tier 0 for local inference on low-RAM machines,
    # otherwise fall back to CLOUD (API) mode
    if ($backend -eq "none") {
        if ($SystemRamGB -lt 12) { return "0" }
        return "CLOUD"
    }

    # AMD Strix Halo -- tier based on system RAM (unified memory)
    if ($backend -eq "amd" -and $GpuInfo.MemoryType -eq "unified") {
        if ($SystemRamGB -ge 90) { return "SH_LARGE" }
        if ($SystemRamGB -ge 64) { return "SH_COMPACT" }
        if ($SystemRamGB -lt 12) { return "0" }
        return "1"  # Fallback for small unified memory
    }

    # NVIDIA -- tier based on VRAM
    $vramGB = [math]::Floor($vramMB / 1024)

    if ($vramGB -ge 90) { return "NV_ULTRA" }
    if ($vramGB -ge 40) { return "4" }
    if ($vramGB -ge 20) { return "3" }
    if ($vramGB -ge 12) { return "2" }
    if ($vramGB -lt 4 -and $SystemRamGB -lt 12) { return "0" }
    return "1"
}

# Map a tier name to its LLM_MODEL value (used by dream model swap)
function ConvertTo-ModelFromTier {
    param([string]$Tier)

    switch -Regex ($Tier) {
        "^CLOUD$"                { return "anthropic/claude-sonnet-4-5-20250514" }
        "^NV_ULTRA$"             { return "qwen3-coder-next" }
        "^SH_LARGE$"             { return "qwen3-coder-next" }
        "^(SH_COMPACT|SH)$"     { return "qwen3-30b-a3b" }
        "^(0|T0)$"               { return "qwen3.5-2b" }
        "^(1|T1)$"               { return "qwen3-8b" }
        "^(2|T2)$"               { return "qwen3-8b" }
        "^(3|T3)$"               { return "qwen3-30b-a3b" }
        "^(4|T4)$"               { return "qwen3-30b-a3b" }
        default                  { return "" }
    }
}

# ============================================================================
# Bootstrap Fast-Start
# ============================================================================
# Tiny model for instant chat while the full tier model downloads in background.

$script:BOOTSTRAP_GGUF_FILE    = "Qwen3.5-2B-Q4_K_M.gguf"
$script:BOOTSTRAP_GGUF_URL     = "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf"
$script:BOOTSTRAP_LLM_MODEL    = "qwen3.5-2b"
$script:BOOTSTRAP_MAX_CONTEXT   = 8192

function Get-TierRank {
    param([string]$Tier)
    switch ($Tier) {
        { $_ -in "NV_ULTRA","SH_LARGE" } { return 5 }
        "4"                                { return 4 }
        { $_ -in "SH_COMPACT","3" }       { return 3 }
        { $_ -in "ARC","2" }              { return 2 }
        { $_ -in "ARC_LITE","1" }         { return 1 }
        "0"                                { return 0 }
        default                            { return 1 }
    }
}

function Should-UseBootstrap {
    param(
        [string]$Tier,
        [string]$InstallDir,
        [string]$GgufFile,
        [bool]$CloudMode = $false,
        [bool]$OfflineMode = $false,
        [bool]$NoBootstrap = $false
    )
    if ($NoBootstrap)  { return $false }
    if ($CloudMode)    { return $false }
    if ($OfflineMode)  { return $false }
    if ((Get-TierRank $Tier) -le 0) { return $false }
    $modelPath = Join-Path (Join-Path $InstallDir "data\models") $GgufFile
    if (Test-Path $modelPath) { return $false }
    return $true
}
