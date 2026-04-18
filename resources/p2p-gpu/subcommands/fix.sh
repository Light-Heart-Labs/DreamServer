#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Subcommand: fix
# ============================================================================
# Part of: p2p-gpu/subcommands/
# Purpose: Apply fixes without full reinstall (port rebind, network fix,
#          CPU cap, permissions, service restart)
#
# Expects: log(), warn(), err(), find_dream_dir(), detect_gpu_backend(),
#          expose_ports_for_vastai(), apply_post_install_fixes(),
#          start_services(), ensure_whisper_asr_model(), ensure_tts_model_ready(),
#          generate_ssh_tunnel_script(),
#          generate_powershell_tunnel_script(), print_access_info(),
#          get_compose_cmd()
# Provides: All runtime fixes applied and services restarted
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

  cmd_fix() {
  step "Applying fixes (no reinstall)"
  local ds_dir
  ds_dir=$(find_dream_dir) || { err "DreamServer directory not found. Run full install first."; exit 1; }

  cd "$ds_dir"
  local gpu_backend
  gpu_backend=$(detect_gpu_backend)

  expose_ports_for_vastai "$ds_dir"

  # Fix stale Docker network
  if docker network inspect dream-network >/dev/null 2>&1; then
    local net_label
    net_label=$(docker network inspect dream-network \
      --format '{{index .Labels "com.docker.compose.network"}}' 2>&1 || echo "")
    if [[ -z "$net_label" ]]; then
      log "Fixing stale dream-network..."
      local compose_cmd
      compose_cmd=$(get_compose_cmd)
      if [[ "$compose_cmd" == "docker compose" ]]; then
        docker compose down 2>&1 || warn "compose down failed (non-fatal)"
      else
        docker-compose down 2>&1 || warn "compose down failed (non-fatal)"
      fi
      for cid in $(docker network inspect dream-network \
        -f '{{range .Containers}}{{.Name}} {{end}}' 2>&1 || echo ""); do
        docker network disconnect -f dream-network "$cid" || warn "disconnect ${cid} failed (non-fatal)"
      done
      docker network rm dream-network || warn "network rm failed (non-fatal)"
      log "Stale network removed — compose will recreate on next start"
    fi
  fi

  apply_post_install_fixes "$ds_dir" "$gpu_backend"

  log "Fixes applied. Restarting services..."
  start_services "$ds_dir"
  ensure_whisper_asr_model "$ds_dir"
  ensure_tts_model_ready "$ds_dir"

  generate_ssh_tunnel_script "$ds_dir"
  generate_powershell_tunnel_script "$ds_dir"

  print_access_info "$ds_dir"
  log "Fix complete!"
}
