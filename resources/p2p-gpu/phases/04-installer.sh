#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Phase 04: Run Upstream Installer
# ============================================================================
# Part of: p2p-gpu/phases/
# Purpose: Execute DreamServer's install.sh with timeout protection
#
# Expects: REPO_DIR, DREAM_USER, INSTALLER_TIMEOUT, log(), warn(), err()
# Provides: DreamServer installed (may be partial if timeout hit)
#
# Fixes covered: #25 (ComfyUI infinite hang), #26 (installer timeout)
#
# Modder notes:
#   Timeout is non-fatal. Heavy services (ComfyUI, Whisper) download in
#   background and are handled by later phases. We only cap the installer
#   wait loop, not the actual containers.
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

step "Phase 4/12: Running DreamServer installer"

warn "Running installer (${INSTALLER_TIMEOUT}s timeout)..."
warn "Heavy services (ComfyUI, Whisper, etc.) will continue after timeout."

install_exit=0
installer_pid=""

su - "$DREAM_USER" -c "cd ${REPO_DIR} && ./install.sh --non-interactive" &
installer_pid=$!

waited=0
while kill -0 "$installer_pid" 2>&1; do
  if [[ $waited -ge $INSTALLER_TIMEOUT ]]; then
    warn "Installer reached ${INSTALLER_TIMEOUT}s limit — proceeding with setup"
    kill -TERM "$installer_pid" || warn "could not TERM installer (non-fatal)"
    sleep 2
    kill -9 "$installer_pid" || warn "could not KILL installer (non-fatal)"
    # Child processes of the installer should die with their parent.
    # No pkill -f needed — TERM/KILL on the parent suffices.
    install_exit=124
    break
  fi
  sleep 5
  waited=$((waited + 5))
  (( waited % 60 == 0 )) && log "Installer running... (${waited}s / ${INSTALLER_TIMEOUT}s max)"
done

if [[ $install_exit -ne 124 ]]; then
  wait "$installer_pid" 2>&1 || install_exit=$?
fi

if [[ $install_exit -eq 0 ]]; then
  log "DreamServer installer completed successfully"
elif [[ $install_exit -eq 124 ]]; then
  log "Installer timed out (normal for heavy services) — continuing"
else
  warn "Installer exited with code ${install_exit} — applying fixes and continuing"
fi
