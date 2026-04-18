#!/bin/bash
# Shared installer helpers for platform dispatch.

set -euo pipefail

is_termux_shell() {
    [[ -n "${TERMUX_VERSION:-}" ]] && return 0
    [[ "${PREFIX:-}" == *"/com.termux/"* ]] && return 0
    [[ "${PREFIX:-}" == *"/com.termux/files/usr" ]] && return 0
    [[ -d "/data/data/com.termux/files/usr" ]] && return 0
    return 1
}

is_ashell_shell() {
    [[ "${TERM_PROGRAM:-}" == "a-Shell" ]] && return 0
    [[ "${TERM_PROGRAM:-}" == "a-Shell mini" ]] && return 0
    [[ -n "${ASHELL:-}" ]] && return 0
    [[ -n "${SHORTCUTS:-}" && "${OSTYPE:-}" == "darwin"* ]] && return 0
    if [[ "${OSTYPE:-}" == "darwin"* ]] && command -v pickFolder >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

detect_platform() {
    if [[ -n "${DREAM_PLATFORM_OVERRIDE:-}" ]]; then
        echo "$DREAM_PLATFORM_OVERRIDE"
    elif is_termux_shell; then
        echo "android-termux"
    elif is_ashell_shell; then
        echo "ios-ashell"
    elif [[ -f /proc/version ]] && grep -qi microsoft /proc/version 2>/dev/null; then
        echo "wsl"
    elif [[ "${OSTYPE:-}" == "msys"* || "${OSTYPE:-}" == "cygwin"* || "${OSTYPE:-}" == "win32"* ]]; then
        echo "windows"
    elif [[ "${OSTYPE:-}" == "darwin"* ]]; then
        echo "macos"
    elif [[ "${OSTYPE:-}" == "linux-gnu"* ]]; then
        echo "linux"
    else
        echo "unknown"
    fi
}
