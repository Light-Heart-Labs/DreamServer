#!/bin/bash
# Service Registry — loads extension manifests and provides lookup functions.
# Source this file: . "$SCRIPT_DIR/lib/service-registry.sh"

EXTENSIONS_DIR="${SCRIPT_DIR:-$(pwd)}/extensions/services"
_SR_LOADED=false
_SR_CACHE="/tmp/dream-service-registry.$$.sh"

# Caching for compose flags (session-level)
_SR_COMPOSE_FLAGS_CACHE=""
_SR_COMPOSE_FLAGS_CACHED=false
_SR_CACHE_HITS=0
_SR_CACHE_MISSES=0

# Associative arrays (bash 4+)
declare -A SERVICE_ALIASES      # alias → service_id
declare -A SERVICE_CONTAINERS   # service_id → container_name
declare -A SERVICE_COMPOSE      # service_id → compose file path
declare -A SERVICE_CATEGORIES   # service_id → core|recommended|optional
declare -A SERVICE_DEPENDS      # service_id → space-separated dependency IDs
declare -A SERVICE_HEALTH       # service_id → health endpoint path
declare -A SERVICE_HEALTH_TIMEOUTS  # service_id → health check timeout in seconds
declare -A SERVICE_PORTS        # service_id → external port (what the user hits on localhost)
declare -A SERVICE_PORT_ENVS    # service_id → env var name for the external port
declare -A SERVICE_NAMES        # service_id → display name
declare -A SERVICE_SETUP_HOOKS  # service_id → absolute path to setup script
declare -A SERVICE_GPU_BACKENDS # service_id → space-separated GPU backends (amd, nvidia, apple, cpu)
declare -a SERVICE_IDS          # ordered list of all service IDs

sr_load() {
    [[ "$_SR_LOADED" == "true" ]] && return 0
    SERVICE_IDS=()
    # Invalidate cache when reloading (extensions may have changed)
    _SR_COMPOSE_FLAGS_CACHED=false
    _SR_COMPOSE_FLAGS_CACHE=""

    # Single Python pass: reads ALL manifests, emits sourceable bash
    PYTHON_CMD="python3"
    if [[ -f "${SCRIPT_DIR:-$(pwd)}/lib/python-cmd.sh" ]]; then
        . "${SCRIPT_DIR:-$(pwd)}/lib/python-cmd.sh"
        PYTHON_CMD="$(ds_detect_python_cmd)"
    elif command -v python >/dev/null 2>&1; then
        PYTHON_CMD="python"
    fi

    "$PYTHON_CMD" - "$EXTENSIONS_DIR" <<'PYEOF' > "$_SR_CACHE"
import yaml, sys, os
from pathlib import Path

import re as _re

_SAFE_VALUE = _re.compile(r'^[a-zA-Z0-9 _./:@,=-]*$')

def _esc(value):
    """Escape a value for safe inclusion in double-quoted bash assignment.
    Rejects values with characters that could enable shell injection."""
    s = str(value)
    if _SAFE_VALUE.match(s):
        return s
    # Strip characters that are dangerous in double-quoted bash strings
    return s.replace('\\', '\\\\').replace('"', '\\"').replace('$', '\\$').replace('`', '\\`').replace('!', '\\!')

ext_dir = Path(sys.argv[1])
if not ext_dir.exists():
    sys.exit(0)

for service_dir in sorted(ext_dir.iterdir()):
    if not service_dir.is_dir():
        continue
    manifest_path = None
    for name in ("manifest.yaml", "manifest.yml", "manifest.json"):
        candidate = service_dir / name
        if candidate.exists():
            manifest_path = candidate
            break
    if not manifest_path:
        continue
    try:
        with open(manifest_path) as f:
            m = yaml.safe_load(f)
        if not isinstance(m, dict):
            print(f'# SKIP: {manifest_path}: not a valid YAML mapping', file=sys.stderr)
            continue
        if m.get("schema_version") != "dream.services.v1":
            continue
        s = m.get("service")
        if not isinstance(s, dict):
            print(f'# SKIP: {manifest_path}: missing or invalid "service" section', file=sys.stderr)
            continue
        sid = s.get("id", "")
        if not sid:
            print(f'# SKIP: {manifest_path}: missing required "id" field', file=sys.stderr)
            continue

        # Validate service ID — must be safe for use as bash associative array key
        if not _re.match(r'^[a-zA-Z0-9_-]+$', sid):
            print(f'# SKIP: invalid service id: {sid!r}', file=sys.stderr)
            continue

        aliases = s.get("aliases", [])
        container = s.get("container_name", f"dream-{sid}")
        compose_file = s.get("compose_file", "")
        category = s.get("category", "optional")
        depends = s.get("depends_on", [])

        # Validate aliases
        valid_aliases = []
        for a in aliases:
            if _re.match(r'^[a-zA-Z0-9_-]+$', str(a)):
                valid_aliases.append(str(a))
            else:
                print(f'# SKIP alias: invalid alias {a!r} in {sid}', file=sys.stderr)

        # Resolve compose path (relative to extension dir)
        compose_path = ""
        if compose_file:
            full = service_dir / compose_file
            if full.exists():
                compose_path = str(full)

        # Emit sourceable lines — all values escaped for safe double-quoting
        print(f'SERVICE_IDS+=("{_esc(sid)}")')
        print(f'SERVICE_ALIASES["{_esc(sid)}"]="{_esc(sid)}"')
        for a in valid_aliases:
            print(f'SERVICE_ALIASES["{_esc(a)}"]="{_esc(sid)}"')
        print(f'SERVICE_CONTAINERS["{_esc(sid)}"]="{_esc(container)}"')
        print(f'SERVICE_COMPOSE["{_esc(sid)}"]="{_esc(compose_path)}"')
        print(f'SERVICE_CATEGORIES["{_esc(sid)}"]="{_esc(category)}"')
        print(f'SERVICE_DEPENDS["{_esc(sid)}"]="{_esc(" ".join(str(d) for d in depends))}"')
        health = s.get("health", "/health")
        health_timeout = s.get("health_timeout", 5)  # Default 5 seconds
        port = s.get("external_port_default", s.get("port", 0))
        port_env = s.get("external_port_env", "")
        print(f'SERVICE_HEALTH["{_esc(sid)}"]="{_esc(health)}"')
        print(f'SERVICE_HEALTH_TIMEOUTS["{_esc(sid)}"]="{_esc(health_timeout)}"')
        print(f'SERVICE_PORTS["{_esc(sid)}"]="{_esc(port)}"')
        print(f'SERVICE_PORT_ENVS["{_esc(sid)}"]="{_esc(port_env)}"')
        print(f'SERVICE_NAMES["{_esc(sid)}"]="{_esc(s.get("name", sid))}"')
        setup_hook = s.get("setup_hook", "")
        setup_path = ""
        if setup_hook:
            full = service_dir / setup_hook
            if full.exists():
                setup_path = str(full)
        print(f'SERVICE_SETUP_HOOKS["{_esc(sid)}"]="{_esc(setup_path)}"')
        # GPU backends (default to amd/nvidia/apple, consistent with dashboard-api)
        gpu_backends = s.get("gpu_backends", ["amd", "nvidia", "apple"])
        backends_str = " ".join(str(b) for b in gpu_backends)
        print(f'SERVICE_GPU_BACKENDS["{_esc(sid)}"]="{_esc(backends_str)}"')
    except Exception as exc:
        print(f'# ERROR: failed to parse {manifest_path}: {exc}', file=sys.stderr)
        continue
PYEOF

    # Source the generated registry (one subprocess for all manifests)
    [[ -f "$_SR_CACHE" ]] && . "$_SR_CACHE"
    rm -f "$_SR_CACHE"
    _SR_LOADED=true
}

# Resolve a user-provided name to a compose service ID
sr_resolve() {
    sr_load
    local input="$1"
    echo "${SERVICE_ALIASES[$input]:-$input}"
}

# Get container name for a service ID
sr_container() {
    sr_load
    local sid
    sid=$(sr_resolve "$1")
    echo "${SERVICE_CONTAINERS[$sid]:-dream-$sid}"
}

# Get compose fragment path for a service ID
sr_compose_file() {
    sr_load
    local sid
    sid=$(sr_resolve "$1")
    echo "${SERVICE_COMPOSE[$sid]:-}"
}

# List all service IDs
sr_list_all() {
    sr_load
    printf '%s\n' "${SERVICE_IDS[@]}"
}

# List enabled services (have compose fragments that exist)
sr_list_enabled() {
    sr_load
    for sid in "${SERVICE_IDS[@]}"; do
        local cf="${SERVICE_COMPOSE[$sid]}"
        [[ -n "$cf" && -f "$cf" ]] && echo "$sid"
    done
}

# Get display name for a service ID
sr_service_names() {
    sr_load
    for sid in "${SERVICE_IDS[@]}"; do
        printf '%s\t%s\n' "$sid" "${SERVICE_NAMES[$sid]:-$sid}"
    done
}

# Build compose -f flags for all enabled extension services
sr_compose_flags() {
    sr_load

    # Return cached result if available
    if [[ "$_SR_COMPOSE_FLAGS_CACHED" == "true" ]]; then
        ((_SR_CACHE_HITS++))
        echo "$_SR_COMPOSE_FLAGS_CACHE"
        return 0
    fi

    # Cache miss: rebuild flags
    ((_SR_CACHE_MISSES++))
    local flags=""
    for sid in "${SERVICE_IDS[@]}"; do
        local cf="${SERVICE_COMPOSE[$sid]}"
        [[ -n "$cf" && -f "$cf" ]] && flags="$flags -f $cf"
    done

    # Store in cache
    _SR_COMPOSE_FLAGS_CACHE="$flags"
    _SR_COMPOSE_FLAGS_CACHED=true

    echo "$flags"
}

# Invalidate compose flags cache (call when extensions directory changes)
sr_cache_invalidate() {
    _SR_COMPOSE_FLAGS_CACHED=false
    _SR_COMPOSE_FLAGS_CACHE=""
}

# Get cache statistics for debugging
sr_cache_stats() {
    echo "Cache Hits: $_SR_CACHE_HITS"
    echo "Cache Misses: $_SR_CACHE_MISSES"
    if [[ $_SR_CACHE_MISSES -gt 0 ]]; then
        local total=$((_SR_CACHE_HITS + _SR_CACHE_MISSES))
        local hit_rate=$((_SR_CACHE_HITS * 100 / total))
        echo "Hit Rate: ${hit_rate}%"
    fi
}
