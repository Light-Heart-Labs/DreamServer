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
# Output: ID|PORT_ENV|PORT_DEFAULT|NAME|CATEGORY|PROXY_MODE|STARTUP_BEHAVIOR|CONTAINER_NAME
discover_all_services() {
  local ds_dir="$1"
  local ext_dirs=("${ds_dir}/extensions/services" "${ds_dir}/user-extensions")

  for ext_root in "${ext_dirs[@]}"; do
    [[ ! -d "$ext_root" ]] && continue
    for manifest in "${ext_root}"/*/manifest.yaml; do
      [[ ! -f "$manifest" ]] && continue
      python3 -c "
import yaml, sys
try:
    data = yaml.safe_load(open(sys.argv[1]))
    svc = data.get('service') or {}
    sid      = svc.get('id', '')
    port_env = svc.get('external_port_env', '')
    port_def = svc.get('external_port_default', '')
    name     = svc.get('name', sid)
    cat      = svc.get('category', 'optional')
    proxy    = svc.get('proxy_mode', 'simple')
    startup  = svc.get('startup_behavior', 'normal')
    cname    = svc.get('container_name', '')
    htimeout = svc.get('health_timeout', 0)
    if startup == 'normal' and isinstance(htimeout, (int, float)) and htimeout > 20:
        startup = 'heavy'
    if sid:
        print(f'{sid}|{port_env}|{port_def}|{name}|{cat}|{proxy}|{startup}|{cname}')
except yaml.YAMLError as e:
    print(f'YAML parse error in {sys.argv[1]}: {e}', file=sys.stderr)
except OSError as e:
    print(f'File read error {sys.argv[1]}: {e}', file=sys.stderr)
" "$manifest" || warn "service discovery failed for ${manifest} (non-fatal)"
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
  grep -E '^[A-Z_]+_PORT=' "$source_file" | while IFS='=' read -r key value; do
    value=$(echo "$value" | tr -d '"' | tr -d "'")
    [[ -z "$value" ]] && continue
    local label="${PORT_LABELS[$key]:-$key}"
    echo "${key}|${value}|${label}"
  done

  # Track which keys were already emitted
  while IFS='=' read -r key _; do
    SEEN_KEYS["$key"]=1
  done < <(grep -E '^[A-Z_]+_PORT=' "$source_file")

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

# Start DreamServer services via compose
start_services() {
  local ds_dir="$1"
  local gpu_backend="${2:-auto}"
  local compose_cmd
  compose_cmd=$(get_compose_cmd)

  cd "$ds_dir"
  [[ "$gpu_backend" == "auto" ]] && gpu_backend=$(detect_gpu_backend)

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
      "cd ${ds_dir} && ./scripts/resolve-compose-stack.sh" 2>&1 || echo "")
    if [[ -n "$resolved_flags" ]]; then
      compose_flags="$resolved_flags"
    fi
  fi

  _cleanup_stale_network
  expose_ports_for_vastai "$ds_dir"

  su - "$DREAM_USER" -c "cd ${ds_dir} && ${compose_cmd} ${compose_flags} up -d" 2>&1 || {
    warn "Full compose failed — trying core services only"
    su - "$DREAM_USER" -c \
      "cd ${ds_dir} && ${compose_cmd} ${compose_flags} up -d llama-server dashboard-api open-webui dashboard" 2>&1 \
      || warn "core compose up also failed (non-fatal)"
  }

  # Nudge dashboard if stuck in Created state
  if docker ps -a --format '{{.Names}} {{.Status}}' 2>&1 | grep -q 'dream-dashboard Created'; then
    docker start dream-dashboard || warn "dashboard kick failed (non-fatal)"
    log "Kicked dashboard out of Created state"
  fi
}
