#!/bin/bash
# Service Registry — loads extension manifests and provides lookup functions.
# Source this file: . "$SCRIPT_DIR/lib/service-registry.sh"

ROOT_DIR="${SCRIPT_DIR:-$(pwd)}"
EXTENSIONS_DIR="$ROOT_DIR/extensions/services"
SR_REGISTRY_BUILDER="$ROOT_DIR/scripts/build-service-registry.py"
_SR_LOADED=false
_SR_CACHE="/tmp/dream-service-registry.$$.sh"
_SR_ARTIFACT="${DREAM_SERVICE_REGISTRY_PATH:-${TMPDIR:-/tmp}/dream-service-registry.$(id -u).json}"

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

sr_load() {
    [[ "$_SR_LOADED" == "true" ]] && return 0

    SERVICE_IDS=()
    SERVICE_ALIASES=()
    SERVICE_CONTAINERS=()
    SERVICE_COMPOSE=()
    SERVICE_CATEGORIES=()
    SERVICE_DEPENDS=()
    SERVICE_HEALTH=()
    SERVICE_PORTS=()
    SERVICE_PORT_ENVS=()
    SERVICE_NAMES=()
    SERVICE_SETUP_HOOKS=()

    if [[ ! -f "$SR_REGISTRY_BUILDER" ]]; then
        echo "service-registry: missing builder script at $SR_REGISTRY_BUILDER" >&2
        return 1
    fi

    # Generate (or refresh) shared registry artifact.
    python3 "$SR_REGISTRY_BUILDER" \
        --root-dir "$ROOT_DIR" \
        --output "$_SR_ARTIFACT" >/dev/null

    # Convert artifact JSON into sourceable bash assignments.
    python3 - "$_SR_ARTIFACT" <<'PYEOF' > "$_SR_CACHE"
import json
import shlex
import sys
from pathlib import Path

artifact = Path(sys.argv[1])
if not artifact.exists():
    sys.exit("service-registry: artifact missing")

data = json.loads(artifact.read_text(encoding="utf-8"))
if data.get("schema_version") != "dream.service-registry.v1":
    sys.exit("service-registry: unsupported artifact schema_version")

services = data.get("services", [])
if not isinstance(services, list):
    sys.exit("service-registry: invalid services payload")


def q(value):
    return shlex.quote("" if value is None else str(value))


for service in services:
    if not isinstance(service, dict):
        continue

    sid = str(service.get("id", "")).strip()
    if not sid:
        continue

    aliases = service.get("aliases", [])
    if not isinstance(aliases, list):
        aliases = []

    depends_on = service.get("depends_on", [])
    if not isinstance(depends_on, list):
        depends_on = []

    container_name = service.get("container_name") or f"dream-{sid}"
    compose_path = service.get("compose_path", "")
    category = service.get("category", "optional")
    health = service.get("health", "/health")
    port = service.get("external_port_default", service.get("port", 0))
    port_env = service.get("external_port_env", "")
    display_name = service.get("name", sid)
    setup_path = service.get("setup_path", "")

    print(f"SERVICE_IDS+=({q(sid)})")
    print(f"SERVICE_ALIASES[{q(sid)}]={q(sid)}")
    for alias in aliases:
        print(f"SERVICE_ALIASES[{q(alias)}]={q(sid)}")

    print(f"SERVICE_CONTAINERS[{q(sid)}]={q(container_name)}")
    print(f"SERVICE_COMPOSE[{q(sid)}]={q(compose_path)}")
    print(f"SERVICE_CATEGORIES[{q(sid)}]={q(category)}")
    print(f"SERVICE_DEPENDS[{q(sid)}]={q(' '.join(str(x) for x in depends_on))}")
    print(f"SERVICE_HEALTH[{q(sid)}]={q(health)}")
    print(f"SERVICE_PORTS[{q(sid)}]={q(port)}")
    print(f"SERVICE_PORT_ENVS[{q(sid)}]={q(port_env)}")
    print(f"SERVICE_NAMES[{q(sid)}]={q(display_name)}")
    print(f"SERVICE_SETUP_HOOKS[{q(sid)}]={q(setup_path)}")
PYEOF

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
    local flags=""
    for sid in "${SERVICE_IDS[@]}"; do
        local cf="${SERVICE_COMPOSE[$sid]}"
        [[ -n "$cf" && -f "$cf" ]] && flags="$flags -f $cf"
    done
    echo "$flags"
}

