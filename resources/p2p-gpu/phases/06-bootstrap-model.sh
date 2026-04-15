#!/usr/bin/env bash
# ============================================================================
# DreamServer — P2P GPU Phase 06: Bootstrap Model
# ============================================================================
# Part of: resources/p2p-gpu/phases/
# Purpose: Ensure a usable GGUF model file exists so llama-server can start
#
# Expects: DS_DIR, GPU_BACKEND, log(), warn(), env_get(), env_set(),
#          fix_known_uid_requirements(), apply_data_acl(),
#          check_disk_for_download(), resolve_model_url(),
#          _store_pid(), create_model_swap_watcher()
# Provides: Verified GGUF_FILE in .env pointing to a real model;
#           background download of tier model + swap watcher (if bootstrapped)
#
# Fixes covered: #19 (bootstrap model missing), #20 (llama-server hang)
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

step "Phase 6/12: Ensuring bootstrap model is available"

env_file="${DS_DIR}/.env"
data_dir="${DS_DIR}/data"
models_dir="${data_dir}/models"
mkdir -p "$models_dir"

gguf_file=""
model_path=""
model_ready=false
tier_gguf=""  # Remember the intended tier model for background download

gguf_file=$(env_get "$env_file" "GGUF_FILE")

# Check if configured model exists and is valid
if [[ -n "$gguf_file" ]]; then
  tier_gguf="$gguf_file"  # Save intended tier model before any fallback
  model_path="${models_dir}/${gguf_file}"
  if [[ -f "$model_path" ]]; then
    file_size=$(stat -c%s "$model_path" || echo 0)
    if [[ $file_size -gt 100000000 ]]; then
      model_ready=true
      log "Model verified: ${gguf_file} ($(( file_size / 1048576 )) MB)"
    else
      warn "Model file exists but too small (${file_size} bytes) — likely corrupt"
      rm -f "$model_path"
    fi
  else
    warn "GGUF_FILE=${gguf_file} but file not found at ${model_path}"
  fi
fi

# Check for ANY .gguf file as fallback
if [[ "$model_ready" != "true" ]]; then
  any_model=$(find "$models_dir" -name "*.gguf" -size +100M 2>&1 | head -1 || echo "")
  if [[ -n "$any_model" ]]; then
    found_name=$(basename "$any_model")
    env_set "$env_file" "GGUF_FILE" "$found_name"
    model_ready=true
    log "Found existing model: ${found_name} — updated GGUF_FILE"
  fi
fi

# Last resort: download small bootstrap model
if [[ "$model_ready" != "true" ]]; then
  # [FIX: disk-check] Verify disk space before downloading
  if ! check_disk_for_download "$models_dir" 2; then
    err "Cannot download bootstrap model — insufficient disk space"
    warn "Continuing without a model — llama-server will not start"
  else
    warn "No usable model found — downloading bootstrap model..."
    bootstrap_url="https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q4_K_M.gguf"
    bootstrap_name="Qwen3-0.6B-Q4_K_M.gguf"

    if command -v aria2c &>/dev/null; then
      aria2c -x 8 -s 8 -k 5M --file-allocation=none --console-log-level=notice \
        --check-integrity=true \
        -d "$models_dir" -o "$bootstrap_name" "$bootstrap_url" 2>&1 | tail -5
    else
      curl -L --fail --progress-bar -o "${models_dir}/${bootstrap_name}" "$bootstrap_url"
    fi

    # [FIX: bootstrap-size] Validate downloaded file size (>50MB for smallest GGUF)
    if [[ -f "${models_dir}/${bootstrap_name}" ]]; then
      local dl_size
      dl_size=$(stat -c%s "${models_dir}/${bootstrap_name}" || echo 0)
      if [[ "$dl_size" -gt 50000000 ]]; then
        env_set "$env_file" "GGUF_FILE" "$bootstrap_name"
        log "Bootstrap model downloaded: ${bootstrap_name} ($(( dl_size / 1048576 )) MB)"
      else
        err "Downloaded model too small (${dl_size} bytes) — likely incomplete or corrupt"
        rm -f "${models_dir}/${bootstrap_name}"
        warn "Continuing without a model — llama-server will not start"
      fi
    else
      err "Failed to download bootstrap model — llama-server will not start"
      warn "Continuing anyway — other services may still work"
    fi
  fi
fi

# ── Queue background download of the intended tier model ────────────────────
# If we bootstrapped with a tiny model, download the real tier model in the
# background. Once complete, the swap watcher hot-swaps GGUF_FILE and restarts
# llama-server — zero downtime for the user.
current_gguf=$(env_get "$env_file" "GGUF_FILE")
if [[ -n "$tier_gguf" && "$tier_gguf" != "$current_gguf" ]]; then
  if check_disk_for_download "$models_dir" 5; then
    tier_url=$(resolve_model_url "$DS_DIR" "$tier_gguf") || tier_url=""
    if [[ -n "$tier_url" ]]; then
      log "Queuing background download of tier model: ${tier_gguf}"
      mkdir -p "${DS_DIR}/logs"

      if command -v aria2c &>/dev/null; then
        nohup aria2c \
          -x 8 -s 8 -k 10M \
          --continue=true \
          --max-tries=0 \
          --retry-wait=5 \
          --timeout=60 \
          --connect-timeout=30 \
          --file-allocation=none \
          --auto-file-renaming=false \
          --console-log-level=warn \
          --summary-interval=30 \
          --check-integrity=true \
          -d "$models_dir" \
          -o "$tier_gguf" \
          "$tier_url" \
          >> "${DS_DIR}/logs/aria2c-download.log" 2>&1 &
      else
        nohup curl -L --fail -o "${models_dir}/${tier_gguf}" "$tier_url" \
          >> "${DS_DIR}/logs/aria2c-download.log" 2>&1 &
      fi

      local dl_pid=$!
      _store_pid "aria2c-model" "$dl_pid"
      log "Background download started (PID: ${dl_pid})"
      create_model_swap_watcher "$DS_DIR" "$tier_gguf"
    else
      warn "Could not resolve download URL for ${tier_gguf} — staying on bootstrap model"
    fi
  else
    warn "Insufficient disk for tier model — staying on bootstrap model"
  fi
fi

fix_known_uid_requirements "$data_dir" "$GPU_BACKEND"
apply_data_acl "$models_dir" || warn "ACL on models/ failed (non-fatal)"
