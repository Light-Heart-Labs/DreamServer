#!/bin/bash
# checkpoint.sh - Installer checkpoint/resume system
# Part of: lib/
# Purpose: Save installer state and resume from last successful phase
#
# Expects: INSTALL_DIR, INSTALL_PHASE (set by install-core.sh)
# Provides: checkpoint_save(), checkpoint_load(), checkpoint_prompt_resume(), checkpoint_clear(), checkpoint_migrate()
#
# Idempotency notes:
#   Phases 01-04 (preflight, detection, features, requirements) perform system
#   detection and validation. These are safe to re-run but may produce different
#   results if system state changed. Phases 05+ (docker, directories, devtools,
#   images, offline, amd-tuning, services, health, summary) are generally
#   idempotent and safe to resume from.
#
# Checkpoint location strategy:
#   Phases 1-5: Use temp location (INSTALL_DIR doesn't exist yet)
#   Phase 6+: Migrate to final location inside INSTALL_DIR

# Temp checkpoint for phases 1-5 (before INSTALL_DIR is created)
CHECKPOINT_TEMP="${HOME}/.cache/dream-server-install-checkpoint"

# Final checkpoint location (phases 6+)
CHECKPOINT_FINAL="${INSTALL_DIR}/.install-checkpoint"

# Get active checkpoint file path (temp if INSTALL_DIR doesn't exist, final otherwise)
_checkpoint_path() {
    if [[ -d "$INSTALL_DIR" ]]; then
        echo "$CHECKPOINT_FINAL"
    else
        echo "$CHECKPOINT_TEMP"
    fi
}

# Save checkpoint after successful phase
checkpoint_save() {
    # Skip checkpoint in dry-run mode (no state should be written)
    if [[ "${DRY_RUN:-false}" == "true" ]]; then
        return 0
    fi

    local phase="$1"
    local timestamp
    timestamp=$(date +%s)
    local checkpoint_file
    checkpoint_file=$(_checkpoint_path)

    # Ensure parent directory exists
    mkdir -p "$(dirname "$checkpoint_file")"

    cat > "$checkpoint_file" << EOF
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
    local checkpoint_file=""

    # Check final location first, then temp location
    if [[ -f "$CHECKPOINT_FINAL" ]]; then
        checkpoint_file="$CHECKPOINT_FINAL"
    elif [[ -f "$CHECKPOINT_TEMP" ]]; then
        checkpoint_file="$CHECKPOINT_TEMP"
    else
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
    done < "$checkpoint_file"

    # Validate checkpoint
    if [[ -z "$last_phase" || -z "$timestamp" ]]; then
        warn "Invalid checkpoint file, starting fresh"
        return 1
    fi

    # Validate INSTALL_DIR hasn't changed
    if [[ -n "$saved_dir" && "$saved_dir" != "$INSTALL_DIR" ]]; then
        warn "Install directory changed (was: $saved_dir, now: $INSTALL_DIR), starting fresh"
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

# Migrate checkpoint from temp to final location (called in phase 6 after INSTALL_DIR is created)
checkpoint_migrate() {
    if [[ -f "$CHECKPOINT_TEMP" && -d "$INSTALL_DIR" ]]; then
        mv "$CHECKPOINT_TEMP" "$CHECKPOINT_FINAL"
        log "Checkpoint migrated to $INSTALL_DIR"
    fi
}

# Clear checkpoint after successful installation
checkpoint_clear() {
    local cleared=false
    if [[ -f "$CHECKPOINT_FINAL" ]]; then
        rm -f "$CHECKPOINT_FINAL"
        cleared=true
    fi
    if [[ -f "$CHECKPOINT_TEMP" ]]; then
        rm -f "$CHECKPOINT_TEMP"
        cleared=true
    fi
    if $cleared; then
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
