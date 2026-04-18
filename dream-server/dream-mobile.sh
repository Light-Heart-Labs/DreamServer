#!/bin/sh
# Lightweight shell wrapper for Dream Server mobile preview.

if [ -z "${BASH_VERSION:-}" ]; then
    SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
    CONFIG_FILE="$SCRIPT_DIR/.dream-mobile.env"
    IOS_CONTAINER_PATTERN='^(/private)?/var/mobile/Containers/Data/Application/'
    if [ -f "$CONFIG_FILE" ] && grep -q 'DREAM_MOBILE_PLATFORM="ios-ashell"' "$CONFIG_FILE" 2>/dev/null; then
        exec sh "$SCRIPT_DIR/installers/mobile/ios-ashell-cli.sh" "$@"
    fi
    if [ "${TERM_PROGRAM:-}" = "a-Shell" ] || [ "${TERM_PROGRAM:-}" = "a-Shell mini" ] || [ -n "${ASHELL:-}" ]; then
        exec sh "$SCRIPT_DIR/installers/mobile/ios-ashell-cli.sh" "$@"
    fi
    if printf '%s\n' "$SCRIPT_DIR" | grep -Eq "$IOS_CONTAINER_PATTERN"; then
        exec sh "$SCRIPT_DIR/installers/mobile/ios-ashell-cli.sh" "$@"
    fi
    if printf '%s\n' "${HOME:-}" | grep -Eq "$IOS_CONTAINER_PATTERN"; then
        exec sh "$SCRIPT_DIR/installers/mobile/ios-ashell-cli.sh" "$@"
    fi
    if [ "$(uname -s 2>/dev/null || echo unknown)" = "Darwin" ] && [ -d /private/var/mobile/Containers/Data/Application ]; then
        exec sh "$SCRIPT_DIR/installers/mobile/ios-ashell-cli.sh" "$@"
    fi
    if command -v bash >/dev/null 2>&1; then
        exec bash "$0" "$@"
    fi
    echo "[error] dream-mobile.sh requires bash." >&2
    exit 1
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/.dream-mobile.env"
INSTALLER="$SCRIPT_DIR/installers/mobile/install-mobile.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log()     { echo -e "${CYAN}[dream-mobile]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC} $1"; }
fail()    { echo -e "${RED}[error]${NC} $1" >&2; exit 1; }

usage() {
    cat <<'EOF'
Dream Server Mobile Shell Preview

Usage:
  ./dream-mobile.sh install
  ./dream-mobile.sh status
  ./dream-mobile.sh chat
  ./dream-mobile.sh local
  ./dream-mobile.sh local-stop
  ./dream-mobile.sh prompt "sua pergunta"
  ./dream-mobile.sh export notes/brief.txt "gere um resumo claro deste repo"

Commands:
  install    Build the mobile runtime and download the preview model
  status     Show the current mobile runtime status
  chat       Open an interactive shell chat with the installed model
  local      Start the Android localhost UI and open it in the browser
  local-stop Stop the Android localhost UI if it is running
  prompt     Send one prompt and print the answer
  export     Generate a file with the model and save it under Downloads on Android
EOF
}

load_config() {
    [[ -f "$CONFIG_FILE" ]] || fail "Mobile preview is not installed yet. Run ./dream-mobile.sh install first."
    # shellcheck disable=SC1090
    source "$CONFIG_FILE"
}

require_runtime() {
    load_config
    [[ -x "${DREAM_MOBILE_LLAMA_CHAT_CLI:-${DREAM_MOBILE_LLAMA_CLI:-}}" ]] || fail "Mobile chat binary was not found at ${DREAM_MOBILE_LLAMA_CHAT_CLI:-${DREAM_MOBILE_LLAMA_CLI:-<unset>}}"
    [[ -f "${DREAM_MOBILE_MODEL_PATH:-}" ]] || fail "Model file was not found at ${DREAM_MOBILE_MODEL_PATH:-<unset>}"
}

require_android_runtime() {
    require_runtime
    [[ "${DREAM_MOBILE_PLATFORM:-}" == "android-termux" ]] || fail "This command is currently available only on Android / Termux."
}

resolve_python_bin() {
    if command -v python >/dev/null 2>&1; then
        echo "python"
        return 0
    fi
    if command -v python3 >/dev/null 2>&1; then
        echo "python3"
        return 0
    fi
    fail "python is required for the Android localhost UI. Re-run ./install.sh."
}

local_server_pid_file() {
    echo "$SCRIPT_DIR/.dream-mobile-local.pid"
}

local_server_log_file() {
    echo "$SCRIPT_DIR/.dream-mobile-local.log"
}

local_server_url() {
    echo "http://${DREAM_MOBILE_LOCAL_HOST:-127.0.0.1}:${DREAM_MOBILE_LOCAL_PORT:-8765}"
}

local_server_alive() {
    local pid_file pid
    pid_file="$(local_server_pid_file)"
    [[ -f "$pid_file" ]] || return 1
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    [[ -n "$pid" ]] || return 1
    kill -0 "$pid" 2>/dev/null
}

local_server_healthy() {
    local url
    url="$(local_server_url)"
    curl -fsS "$url/api/health" >/dev/null 2>&1
}

open_local_url() {
    local url
    url="$(local_server_url)"

    if command -v termux-open-url >/dev/null 2>&1; then
        termux-open-url "$url" >/dev/null 2>&1 &
        return 0
    fi

    echo "$url"
}

status() {
    require_runtime

    echo "Platform: ${DREAM_MOBILE_PLATFORM}"
    echo "Model:    ${DREAM_MOBILE_MODEL_NAME}"
    echo "File:     ${DREAM_MOBILE_MODEL_FILE}"
    echo "Context:  ${DREAM_MOBILE_CONTEXT}"
    echo "Threads:  ${DREAM_MOBILE_THREADS}"
    echo "Chat CLI: ${DREAM_MOBILE_LLAMA_CHAT_CLI:-${DREAM_MOBILE_LLAMA_CLI:-<unset>}}"
    if [[ -n "${DREAM_MOBILE_LLAMA_PROMPT_CLI:-}" ]]; then
        echo "Prompt:   ${DREAM_MOBILE_LLAMA_PROMPT_CLI}"
    fi
    echo "Path:     ${DREAM_MOBILE_MODEL_PATH}"
    if [[ -n "${DREAM_MOBILE_EXPORT_DIR:-}" ]]; then
        echo "Exports:  ${DREAM_MOBILE_EXPORT_DIR}"
    fi
    if [[ -n "${DREAM_MOBILE_EXPORT_MODE:-}" ]]; then
        echo "Mode:     ${DREAM_MOBILE_EXPORT_MODE}"
    fi
    if [[ -n "${DREAM_MOBILE_LOCAL_PORT:-}" ]]; then
        echo "Local UI: http://${DREAM_MOBILE_LOCAL_HOST:-127.0.0.1}:${DREAM_MOBILE_LOCAL_PORT}"
    fi
    success "Runtime looks ready"
}

interactive_chat() {
    require_runtime
    local thread_args=()
    if [[ -n "${DREAM_MOBILE_THREADS:-}" ]]; then
        thread_args=(-t "${DREAM_MOBILE_THREADS}")
    fi
    exec "${DREAM_MOBILE_LLAMA_CHAT_CLI:-${DREAM_MOBILE_LLAMA_CLI}}" \
        -m "${DREAM_MOBILE_MODEL_PATH}" \
        -c "${DREAM_MOBILE_CONTEXT}" \
        "${thread_args[@]}" \
        -ngl 0
}

one_prompt() {
    require_runtime
    [[ $# -gt 0 ]] || fail "Provide a prompt after 'prompt'."
    [[ -x "${DREAM_MOBILE_LLAMA_PROMPT_CLI:-}" ]] || fail "Mobile prompt binary was not found at ${DREAM_MOBILE_LLAMA_PROMPT_CLI:-<unset>}"

    local prompt_text output
    local thread_args=()
    if [[ -n "${DREAM_MOBILE_THREADS:-}" ]]; then
        thread_args=(-t "${DREAM_MOBILE_THREADS}")
    fi
    prompt_text="$*"
    output="$("${DREAM_MOBILE_LLAMA_PROMPT_CLI}" \
        -m "${DREAM_MOBILE_MODEL_PATH}" \
        "${thread_args[@]}" \
        -ngl 0 \
        -n 512 \
        "$prompt_text" 2>/dev/null)"

    output="${output#"$prompt_text"}"
    printf '%s\n' "${output#${output%%[![:space:]]*}}"
}

export_prompt() {
    require_android_runtime
    [[ $# -ge 2 ]] || fail "Usage: ./dream-mobile.sh export notes/output.txt \"o que voce quer gerar\""

    local relative_target="$1"
    shift

    [[ "$relative_target" != /* ]] || fail "Use a relative path inside the Android export directory."
    [[ ! "$relative_target" =~ (^|/)\.\.(/|$) ]] || fail "Parent path segments are not allowed in export targets."
    [[ -n "${DREAM_MOBILE_EXPORT_DIR:-}" ]] || fail "No export directory is configured for Android mobile preview."

    local target_path="$DREAM_MOBILE_EXPORT_DIR/$relative_target"
    local target_dir
    target_dir="$(dirname "$target_path")"
    mkdir -p "$target_dir"

    local export_prompt_text
    export_prompt_text=$'Write the requested deliverable directly.\nReturn only the final file contents.\nDo not add markdown fences, commentary, or role labels.\n\nRequest: '"$*"

    [[ -x "${DREAM_MOBILE_LLAMA_PROMPT_CLI:-}" ]] || fail "Mobile prompt binary was not found at ${DREAM_MOBILE_LLAMA_PROMPT_CLI:-<unset>}"

    local output
    local thread_args=()
    if [[ -n "${DREAM_MOBILE_THREADS:-}" ]]; then
        thread_args=(-t "${DREAM_MOBILE_THREADS}")
    fi
    output="$("${DREAM_MOBILE_LLAMA_PROMPT_CLI}" \
        -m "${DREAM_MOBILE_MODEL_PATH}" \
        "${thread_args[@]}" \
        -ngl 0 \
        -n 768 \
        "$export_prompt_text" 2>/dev/null)"

    output="${output#"$export_prompt_text"}"
    printf '%s' "${output#${output%%[![:space:]]*}}" > "$target_path"

    success "Saved generated file to $target_path"
    if [[ "${DREAM_MOBILE_EXPORT_MODE:-}" != "shared-downloads" ]]; then
        log "Shared Downloads is not configured yet. Run termux-setup-storage, then reinstall to export into Android Downloads."
    fi
}

local_ui() {
    require_android_runtime

    local server_script python_bin pid_file log_file url local_threads
    server_script="${DREAM_MOBILE_LOCAL_SERVER:-$SCRIPT_DIR/installers/mobile/android-local-server.py}"
    [[ -f "$server_script" ]] || fail "Android local UI server was not found at $server_script"
    python_bin="$(resolve_python_bin)"
    pid_file="$(local_server_pid_file)"
    log_file="$(local_server_log_file)"
    url="$(local_server_url)"
    local_threads="${DREAM_MOBILE_LOCAL_THREADS:-${DREAM_MOBILE_THREADS:-0}}"

    if [[ "$local_threads" =~ ^[0-9]+$ ]] && (( local_threads > 2 )); then
        local_threads=2
    fi

    if local_server_alive && local_server_healthy; then
        success "Android local UI is already running at $url"
        open_local_url >/dev/null 2>&1 || true
        return 0
    fi

    if local_server_alive; then
        kill "$(cat "$pid_file")" >/dev/null 2>&1 || true
        rm -f "$pid_file"
    fi

    nohup "$python_bin" "$server_script" \
        --host "${DREAM_MOBILE_LOCAL_HOST:-127.0.0.1}" \
        --port "${DREAM_MOBILE_LOCAL_PORT:-8765}" \
        --model "${DREAM_MOBILE_MODEL_PATH}" \
        --chat-bin "${DREAM_MOBILE_LLAMA_CHAT_CLI:-${DREAM_MOBILE_LLAMA_CLI}}" \
        --context "${DREAM_MOBILE_CONTEXT}" \
        --threads "${local_threads}" \
        --export-dir "${DREAM_MOBILE_EXPORT_DIR:-$SCRIPT_DIR/data/exports/mobile}" \
        --project-root "$SCRIPT_DIR" >"$log_file" 2>&1 &

    echo $! > "$pid_file"

    local i
    for i in $(seq 1 40); do
        if local_server_healthy; then
            success "Android local UI is ready at $url"
            open_local_url >/dev/null 2>&1 || true
            return 0
        fi
        sleep 1
    done

    echo "[error] Android local UI failed to start. Recent log output:" >&2
    tail -n 40 "$log_file" >&2 || true
    exit 1
}

stop_local_ui() {
    require_android_runtime
    local pid_file pid
    pid_file="$(local_server_pid_file)"
    [[ -f "$pid_file" ]] || fail "Android local UI is not running."
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    [[ -n "$pid" ]] || fail "Android local UI PID file is empty."
    kill "$pid" >/dev/null 2>&1 || true
    rm -f "$pid_file"
    success "Android local UI stopped"
}

cmd="${1:-status}"
case "$cmd" in
    install)
        shift
        exec bash "$INSTALLER" "$@"
        ;;
    status)
        shift
        status "$@"
        ;;
    chat)
        shift
        interactive_chat "$@"
        ;;
    prompt)
        shift
        one_prompt "$@"
        ;;
    export)
        shift
        export_prompt "$@"
        ;;
    local)
        shift
        local_ui "$@"
        ;;
    local-stop)
        shift
        stop_local_ui "$@"
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        fail "Unknown command: $cmd"
        ;;
esac
