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

if [[ ${#pkgs_needed[@]} -gt 0 ]]; then
  apt-get update -qq 2>>"$LOGFILE"
  apt-get install -y -qq "${pkgs_needed[@]}" 2>>"$LOGFILE"
  log "Installed: ${pkgs_needed[*]}"
else
  log "All dependencies already present"
fi
