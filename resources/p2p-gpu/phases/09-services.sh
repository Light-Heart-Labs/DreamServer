#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Phase 09: Services & Health Check
# ============================================================================
# Part of: p2p-gpu/phases/
# Purpose: Start all services, run health-check loop with llama-server
#          diagnostics, report per-service status
#
# Expects: DS_DIR, GPU_BACKEND, LOGFILE, log(), warn(), err(),
#          env_get(), env_set(), start_services(), discover_all_services()
# Provides: Running DreamServer stack with status report
#
# Fixes covered: #10 (Dashboard stuck), #20 (llama-server hang),
#                #23 (CUDA OOM), #25 (ComfyUI hang)
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

step "Phase 9/12: Starting services"

# Multi-GPU: run topology detection and GPU-to-service assignment before startup
if [[ "${GPU_COUNT:-0}" -ge "${MULTIGPU_MIN_GPUS:-2}" ]]; then
  run_gpu_assignment "$DS_DIR" "${DS_DIR}/.env"
fi

start_services "$DS_DIR"

# ── Health-check loop with llama-server diagnostics ─────────────────────────
_run_health_check() {
  local env_file="${DS_DIR}/.env"
  local models_dir="${DS_DIR}/data/models"
  local max_wait=120 elapsed=0 llama_diagnosed=false

  echo -n "  Waiting for services "
  while [[ $elapsed -lt $max_wait ]]; do
    local healthy running
    healthy=$(docker ps --filter "health=healthy" --format '{{.Names}}' | wc -l)
    running=$(docker ps --format '{{.Names}}' | wc -l)
    echo -n "."

    if [[ $healthy -ge 3 ]]; then
      echo ""
      log "Core services healthy (${healthy}/${running} containers)"
      return 0
    fi

    # Diagnose llama-server at 45s mark
    if [[ $elapsed -ge 45 && "$llama_diagnosed" != "true" ]]; then
      llama_diagnosed=true
      _diagnose_llama "$env_file" "$models_dir"
    fi

    sleep 5
    elapsed=$((elapsed + 5))
  done

  echo ""
  warn "Health-check timeout (${max_wait}s) — some services may still be starting"
}

_diagnose_llama() {
  local env_file="$1" models_dir="$2"
  local llama_status
  llama_status=$(docker inspect --format '{{.State.Status}}' dream-llama-server 2>&1 || echo "missing")

  [[ "$llama_status" != "restarting" ]] && return 0

  echo ""
  warn "llama-server is crash-looping — diagnosing..."
  local llama_logs
  llama_logs=$(docker logs --tail 20 dream-llama-server 2>&1 || echo "")

  if echo "$llama_logs" | grep -qi "CUDA out of memory\|out of memory\|OOM"; then
    _handle_oom "$env_file" "$models_dir"
  elif echo "$llama_logs" | grep -qi "No such file\|model file not found\|failed to load"; then
    _handle_missing_model "$env_file" "$models_dir"
  elif echo "$llama_logs" | grep -qi "address already in use\|bind failed"; then
    err "Port conflict on llama-server port!"
    warn "Check: ss -tlnp | grep :8080"
  fi
}

_handle_oom() {
  local env_file="$1" models_dir="$2"
  err "Model too large for GPU VRAM!"
  warn "Switching to smallest bootstrap model..."

  local tiny_url="https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf"
  local tiny_name="Qwen3-0.6B-Q4_K_M.gguf"
  if [[ ! -f "${models_dir}/${tiny_name}" ]]; then
    aria2c -x 8 -s 8 -d "$models_dir" -o "$tiny_name" "$tiny_url" 2>&1 || \
      curl -sL -o "${models_dir}/${tiny_name}" "$tiny_url"
  fi
  env_set "$env_file" "GGUF_FILE" "$tiny_name"
  docker restart dream-llama-server || warn "llama-server restart failed (non-fatal)"
  echo -n "  Retrying with smaller model "
}

_handle_missing_model() {
  local env_file="$1" models_dir="$2"
  err "Model file not found by llama-server!"
  local current_gguf
  current_gguf=$(env_get "$env_file" "GGUF_FILE")
  if [[ -n "$current_gguf" && ! -f "${models_dir}/${current_gguf}" ]]; then
    warn "GGUF_FILE='${current_gguf}' does not exist in ${models_dir}/"
    local fallback
    fallback=$(find "$models_dir" -name "*.gguf" -size +50M 2>&1 | head -1 | xargs -r basename || echo "")
    if [[ -n "$fallback" ]]; then
      env_set "$env_file" "GGUF_FILE" "$fallback"
      docker restart dream-llama-server || warn "llama-server restart failed (non-fatal)"
      warn "Switched to ${fallback}"
    fi
  fi
}

_run_health_check

# ── Service status report ──────────────────────────────────────────────────
_report_service_status() {
  echo ""
  echo -e "${BOLD}Service Status:${NC}"
  echo ""

  local -a core_services=(llama-server open-webui dashboard dashboard-api)
  local -a heavy_services=()
  local -a normal_services=()

  while IFS='|' read -r sid _pe _pd _name _cat _proxy startup _cname; do
    [[ -z "$sid" ]] && continue
    case "$sid" in open-webui|dashboard|dashboard-api) continue ;; esac
    if [[ "$startup" == "heavy" ]]; then
      heavy_services+=("$sid")
    else
      normal_services+=("$sid")
    fi
  done < <(discover_all_services "$DS_DIR")

  _report_containers "${core_services[@]}"
  _report_heavy "${heavy_services[@]}"
  _report_normal "${normal_services[@]}"
  _report_background_downloads

  echo ""
}

_report_containers() {
  for svc in "$@"; do
    local container="dream-${svc}"
    local status health
    status=$(docker inspect --format '{{.State.Status}}' "$container" 2>&1 || echo "not found")
    health=$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>&1 || echo "none")

    if [[ "$health" == "healthy" ]]; then
      echo -e "  ${GREEN}✓${NC} ${svc}: healthy"
    elif [[ "$status" == "running" ]]; then
      echo -e "  ${YELLOW}◌${NC} ${svc}: starting up..."
    elif [[ "$status" == "restarting" ]]; then
      echo -e "  ${RED}↻${NC} ${svc}: restarting (check: docker logs ${container})"
    elif [[ "$status" == "not found" ]]; then
      echo -e "  ${DIM}·${NC} ${svc}: not deployed"
    else
      echo -e "  ${RED}✗${NC} ${svc}: ${status}"
    fi
  done
}

_report_heavy() {
  for svc in "$@"; do
    local container="dream-${svc}"
    local status
    status=$(docker inspect --format '{{.State.Status}}' "$container" 2>&1 || echo "not found")
    [[ "$status" == "not found" || "$status" == "exited" ]] && continue

    local health
    health=$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>&1 || echo "none")
    if [[ "$health" == "healthy" ]]; then
      echo -e "  ${GREEN}✓${NC} ${svc}: ready"
    elif [[ "$status" == "running" ]]; then
      echo -e "  ${CYAN}↓${NC} ${svc}: initializing in background"
    elif [[ "$status" == "restarting" ]]; then
      echo -e "  ${YELLOW}↻${NC} ${svc}: restarting (downloading models)"
    fi
  done
}

_report_normal() {
  for svc in "$@"; do
    local container="dream-${svc}"
    local status
    status=$(docker inspect --format '{{.State.Status}}' "$container" 2>&1 || echo "not found")
    [[ "$status" == "not found" || "$status" == "exited" ]] && continue

    local health
    health=$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>&1 || echo "none")
    if [[ "$health" == "healthy" ]]; then
      echo -e "  ${GREEN}✓${NC} ${svc}: healthy"
    elif [[ "$status" == "running" ]]; then
      echo -e "  ${YELLOW}◌${NC} ${svc}: starting up..."
    fi
  done
}

_report_background_downloads() {
  if pgrep -f "aria2c.*gguf" > /dev/null 2>&1; then
    echo -e "  ${CYAN}↓${NC} LLM model: upgrading in background (aria2c)"
    echo "    Monitor: tail -f ${DS_DIR}/logs/aria2c-download.log"
  fi
  local bg_upgrade="${DS_DIR}/logs/model-upgrade.log"
  if [[ -f "$bg_upgrade" ]] && pgrep -f "model-upgrade\|model.*download" > /dev/null 2>&1; then
    echo -e "  ${CYAN}↓${NC} LLM model: upgrading in background (DreamServer)"
  fi
}

_report_service_status
