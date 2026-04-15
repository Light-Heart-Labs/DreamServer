#!/bin/sh
# ============================================================================
# Dream Server iOS / a-Shell Lite Beta Installer
# ============================================================================

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"

RED='[0;31m'
GREEN='[0;32m'
YELLOW='[1;33m'
CYAN='[0;36m'
NC='[0m'

log()     { printf '%s[dream-ios]%s %s\n' "$CYAN" "$NC" "$1"; }
success() { printf '%s[ok]%s %s\n' "$GREEN" "$NC" "$1"; }
warn()    { printf '%s[warn]%s %s\n' "$YELLOW" "$NC" "$1"; }
fail()    { printf '%s[error]%s %s\n' "$RED" "$NC" "$1" >&2; exit 1; }

DRY_RUN=false
FORCE=false
DOWNLOAD_MODEL=true
MODEL_ID="qwen3-0.6b"
MOBILE_CONTEXT=1024
MOBILE_REPLY_TOKENS=48
MOBILE_CHAT_REPLY_TOKENS=64
MOBILE_HISTORY_MESSAGES=1
IGNORED_FLAGS=""

IOS_RUNTIME_DIR="$ROOT_DIR/mobile-runtime/ios-ashell"
IOS_BIN_DIR="$IOS_RUNTIME_DIR/bin"
MODEL_DIR="$ROOT_DIR/data/models/mobile"
CONFIG_FILE="$ROOT_DIR/.dream-mobile.env"
IOS_GUIDE_DOC="$ROOT_DIR/docs/IOS-ASHELL-SHORTCUTS.md"
WASM_BUILD_HELPER="$ROOT_DIR/installers/mobile/build-ios-ashell-wasm-runtime.sh"
WASM_BUILD_DOC="$ROOT_DIR/docs/IOS-ASHELL-WASM-RUNTIME.md"

write_lines_file() {
    target_path="$1"
    shift
    tmp_path="${target_path}.tmp"

    if [ "$DRY_RUN" = "true" ]; then
        return 0
    fi

    rm -f "$tmp_path"
    : > "$tmp_path"
    for line in "$@"; do
        printf '%s\n' "$line" >> "$tmp_path"
    done
    mv "$tmp_path" "$target_path"
}

usage() {
    cat <<'EOF'
Dream Server iOS / a-Shell Preview

Usage:
  sh ./install.sh
  sh ./dream-mobile.sh install

Options:
  --model NAME           Model preset to track in config (default: qwen3-0.6b)
  --context N            Context size to use when a wasm runtime is available
  --reply-tokens N       Default max reply tokens for prompt/chat on iOS
  --chat-reply-tokens N  Default max reply tokens for interactive chat on iOS
  --history-messages N   Max recent chat turns to keep in the legacy-fast iOS chat
  --download-model       Download the GGUF during install (default)
  --no-model-download    Skip the default GGUF download for now
  --force                Re-write config and re-download the model if requested
  --dry-run              Show what would happen without writing files
  -h, --help             Show this help

Notes:
  - This iOS preview is CLI-first and shell-only.
  - The install step downloads Qwen3-0.6B by default.
  - If a local wasm llama runtime is added later, the same commands can use it.
  - The default iOS profile is legacy-fast: rawer prompting, fast streaming, short chat memory.
EOF
}

run_cmd() {
    if [ "$DRY_RUN" = "true" ]; then
        printf '[dry-run]'
        for arg in "$@"; do
            printf ' %s' "$arg"
        done
        printf '\n'
    else
        "$@"
    fi
}

ensure_integer() {
    case "${1:-}" in
        ''|*[!0-9]*)
            fail "Expected an integer, got: ${1:-<empty>}"
            ;;
    esac
}

resolve_model() {
    case "$(printf '%s' "$MODEL_ID" | tr '[:upper:]' '[:lower:]')" in
        qwen3-0.6b|qwen3|qwen-0.6b)
            MODEL_NAME="Qwen3-0.6B"
            MODEL_REPO="ggml-org/Qwen3-0.6B-GGUF"
            MODEL_FILE="Qwen3-0.6B-Q4_0.gguf"
            MODEL_URL="https://huggingface.co/ggml-org/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_0.gguf"
            MODEL_SIZE_MB=429
            ;;
        *)
            fail "Unsupported iOS model preset: $MODEL_ID"
            ;;
    esac

    ensure_integer "$MOBILE_CONTEXT"
    ensure_integer "$MOBILE_REPLY_TOKENS"
    ensure_integer "$MOBILE_CHAT_REPLY_TOKENS"
    ensure_integer "$MOBILE_HISTORY_MESSAGES"
    MODEL_PATH="$MODEL_DIR/$MODEL_FILE"
    WASM_RUNTIME_PATH="$IOS_BIN_DIR/llama-cli.wasm"
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --model)
                MODEL_ID="${2:-}"
                shift 2
                ;;
            --context|--ctx|--ctx-size)
                MOBILE_CONTEXT="${2:-}"
                shift 2
                ;;
            --reply-tokens|--max-tokens)
                MOBILE_REPLY_TOKENS="${2:-}"
                shift 2
                ;;
            --chat-reply-tokens)
                MOBILE_CHAT_REPLY_TOKENS="${2:-}"
                shift 2
                ;;
            --history-messages|--history)
                MOBILE_HISTORY_MESSAGES="${2:-}"
                shift 2
                ;;
            --download-model)
                DOWNLOAD_MODEL=true
                shift
                ;;
            --no-model-download)
                DOWNLOAD_MODEL=false
                shift
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
                shift
                ;;
            --tier|--summary-json)
                IGNORED_FLAGS="$IGNORED_FLAGS $1 ${2:-}"
                shift 2
                ;;
            --skip-docker|--voice|--workflows|--rag|--openclaw|--all|--cloud|--offline|--no-bootstrap|--bootstrap|--comfyui|--no-comfyui|--dreamforge|--no-dreamforge)
                IGNORED_FLAGS="$IGNORED_FLAGS $1"
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                fail "Unknown option for iOS / a-Shell preview: $1"
                ;;
        esac
    done
}

warn_ignored_flags() {
    [ -n "$IGNORED_FLAGS" ] || return 0
    warn "Ignoring desktop-only flags in the iOS preview:$IGNORED_FLAGS"
}

prepare_dirs() {
    run_cmd mkdir -p "$IOS_RUNTIME_DIR" "$IOS_BIN_DIR" "$MODEL_DIR"
}

write_config() {
    ENGINE="rules"
    WASM_READY="false"
    MODEL_DOWNLOADED="false"

    if [ -f "$WASM_RUNTIME_PATH" ]; then
        ENGINE="wasm"
        WASM_READY="true"
    fi
    if [ -f "$MODEL_PATH" ]; then
        MODEL_DOWNLOADED="true"
    fi

    if [ "$DRY_RUN" = "true" ]; then
        log "Would write iOS config to $CONFIG_FILE"
        return 0
    fi

    write_lines_file "$CONFIG_FILE" \
        "DREAM_MOBILE_PLATFORM=\"ios-ashell\"" \
        "DREAM_MOBILE_MODE=\"ios-ashell-lite-beta\"" \
        "DREAM_MOBILE_ENGINE=\"$ENGINE\"" \
        "DREAM_MOBILE_MODEL_ID=\"$MODEL_ID\"" \
        "DREAM_MOBILE_MODEL_NAME=\"$MODEL_NAME\"" \
        "DREAM_MOBILE_MODEL_REPO=\"$MODEL_REPO\"" \
        "DREAM_MOBILE_MODEL_FILE=\"$MODEL_FILE\"" \
        "DREAM_MOBILE_MODEL_URL=\"$MODEL_URL\"" \
        "DREAM_MOBILE_MODEL_PATH=\"$MODEL_PATH\"" \
        "DREAM_MOBILE_MODEL_DOWNLOADED=\"$MODEL_DOWNLOADED\"" \
        "DREAM_MOBILE_WASM_RUNNER=\"wasm\"" \
        "DREAM_MOBILE_WASM_BINARY=\"$WASM_RUNTIME_PATH\"" \
        "DREAM_MOBILE_WASM_READY=\"$WASM_READY\"" \
        "DREAM_MOBILE_WASM_BUILD_HELPER=\"$WASM_BUILD_HELPER\"" \
        "DREAM_MOBILE_WASM_BUILD_DOC=\"$WASM_BUILD_DOC\"" \
        "DREAM_MOBILE_CONTEXT=\"$MOBILE_CONTEXT\"" \
        "DREAM_MOBILE_REPLY_TOKENS=\"$MOBILE_REPLY_TOKENS\"" \
        "DREAM_MOBILE_CHAT_REPLY_TOKENS=\"$MOBILE_CHAT_REPLY_TOKENS\"" \
        "DREAM_MOBILE_HISTORY_MESSAGES=\"$MOBILE_HISTORY_MESSAGES\"" \
        "DREAM_MOBILE_GUIDE_DOC=\"$IOS_GUIDE_DOC\""

    success "Wrote iOS preview config"
}

download_model() {
    if [ "$DOWNLOAD_MODEL" != "true" ]; then
        warn "Skipping GGUF download because --no-model-download was used."
        return 0
    fi

    if [ -f "$MODEL_PATH" ] && [ "$FORCE" != "true" ]; then
        success "Model already present: $MODEL_FILE"
        return 0
    fi

    log "Downloading $MODEL_NAME ($MODEL_SIZE_MB MB)"
    run_cmd curl -L --fail --progress-bar -C - -o "$MODEL_PATH" "$MODEL_URL"
}

print_summary() {
    ENGINE="rules"
    [ -f "$WASM_RUNTIME_PATH" ] && ENGINE="wasm"

    echo ""
    success "Dream Server iOS / a-Shell preview is ready."
    echo ""
    echo "Platform:   iOS / a-Shell"
    echo "Mode:       Lite beta shell chat"
    echo "Engine:     $ENGINE"
    echo "Model:      $MODEL_NAME"
    echo "Model file: $MODEL_PATH"
    echo "Context:    $MOBILE_CONTEXT"
    echo "Prompt tok: $MOBILE_REPLY_TOKENS"
    echo "Chat tok:   $MOBILE_CHAT_REPLY_TOKENS"
    echo "History:    $MOBILE_HISTORY_MESSAGES turns"
    echo "Wasm path:  $WASM_RUNTIME_PATH"
    echo "Host build: $WASM_BUILD_HELPER"
    echo ""
    echo "Use now:"
    echo "  sh ./dream-mobile.sh status"
    echo "  sh ./dream-mobile.sh chat"
    echo ""
    echo "Guide:"
    echo "  $IOS_GUIDE_DOC"
    echo ""
    if [ "$DOWNLOAD_MODEL" != "true" ]; then
        echo "Model download was skipped for this run."
        echo "When you want the GGUF on-device:"
        echo "  sh ./dream-mobile.sh install --download-model"
        echo ""
    else
        echo "Model download is enabled by default on iOS install."
        echo "If you want to skip it on a specific run:"
        echo "  sh ./dream-mobile.sh install --no-model-download"
        echo ""
    fi
    if [ ! -f "$WASM_RUNTIME_PATH" ]; then
        echo "Today the iOS path uses a local rule-based intent engine by default."
        echo "The repo also ships a host-side experimental builder here:"
        echo "  $WASM_BUILD_HELPER"
        echo "Current runtime notes live here:"
        echo "  $WASM_BUILD_DOC"
        echo "If you later drop a working wasm llama runtime at:"
        echo "  $WASM_RUNTIME_PATH"
        echo "the same CLI can switch to local prompt inference."
    fi
}

main() {
    parse_args "$@"
    warn_ignored_flags
    resolve_model
    prepare_dirs
    download_model
    write_config
    print_summary
}

main "$@"
