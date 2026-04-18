#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Subcommand: resume
# ============================================================================
# Part of: p2p-gpu/subcommands/
# Purpose: Quick restart — re-apply fixes and start services
#
# Expects: log(), warn(), err(), find_dream_dir(), detect_gpu_backend(),
#          apply_post_install_fixes(), start_services(),
#          ensure_whisper_asr_model(), ensure_tts_model_ready(),
#          generate_ssh_tunnel_script(), generate_powershell_tunnel_script(),
#          print_access_info()
# Provides: Running DreamServer with latest fixes applied
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

cmd_resume() {
  step "Resuming DreamServer"
  local ds_dir
  ds_dir=$(find_dream_dir) || { err "DreamServer directory not found"; exit 1; }

  cd "$ds_dir"
  local gpu_backend
  gpu_backend=$(detect_gpu_backend)

  apply_post_install_fixes "$ds_dir" "$gpu_backend"
  start_services "$ds_dir"
  ensure_whisper_asr_model "$ds_dir"
  ensure_tts_model_ready "$ds_dir"
  generate_ssh_tunnel_script "$ds_dir"
  generate_powershell_tunnel_script "$ds_dir"
  print_access_info "$ds_dir"
}
