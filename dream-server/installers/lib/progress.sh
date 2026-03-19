#!/bin/bash
# ============================================================================
# Dream Server Installer — GUI Progress Protocol
# ============================================================================
# Part of: installers/lib/
# Purpose: Emit structured progress events for the Tauri GUI installer
#
# Expects: DREAM_INSTALLER_GUI (optional env var, set by Tauri)
# Provides: dream_progress()
#
# Modder notes:
#   When DREAM_INSTALLER_GUI=1, progress lines are emitted to stdout in a
#   machine-readable format. When unset, this is a complete no-op.
#   Format: DREAM_PROGRESS:<percent>:<phase_id>:<human_message>
# ============================================================================

dream_progress() {
  local percent="$1"
  local phase="$2"
  local message="$3"

  if [[ "${DREAM_INSTALLER_GUI:-0}" == "1" ]]; then
    echo "DREAM_PROGRESS:${percent}:${phase}:${message}"
  fi
}
