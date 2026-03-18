#!/bin/bash
# Shared library for Docker Compose flag resolution
# Source this file: . "$SCRIPT_DIR/lib/compose-flags.sh"

# Build full compose flags: base + GPU overlay + enabled extensions
# Requires: INSTALL_DIR, TIER, GPU_BACKEND env vars
# Requires: service-registry.sh to be sourced first
get_compose_flags() {
    local base_flags
    if [[ -x "$INSTALL_DIR/scripts/resolve-compose-stack.sh" ]]; then
        base_flags=$("$INSTALL_DIR/scripts/resolve-compose-stack.sh" \
            --script-dir "$INSTALL_DIR" --tier "${TIER:-1}" --gpu-backend "${GPU_BACKEND:-nvidia}")
    elif [[ -f "$INSTALL_DIR/docker-compose.base.yml" ]]; then
        base_flags="-f docker-compose.base.yml"
    else
        base_flags="-f docker-compose.yml"
    fi
    local ext_flags
    ext_flags=$(sr_compose_flags)
    echo "$base_flags $ext_flags"
}
