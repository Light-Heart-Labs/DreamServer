#!/bin/bash
# checkpoint.sh - Installer checkpoint/resume system
# Part of: lib/
# Purpose: Save installer state and resume from last successful phase
#
# Expects: INSTALL_DIR, INSTALL_PHASE (set by install-core.sh)
# Provides: checkpoint_save(), checkpoint_load(), checkpoint_prompt_resume(), checkpoint_clear()
#
# Idempotency notes:
#   Phases 01-04 (preflight, detection, features, requirements) perform system
#   detection and validation. These are safe to re-run but may produce different
#   results if system state changed. Phases 05+ (docker, directories, devtools,
#   images, offline, amd-tuning, services, health, summary) are generally
#   idempotent and safe to resume from.

CHECKPOINT_FILE="${INSTALL_DIR}/.install-checkpoint"

# Save checkpoint after successful phase
checkpoint_save() {
    local phase="$1"
    local timestamp
    timestamp=$(date +%s)

    cat > "$CHECKPOINT_FILE" << EOF
LAST_PHASE=$phase
TIMESTAMP=$timestamp
INSTALL_DIR=$INSTALL_DIR
VERSION=${DS_VERSION:-unknown}
EOF

    log "Checkpoint saved: phase $phase"
}

# Load checkpoint from previous installation
# Returns: echoes last phase number to stdout, returns 0 on success, 1 on failure
checkpoint_load() {
    if [[ ! -f "$CHECKPOINT_FILE" ]]; then
        return 1
    fi

    # Source checkpoint file safely
    local last_phase=""
    local timestamp=""
    local saved_dir=""
    local saved_version=""

    while IFS='=' read -r key value; do
        case "$key" in
            LAST_PHASE) last_phase="$value" ;;
            TIMESTAMP) timestamp="$value" ;;
            INSTALL_DIR) saved_dir="$value" ;;
            VERSION) saved_version="$value" ;;
        esac
    done < "$CHECKPOINT_FILE"

    # Validate checkpoint
    if [[ -z "$last_phase" || -z "$timestamp" ]]; then
        warn "Invalid checkpoint file, starting fresh"
        return 1
    fi

    # Check if checkpoint is stale (>24 hours)
    local now
    now=$(date +%s)
    local age=$((now - timestamp))
    if [[ $age -gt 86400 ]]; then
        warn "Checkpoint is stale (>24 hours old), starting fresh"
        return 1
    fi

    echo "$last_phase"
    return 0
}

# Clear checkpoint after successful installation
checkpoint_clear() {
    if [[ -f "$CHECKPOINT_FILE" ]]; then
        rm -f "$CHECKPOINT_FILE"
        log "Checkpoint cleared"
    fi
}

# Prompt user if they want to resume from checkpoint
# Must be called in parent shell (not in command substitution) to allow user input
# Returns: 0 if user wants to resume, 1 if not
checkpoint_prompt_resume() {
    local last_phase

    # Load checkpoint (this doesn't prompt, just validates)
    if ! last_phase=$(checkpoint_load); then
        return 1
    fi

    # Ask user if they want to resume (interactive mode only)
    if [[ "${INTERACTIVE:-true}" == "true" ]]; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "Previous installation detected (stopped at phase $last_phase)"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        read -rp "Resume from phase $last_phase? [Y/n] " response </dev/tty
        if [[ "$response" =~ ^[Nn]$ ]]; then
            checkpoint_clear
            return 1
        fi
    fi

    return 0
}

# Get next phase number after checkpoint
checkpoint_next_phase() {
    local last_phase="$1"
    echo $((last_phase + 1))
}
