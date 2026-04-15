#!/bin/sh
# ============================================================================
# Dream Server Mobile Shell Preview Installer
# ============================================================================
# Scope:
#   - Android / Termux: supported local shell preview path
#   - iOS / a-Shell: CLI + Apple Shortcuts preview path
#
# This intentionally does NOT try to boot the full Dream Server stack.
# Mobile shell mode is a lightweight, model-in-shell preview for early testing.
# ============================================================================

if [ -z "${BASH_VERSION:-}" ]; then
    if [ "${TERM_PROGRAM:-}" = "a-Shell" ] || [ "${TERM_PROGRAM:-}" = "a-Shell mini" ] || [ -n "${ASHELL:-}" ]; then
        exec sh "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/ios-ashell-install.sh" "$@"
    fi

    if command -v bash >/dev/null 2>&1; then
        exec bash "$0" "$@"
    fi

    echo "[error] bash is required for the Android / Termux mobile preview." >&2
    exit 1
fi

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/installers/common.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()     { echo -e "${CYAN}[dream-mobile]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $1"; }
fail()    { echo -e "${RED}[error]${NC} $1" >&2; exit 1; }

DRY_RUN=false
FORCE=false
INTERACTIVE=true
MODEL_ID="qwen3-0.6b"
MOBILE_CONTEXT=2048
MOBILE_THREADS=""
IGNORED_FLAGS=()

MOBILE_RUNTIME_DIR="$ROOT_DIR/mobile-runtime"
LLAMA_DIR="$MOBILE_RUNTIME_DIR/llama.cpp"
LLAMA_BUILD_DIR="$LLAMA_DIR/build"
MODEL_DIR="$ROOT_DIR/data/models/mobile"
EXPORT_FALLBACK_DIR="$ROOT_DIR/data/exports/mobile"
CONFIG_FILE="$ROOT_DIR/.dream-mobile.env"
EXPORT_DIR=""
EXPORT_MODE=""

usage() {
    cat <<'EOF'
Dream Server Mobile Shell Preview

Usage:
  ./install.sh
  ./dream-mobile.sh install

Options:
  --model NAME        Model preset to install (default: qwen3-0.6b)
  --context N         Context size for shell chat (default: 2048)
  --threads N         CPU threads for llama-cli (default: auto, capped for phones)
  --force             Rebuild llama.cpp and re-download the model
  --dry-run           Print the mobile steps without changing anything
  --non-interactive   Skip prompts
  -h, --help          Show this help

Notes:
  - This mobile preview is shell-only.
  - Android Termux is supported for local chat with Qwen3-0.6B.
  - iOS a-Shell uses the CLI + Shortcuts preview path.
EOF
}

run_cmd() {
    if $DRY_RUN; then
        printf '[dry-run]'
        printf ' %q' "$@"
        printf '\n'
    else
        "$@"
    fi
}

ensure_integer() {
    local value="${1:-}"
    [[ "$value" =~ ^[0-9]+$ ]] || fail "Expected an integer, got: ${value:-<empty>}"
}

recommended_threads() {
    local cores
    cores=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo "2")
    [[ "$cores" =~ ^[0-9]+$ ]] || cores=2
    (( cores < 1 )) && cores=1
    (( cores > 4 )) && cores=4
    echo "$cores"
}

resolve_model() {
    case "${MODEL_ID,,}" in
        qwen3-0.6b|qwen3|qwen-0.6b)
            MODEL_NAME="Qwen3-0.6B"
            MODEL_REPO="ggml-org/Qwen3-0.6B-GGUF"
            MODEL_FILE="Qwen3-0.6B-Q4_0.gguf"
            MODEL_URL="https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_0.gguf"
            MODEL_SIZE_MB=429
            ;;
        qwen3.5-2b|qwen-3.5-2b|qwen35-2b)
            MODEL_NAME="Qwen3.5-2B"
            MODEL_REPO="bartowski/Qwen_Qwen3.5-2B-GGUF"
            MODEL_FILE="Qwen_Qwen3.5-2B-Q4_K_M.gguf"
            MODEL_URL="https://huggingface.co/bartowski/Qwen_Qwen3.5-2B-GGUF/resolve/main/Qwen_Qwen3.5-2B-Q4_K_M.gguf"
            MODEL_SIZE_MB=1600
            ;;
        *)
            fail "Unsupported mobile model preset: $MODEL_ID"
            ;;
    esac

    if [[ -z "$MOBILE_THREADS" ]]; then
        MOBILE_THREADS="$(recommended_threads)"
    else
        ensure_integer "$MOBILE_THREADS"
    fi

    ensure_integer "$MOBILE_CONTEXT"
    MODEL_PATH="$MODEL_DIR/$MODEL_FILE"
}

warn_ignored_flags() {
    local flag
    [[ "${#IGNORED_FLAGS[@]}" -gt 0 ]] || return 0
    for flag in "${IGNORED_FLAGS[@]}"; do
        warn "Ignoring desktop-only flag in mobile shell preview: $flag"
    done
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --model)
                MODEL_ID="${2:-}"
                shift 2
                ;;
            --context|--ctx|--ctx-size)
                MOBILE_CONTEXT="${2:-}"
                shift 2
                ;;
            --threads)
                MOBILE_THREADS="${2:-}"
                shift 2
                ;;
            --force)
                FORCE=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --non-interactive)
                INTERACTIVE=false
                shift
                ;;
            --tier|--summary-json)
                IGNORED_FLAGS+=("$1 ${2:-}")
                shift 2
                ;;
            --skip-docker|--voice|--workflows|--rag|--openclaw|--all|--cloud|--offline|--no-bootstrap|--bootstrap|--comfyui|--no-comfyui|--dreamforge|--no-dreamforge)
                IGNORED_FLAGS+=("$1")
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                fail "Unknown option for mobile shell preview: $1"
                ;;
        esac
    done
}

detect_mobile_platform() {
    detect_platform
}

fail_termux_partial_upgrade() {
    cat >&2 <<'EOF'
[error] Termux package state looks inconsistent.

Dream Server mobile preview depends on a healthy Termux userland.
Termux uses a rolling-release package model and does not support partial upgrades.

Fix inside Termux:
  apt update && apt full-upgrade

If repositories or mirrors still look wrong, refresh the mirror first:
  termux-change-repo

Then rerun:
  ./install.sh
EOF
    exit 1
}

verify_termux_runtime_health() {
    command -v curl >/dev/null 2>&1 || fail "curl is missing from Termux after dependency install."
    command -v git >/dev/null 2>&1 || fail "git is missing from Termux after dependency install."
    command -v cmake >/dev/null 2>&1 || fail "cmake is missing from Termux after dependency install."
    command -v clang >/dev/null 2>&1 || fail "clang is missing from Termux after dependency install."
    command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1 || fail "python is missing from Termux after dependency install."

    if ! curl --version >/dev/null 2>&1; then
        fail_termux_partial_upgrade
    fi

    if ! git --version >/dev/null 2>&1; then
        fail_termux_partial_upgrade
    fi
}

ensure_termux_dependencies() {
    log "Installing Termux build dependencies"
    run_cmd pkg update -y
    run_cmd pkg upgrade -y
    run_cmd pkg install -y git cmake make clang curl python poppler
    verify_termux_runtime_health
}

prepare_runtime_dirs() {
    run_cmd mkdir -p "$MOBILE_RUNTIME_DIR" "$MODEL_DIR" "$EXPORT_FALLBACK_DIR"
}

resolve_export_dir() {
    local shared_downloads="${HOME:-$ROOT_DIR}/storage/downloads"

    if [[ -d "$shared_downloads" ]]; then
        EXPORT_DIR="$shared_downloads"
        EXPORT_MODE="shared-downloads"
    else
        EXPORT_DIR="$EXPORT_FALLBACK_DIR"
        EXPORT_MODE="repo-fallback"
    fi
}

clone_or_refresh_llama_cpp() {
    if [[ -d "$LLAMA_DIR/.git" ]]; then
        if $FORCE; then
            run_cmd rm -rf "$LLAMA_DIR"
            run_cmd git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$LLAMA_DIR"
        else
            log "Refreshing local llama.cpp checkout"
            run_cmd git -C "$LLAMA_DIR" pull --ff-only
        fi
    else
        log "Cloning llama.cpp runtime"
        run_cmd git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$LLAMA_DIR"
    fi
}

build_llama_cli() {
    local jobs
    jobs="$(recommended_threads)"

    log "Building llama.cpp chat binaries for Termux"
    run_cmd cmake -S "$LLAMA_DIR" -B "$LLAMA_BUILD_DIR" \
        -DCMAKE_BUILD_TYPE=Release \
        -DGGML_OPENMP=OFF \
        -DLLAMA_BUILD_TOOLS=OFF \
        -DLLAMA_BUILD_SERVER=OFF \
        -DLLAMA_BUILD_TESTS=OFF \
        -DLLAMA_BUILD_EXAMPLES=ON \
        -DLLAMA_CURL=OFF
    run_cmd cmake --build "$LLAMA_BUILD_DIR" --config Release -j "$jobs" --target llama-simple-chat llama-simple
}

resolve_llama_chat_binary() {
    local candidate
    for candidate in \
        "$LLAMA_BUILD_DIR/bin/llama-simple-chat" \
        "$LLAMA_BUILD_DIR/bin/Release/llama-simple-chat"
    do
        if [[ -x "$candidate" ]]; then
            echo "$candidate"
            return 0
        fi
    done

    echo "$LLAMA_BUILD_DIR/bin/llama-simple-chat"
}

resolve_llama_prompt_binary() {
    local candidate
    for candidate in \
        "$LLAMA_BUILD_DIR/bin/llama-simple" \
        "$LLAMA_BUILD_DIR/bin/Release/llama-simple"
    do
        if [[ -x "$candidate" ]]; then
            echo "$candidate"
            return 0
        fi
    done

    echo "$LLAMA_BUILD_DIR/bin/llama-simple"
}

download_model() {
    if [[ -s "$MODEL_PATH" && "$FORCE" != "true" ]]; then
        success "Model already present: $MODEL_FILE"
        return 0
    fi

    log "Downloading ${MODEL_NAME} (${MODEL_SIZE_MB}MB)"
    run_cmd curl -L --fail --progress-bar -C - -o "$MODEL_PATH" "$MODEL_URL"
}

write_config() {
    local llama_chat_cli
    local llama_prompt_cli
    llama_chat_cli="$(resolve_llama_chat_binary)"
    llama_prompt_cli="$(resolve_llama_prompt_binary)"

    if $DRY_RUN; then
        log "Would write mobile config to $CONFIG_FILE"
        return 0
    fi

    cat > "$CONFIG_FILE" <<EOF
DREAM_MOBILE_PLATFORM="android-termux"
DREAM_MOBILE_MODEL_ID="$MODEL_ID"
DREAM_MOBILE_MODEL_NAME="$MODEL_NAME"
DREAM_MOBILE_MODEL_REPO="$MODEL_REPO"
DREAM_MOBILE_MODEL_FILE="$MODEL_FILE"
DREAM_MOBILE_MODEL_URL="$MODEL_URL"
DREAM_MOBILE_MODEL_PATH="$MODEL_PATH"
DREAM_MOBILE_LLAMA_DIR="$LLAMA_DIR"
DREAM_MOBILE_LLAMA_CLI="$llama_chat_cli"
DREAM_MOBILE_LLAMA_CHAT_CLI="$llama_chat_cli"
DREAM_MOBILE_LLAMA_PROMPT_CLI="$llama_prompt_cli"
DREAM_MOBILE_CONTEXT="$MOBILE_CONTEXT"
DREAM_MOBILE_THREADS="$MOBILE_THREADS"
DREAM_MOBILE_EXPORT_DIR="$EXPORT_DIR"
DREAM_MOBILE_EXPORT_MODE="$EXPORT_MODE"
DREAM_MOBILE_LOCAL_HOST="127.0.0.1"
DREAM_MOBILE_LOCAL_PORT="8765"
DREAM_MOBILE_LOCAL_SERVER="$ROOT_DIR/installers/mobile/android-local-server.py"
EOF
}

print_summary() {
    echo ""
    success "Dream Server mobile shell preview is ready."
    echo ""
    echo "Platform:  Android / Termux"
    echo "Model:     $MODEL_NAME ($MODEL_FILE)"
    echo "Context:   $MOBILE_CONTEXT"
    echo "Threads:   $MOBILE_THREADS"
    echo "Exports:   $EXPORT_DIR"
    echo ""
    echo "Next steps:"
    echo "  ./dream-mobile.sh status"
    echo "  ./dream-mobile.sh chat"
    echo "  ./dream-mobile.sh local"
    echo "  ./dream-mobile.sh prompt \"oi, me explica esse repo\""
    echo "  ./dream-mobile.sh export notes/brief.txt \"gere um resumo claro deste repo\""
    echo ""
    echo "This mobile preview is intentionally limited to shell chat for now."
    if [[ "$EXPORT_MODE" = "repo-fallback" ]]; then
        echo ""
        warn "Android shared storage is not linked yet."
        echo "Run 'termux-setup-storage' once, grant the permission, and rerun ./install.sh to export into Downloads."
    fi
}

main() {
    parse_args "$@"
    warn_ignored_flags
    resolve_model

    local platform
    platform="$(detect_mobile_platform)"

    case "$platform" in
        android-termux)
            log "Detected Android / Termux mobile shell"
            ;;
        ios-ashell)
            exec sh "$ROOT_DIR/installers/mobile/ios-ashell-install.sh" "$@"
            ;;
        *)
            fail "Mobile shell preview only supports Android / Termux today. Detected platform: $platform"
            ;;
    esac

    prepare_runtime_dirs
    resolve_export_dir
    ensure_termux_dependencies
    clone_or_refresh_llama_cpp
    build_llama_cli
    download_model
    write_config
    print_summary
}

main "$@"
