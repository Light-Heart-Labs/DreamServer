#!/usr/bin/env bash
# ============================================================================
# DreamServer — P2P GPU Environment Helpers
# ============================================================================
# Part of: resources/p2p-gpu/lib/
# Purpose: .env management, port checks, directory discovery, CPU capping,
#          ownership fixes, HTTP polling, GPU detection, post-install orchestrator
#
# Expects: DREAM_USER, DREAM_HOME, LOGFILE, log(), warn(), err()
# Provides: env_set(), env_get(), port_in_use(), find_dream_dir(),
#           cap_cpu_in_yaml(), fix_ownership(), wait_for_http(),
#           detect_gpu(), apply_post_install_fixes()
#
# Modder notes:
#   env_set is idempotent — safe to call multiple times with same key.
#   env_set creates .env with 0600 mode to protect secrets.
#   find_dream_dir checks both expected DreamServer install paths.
#   detect_gpu() is the single source of truth for GPU detection —
#   call it once and reuse the result (avoid duplicate detection).
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

# ── [FIX: env-perms] .env management with proper file permissions ───────────

# Set a key in .env idempotently (no duplicates, preserves inode)
# Creates with 0600 to protect secrets (WEBUI_SECRET, API keys, etc.)
env_set() {
  local file="$1" key="$2" value="$3"
  if [[ ! -f "$file" ]]; then
    install -m 0600 /dev/null "$file"
  fi
  if grep -q "^${key}=" "$file"; then
    # Escape sed delimiter in value to prevent breakage
    local escaped_value="${value//|/\\|}"
    sed -i "s|^${key}=.*|${key}=${escaped_value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

# Read a key from .env
env_get() {
  local file="$1" key="$2"
  grep "^${key}=" "$file" 2>&1 | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || echo ""
}

# Check if a TCP port is in use
port_in_use() {
  local port="$1"
  ss -tlnp 2>&1 | grep -q ":${port} "
}

# Locate the active dream-server working directory
find_dream_dir() {
  local candidate
  # Prefer directory with both .env and compose (fully configured)
  for candidate in "${DREAM_HOME}/dream-server" "${DREAM_HOME}/DreamServer/dream-server"; do
    if [[ -f "${candidate}/.env" && -f "${candidate}/docker-compose.base.yml" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  # Fallback: any existing directory (partially configured)
  for candidate in "${DREAM_HOME}/dream-server" "${DREAM_HOME}/DreamServer/dream-server"; do
    if [[ -d "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

# Cap CPU values in YAML files to actual CPU count
cap_cpu_in_yaml() {
  local dir="$1" max_cpu="$2"
  find "$dir" \( -name "*.yml" -o -name "*.yaml" \) -type f | while read -r f; do
    if grep -qE "cpus:\s*['\"]?[0-9]+\.0['\"]?" "$f"; then
      sed -i -E "s/cpus:\s*['\"]?([0-9]+)\.0['\"]?/cpus: '${max_cpu}.0'/g" "$f"
    fi
  done
}

# Fix ownership recursively, only if needed
fix_ownership() {
  local dir="$1" user="$2" group="${3:-$2}"
  [[ ! -d "$dir" ]] && return 0
  local current_owner
  current_owner=$(stat -c '%U' "$dir" || echo "unknown")
  if [[ "$current_owner" != "$user" ]]; then
    # chown may fail on NFS mounts or in containers without CAP_CHOWN
    chown -R "${user}:${group}" "$dir" || warn "chown failed on ${dir} (non-fatal)"
  fi
}

# Wait for a URL to return HTTP 200
wait_for_http() {
  local url="$1" timeout="${2:-60}" interval="${3:-5}"
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    if curl -sf --max-time 5 "$url" > /dev/null 2>&1; then
      return 0
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  return 1
}

# ── [FIX: gpu-dedup] Single source of truth for GPU detection ───────────────
# Sets GPU_BACKEND, GPU_NAME, GPU_VRAM, GPU_COUNT as globals.
# Call once in preflight; all other code reads these variables.
detect_gpu() {
  GPU_BACKEND="cpu"
  GPU_NAME="none"
  GPU_VRAM="0"
  GPU_COUNT=0
  GPU_TOTAL_VRAM=0

  if command -v nvidia-smi &>/dev/null && nvidia-smi --query-gpu=name --format=csv,noheader &>/dev/null 2>&1; then
    GPU_BACKEND="nvidia"
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 | xargs)
    GPU_VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | xargs)
    GPU_COUNT=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | wc -l)
    GPU_TOTAL_VRAM=0
    while read -r v; do GPU_TOTAL_VRAM=$(( GPU_TOTAL_VRAM + v )); done \
      < <(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null)
    [[ $GPU_TOTAL_VRAM -eq 0 ]] && GPU_TOTAL_VRAM=$GPU_VRAM

  elif command -v rocm-smi &>/dev/null || [[ -e /dev/kfd ]]; then
    GPU_BACKEND="amd"
    GPU_NAME=$(rocm-smi --showproductname 2>/dev/null | grep -oP 'Card series:\s*\K.*' | head -1 || echo "AMD GPU")
    GPU_VRAM=$(rocm-smi --showmeminfo vram 2>/dev/null | grep -oP 'Total Memory \(B\):\s*\K[0-9]+' | head -1 || echo "0")
    # Convert bytes to MiB
    if [[ "${GPU_VRAM:-0}" -gt 1000000 ]]; then
      GPU_VRAM=$(( GPU_VRAM / 1048576 ))
    fi
    GPU_COUNT=$(rocm-smi --showid 2>/dev/null | grep -c 'GPU\[' || echo 1)
    if [[ $GPU_COUNT -ge 2 ]]; then
      GPU_TOTAL_VRAM=$(( GPU_VRAM * GPU_COUNT ))  # rocm-smi per-device sum
    else
      GPU_TOTAL_VRAM=$GPU_VRAM
    fi
  fi
}

# Lightweight backend-only detection (for subcommands that don't need full GPU info)
detect_gpu_backend() {
  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
    echo "nvidia"
  elif command -v rocm-smi &>/dev/null || [[ -e /dev/kfd ]]; then
    echo "amd"
  else
    echo "cpu"
  fi
}

# ── Post-install fix orchestrator ───────────────────────────────────────────
# Called by phases/05, subcommands/fix, subcommands/resume.
# Coordinates all post-install fixes in correct order.
apply_post_install_fixes() {
  local ds_dir="$1"
  local gpu_backend="${2:-auto}"
  local data_dir="${ds_dir}/data"
  local env_file="${ds_dir}/.env"
  local cpu_count
  cpu_count=$(nproc)

  [[ "$gpu_backend" == "auto" ]] && gpu_backend=$(detect_gpu_backend)

  # Docker group membership
  if getent group docker &>/dev/null; then
    usermod -aG docker "$DREAM_USER" || warn "docker group add failed (non-fatal)"
  fi

  # CPU limit fix — cap to (actual - 1) if < 16
  if [[ $cpu_count -lt 16 ]]; then
    local max_cpu=$(( cpu_count > 1 ? cpu_count - 1 : 1 ))
    cap_cpu_in_yaml "$ds_dir" "$max_cpu"
    log "CPU limits capped to ${max_cpu} (instance has ${cpu_count} cores)"
  fi

  _apply_permission_fixes "$ds_dir" "$data_dir" "$gpu_backend"
  _apply_compatibility_fixes "$ds_dir"
  _apply_env_defaults "$ds_dir" "$env_file" "$data_dir"

  log "Post-install fixes applied (including ACL-based permission system)"
}

_apply_permission_fixes() {
  local ds_dir="$1" data_dir="$2" gpu_backend="$3"
  ensure_acl_tools
  precreate_extension_data_dirs "$ds_dir"
  apply_data_acl "$data_dir"
  fix_known_uid_requirements "$data_dir" "$gpu_backend"
  configure_dream_umask
  create_permission_fix_script "$ds_dir"
  apply_data_acl "${ds_dir}/extensions" || warn "ACL on extensions/ failed (non-fatal)"
  if [[ -d "${ds_dir}/user-extensions" ]]; then
    apply_data_acl "${ds_dir}/user-extensions"
  fi
  find "${ds_dir}/scripts" -name "*.sh" -exec chmod +x {} + || warn "chmod scripts failed (non-fatal)"
  mkdir -p "${ds_dir}/logs"
  apply_data_acl "${ds_dir}/logs" || warn "ACL on logs/ failed (non-fatal)"
}

_apply_compatibility_fixes() {
  local ds_dir="$1"
  ensure_whisper_ui_compatibility "$ds_dir"
  patch_openclaw_inject_token_runtime "$ds_dir"
}

_apply_env_defaults() {
  local ds_dir="$1" env_file="$2" data_dir="$3"
  [[ ! -f "$env_file" ]] && return 0

  # WEBUI_SECRET — open-webui crashes without it
  if [[ -z "$(env_get "$env_file" "WEBUI_SECRET")" ]]; then
    env_set "$env_file" "WEBUI_SECRET" "$(openssl rand -hex 32)"
    log "Generated WEBUI_SECRET"
  fi

  # SEARXNG_SECRET
  if [[ -z "$(env_get "$env_file" "SEARXNG_SECRET")" ]]; then
    env_set "$env_file" "SEARXNG_SECRET" "$(openssl rand -hex 32)"
    log "Generated SEARXNG_SECRET"
  fi

  # GGUF_FILE — detect from data/models if not set
  if [[ -z "$(env_get "$env_file" "GGUF_FILE")" ]]; then
    local first_model
    first_model=$(find "${data_dir}/models/" -maxdepth 1 -name "*.gguf" -type f \
      -printf '%s %f\n' 2>&1 | sort -rn | head -1 | cut -d' ' -f2- || echo "")
    if [[ -n "$first_model" ]]; then
      env_set "$env_file" "GGUF_FILE" "$first_model"
      log "Set GGUF_FILE=${first_model}"
    fi
  fi
}
