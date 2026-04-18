#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Phase 08: Vast.ai Quirks
# ============================================================================
# Part of: p2p-gpu/phases/
# Purpose: No-systemd workaround, /dev/shm remount, OpenCode crash-loop fix
#
# Expects: DS_DIR, DREAM_USER, log(), warn()
# Provides: Vast.ai-specific environment fixes applied
#
# Fixes covered: #18 (/dev/shm), #21 (no systemd), #22 (OpenCode crash-loop),
#                #24 (/dev/shm too small)
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

step "Phase 8/12: Applying Vast.ai-specific fixes"

# ── No systemd ─────────────────────────────────────────────────────────────
if ! command -v systemctl &>/dev/null && ! pidof systemd &>/dev/null; then
  log "No systemd detected — Vast.ai environment confirmed"
  dream_cli="${DS_DIR}/dream-cli"
  if [[ -x "$dream_cli" ]]; then
    su - "$DREAM_USER" -c "cd ${DS_DIR} && ./dream-cli agent start" 2>&1 || \
      warn "Host agent start failed (non-fatal — dashboard may have limited features)"
  fi
fi

# ── OpenCode crash-loop disable ────────────────────────────────────────────
if docker ps -a --format '{{.Names}} {{.Status}}' 2>&1 | grep -q 'dream-opencode.*Restarting'; then
  warn "OpenCode is crash-looping — disabling to unblock other services"
  dream_cli="${DS_DIR}/dream-cli"
  if [[ -x "$dream_cli" ]]; then
    su - "$DREAM_USER" -c "cd ${DS_DIR} && ./dream-cli disable opencode" 2>&1 \
      || warn "dream-cli disable opencode failed (non-fatal)"
  else
    docker stop dream-opencode || warn "opencode stop failed (non-fatal)"
    docker rm dream-opencode || warn "opencode rm failed (non-fatal)"
  fi
fi

# ── Shared memory fix ─────────────────────────────────────────────────────
shm_size_kb=$(df /dev/shm 2>&1 | awk 'NR==2{print $2}' || echo 0)
if [[ "${shm_size_kb:-0}" -lt 1048576 ]]; then
  shm_mb=$(( shm_size_kb / 1024 ))
  warn "/dev/shm is only ${shm_mb} MB — GPU containers may be memory-starved"
  mount -o remount,size=4G /dev/shm || warn "/dev/shm remount failed (non-fatal)"
fi

# ── Pre-pull Docker images ─────────────────────────────────────────────────
prepull_docker_images "$DS_DIR"

log "Vast.ai environment fixes applied"
