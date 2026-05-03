#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Phase 01: System Dependencies
# ============================================================================
# Part of: p2p-gpu/phases/
# Purpose: Install missing packages (git, curl, jq, aria2, acl, python3-yaml)
#
# Expects: LOGFILE, log()
# Provides: All required CLI tools available in PATH
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

step "Phase 1/12: Installing system dependencies"

pkgs_needed=()
for pkg in sudo git curl jq wget openssl aria2 procps iproute2 acl python3-yaml; do
  # python3-yaml is a library, check via python3 import
  if [[ "$pkg" == "python3-yaml" ]]; then
    python3 -c "import yaml" 2>&1 || pkgs_needed+=("$pkg")
    continue
  fi
  command -v "$pkg" &>/dev/null || pkgs_needed+=("$pkg")
done
# ss is part of iproute2
command -v ss &>/dev/null || pkgs_needed+=("iproute2")

# Vast.ai instances often ship with stale PPAs (e.g. graphics-drivers) that
# timeout during apt-get update and cause hard failures under set -e.
# The GPU driver is already installed — these PPAs are not needed.
for stale_ppa in graphics-drivers; do
  if ls /etc/apt/sources.list.d/${stale_ppa}* &>/dev/null; then
    rm -f /etc/apt/sources.list.d/${stale_ppa}*
    log "Removed stale PPA: ${stale_ppa} (not needed — driver already installed)"
  fi
done

# unattended-upgrades can hold the dpkg lock for minutes on fresh Vast.ai
# instances. Kill it rather than waiting 300s — these are ephemeral boxes.
if fuser /var/lib/dpkg/lock-frontend &>/dev/null; then
  log "dpkg lock held by another process — killing unattended-upgrades"
  killall -9 unattended-upgrades apt-get dpkg 2>>"$LOGFILE" || warn "killall did not find target processes (expected)"
  sleep 2
  dpkg --configure -a 2>>"$LOGFILE" || warn "dpkg --configure -a failed (non-fatal)"
fi

if [[ ${#pkgs_needed[@]} -gt 0 ]]; then
  # unattended-upgrades may briefly hold dpkg lock on fresh hosts.
  apt-get -o DPkg::Lock::Timeout="${APT_LOCK_TIMEOUT:-300}" update -qq 2>>"$LOGFILE"
  apt-get -o DPkg::Lock::Timeout="${APT_LOCK_TIMEOUT:-300}" install -y -qq "${pkgs_needed[@]}" 2>>"$LOGFILE"
  log "Installed: ${pkgs_needed[*]}"
else
  log "All dependencies already present"
fi
