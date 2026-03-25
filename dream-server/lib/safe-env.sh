#!/usr/bin/env bash
# ============================================================================
# Dream Server — Safe environment loading (no eval)
# ============================================================================
# Scripts that need to load .env should use load_env_file from this script.
# Do not use eval or "export $(grep ... .env | xargs)" — they allow injection.
#
# - load_env_file <path>  — parse a .env file and export vars (safe keys, no eval)
# - load_env_from_output  — parse KEY="value" lines from stdin (for script output)
# ============================================================================

# Load a .env file safely: comments and empty lines skipped; key names must be
# valid identifiers; values may be unquoted or quoted; no eval or word-splitting.
load_env_file() {
    local path="$1"
    [[ -f "$path" ]] || return 0
    local line key value
    while IFS= read -r line || [[ -n "$line" ]]; do
        # Skip comments and blank lines
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ "$line" =~ ^[[:space:]]*$ ]] && continue
        # Split on first '=' only, preserve '=' in values (e.g. base64 padding)
        key="${line%%=*}"
        value="${line#*=}"
        # Trim whitespace from key
        key="${key#"${key%%[![:space:]]*}"}"
        key="${key%"${key##*[![:space:]]}"}"
        [[ -z "$key" ]] && continue
        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        # Strip optional surrounding quotes and one leading space
        value="${value# }"
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"
        value="${value#\'}"
        export "$key=$value"
    done < "$path"
}

load_env_from_output() {
    local line key value
    while IFS= read -r line; do
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=\"(.*)\"$ ]]; then
            key="${BASH_REMATCH[1]}"
            value="${BASH_REMATCH[2]}"
            # Unescape: \\ -> \, \" -> "
            value="${value//\\\\/\\}"
            value="${value//\\\"/\"}"
            export "$key=$value"
        fi
    done
}
