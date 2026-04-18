#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Phase 05: Post-Install Fixes
# ============================================================================
# Part of: p2p-gpu/phases/
# Purpose: Locate active dream-server directory, apply all post-install fixes
#
# Expects: DREAM_HOME, REPO_DIR, GPU_BACKEND, DREAM_USER,
#          log(), warn(), err(), find_dream_dir(), fix_ownership(),
#          apply_post_install_fixes()
# Provides: DS_DIR (active dream-server path)
#
# Fixes covered: #03 (/tmp), #04 (CPU overflow), #05 (n8n uid), #06 (dashboard-api),
#                #07 (comfyui write), #08 (WEBUI_SECRET), #15 (.env dupes)
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

step "Phase 5/12: Locating directory & applying fixes"

DS_DIR=$(find_dream_dir) || {
  err "Could not find dream-server directory after install"
  err "Expected at: ${DREAM_HOME}/dream-server or ${REPO_DIR}/dream-server"
  exit 1
}

log "Active directory: ${DS_DIR}"
fix_ownership "$DS_DIR" "$DREAM_USER"

apply_post_install_fixes "$DS_DIR" "$GPU_BACKEND"

# Fix secondary directory if dual-install occurred
alt_dir=""
if [[ "$DS_DIR" == "${DREAM_HOME}/dream-server" && -d "${REPO_DIR}/dream-server" ]]; then
  alt_dir="${REPO_DIR}/dream-server"
elif [[ "$DS_DIR" == "${REPO_DIR}/dream-server" && -d "${DREAM_HOME}/dream-server" ]]; then
  alt_dir="${DREAM_HOME}/dream-server"
fi

if [[ -n "$alt_dir" && -f "${alt_dir}/.env" ]]; then
  apply_post_install_fixes "$alt_dir" "$GPU_BACKEND"
  log "Also fixed secondary directory: ${alt_dir}"
fi
