#!/usr/bin/env bash
# Langfuse post_install hook — Linux bind-mount uid alignment.
#
# The langfuse stack uses upstream images that run as non-root uids baked
# into the image:
#   - postgres:17.9-alpine          -> runs as uid 70  (postgres)
#   - clickhouse/clickhouse-server  -> runs as uid 101 (clickhouse)
#
# On Linux native Docker, bind mounts preserve host uid/gid, so a data
# directory owned by the install user (e.g. 1000:1000) causes initdb to
# fail with "permission denied" on first start. macOS Docker Desktop
# (osxfs/virtiofs) and WSL2 Docker Desktop (virtiofs) mask this by
# translating uids transparently — no chown needed on those platforms.
#
# Hook contract (see bin/dream-host-agent.py:_handle_install):
#   $1 = INSTALL_DIR (absolute path to dream-server install)
#   $2 = GPU_BACKEND (informational; unused here)
#
# Idempotent by nature: chown is a no-op when ownership already matches.

set -euo pipefail

INSTALL_DIR="${1:-}"
# shellcheck disable=SC2034  # $2 is part of the hook contract; kept for clarity
GPU_BACKEND="${2:-}"

log() {
    echo "langfuse post_install: $*" >&2
}

if [[ -z "$INSTALL_DIR" ]]; then
    log "ERROR: INSTALL_DIR (arg 1) is required"
    exit 2
fi

# Platform check — only act on Linux-family hosts (including WSL2).
# macOS Docker Desktop masks uid mismatch; chown would be a harmless
# no-op there but we skip to keep the intent explicit.
PLATFORM="$(uname -s)"
if [[ "$PLATFORM" == "Darwin" ]]; then
    log "macOS Docker Desktop handles uid translation; no chown needed"
    exit 0
fi

POSTGRES_DIR="$INSTALL_DIR/data/langfuse/postgres"
CLICKHOUSE_DIR="$INSTALL_DIR/data/langfuse/clickhouse"

# Pick an elevator: sudo if available and we're not already root.
# If neither is possible, fall back to plain chown (may fail — log and
# continue so the operator sees a clear warning rather than a silent abort).
SUDO=""
if [[ "$(id -u)" -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    fi
fi

is_container_running() {
    # docker ps returns only running containers; --quiet is empty when none match.
    local name="$1"
    [[ -n "$(docker ps --quiet --filter "name=^${name}$" 2>/dev/null)" ]]
}

chown_dir() {
    local dir="$1"
    local owner="$2"  # uid:gid
    local guard_container="${3:-}"

    # If the container is already running, ownership must already satisfy the
    # image's uid (postgres won't start otherwise) — re-running chown -R on a
    # live data directory races with WAL writes and gains nothing. Skip with
    # a clear log line so re-invocation of the hook on a healthy install is
    # safe.
    if [[ -n "$guard_container" ]] && is_container_running "$guard_container"; then
        log "$guard_container is running; skipping chown of $dir (ownership already correct)"
        return 0
    fi

    # Defensive: create the directory if the installer hasn't yet.
    # Phase 06 normally pre-creates these, but running the hook
    # out-of-band (e.g. via extension/install) should still work.
    if [[ ! -d "$dir" ]]; then
        log "creating $dir"
        if ! mkdir -p "$dir" 2>/dev/null; then
            if [[ -n "$SUDO" ]]; then
                $SUDO mkdir -p "$dir"
            else
                log "ERROR: cannot create $dir — sudo unavailable and mkdir failed (permission denied). " \
                    "langfuse postgres/clickhouse will fail to initialize without this directory. " \
                    "Run manually: sudo mkdir -p $dir && sudo chown -R $owner $dir, then retry the install."
                return 1
            fi
        fi
    fi

    log "chown -R $owner $dir"
    if [[ -n "$SUDO" ]]; then
        if ! $SUDO chown -R "$owner" "$dir"; then
            log "ERROR: 'sudo chown -R $owner $dir' failed. " \
                "langfuse postgres (uid 70) / clickhouse (uid 101) will fail to initialize without this ownership. " \
                "Verify the path exists and is writable, then run manually: sudo chown -R $owner $dir, then retry the install."
            return 1
        fi
    else
        if ! chown -R "$owner" "$dir" 2>/dev/null; then
            log "ERROR: chown failed for $dir and sudo is unavailable (not root, sudo not installed). " \
                "langfuse postgres (uid 70) / clickhouse (uid 101) will fail to initialize without this ownership. " \
                "Run manually as root: chown -R $owner $dir (or install sudo), then retry the install."
            return 1
        fi
    fi
}

# postgres official image: uid 70 (postgres user baked into image)
chown_dir "$POSTGRES_DIR" "70:70" "dream-langfuse-postgres"

# clickhouse-server image: uid 101 (clickhouse user)
chown_dir "$CLICKHOUSE_DIR" "101:101" "dream-langfuse-clickhouse"

log "done"
exit 0
