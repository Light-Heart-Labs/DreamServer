# ============================================================================
# Dream Server Windows Installer -- Constants
# ============================================================================
# Part of: installers/windows/lib/
# Purpose: Version, paths, colors, configuration defaults
#
# Canonical source: installers/lib/constants.sh (keep VERSION in sync)
#
# Modder notes:
#   Change DS_VERSION for custom builds. Must match constants.sh VERSION.
# ============================================================================

$script:DS_VERSION = "2.3.2"

# Install location (override via $env:DREAM_HOME)
# NOTE: $(if ...) syntax required for PS 5.1 compatibility (bare if-as-expression is PS 7+ only)
$script:DS_INSTALL_DIR = $(if ($env:DREAM_HOME) { $env:DREAM_HOME } else { Join-Path $env:USERPROFILE "dream-server" })

# Logging
$script:DS_LOG_FILE = Join-Path $env:TEMP "dream-server-install.log"
$script:DS_PREFLIGHT_REPORT = Join-Path $env:TEMP "dream-server-windows-preflight.json"

# Native llama-server paths (AMD Strix Halo Vulkan path only)
$script:LLAMA_SERVER_DIR = Join-Path $script:DS_INSTALL_DIR "llama-server"
$script:LLAMA_SERVER_EXE = Join-Path $script:LLAMA_SERVER_DIR "llama-server.exe"
$script:LLAMA_SERVER_PID_FILE = Join-Path (Join-Path $script:DS_INSTALL_DIR "data") "llama-server.pid"

# llama.cpp release for Vulkan build (update when new releases ship)
$script:LLAMA_CPP_RELEASE_TAG = "b8248"
$script:LLAMA_CPP_VULKAN_ASSET = "llama-$($script:LLAMA_CPP_RELEASE_TAG)-bin-win-vulkan-x64.zip"
$script:LLAMA_CPP_VULKAN_URL = "https://github.com/ggml-org/llama.cpp/releases/download/$($script:LLAMA_CPP_RELEASE_TAG)/$($script:LLAMA_CPP_VULKAN_ASSET)"

# Docker
$script:DOCKER_COMPOSE_CMD = "docker compose"
$script:MIN_DOCKER_VERSION = "4.20.0"

# Minimum NVIDIA driver version for CUDA in Docker Desktop
$script:MIN_NVIDIA_DRIVER = 570

# OpenCode (host-level AI coding IDE, not a Docker service)
$script:OPENCODE_VERSION = "1.2.18"
$script:OPENCODE_ZIP = "opencode-windows-x64.zip"
$script:OPENCODE_URL = "https://github.com/anomalyco/opencode/releases/download/v$($script:OPENCODE_VERSION)/$($script:OPENCODE_ZIP)"
$script:OPENCODE_DIR = Join-Path $env:USERPROFILE ".opencode"
$script:OPENCODE_BIN = Join-Path (Join-Path $env:USERPROFILE ".opencode") "bin"
$script:OPENCODE_EXE = Join-Path (Join-Path $env:USERPROFILE ".opencode") "bin\opencode.exe"
$script:OPENCODE_CONFIG_DIR = Join-Path (Join-Path $env:USERPROFILE ".config") "opencode"
$script:OPENCODE_PORT = 3003

# Timing
$script:INSTALL_START = Get-Date

# ============================================================================
# Colors -- green phosphor CRT theme (PowerShell console colors)
# ============================================================================
$script:C = @{
    Red       = "Red"
    Green     = "Green"
    BrightGrn = "DarkGreen"
    DimGrn    = "DarkGray"
    Amber     = "Yellow"
    White     = "White"
    Cyan      = "Cyan"
    Reset     = "Gray"
}
