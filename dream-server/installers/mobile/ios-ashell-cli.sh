#!/bin/sh
# ============================================================================
# Dream Server iOS / a-Shell CLI Preview
# ============================================================================

set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
CONFIG_FILE="$ROOT_DIR/.dream-mobile.env"
INSTALLER="$ROOT_DIR/installers/mobile/ios-ashell-install.sh"

RED='[0;31m'
GREEN='[0;32m'
CYAN='[0;36m'
NC='[0m'

success() { printf '%s[ok]%s %s\n' "$GREEN" "$NC" "$1"; }
fail()    { printf '%s[error]%s %s\n' "$RED" "$NC" "$1" >&2; exit 1; }

usage() {
    cat <<'EOF'
Dream Server iOS / a-Shell Preview

Usage:
  sh ./dream-mobile.sh install
  sh ./dream-mobile.sh status
  sh ./dream-mobile.sh chat

Commands:
  install      Set up the iOS preview files and download the default model
  status       Show the current iOS runtime status
  chat         Open the fast interactive local chat
EOF
}

load_config() {
    [ -f "$CONFIG_FILE" ] || fail "iOS preview is not installed yet. Run 'sh ./install.sh' first."
    # shellcheck disable=SC1090
    . "$CONFIG_FILE"
}

require_config_var() {
    var_name="$1"
    eval "var_value=\${$var_name-}"
    [ -n "$var_value" ] || fail "iOS preview config is incomplete: missing $var_name. Run 'sh ./install.sh' again."
}

local_wasm_ready() {
    [ "${DREAM_MOBILE_WASM_READY:-false}" = "true" ] || return 1
    command -v "${DREAM_MOBILE_WASM_RUNNER:-wasm}" >/dev/null 2>&1 || return 1
    [ -f "${DREAM_MOBILE_WASM_BINARY:-}" ] || return 1
    [ -f "${DREAM_MOBILE_MODEL_PATH:-}" ] || return 1
    return 0
}

status() {
    load_config
    require_config_var DREAM_MOBILE_PLATFORM
    require_config_var DREAM_MOBILE_MODE
    require_config_var DREAM_MOBILE_ENGINE
    require_config_var DREAM_MOBILE_MODEL_NAME
    require_config_var DREAM_MOBILE_MODEL_PATH

    echo "Platform:  ${DREAM_MOBILE_PLATFORM}"
    echo "Mode:      ${DREAM_MOBILE_MODE}"
    echo "Engine:    ${DREAM_MOBILE_ENGINE}"
    echo "Model:     ${DREAM_MOBILE_MODEL_NAME}"
    echo "Model file:${DREAM_MOBILE_MODEL_PATH}"
    echo "Context:   ${DREAM_MOBILE_CONTEXT}"
    echo "Chat tok:  ${DREAM_MOBILE_CHAT_REPLY_TOKENS:-64}"
    echo "History:   ${DREAM_MOBILE_HISTORY_MESSAGES:-1} turns"
    echo "Downloaded:${DREAM_MOBILE_MODEL_DOWNLOADED}"
    echo "Wasm bin:  ${DREAM_MOBILE_WASM_BINARY}"
    echo "Wasm ready:${DREAM_MOBILE_WASM_READY}"
    success "iOS preview config loaded"
}

interactive_chat() {
    load_config
    if ! local_wasm_ready; then
        fail "Interactive chat on iOS still needs a linked wasm runtime at ${DREAM_MOBILE_WASM_BINARY:-<unset>}."
    fi

    exec "${DREAM_MOBILE_WASM_RUNNER}" "${DREAM_MOBILE_WASM_BINARY}" \
        -m "${DREAM_MOBILE_MODEL_PATH}" \
        -c "${DREAM_MOBILE_CONTEXT:-2048}" \
        -n "${DREAM_MOBILE_CHAT_REPLY_TOKENS:-64}" \
        --history "${DREAM_MOBILE_HISTORY_MESSAGES:-1}" \
        --fast-chat \
        -i
}

cmd="${1:-status}"
case "$cmd" in
    install)
        shift
        exec sh "$INSTALLER" "$@"
        ;;
    status)
        shift
        status "$@"
        ;;
    chat)
        shift
        interactive_chat "$@"
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        fail "Unknown command: $cmd"
        ;;
esac
