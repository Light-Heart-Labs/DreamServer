#!/bin/sh
# Dream Server Installer entrypoint (PR-1 dispatcher)
# Pass-through options (implemented in install-core.sh):
# --dry-run --skip-docker --force --tier --voice --workflows --rag
# --openclaw --all --non-interactive --no-bootstrap --bootstrap --offline

if [ -z "${BASH_VERSION:-}" ]; then
    SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
    CONFIG_FILE="$SCRIPT_DIR/.dream-mobile.env"
    IOS_CONTAINER_PATTERN='^(/private)?/var/mobile/Containers/Data/Application/'

    if [ -f "$CONFIG_FILE" ] && grep -q 'DREAM_MOBILE_PLATFORM="ios-ashell"' "$CONFIG_FILE" 2>/dev/null; then
        sh "$SCRIPT_DIR/installers/mobile/install-mobile.sh" "$@"
        exit $?
    fi
    if [ "${TERM_PROGRAM:-}" = "a-Shell" ] || [ "${TERM_PROGRAM:-}" = "a-Shell mini" ] || [ -n "${ASHELL:-}" ]; then
        sh "$SCRIPT_DIR/installers/mobile/install-mobile.sh" "$@"
        exit $?
    fi
    if printf '%s\n' "$SCRIPT_DIR" | grep -Eq "$IOS_CONTAINER_PATTERN"; then
        sh "$SCRIPT_DIR/installers/mobile/install-mobile.sh" "$@"
        exit $?
    fi
    if printf '%s\n' "${HOME:-}" | grep -Eq "$IOS_CONTAINER_PATTERN"; then
        sh "$SCRIPT_DIR/installers/mobile/install-mobile.sh" "$@"
        exit $?
    fi
    if [ "$(uname -s 2>/dev/null || echo unknown)" = "Darwin" ] && [ -d /private/var/mobile/Containers/Data/Application ]; then
        sh "$SCRIPT_DIR/installers/mobile/install-mobile.sh" "$@"
        exit $?
    fi

    if command -v bash >/dev/null 2>&1; then
        exec bash "$0" "$@"
    fi

    echo "[ERROR] This installer needs bash on this platform." >&2
    echo "        On iOS a-Shell, use the POSIX shell preview path instead:" >&2
    echo "        sh ./install.sh" >&2
    exit 1
fi

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/installers/dispatch.sh"

target="$(resolve_installer_target)"

case "$target" in
    unsupported:unknown)
        echo "[ERROR] Unsupported OS for this installer entrypoint."
        echo "        See docs/SUPPORT-MATRIX.md for supported platforms."
        exit 1
        ;;
    *)
        if [[ ! -f "$target" ]]; then
            echo "[ERROR] Installer target not found: $target"
            exit 1
        fi
        case "$target" in
            *.ps1)
                echo "[INFO] Windows installer target: $target"
                if command -v pwsh >/dev/null 2>&1; then
                    exec pwsh -File "$target" "$@"
                else
                    echo "[ERROR] PowerShell (pwsh) not found in this shell."
                    echo "        Run this from Windows PowerShell instead:"
                    echo "        .\\install.ps1"
                    exit 1
                fi
                ;;
            *)
                exec bash "$target" "$@"
                ;;
        esac
        ;;
esac
