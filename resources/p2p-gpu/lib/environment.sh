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
#           ensure_dream_cli_command(),
#           cap_cpu_in_yaml(), cap_cpu_in_files(), get_compose_cpu_ceiling(),
#           compute_safe_cpu_cap(), fix_ownership(), wait_for_http(),
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
  [[ ! -f "$file" ]] && return 0
  grep "^${key}=" "$file" 2>>"$LOGFILE" | head -1 | cut -d= -f2- \
    | sed 's/[[:space:]]#.*$//' | tr -d '"' | tr -d "'" || echo ""
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

# Install a stable `dream` command wrapper for root/non-root shells.
ensure_dream_cli_command() {
  local ds_dir="$1"
  local cli_path="${ds_dir}/dream-cli"
  local wrapper="/usr/local/bin/dream"

  if [[ ! -x "$cli_path" ]]; then
    warn "dream-cli not executable at ${cli_path} (skipping global dream command)"
    return 0
  fi

  cat > "$wrapper" << EOF
#!/usr/bin/env bash
set -euo pipefail
export DREAM_HOME="\${DREAM_HOME:-${ds_dir}}"
cd "${ds_dir}"
exec "${cli_path}" "\$@"
EOF
  chmod +x "$wrapper" || warn "chmod failed on ${wrapper} (non-fatal)"
  log "Installed global dream command: ${wrapper}"
}

# Cap CPU values in one YAML file to max_cpu.
# Handles any numeric form (N, N.M) with optional quotes. Values <= max_cpu
# are left alone; values > max_cpu are lowered to max_cpu.
_cap_cpu_in_yaml_file() {
  local file="$1" max_cpu="$2"
  [[ ! -f "$file" ]] && return 0
  python3 - "$file" "$max_cpu" <<'PY'
import re, sys
path, cap = sys.argv[1], float(sys.argv[2])
try:
  with open(path, "r", encoding="utf-8") as fh:
    src = fh.read()
except OSError:
  sys.exit(0)

def parse_numeric(value):
  raw = value.strip().strip("'\"")
  if re.fullmatch(r"[0-9]+(?:\.[0-9]+)?", raw):
    return float(raw)
  m = re.fullmatch(r"\$\{[^:}]+:-([0-9]+(?:\.[0-9]+)?)\}", raw)
  if m:
    return float(m.group(1))
  return None

def repl(m):
  indent, rhs, comment = m.group(1), m.group(2).strip(), m.group(3) or ""
  q = "'"
  if rhs[:1] in ("'", '"'):
    q = rhs[0]

  numeric = parse_numeric(rhs)
  needs_cap = ("${" in rhs) or (numeric is None) or (numeric > cap)
  if needs_cap:
    return f"{indent}cpus: {q}{cap:g}{q}{comment}"
  return m.group(0)

pat = re.compile(r"^(\s*)cpus:\s*([^#\n]+?)(\s+#.*)?$", re.M)
new = pat.sub(repl, src)
if new != src:
  with open(path, "w", encoding="utf-8") as fh:
    fh.write(new)
PY
}

# Cap CPU values in all YAML files under a directory tree.
cap_cpu_in_yaml() {
  local dir="$1" max_cpu="$2"
  while IFS= read -r -d '' f; do
    _cap_cpu_in_yaml_file "$f" "$max_cpu"
  done < <(find "$dir" \( -name "*.yml" -o -name "*.yaml" \) -type f -print0)
  return 0
}

# Cap CPU values in a specific list of YAML files.
cap_cpu_in_files() {
  local max_cpu="$1"
  shift
  local f
  for f in "$@"; do
    _cap_cpu_in_yaml_file "$f" "$max_cpu"
  done
  return 0
}

# Return the CPU ceiling Docker can actually schedule, accounting for
# container-level CPU quotas that can differ from nproc.
get_compose_cpu_ceiling() {
  local host_nproc docker_ncpu ceiling

  host_nproc=$(nproc 2>>"$LOGFILE" || echo 1)
  if [[ ! "$host_nproc" =~ ^[0-9]+$ ]] || [[ "$host_nproc" -lt 1 ]]; then
    host_nproc=1
  fi

  ceiling="$host_nproc"
  docker_ncpu=$(docker info --format '{{.NCPU}}' 2>>"$LOGFILE" || echo "")
  if [[ "$docker_ncpu" =~ ^[0-9]+$ ]] && [[ "$docker_ncpu" -gt 0 ]] && [[ "$docker_ncpu" -lt "$ceiling" ]]; then
    ceiling="$docker_ncpu"
  fi

  echo "$ceiling"
}

# Compute a safe cpus: cap value with one-core headroom.
# Optional arg 1: hard ceiling discovered from daemon error output.
compute_safe_cpu_cap() {
  local forced_ceiling="${1:-}"
  local ceiling

  ceiling=$(get_compose_cpu_ceiling)
  if [[ "$forced_ceiling" =~ ^[0-9]+$ ]] && [[ "$forced_ceiling" -gt 0 ]] && [[ "$forced_ceiling" -lt "$ceiling" ]]; then
    ceiling="$forced_ceiling"
  fi

  if [[ "$ceiling" -gt 1 ]]; then
    echo $((ceiling - 1))
  else
    echo 1
  fi
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
    GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>>"$LOGFILE" | head -1 | xargs)
    GPU_VRAM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>>"$LOGFILE" | head -1 | xargs)
    GPU_COUNT=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>>"$LOGFILE" | wc -l)
    GPU_TOTAL_VRAM=0
    while read -r v; do GPU_TOTAL_VRAM=$(( GPU_TOTAL_VRAM + v )); done \
      < <(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>>"$LOGFILE")
    if [[ $GPU_TOTAL_VRAM -eq 0 ]]; then GPU_TOTAL_VRAM=$GPU_VRAM; fi

  elif command -v rocm-smi &>/dev/null || [[ -e /dev/kfd ]]; then
    GPU_BACKEND="amd"
    GPU_NAME=$(rocm-smi --showproductname 2>>"$LOGFILE" | grep -oP 'Card series:\s*\K.*' | head -1 || echo "AMD GPU")
    GPU_VRAM=$(rocm-smi --showmeminfo vram 2>>"$LOGFILE" | grep -oP 'Total Memory \(B\):\s*\K[0-9]+' | head -1 || echo "0")
    # Convert bytes to MiB
    if [[ "${GPU_VRAM:-0}" -gt 1000000 ]]; then
      GPU_VRAM=$(( GPU_VRAM / 1048576 ))
    fi
    GPU_COUNT=$(rocm-smi --showid 2>>"$LOGFILE" | grep -c 'GPU\[' || echo 1)
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

# ── [FIX: nvml-mismatch] NVIDIA driver/library version mismatch detection ────
# Detects if host NVIDIA driver and container CUDA driver versions are misaligned.
# Returns: 0 = matched, 1 = mismatched, 2 = couldn't detect
# Outputs: diagnostics to stdout (host_driver=X.X container_cuda=Y.Y)
detect_nvml_mismatch() {
  local host_driver container_cuda docker_test_image="${1:-nvidia/cuda:12.4.1-base-ubuntu22.04}"
  local test_timeout="${NVIDIA_DOCKER_TEST_TIMEOUT:-180}"

  # Get host driver version
  host_driver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>>"$LOGFILE" | head -1 | xargs || echo "")
  if [[ -z "$host_driver" ]]; then
    log "NVIDIA driver version detection failed (non-fatal)"
    return 2
  fi

  # Get container CUDA driver compatibility version
  container_cuda=$(timeout --signal=TERM "$test_timeout" \
    docker run --rm --gpus all "$docker_test_image" \
    nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>>"$LOGFILE" | head -1 | xargs || echo "")

  if [[ -z "$container_cuda" ]]; then
    log "Container CUDA driver detection failed (non-fatal)"
    return 2
  fi

  # Compare major.minor versions (e.g., 535.104.05 → 535.104)
  local host_major_minor container_major_minor
  host_major_minor=$(echo "$host_driver" | cut -d. -f1,2)
  container_major_minor=$(echo "$container_cuda" | cut -d. -f1,2)

  log "NVIDIA driver mismatch check: host=${host_driver} (${host_major_minor}) vs container=${container_cuda} (${container_major_minor})"

  if [[ "$host_major_minor" != "$container_major_minor" ]]; then
    log "NVIDIA driver/library MISMATCH detected: host ${host_driver} != container ${container_cuda}"
    return 1
  fi

  log "NVIDIA driver/library versions aligned (${host_major_minor})"
  return 0
}

# ── [FIX: nvml-mismatch] NVIDIA driver upgrade to align with container CUDA ──
# Attempts to upgrade host NVIDIA driver to resolve mismatch.
# Non-fatal: logs warnings on failure but does not halt.
repair_nvml_mismatch() {
  local initial_state post_repair_state
  
  log "Attempting to repair NVIDIA driver/library mismatch..."

  # Capture initial state
  initial_state=$(detect_nvml_mismatch)
  
  if [[ $? -eq 0 ]]; then
    log "No mismatch detected, skipping repair"
    return 0
  fi

  # Attempt upgrade
  log "Running apt-get update && apt-get install --only-upgrade nvidia-driver-*"
  if apt-get update -qq 2>>"$LOGFILE" && apt-get install -y -qq --only-upgrade "nvidia-driver-*" 2>>"$LOGFILE"; then
    log "NVIDIA driver upgrade completed"
    
    # Restart Docker to recognize new driver
    log "Restarting Docker daemon to recognize upgraded driver..."
    if systemctl restart docker 2>>"$LOGFILE" || service docker restart 2>>"$LOGFILE"; then
      log "Docker daemon restarted"
    else
      warn "Docker restart failed (non-fatal, may need manual restart)"
    fi

    # Verify post-repair
    sleep 2  # brief delay for driver to stabilize
    post_repair_state=$(detect_nvml_mismatch)
    if [[ $? -eq 0 ]]; then
      log "NVIDIA driver mismatch RESOLVED after upgrade"
      return 0
    else
      warn "NVIDIA driver mismatch persists after upgrade (non-fatal, manual intervention may be needed)"
      return 1
    fi
  else
    warn "NVIDIA driver upgrade failed (non-fatal, GPU may still work)"
    return 1
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
  local cpu_count docker_cpu compose_ceiling max_cpu
  cpu_count=$(nproc 2>>"$LOGFILE" || echo 1)
  docker_cpu=$(docker info --format '{{.NCPU}}' 2>>"$LOGFILE" || echo "unknown")

  [[ "$gpu_backend" == "auto" ]] && gpu_backend=$(detect_gpu_backend)

  # Docker group membership
  if getent group docker &>/dev/null; then
    usermod -aG docker "$DREAM_USER" || warn "docker group add failed (non-fatal)"
  fi

  # CPU limit fix — cap any cpus: value that exceeds (nproc - 1).
  # Always run: cheap no-op on files whose values already fit.
  compose_ceiling=$(get_compose_cpu_ceiling)
  max_cpu=$(compute_safe_cpu_cap)
  cap_cpu_in_yaml "$ds_dir" "$max_cpu"
  log "CPU limits capped to ${max_cpu} (nproc=${cpu_count}, docker=${docker_cpu}, ceiling=${compose_ceiling})"

  # Keep env-substituted CPU limits safe for overlays that use
  # ${LLAMA_CPU_LIMIT:-...} syntax.
  if [[ -f "$env_file" ]]; then
    local llama_limit="${max_cpu}.0"
    local llama_reservation="2.0"
    if [[ "$max_cpu" -lt 2 ]]; then
      llama_reservation="1.0"
    fi
    env_set "$env_file" "LLAMA_CPU_LIMIT" "$llama_limit"
    env_set "$env_file" "LLAMA_CPU_RESERVATION" "$llama_reservation"
    log "LLAMA CPU env caps set to limit=${llama_limit}, reservation=${llama_reservation}"
  fi

  _apply_permission_fixes "$ds_dir" "$data_dir" "$gpu_backend"
  _apply_compatibility_fixes "$ds_dir"
  _apply_env_defaults "$ds_dir" "$env_file" "$data_dir"
  ensure_dream_cli_command "$ds_dir"

  # ── [FIX: nvml-mismatch] Post-install NVIDIA driver check (fallback) ──────
  if [[ "$gpu_backend" == "nvidia" ]]; then
    log "Checking for NVIDIA driver/library version alignment (post-install)..."
    if ! detect_nvml_mismatch; then
      mismatch_status=$?
      if [[ $mismatch_status -eq 1 ]]; then
        warn "NVIDIA driver/library mismatch detected post-install (non-fatal)"
        warn "Run 'bash setup.sh --fix' to repair, or manually upgrade nvidia-driver-*"
      fi
    fi
  fi

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
  ensure_webui_stt_model_alignment "$ds_dir"
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
