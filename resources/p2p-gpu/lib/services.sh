#!/usr/bin/env bash
# ============================================================================
# DreamServer — P2P GPU Service Discovery & Management
# ============================================================================
# Part of: resources/p2p-gpu/lib/
# Purpose: Manifest-driven service discovery, port enumeration, compose
#          command detection, Docker image pre-pull, service startup
#
# Expects: DREAM_USER, LOGFILE, log(), warn(), err(), env_get(), env_set(),
#          expose_ports_for_vastai()
# Provides: read_manifest_field(), discover_all_services(),
#           discover_service_ports(), extract_compose_uid(),
#           get_compose_cmd(), start_services(), prepull_docker_images()
#
# Modder notes:
#   Requires python3 + PyYAML (installed in Phase 1). Functions gracefully
#   return empty when python3/PyYAML is unavailable.
#   [FIX: python-except] Python catches only specific exceptions with logging.
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

# Ensure Dream host agent is running so Dashboard model downloads can start.
_ensure_host_agent_running() {
  local ds_dir="$1"
  local dream_cli="${ds_dir}/dream-cli"

  if [[ ! -x "$dream_cli" ]]; then
    warn "dream-cli not found at ${dream_cli} — skipping host agent auto-start"
    return 0
  fi

  if su - "$DREAM_USER" -c "cd ${ds_dir} && DREAM_HOME=${ds_dir} ./dream-cli agent start" \
    >> "$LOGFILE" 2>&1; then
    log "Ensured Dream host agent is started"
  else
    warn "Dream host agent auto-start failed — model download from Dashboard may fail"
    warn "Run manually: su - ${DREAM_USER} -c 'cd ${ds_dir} && DREAM_HOME=${ds_dir} ./dream-cli agent start'"
  fi
}

# Ensure OpenCode web is reachable on no-systemd hosts (Vast.ai fallback).
_ensure_opencode_web_running() {
  local ds_dir="$1"
  local env_file="${ds_dir}/.env"
  local opencode_bin="/home/${DREAM_USER}/.opencode/bin/opencode"
  local opencode_port opencode_password escaped_password launch_dir escaped_launch_dir

  opencode_port=$(env_get "$env_file" "OPENCODE_PORT")
  opencode_port="${opencode_port:-3003}"

  if curl -sf --max-time 3 "http://127.0.0.1:${opencode_port}/" >/dev/null 2>&1; then
    log "OpenCode web already reachable on port ${opencode_port}"
    return 0
  fi

  if [[ ! -x "$opencode_bin" ]]; then
    warn "OpenCode binary not found at ${opencode_bin} — skipping OpenCode web auto-start"
    return 0
  fi

  opencode_password=$(env_get "$env_file" "OPENCODE_SERVER_PASSWORD")
  if [[ -z "$opencode_password" ]]; then
    opencode_password=$(openssl rand -base64 16)
    env_set "$env_file" "OPENCODE_SERVER_PASSWORD" "$opencode_password"
    log "Generated OPENCODE_SERVER_PASSWORD for secure OpenCode web access"
  fi

  launch_dir="$ds_dir"
  if ! su - "$DREAM_USER" -c "test -r $(printf '%q' "$ds_dir") && test -x $(printf '%q' "$ds_dir")"; then
    launch_dir="$DREAM_HOME"
    warn "OpenCode launch dir ${ds_dir} is not accessible to ${DREAM_USER}; using ${launch_dir}"
  fi

  mkdir -p "${ds_dir}/logs"
  escaped_password=$(printf '%q' "$opencode_password")
  escaped_launch_dir=$(printf '%q' "$launch_dir")
  if su - "$DREAM_USER" -c \
    "cd ${escaped_launch_dir} && OPENCODE_SERVER_PASSWORD=${escaped_password} nohup ${opencode_bin} web --hostname 0.0.0.0 --port ${opencode_port} >> ${ds_dir}/logs/opencode-web.log 2>&1 &" \
    >> "$LOGFILE" 2>&1; then
    sleep 2
    if curl -sf --max-time 4 "http://127.0.0.1:${opencode_port}/" >/dev/null 2>&1; then
      log "Started OpenCode web fallback on port ${opencode_port}"
    else
      warn "OpenCode fallback launch command succeeded but service is not reachable yet"
    fi
  else
    warn "OpenCode fallback launch failed (non-fatal)"
  fi
}

_normalize_dashboard_api_port_envs() {
  local env_file="$1"

  [[ -f "$env_file" ]] || return 0

  python3 - "$env_file" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
text = path.read_text()
pattern = re.compile(r'^([A-Z0-9_]+_PORT)=(\d+)\s+#.*$')
changed = []
lines = []

for line in text.splitlines():
    match = pattern.match(line)
    if match:
      line = f"{match.group(1)}={match.group(2)}"
      changed.append(match.group(1))
    lines.append(line)

new_text = "\n".join(lines) + ("\n" if text.endswith("\n") else "")
if new_text != text:
    path.write_text(new_text)
    if changed:
        print("\n".join(changed))
PY
}

# Read a field from a manifest.yaml service: block
read_manifest_field() {
  local manifest="$1" field="$2"
  python3 -c "
import yaml, sys
try:
    data = yaml.safe_load(open(sys.argv[1]))
    svc = data.get('service') or {}
    val = svc.get(sys.argv[2], '')
    if isinstance(val, list):
        print(' '.join(str(v) for v in val))
    else:
        print(val)
except yaml.YAMLError as e:
    print(f'YAML parse error in {sys.argv[1]}: {e}', file=sys.stderr)
except OSError as e:
    print(f'File read error {sys.argv[1]}: {e}', file=sys.stderr)
" "$manifest" "$field" || warn "manifest field read failed for ${manifest}:${field} (non-fatal)"
}

# Discover all enabled services from extension manifests.
# Usage: discover_all_services <ds_dir> [hints_file]
# Output: ID|PORT_ENV|PORT_DEFAULT|NAME|CATEGORY|PROXY_MODE|STARTUP_BEHAVIOR|CONTAINER_NAME
discover_all_services() {
  local ds_dir="$1"
  local hints_file="${2:-}"
  if [[ -z "$hints_file" && -n "${SCRIPT_DIR:-}" ]]; then
    hints_file="${SCRIPT_DIR}/config/service-hints.yaml"
  fi
  local ext_dirs=("${ds_dir}/extensions/services" "${ds_dir}/user-extensions")

  for ext_root in "${ext_dirs[@]}"; do
    [[ ! -d "$ext_root" ]] && continue
    for manifest in "${ext_root}"/*/manifest.yaml; do
      [[ ! -f "$manifest" ]] && continue
          python3 -c "import os, yaml, sys; data = yaml.safe_load(open(sys.argv[1])) or {}; svc = data.get('service') or {}; sid = svc.get('id', ''); port_env = svc.get('external_port_env', ''); port_def = svc.get('external_port_default', ''); name = svc.get('name', sid); cat = svc.get('category', 'optional'); hints = {}; hints_path = sys.argv[2] if len(sys.argv) > 2 else ''; hints = ((yaml.safe_load(open(hints_path)) or {}).get(sid, {}) if (hints_path and os.path.exists(hints_path) and sid) else {}); proxy = hints.get('proxy_mode', svc.get('proxy_mode', 'simple')); startup = hints.get('startup_behavior', svc.get('startup_behavior', 'normal')); cname = svc.get('container_name', ''); htimeout = svc.get('health_timeout', 0); startup = 'heavy' if startup == 'normal' and isinstance(htimeout, (int, float)) and htimeout > 20 else startup; print(f'{sid}|{port_env}|{port_def}|{name}|{cat}|{proxy}|{startup}|{cname}') if sid else None" "$manifest" "$hints_file" || warn "service discovery failed for ${manifest} (non-fatal)"
    done
  done
}

# Discover service ports from .env / manifests.
# Output: SERVICE_KEY|PORT_NUMBER|LABEL
# Reads explicit _PORT= lines from .env, then fills in manifest defaults
# for any services whose port_env isn't already set.
discover_service_ports() {
  local ds_dir="$1"
  local env_file="${ds_dir}/.env"
  local env_example="${ds_dir}/.env.example"

  declare -A PORT_LABELS PORT_DEFAULTS SEEN_KEYS
  while IFS='|' read -r _id port_env port_def svc_name _rest; do
    [[ -z "$port_env" ]] && continue
    PORT_LABELS["$port_env"]="$svc_name"
    [[ -n "$port_def" ]] && PORT_DEFAULTS["$port_env"]="$port_def"
  done < <(discover_all_services "$ds_dir")

  local source_file="$env_file"
  [[ ! -f "$source_file" ]] && source_file="$env_example"
  [[ ! -f "$source_file" ]] && return 0

  # Emit ports explicitly set in .env
  {
    grep -E '^[A-Z_]+_PORT=' "$source_file" 2>/dev/null || true
  } | while IFS='=' read -r key value; do
    value=$(echo "$value" | sed 's/[[:space:]]#.*$//' | tr -d '"' | tr -d "'" | xargs)
    [[ -z "$value" ]] && continue
    local label="${PORT_LABELS[$key]:-$key}"
    echo "${key}|${value}|${label}"
  done

  # Track which keys were already emitted
  while IFS='=' read -r key _; do
    SEEN_KEYS["$key"]=1
  done < <(grep -E '^[A-Z_]+_PORT=' "$source_file" 2>/dev/null || true)

  # Fill in manifest defaults for services not in .env
  for key in "${!PORT_DEFAULTS[@]}"; do
    [[ -n "${SEEN_KEYS[$key]:-}" ]] && continue
    local label="${PORT_LABELS[$key]:-$key}"
    echo "${key}|${PORT_DEFAULTS[$key]}|${label}"
  done
}

# Detect available compose command
get_compose_cmd() {
  if docker compose version &>/dev/null; then
    echo "docker compose"
  elif command -v docker-compose &>/dev/null; then
    echo "docker-compose"
  else
    err "Neither 'docker compose' nor 'docker-compose' found"
    exit 1
  fi
}

# Pre-pull Docker images in parallel
prepull_docker_images() {
  local ds_dir="$1"
  local max_parallel="${2:-4}"

  local images
  images=$(grep -rh 'image:' "${ds_dir}"/docker-compose*.yml \
    "${ds_dir}"/extensions/services/*/compose*.y*ml 2>&1 \
    | sed -E 's/.*image:\s*//' | tr -d '"' | tr -d "'" \
    | sort -u | grep -v '^\$' || echo "")

  if [[ -z "$images" ]]; then
    log "No Docker images found to pre-pull"
    return 0
  fi

  local count
  count=$(echo "$images" | wc -l)
  log "Pre-pulling ${count} Docker images (${max_parallel} parallel)..."

  echo "$images" | xargs -P "$max_parallel" -I {} sh -c \
    'docker pull {} >/dev/null 2>&1 && echo "  pulled: {}" || echo "  skip:   {} (will retry at compose up)"' \
    || warn "some image pulls failed (non-fatal)"

  log "Docker image pre-pull complete"
}

# ── Remove stale Docker network ────────────────────────────────────────────
_cleanup_stale_network() {
  if ! docker network inspect dream-network >/dev/null 2>&1; then
    return 0
  fi
  local net_label
  net_label=$(docker network inspect dream-network \
    --format '{{index .Labels "com.docker.compose.network"}}' 2>&1 || echo "")
  if [[ -n "$net_label" ]]; then
    return 0
  fi
  log "Removing stale dream-network (missing compose labels)..."
  for cid in $(docker network inspect dream-network \
    -f '{{range .Containers}}{{.Name}} {{end}}' 2>&1 || echo ""); do
    docker network disconnect -f dream-network "$cid" || warn "disconnect ${cid} failed (non-fatal)"
  done
  docker network rm dream-network || warn "network rm failed (non-fatal)"
}

_set_safe_llama_cpu_caps() {
  local env_file="$1" max_cpu="$2"
  [[ ! -f "$env_file" ]] && return 0

  local llama_limit="${max_cpu}.0"
  local llama_reservation="2.0"
  if [[ "$max_cpu" -lt 2 ]]; then
    llama_reservation="1.0"
  fi

  env_set "$env_file" "LLAMA_CPU_LIMIT" "$llama_limit"
  env_set "$env_file" "LLAMA_CPU_RESERVATION" "$llama_reservation"
}

_extract_cpu_ceiling_from_compose_error() {
  local compose_err="$1"
  local ceiling=""

  ceiling=$(tr -d '\r' < "$compose_err" | grep -Eo 'range of CPUs is from [0-9.]+ to [0-9.]+' 2>>"$LOGFILE" \
    | head -1 | awk '{print $NF}' | cut -d'.' -f1 || echo "")

  if [[ -z "$ceiling" ]]; then
    ceiling=$(tr -d '\r' < "$compose_err" | grep -Eo 'only [0-9]+ CPUs available' 2>>"$LOGFILE" \
      | head -1 | awk '{print $2}' || echo "")
  fi

  if [[ "$ceiling" =~ ^[0-9]+$ ]] && [[ "$ceiling" -gt 0 ]]; then
    echo "$ceiling"
  fi
}

_compose_output_has_cpu_error() {
  local compose_err="$1"
  tr -d '\r' < "$compose_err" | grep -Eqi "range of CPUs is from|only [0-9]+ CPUs available|invalid.*cpu|NanoCPUs"
}

_resolve_compose_files_from_flags() {
  local ds_dir="$1" compose_flags="$2"
  local prev="" token

  for token in $compose_flags; do
    if [[ "$prev" == "-f" ]]; then
      if [[ "$token" == /* ]]; then
        echo "$token"
      else
        echo "${ds_dir}/${token}"
      fi
      prev=""
      continue
    fi
    [[ "$token" == "-f" ]] && prev="-f"
  done
}

_compose_ansi_flag() {
  local compose_cmd="$1"
  case "$compose_cmd" in
    "docker compose") echo "--ansi never" ;;
    "docker-compose") echo "--no-ansi" ;;
    *) echo "" ;;
  esac
}

_apply_host_cpu_caps() {
  local ds_dir="$1" env_file="$2" daemon_ceiling="${3:-}" compose_flags="${4:-}"
  local nproc_count docker_ncpu compose_ceiling max_cpu
  local -a compose_files=()

  nproc_count=$(nproc 2>>"$LOGFILE" || echo 1)
  docker_ncpu=$(docker info --format '{{.NCPU}}' 2>>"$LOGFILE" || echo "unknown")
  compose_ceiling=$(get_compose_cpu_ceiling)
  max_cpu=$(compute_safe_cpu_cap "$daemon_ceiling")

  cap_cpu_in_yaml "$ds_dir" "$max_cpu"
  if [[ -n "$compose_flags" ]]; then
    mapfile -t compose_files < <(_resolve_compose_files_from_flags "$ds_dir" "$compose_flags")
    if [[ "${#compose_files[@]}" -gt 0 ]]; then
      cap_cpu_in_files "$max_cpu" "${compose_files[@]}"
    fi
  fi
  _set_safe_llama_cpu_caps "$env_file" "$max_cpu"
  log "Ensured compose CPU limits <= ${max_cpu} cores (nproc=${nproc_count}, docker=${docker_ncpu}, ceiling=${compose_ceiling}${daemon_ceiling:+, daemon=${daemon_ceiling}})"
}

_compose_up() {
  local ds_dir="$1" compose_cmd="$2" compose_flags="$3" compose_err="$4"
  shift 4
  local ansi_flag cmd service_args
  ansi_flag=$(_compose_ansi_flag "$compose_cmd")
  cmd="${compose_cmd}"
  [[ -n "$ansi_flag" ]] && cmd="${cmd} ${ansi_flag}"
  cmd="${cmd} ${compose_flags} up -d"
  if [[ "$#" -gt 0 ]]; then
    printf -v service_args ' %q' "$@"
    cmd="${cmd}${service_args}"
  fi

  su - "$DREAM_USER" -c "cd ${ds_dir} && ${cmd}" 2>&1 \
    | tee -a "$LOGFILE" | tee "$compose_err"
}

_compose_up_with_cpu_heal() {
  local ds_dir="$1" compose_cmd="$2" compose_flags="$3" env_file="$4" scope="$5"
  shift 5
  local compose_err daemon_ceiling
  compose_err=$(mktemp)

  if _compose_up "$ds_dir" "$compose_cmd" "$compose_flags" "$compose_err" "$@"; then
    rm -f "$compose_err"
    return 0
  fi

  if _compose_output_has_cpu_error "$compose_err"; then
    daemon_ceiling=$(_extract_cpu_ceiling_from_compose_error "$compose_err")
    if [[ -n "$daemon_ceiling" ]]; then
      warn "CPU limit exceeds daemon ceiling (${daemon_ceiling}) during ${scope} — recapping and retrying"
    else
      warn "CPU limit exceeds host/daemon cores during ${scope} — recapping and retrying"
    fi
    _apply_host_cpu_caps "$ds_dir" "$env_file" "$daemon_ceiling" "$compose_flags"
    if _compose_up "$ds_dir" "$compose_cmd" "$compose_flags" "$compose_err" "$@"; then
      rm -f "$compose_err"
      return 0
    fi
  fi

  rm -f "$compose_err"
  return 1
}

_heal_dashboard_api_proxy() {
  local env_file="$1"
  local dashboard_port dashboard_api_port dash_status api_status
  dashboard_port=$(env_get "$env_file" "DASHBOARD_PORT")
  dashboard_port="${dashboard_port:-3001}"
  dashboard_api_port=$(env_get "$env_file" "DASHBOARD_API_PORT")
  dashboard_api_port="${dashboard_api_port:-3002}"

  dash_status=$(docker inspect --format '{{.State.Status}}' dream-dashboard 2>/dev/null || echo "missing") # stderr expected: container may not exist
  api_status=$(docker inspect --format '{{.State.Status}}' dream-dashboard-api 2>/dev/null || echo "missing") # stderr expected: container may not exist
  [[ "$dash_status" != "running" || "$api_status" != "running" ]] && return 0

  if curl -sf --max-time 3 "http://127.0.0.1:${dashboard_api_port}/health" >/dev/null 2>&1 \
    && ! curl -sf --max-time 4 "http://127.0.0.1:${dashboard_port}/api/status" >/dev/null 2>&1; then
    warn "Dashboard returned API 502 while dashboard-api is healthy — restarting dashboard to refresh upstream"
    docker restart dream-dashboard 2>>"$LOGFILE" || warn "dashboard restart failed (non-fatal)"
  fi
}

# Start DreamServer services via compose
start_services() {
  local ds_dir="$1"
  local gpu_backend="${2:-auto}"
  local env_file="${ds_dir}/.env"
  local compose_cmd
  compose_cmd=$(get_compose_cmd)

  cd "$ds_dir"
  [[ "$gpu_backend" == "auto" ]] && gpu_backend=$(detect_gpu_backend)

  # Last-resort .env permission guard (fatal if fails — compose cannot start without readable .env)
  if [[ -f "$env_file" ]]; then
    # Check and fix ownership independently
    if [[ "$(stat -c '%U' "$env_file" 2>/dev/null || echo root)" != "${DREAM_USER}" ]]; then
      chown "${DREAM_USER}:${DREAM_USER}" "$env_file" || {
        err ".env ownership fix failed in start_services — Docker Compose cannot start"
        exit 1
      }
    fi
    # Check and fix mode independently
    if [[ "$(stat -c '%a' "$env_file" 2>/dev/null)" != "660" ]]; then
      chmod 0660 "$env_file" || {
        err ".env chmod to 0660 failed in start_services — Docker Compose cannot start"
        exit 1
      }
    fi
  fi

  local gpu_overlay="docker-compose.${gpu_backend}.yml"
  if [[ ! -f "$gpu_overlay" && "$gpu_backend" != "cpu" ]]; then
    warn "GPU overlay ${gpu_overlay} not found — falling back to nvidia"
    gpu_overlay="docker-compose.nvidia.yml"
  fi

  local compose_flags="-f docker-compose.base.yml"
  if [[ "$gpu_backend" != "cpu" && -f "$gpu_overlay" ]]; then
    compose_flags="${compose_flags} -f ${gpu_overlay}"
  fi

  # Prefer upstream compose stack resolver
  if [[ -x "${ds_dir}/scripts/resolve-compose-stack.sh" ]]; then
    log "Using DreamServer's resolve-compose-stack.sh"
    local resolved_flags
    resolved_flags=$(su - "$DREAM_USER" -c \
      "cd ${ds_dir} && ./scripts/resolve-compose-stack.sh \
        --gpu-backend ${gpu_backend} --gpu-count ${GPU_COUNT:-1}" 2>&1 || echo "")
    if [[ -n "$resolved_flags" ]]; then
      compose_flags="$resolved_flags"
    fi
  fi

  _cleanup_stale_network
  _apply_host_cpu_caps "$ds_dir" "$env_file" "" "$compose_flags"
  expose_ports_for_vastai "$ds_dir"

  if ! _compose_up_with_cpu_heal "$ds_dir" "$compose_cmd" "$compose_flags" "$env_file" "full compose"; then
    warn "Full compose failed — trying core services only"
    if ! _compose_up_with_cpu_heal "$ds_dir" "$compose_cmd" "$compose_flags" "$env_file" \
      "core services" llama-server dashboard-api open-webui dashboard; then
      warn "Core compose with llama failed — bringing up control plane only"
      _compose_up_with_cpu_heal "$ds_dir" "$compose_cmd" "$compose_flags" "$env_file" \
        "control-plane services" dashboard-api dashboard open-webui \
        || warn "control-plane compose up also failed (non-fatal)"
    fi
  fi

  local normalized_ports
  normalized_ports=$(_normalize_dashboard_api_port_envs "$env_file")
  if [[ -n "$normalized_ports" ]]; then
    log "Normalized commented port env values in .env: ${normalized_ports//$'\n'/, }"
    docker restart dream-dashboard-api 2>>"$LOGFILE" || warn "dashboard-api restart failed (non-fatal)"
    docker restart dream-dashboard 2>>"$LOGFILE" || warn "dashboard restart failed (non-fatal)"
  fi

  # If compose exited early, some containers may be left in Created state.
  # Try to start them so users can still reach the control plane.
  local created
  created=$(docker ps -a --filter "status=created" --format '{{.Names}}' | grep '^dream-' || echo "")
  if [[ -n "$created" ]]; then
    warn "Some containers are still in Created state — attempting docker start"
    while IFS= read -r cname; do
      [[ -z "$cname" ]] && continue
      docker start "$cname" >/dev/null 2>&1 || warn "start ${cname} failed (non-fatal)"
    done <<< "$created"
  fi

  # Nudge dashboard if stuck in Created state
  if docker ps -a --format '{{.Names}} {{.Status}}' 2>&1 | grep -q 'dream-dashboard Created'; then
    docker start dream-dashboard || warn "dashboard kick failed (non-fatal)"
    log "Kicked dashboard out of Created state"
  fi

  _heal_dashboard_api_proxy "$env_file"
  _ensure_host_agent_running "$ds_dir"
  _ensure_opencode_web_running "$ds_dir"
}
