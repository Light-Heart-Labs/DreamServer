#!/bin/bash
# retry.sh - Retry logic with exponential backoff
# Part of: lib/
# Purpose: Provide reusable retry functions for operations that may fail transiently
#
# Expects: Nothing (pure functions)
# Provides: retry_with_backoff()

# Retry a command with exponential backoff
# Usage: retry_with_backoff <max_attempts> <base_delay> <command> [args...]
# Returns: 0 if command succeeds within max_attempts, 1 otherwise
#
# Example: retry_with_backoff 3 2 curl -f https://example.com
#          Tries 3 times with delays: 2s, 4s, 8s
retry_with_backoff() {
    local max_attempts="${1:-3}"
    local base_delay="${2:-2}"
    shift 2

    local attempt=1
    local delay="$base_delay"

    while [[ $attempt -le $max_attempts ]]; do
        if "$@"; then
            return 0
        fi

        if [[ $attempt -lt $max_attempts ]]; then
            echo "Attempt $attempt/$max_attempts failed. Retrying in ${delay}s..." >&2
            sleep "$delay"
            delay=$((delay * 2))
        fi

        attempt=$((attempt + 1))
    done

    echo "All $max_attempts attempts failed" >&2
    return 1
}

# Retry a command with fixed delay
# Usage: retry_fixed <max_attempts> <delay> <command> [args...]
retry_fixed() {
    local max_attempts="${1:-3}"
    local delay="${2:-2}"
    shift 2

    local attempt=1

    while [[ $attempt -le $max_attempts ]]; do
        if "$@"; then
            return 0
        fi

        if [[ $attempt -lt $max_attempts ]]; then
            echo "Attempt $attempt/$max_attempts failed. Retrying in ${delay}s..." >&2
            sleep "$delay"
        fi

        attempt=$((attempt + 1))
    done

    echo "All $max_attempts attempts failed" >&2
    return 1
}
