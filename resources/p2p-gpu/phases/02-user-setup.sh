#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Phase 02: User Setup
# ============================================================================
# Part of: p2p-gpu/phases/
# Purpose: Create dream user, configure sudo/docker group, copy SSH keys
#
# Expects: DREAM_USER, DREAM_HOME, log(), warn()
# Provides: Non-root 'dream' user ready for DreamServer install
#
# Fixes covered: #01 (root user rejection), #02 (Docker socket denied)
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

step "Phase 2/12: Creating user '${DREAM_USER}'"

if id -u "$DREAM_USER" &>/dev/null; then
  log "User '${DREAM_USER}' already exists"
else
  useradd -m -s /bin/bash -u 1000 "$DREAM_USER" 2>&1 || \
    useradd -m -s /bin/bash "$DREAM_USER"
  log "User '${DREAM_USER}' created"
fi

# Sudo access
usermod -aG sudo "$DREAM_USER" || warn "sudo group add failed (non-fatal)"
echo "${DREAM_USER} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-dream
chmod 440 /etc/sudoers.d/90-dream

# Docker group
if getent group docker &>/dev/null; then
  usermod -aG docker "$DREAM_USER"
  log "Added ${DREAM_USER} to docker group"
fi

# Copy SSH keys for direct user access
if [[ -d /root/.ssh && ! -d "${DREAM_HOME}/.ssh" ]]; then
  cp -r /root/.ssh "${DREAM_HOME}/.ssh"
  chown -R "${DREAM_USER}:${DREAM_USER}" "${DREAM_HOME}/.ssh"
  chmod 700 "${DREAM_HOME}/.ssh"
  find "${DREAM_HOME}/.ssh" -type f -exec chmod 600 {} + || warn "ssh key chmod failed (non-fatal)"
fi

log "User configured"
