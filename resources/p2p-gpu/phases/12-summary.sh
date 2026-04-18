#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Phase 12: Summary
# ============================================================================
# Part of: p2p-gpu/phases/
# Purpose: Print access info, connection methods, final success message
#
# Expects: DS_DIR, LOGFILE, log(), print_access_info(), _ts()
# Provides: User-facing summary of all access methods
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

step "Phase 12/12: Setup complete"

print_access_info "$DS_DIR"

echo "=== Setup completed at $(_ts) ===" >> "$LOGFILE" || :
log "Setup complete! Core services ready. Heavy services downloading in background."
