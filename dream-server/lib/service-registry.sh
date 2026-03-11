#!/bin/bash
# Service Registry — loads extension manifests and provides lookup functions.
# Source this file: . "$SCRIPT_DIR/lib/service-registry.sh"

EXTENSIONS_DIR="${SCRIPT_DIR:-$(pwd)}/extensions/services"
_SR_LOADED=false
_SR_CACHE_DIR="${SCRIPT_DIR:-$(pwd)}/.cache"
_SR_CACHE="$_SR_CACHE_DIR/service-registry.sh"
_SR_MTIME_CACHE="$_SR_CACHE_DIR/service-registry.mtimes"

# Associative arrays (bash 4+)
declare -A SERVICE_ALIASES      # alias → service_id
declare -A SERVICE_CONTAINERS   # service_id → container_name
declare -A SERVICE_COMPOSE      # service_id → compose file path
declare -A SERVICE_CATEGORIES   # service_id → core|recommended|optional
declare -A SERVICE_DEPENDS      # service_id → space-separated dependency IDs
declare -A SERVICE_HEALTH       # service_id → health endpoint path
declare -A SERVICE_PORTS        # service_id → external port (what the user hits on localhost)
declare -A SERVICE_PORT_ENVS    # service_id → env var name for the external port
declare -A SERVICE_NAMES        # service_id → display name
declare -A SERVICE_SETUP_HOOKS  # service_id → absolute path to setup script
declare -a SERVICE_IDS          # ordered list of all service IDs

# Check if cache is valid by comparing manifest mtimes
_sr_cache_valid() {
    [[ -f "$_SR_CACHE" && -f "$_SR_MTIME_CACHE" ]] || return 1

    # Check if extensions directory exists
    [[ -d "$EXTENSIONS_DIR" ]] || return 1

    # Build current mtime snapshot
    local current_mtimes=""
    while IFS= read -r -d '' manifest; do
        local mtime
        mtime=$(stat -c %Y "$manifest" 2>/dev/null || stat -f %m "$manifest" 2>/dev/null || echo "0")
        current_mtimes="${current_mtimes}${manifest}:${mtime}"$'\n'
    done < <(find "$EXTENSIONS_DIR" -maxdepth 2 -name "manifest.y*ml" -o -name "manifest.json" 2>/dev/null | sort -z)

    # Compare with cached mtimes
    local cached_mtimes
    cached_mtimes=$(cat "$_SR_MTIME_CACHE" 2>/dev/null || echo "")

    [[ "$current_mtimes" == "$cached_mtimes" ]]
}

# Generate cache from manifests
_sr_generate_cache() {
    mkdir -p "$_SR_CACHE_DIR"

    # Generate registry cache
    python3 - "$EXTENSIONS_DIR" <<'PYEOF' > "$_SR_CACHE.tmp"
import yaml, sys, os
from pathlib import Path

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
        if m.get("schema_version") != "dream.services.v1":
            continue
        s = m.get("service", {})
        sid = s.get("id", "")
        if not sid:
            continue
        aliases = s.get("aliases", [])
        container = s.get("container_name", f"dream-{sid}")
        compose_file = s.get("compose_file", "")
        category = s.get("category", "optional")
        depends = s.get("depends_on", [])

        # Resolve compose path (relative to extension dir)
        compose_path = ""
        if compose_file:
            full = service_dir / compose_file
            if full.exists():
                compose_path = str(full)

        # Emit sourceable lines
        print(f'SERVICE_IDS+=("{sid}")')
        print(f'SERVICE_ALIASES["{sid}"]="{sid}"')
        for a in aliases:
            print(f'SERVICE_ALIASES["{a}"]="{sid}"')
        print(f'SERVICE_CONTAINERS["{sid}"]="{container}"')
        print(f'SERVICE_COMPOSE["{sid}"]="{compose_path}"')
        print(f'SERVICE_CATEGORIES["{sid}"]="{category}"')
        print(f'SERVICE_DEPENDS["{sid}"]="{" ".join(depends)}"')
        health = s.get("health", "/health")
        port = s.get("external_port_default", s.get("port", 0))
        port_env = s.get("external_port_env", "")
        print(f'SERVICE_HEALTH["{sid}"]="{health}"')
        print(f'SERVICE_PORTS["{sid}"]="{port}"')
        print(f'SERVICE_PORT_ENVS["{sid}"]="{port_env}"')
        print(f'SERVICE_NAMES["{sid}"]="{s.get("name", sid)}"')
        setup_hook = s.get("setup_hook", "")
        setup_path = ""
        if setup_hook:
            full = service_dir / setup_hook
            if full.exists():
                setup_path = str(full)
        print(f'SERVICE_SETUP_HOOKS["{sid}"]="{setup_path}"')
    except Exception:
        continue
PYEOF

    # Move to final location atomically
    [[ -f "$_SR_CACHE.tmp" ]] && mv "$_SR_CACHE.tmp" "$_SR_CACHE"

    # Generate mtime cache
    : > "$_SR_MTIME_CACHE.tmp"
    while IFS= read -r -d '' manifest; do
        local mtime
        mtime=$(stat -c %Y "$manifest" 2>/dev/null || stat -f %m "$manifest" 2>/dev/null || echo "0")
        echo "${manifest}:${mtime}" >> "$_SR_MTIME_CACHE.tmp"
    done < <(find "$EXTENSIONS_DIR" -maxdepth 2 -name "manifest.y*ml" -o -name "manifest.json" 2>/dev/null | sort -z)

    [[ -f "$_SR_MTIME_CACHE.tmp" ]] && mv "$_SR_MTIME_CACHE.tmp" "$_SR_MTIME_CACHE"
}

sr_load() {
    [[ "$_SR_LOADED" == "true" ]] && return 0
    SERVICE_IDS=()

    # Use cache if valid, otherwise regenerate
    if _sr_cache_valid; then
        . "$_SR_CACHE"
    else
        _sr_generate_cache
        [[ -f "$_SR_CACHE" ]] && . "$_SR_CACHE"
    fi

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
    local flags=""
    for sid in "${SERVICE_IDS[@]}"; do
        local cf="${SERVICE_COMPOSE[$sid]}"
        [[ -n "$cf" && -f "$cf" ]] && flags="$flags -f $cf"
    done
    echo "$flags"
}

# Validate services in extensions.list against available services
# Args: $1 = path to extensions.list file
# Returns: 0 if all OK, 1 if missing enabled services found
# Outputs: enabled_count|enabled_list|disabled_count|disabled_list
sr_validate_extensions_list() {
    local extensions_list="$1"
    [[ -f "$extensions_list" ]] || { echo "0||0|"; return 1; }

    sr_load

    local missing_enabled=()
    local missing_disabled=()

    while IFS=: read -r state sid; do
        [[ -z "$sid" ]] && continue
        # Skip comments and empty lines
        [[ "$state" =~ ^[[:space:]]*# ]] && continue

        # Check if service exists in current registry
        local found=false
        for s in "${SERVICE_IDS[@]}"; do
            [[ "$s" == "$sid" ]] && found=true && break
        done

        if [[ "$found" == "false" ]]; then
            if [[ "$state" == "enabled" ]]; then
                missing_enabled+=("$sid")
            elif [[ "$state" == "disabled" ]]; then
                missing_disabled+=("$sid")
            fi
        fi
    done < "$extensions_list"

    # Output format: enabled_count|enabled_list|disabled_count|disabled_list
    echo "${#missing_enabled[@]}|${missing_enabled[*]}|${#missing_disabled[@]}|${missing_disabled[*]}"

    # Return 1 if any enabled services are missing (warning condition)
    [[ ${#missing_enabled[@]} -gt 0 ]] && return 1
    return 0
}
