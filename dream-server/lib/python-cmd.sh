#!/usr/bin/env bash

# Dream Server: Python command resolver
# Goal: Prefer python3 when available, but gracefully fall back to python (common on some Windows setups).
# This file is sourced by other scripts, so it must not change the caller's shell options.

_ds_python_cmd_cached=""

# Prints the python command name to stdout.
# Order:
#  1) python3 (must be runnable)
#  2) python  (must be runnable)
# Exits non-zero if neither works.
ds_detect_python_cmd() {
    if [[ -n "${_ds_python_cmd_cached}" ]]; then
        printf '%s' "${_ds_python_cmd_cached}"
        return 0
    fi

    if command -v python3 >/dev/null 2>&1; then
        if python3 -c 'import sys; sys.exit(0)' >/dev/null 2>&1; then
            _ds_python_cmd_cached="python3"
            printf '%s' "${_ds_python_cmd_cached}"
            return 0
        fi
    fi

    if command -v python >/dev/null 2>&1; then
        if python -c 'import sys; sys.exit(0)' >/dev/null 2>&1; then
            _ds_python_cmd_cached="python"
            printf '%s' "${_ds_python_cmd_cached}"
            return 0
        fi
    fi

    echo "ERROR: Neither python3 nor python is available/runnable." >&2
    return 1
}
