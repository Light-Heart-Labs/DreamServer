#!/bin/bash
# ============================================================================
# Guardian — Self-Healing Process Watchdog
# ============================================================================
# Runs as a root-level systemd service. Agents cannot kill, modify, or
# interfere with this process. It monitors all critical infrastructure
# and auto-heals from known-good backups when things break.
#
# Design principles:
#   1. Agents CAN'T touch guardian (root-owned, system service)
#   2. Guardian KNOWS what healthy looks like (config + backups)
#   3. Guardian HEALS automatically (restart -> restore -> restart)
#   4. Guardian LOGS everything (so you know what broke and when)
#
# Supported types:
#   process        — match by pgrep, restart via start_cmd
#   systemd-user   — systemctl --user service
#   docker         — docker container, restart via docker restart
#   file-integrity — validate file exists and is valid (JSON, etc.)
# ============================================================================

set -uo pipefail

# ── Config file search order ──────────────────────────────────────────────
# 1. $GUARDIAN_CONF env var (explicit override)
# 2. ./guardian.conf (local development / testing)
# 3. /etc/guardian/guardian.conf (installed location)

if [[ -n "${GUARDIAN_CONF:-}" ]]; then
    CONF_FILE="$GUARDIAN_CONF"
elif [[ -f "./guardian.conf" ]]; then
    CONF_FILE="./guardian.conf"
else
    CONF_FILE="/etc/guardian/guardian.conf"
fi

BACKUP_DIR="/var/lib/guardian/backups"
STATE_DIR="/var/lib/guardian/state"
LOG_FILE="/var/log/guardian.log"
MAX_LOG_SIZE=10485760  # 10MB
BACKUP_GENERATIONS=5

# ── Logging ────────────────────────────────────────────────────────────────

log() {
    local level="$1"; shift
    local msg="$*"
    local ts
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$ts] [$level] $msg" >> "$LOG_FILE"
    echo "[$level] $msg"
}

rotate_log() {
    if [[ -f "$LOG_FILE" ]] && (( $(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0) > MAX_LOG_SIZE )); then
        mv "$LOG_FILE" "${LOG_FILE}.1"
        log INFO "Log rotated"
    fi
}

# ── Config Parser ──────────────────────────────────────────────────────────

declare -A CONFIG
SECTIONS=()

parse_config() {
    local section=""
    while IFS= read -r line; do
        line="${line%%#*}"
        line="${line## }"
        line="${line%% }"
        [[ -z "$line" ]] && continue

        if [[ "$line" =~ ^\[([a-zA-Z0-9_-]+)\]$ ]]; then
            section="${BASH_REMATCH[1]}"
            SECTIONS+=("$section")
            continue
        fi

        if [[ "$line" =~ ^([a-zA-Z_][a-zA-Z0-9_]*)=(.*)$ ]]; then
            CONFIG["${section}.${BASH_REMATCH[1]}"]="${BASH_REMATCH[2]}"
        fi
    done < "$CONF_FILE"
}

cfg() {
    local key="${1}.${2}"
    local default="${3:-}"
    echo "${CONFIG[$key]:-$default}"
}

# ── Immutable Flag Helpers ─────────────────────────────────────────────────
# All protected files and backups are chattr +i (immutable). Guardian runs
# as root and must temporarily clear the flag before writing, then re-set it.

clear_immutable() {
    local file="$1"
    [[ -f "$file" ]] && chattr -i "$file" 2>/dev/null || true
}

set_immutable() {
    local file="$1"
    [[ -f "$file" ]] && chattr +i "$file" 2>/dev/null || true
}

secure_backup() {
    # Ensure backup file is root-owned, locked down, and immutable
    local file="$1"
    chown root:root "$file" 2>/dev/null || true
    chmod 600 "$file" 2>/dev/null || true
    set_immutable "$file"
}

# ── Self-Integrity Check ──────────────────────────────────────────────────
# Verify guardian's own files haven't been tampered with. If immutable
# flags have been removed (e.g. agent used sudo chattr -i), re-set them.
# Paths are derived from the install location and config file path.

check_self_integrity() {
    local conf_dir
    conf_dir=$(dirname "$CONF_FILE")
    local files=( /usr/local/bin/guardian.sh "$CONF_FILE" /etc/systemd/system/guardian.service )
    for f in "${files[@]}"; do
        if [[ -f "$f" ]]; then
            local attrs
            attrs=$(lsattr "$f" 2>/dev/null || echo "")
            if [[ -n "$attrs" ]] && [[ ! "$attrs" =~ ^....i ]]; then
                chattr +i "$f" 2>/dev/null || true
                log WARN "[self-integrity] Immutable flag was missing on $f — RESTORED"
            fi
        fi
    done
}

# ── Backup Management ──────────────────────────────────────────────────────

rotate_backups() {
    # Rotate backup generations: current -> .1 -> .2 -> ... -> .$BACKUP_GENERATIONS
    local snap_dir="$1"
    local bname="$2"
    local max_gen="$BACKUP_GENERATIONS"

    # Delete oldest generation
    local oldest="$snap_dir/${bname}.${max_gen}"
    if [[ -f "$oldest" ]]; then
        clear_immutable "$oldest"
        rm -f "$oldest"
    fi

    # Shift generations up: .4 -> .5, .3 -> .4, etc.
    local i=$((max_gen - 1))
    while (( i >= 1 )); do
        local src="$snap_dir/${bname}.${i}"
        local dst="$snap_dir/${bname}.$((i + 1))"
        if [[ -f "$src" ]]; then
            clear_immutable "$src"
            mv "$src" "$dst"
            secure_backup "$dst"
        fi
        i=$((i - 1))
    done

    # Current backup -> .1
    local current="$snap_dir/$bname"
    if [[ -f "$current" ]]; then
        clear_immutable "$current"
        cp -p "$current" "$snap_dir/${bname}.1"
        secure_backup "$snap_dir/${bname}.1"
    fi
}

take_snapshot() {
    local section="$1"
    local files_csv
    files_csv=$(cfg "$section" protected_files "")
    [[ -z "$files_csv" ]] && return 0

    local snap_dir="$BACKUP_DIR/$section"
    mkdir -p "$snap_dir"

    IFS=',' read -ra files <<< "$files_csv"
    for filepath in "${files[@]}"; do
        filepath="${filepath## }"
        filepath="${filepath%% }"
        [[ ! -f "$filepath" ]] && continue

        local bname
        bname=$(basename "$filepath")
        local backup_path="$snap_dir/$bname"

        if [[ ! -f "$backup_path" ]] || ! diff -q "$filepath" "$backup_path" &>/dev/null; then
            rotate_backups "$snap_dir" "$bname"
            clear_immutable "$backup_path"
            cp -p "$filepath" "$backup_path"
            secure_backup "$backup_path"
            log INFO "[$section] Snapshot updated: $bname"
        fi
    done

    # Snapshot systemd service file if defined
    local svc_file
    svc_file=$(cfg "$section" protected_service "")
    if [[ -n "$svc_file" && -f "$svc_file" ]]; then
        local svc_bname
        svc_bname=$(basename "$svc_file")
        local svc_backup="$snap_dir/$svc_bname"
        if [[ ! -f "$svc_backup" ]] || ! diff -q "$svc_file" "$svc_backup" &>/dev/null; then
            rotate_backups "$snap_dir" "$svc_bname"
            clear_immutable "$svc_backup"
            cp -p "$svc_file" "$svc_backup"
            secure_backup "$svc_backup"
            log INFO "[$section] Service file snapshot: $svc_bname"
        fi
    fi
}

restore_from_backup() {
    local section="$1"
    local files_csv
    files_csv=$(cfg "$section" protected_files "")
    [[ -z "$files_csv" ]] && return 1

    local snap_dir="$BACKUP_DIR/$section"
    [[ ! -d "$snap_dir" ]] && { log ERROR "[$section] No backup directory!"; return 1; }

    local svc_user
    svc_user=$(cfg "$section" start_user "$(cfg "$section" systemd_user "")")

    IFS=',' read -ra files <<< "$files_csv"
    local restored=0
    for filepath in "${files[@]}"; do
        filepath="${filepath## }"
        filepath="${filepath%% }"
        local bname
        bname=$(basename "$filepath")
        local backup_path="$snap_dir/$bname"

        if [[ -f "$backup_path" ]]; then
            clear_immutable "$filepath"
            if cp -p "$backup_path" "$filepath" 2>/dev/null; then
                if [[ -n "$svc_user" ]]; then
                    chown "$svc_user:$svc_user" "$filepath" 2>/dev/null || true
                fi
                local skip_imm
                skip_imm=$(cfg "$section" skip_immutable "")
                if [[ "$skip_imm" != "true" ]]; then
                    set_immutable "$filepath"
                fi
                restored=1
                log WARN "[$section] RESTORED: $bname"
            else
                log ERROR "[$section] FAILED to restore $bname (write error)"
            fi
        fi
    done

    # Restore service file
    local svc_file
    svc_file=$(cfg "$section" protected_service "")
    if [[ -n "$svc_file" ]]; then
        local svc_bname
        svc_bname=$(basename "$svc_file")
        local svc_backup="$snap_dir/$svc_bname"
        if [[ -f "$svc_backup" ]]; then
            clear_immutable "$svc_file"
            if cp -p "$svc_backup" "$svc_file" 2>/dev/null; then
                set_immutable "$svc_file"
                log WARN "[$section] RESTORED service file: $svc_bname (immutable flag re-set)"
            else
                log ERROR "[$section] FAILED to restore service file: $svc_bname (write error)"
            fi
        fi
    fi

    (( restored )) && return 0 || return 1
}

# ── Health Checks ──────────────────────────────────────────────────────────

check_ports() {
    local ports_csv="$1"
    [[ -z "$ports_csv" ]] && return 0
    IFS=',' read -ra ports <<< "$ports_csv"
    for port in "${ports[@]}"; do
        port="${port## }"
        port="${port%% }"
        [[ -z "$port" ]] && continue
        if ! ss -tlnp | grep -q ":${port} " 2>/dev/null; then
            return 1
        fi
    done
    return 0
}

check_health_url() {
    local url="$1"
    [[ -z "$url" ]] && return 0
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo "000")
    [[ "$code" =~ ^2[0-9][0-9]$ ]]
}

check_health_port() {
    local port="$1"
    [[ -z "$port" ]] && return 0
    ss -tlnp | grep -q ":${port} " 2>/dev/null
}

check_systemd_service() {
    local service="$1"
    local user="$2"
    sudo -u "$user" XDG_RUNTIME_DIR="/run/user/$(id -u "$user")" systemctl --user is-active "$service" &>/dev/null
}

check_process() {
    local match="$1"
    [[ -z "$match" ]] && return 0
    pgrep -f "$match" &>/dev/null
}

check_docker() {
    local container="$1"
    [[ -z "$container" ]] && return 0
    local status
    status=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || echo "false")
    [[ "$status" == "true" ]]
}

check_file_integrity() {
    local section="$1"
    local files_csv
    files_csv=$(cfg "$section" protected_files "")
    [[ -z "$files_csv" ]] && return 0

    IFS=',' read -ra files <<< "$files_csv"
    for filepath in "${files[@]}"; do
        filepath="${filepath## }"
        filepath="${filepath%% }"
        # File must exist
        [[ ! -f "$filepath" ]] && return 1
        # File must not be empty
        [[ ! -s "$filepath" ]] && return 1
    done

    # If JSON keys are required, validate them
    local json_keys
    json_keys=$(cfg "$section" required_json_keys "")
    if [[ -n "$json_keys" ]]; then
        for filepath in "${files[@]}"; do
            filepath="${filepath## }"
            filepath="${filepath%% }"
            [[ "$filepath" != *.json ]] && continue
            # Must be valid JSON
            if ! python3 -c "import json; json.load(open('$filepath'))" 2>/dev/null; then
                return 1
            fi
            # Must have required keys
            IFS=',' read -ra keys <<< "$json_keys"
            for key in "${keys[@]}"; do
                key="${key## }"
                key="${key%% }"
                if ! python3 -c "import json; d=json.load(open('$filepath')); assert '$key' in d" 2>/dev/null; then
                    return 1
                fi
            done
        done
    fi

    # If JSON values are pinned, validate them
    local json_values
    json_values=$(cfg "$section" required_json_values "")
    if [[ -n "$json_values" ]]; then
        for filepath in "${files[@]}"; do
            filepath="${filepath## }"
            filepath="${filepath%% }"
            [[ "$filepath" != *.json ]] && continue
            IFS="," read -ra pairs <<< "$json_values"
            for pair in "${pairs[@]}"; do
                pair="${pair## }"
                pair="${pair%% }"
                local jpath="${pair%%=*}"
                local expected="${pair#*=}"
                local actual
                actual=$(python3 -c "
import json, functools
d = json.load(open('$filepath'))
keys = '$jpath'.split('.')
val = functools.reduce(lambda o, k: o[k], keys, d)
print(val if isinstance(val, str) else json.dumps(val))
" 2>/dev/null || echo "__MISSING__")
                if [[ "$actual" != "$expected" ]]; then
                    log WARN "[$section] JSON value mismatch in $(basename $filepath): $jpath expected='$expected' got='$actual'"
                    return 1
                fi
            done
        done
    fi
    return 0
}

# ── Recovery Actions ───────────────────────────────────────────────────────

restart_process() {
    local section="$1"
    local start_cmd
    start_cmd=$(cfg "$section" start_cmd "")
    local start_dir
    start_dir=$(cfg "$section" start_dir "")
    local start_user
    start_user=$(cfg "$section" start_user "$(whoami)")
    local start_venv
    start_venv=$(cfg "$section" start_venv "")

    if [[ -z "$start_cmd" ]]; then
        log ERROR "[$section] No start_cmd defined"
        return 1
    fi

    # Kill existing
    local match
    match=$(cfg "$section" process_match "")
    if [[ -n "$match" ]]; then
        pkill -f "$match" 2>/dev/null || true
        sleep 2
        pkill -9 -f "$match" 2>/dev/null || true
        sleep 1
    fi

    # Free ports
    local ports_csv
    ports_csv=$(cfg "$section" required_ports "")
    if [[ -n "$ports_csv" ]]; then
        IFS=',' read -ra ports <<< "$ports_csv"
        for port in "${ports[@]}"; do
            port="${port## }"
            [[ -n "$port" ]] && fuser -k "${port}/tcp" 2>/dev/null || true
        done
        sleep 1
    fi

    # Build the start command
    local run_cmd=""
    if [[ -n "$start_venv" ]]; then
        run_cmd="source '$start_venv/bin/activate' && "
    fi
    if [[ -n "$start_dir" ]]; then
        run_cmd="${run_cmd}cd '$start_dir' && "
    fi

    # Determine how to run: .py files get python, .sh files get bash
    if [[ "$start_cmd" == *.py ]]; then
        run_cmd="${run_cmd}nohup python3 '$start_cmd' > /tmp/guardian-${section}.log 2>&1 &"
    else
        run_cmd="${run_cmd}nohup bash '$start_cmd' > /tmp/guardian-${section}.log 2>&1 &"
    fi

    log INFO "[$section] Starting: $start_cmd (user=$start_user)"
    sudo -u "$start_user" bash -c "$run_cmd"
    return 0
}

restart_systemd_service() {
    local section="$1"
    local service
    service=$(cfg "$section" service "")
    local user
    user=$(cfg "$section" systemd_user "")

    if [[ -z "$service" ]]; then
        log ERROR "[$section] No service defined"
        return 1
    fi

    if [[ -z "$user" ]]; then
        log ERROR "[$section] No systemd_user defined"
        return 1
    fi

    local uid
    uid=$(id -u "$user")

    log INFO "[$section] Restarting systemd: $service"
    sudo -u "$user" XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user daemon-reload 2>/dev/null || true
    sudo -u "$user" XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user restart "$service" 2>/dev/null
}

restart_docker() {
    local section="$1"
    local container
    container=$(cfg "$section" container_name "")

    if [[ -z "$container" ]]; then
        log ERROR "[$section] No container_name defined"
        return 1
    fi

    log INFO "[$section] Restarting docker container: $container"
    docker restart "$container" 2>/dev/null
}

do_restart() {
    local section="$1"
    local type="$2"

    # Check if this section delegates restart to another section
    local restart_via
    restart_via=$(cfg "$section" restart_via "")
    if [[ -n "$restart_via" ]]; then
        local via_type
        via_type=$(cfg "$restart_via" type "")
        log INFO "[$section] Delegating restart to [$restart_via]"
        do_restart "$restart_via" "$via_type"
        return $?
    fi

    case "$type" in
        process)        restart_process "$section" ;;
        systemd-user)   restart_systemd_service "$section" ;;
        docker)         restart_docker "$section" ;;
        file-integrity) restore_from_backup "$section" ;;
        *)              log ERROR "[$section] Unknown type: $type"; return 1 ;;
    esac
}

# ── Main Check for a Single Section ───────────────────────────────────────

check_section() {
    local section="$1"
    local enabled
    enabled=$(cfg "$section" enabled "false")
    [[ "$enabled" != "true" ]] && return 0

    local type
    type=$(cfg "$section" type "")
    local desc
    desc=$(cfg "$section" description "$section")
    local max_soft
    max_soft=$(cfg "$section" max_soft_restarts "3")
    local grace
    grace=$(cfg "$section" restart_grace "10")

    # Track failure count
    local fail_file="$STATE_DIR/${section}.failures"
    local fail_count=0
    [[ -f "$fail_file" ]] && fail_count=$(cat "$fail_file" 2>/dev/null || echo 0)

    # ── Determine health ──
    local healthy=true
    local reason=""

    case "$type" in
        process)
            local match
            match=$(cfg "$section" process_match "")
            if [[ -n "$match" ]] && ! check_process "$match"; then
                healthy=false
                reason="process not found (match: $match)"
            fi
            ;;
        systemd-user)
            local service
            service=$(cfg "$section" service "")
            local user
            user=$(cfg "$section" systemd_user "")
            if [[ -n "$service" && -n "$user" ]] && ! check_systemd_service "$service" "$user"; then
                healthy=false
                reason="systemd service $service not active"
            fi
            ;;
        docker)
            local container
            container=$(cfg "$section" container_name "")
            if [[ -n "$container" ]] && ! check_docker "$container"; then
                healthy=false
                reason="docker container $container not running"
            fi
            ;;
        file-integrity)
            if ! check_file_integrity "$section"; then
                healthy=false
                reason="file integrity check failed"
            fi
            ;;
    esac

    # Check ports (all types)
    if $healthy; then
        local ports
        ports=$(cfg "$section" required_ports "")
        if [[ -n "$ports" ]] && ! check_ports "$ports"; then
            healthy=false
            reason="required ports not listening ($ports)"
        fi
    fi

    # Check health URL (all types)
    if $healthy; then
        local health_url
        health_url=$(cfg "$section" health_url "")
        if [[ -n "$health_url" ]] && ! check_health_url "$health_url"; then
            healthy=false
            reason="health check failed ($health_url)"
        fi
    fi

    # Check health port (all types)
    if $healthy; then
        local health_port
        health_port=$(cfg "$section" health_port "")
        if [[ -n "$health_port" ]] && ! check_health_port "$health_port"; then
            healthy=false
            reason="health port not listening ($health_port)"
        fi
    fi

    # Check health command (all types) — runs a custom script, non-zero = unhealthy
    if $healthy; then
        local health_cmd
        health_cmd=$(cfg "$section" health_cmd "")
        if [[ -n "$health_cmd" ]]; then
            local cmd_output
            cmd_output=$(bash -c "$health_cmd" 2>&1)
            if [[ $? -ne 0 ]]; then
                healthy=false
                reason="health_cmd failed: ${cmd_output:0:120}"
            fi
        fi
    fi

    # ── Healthy ──
    if $healthy; then
        if (( fail_count > 0 )); then
            log INFO "[$section] $desc RECOVERED. Resetting failure counter."
            echo 0 > "$fail_file"
        fi
        take_snapshot "$section"
        return 0
    fi

    # ── UNHEALTHY — recover ──
    fail_count=$((fail_count + 1))
    echo "$fail_count" > "$fail_file"
    log WARN "[$section] $desc UNHEALTHY: $reason (failure #$fail_count)"

    if (( fail_count <= max_soft )); then
        log INFO "[$section] Soft restart ($fail_count/$max_soft)"
        do_restart "$section" "$type"
        sleep "$grace"
    else
        log WARN "[$section] Soft restarts exhausted. RESTORING FROM BACKUP."
        if restore_from_backup "$section"; then
            log INFO "[$section] Backup restored. Restarting..."
            do_restart "$section" "$type"
            sleep "$grace"
            echo 0 > "$fail_file"
        else
            log ERROR "[$section] NO BACKUP AVAILABLE. Manual intervention required."
        fi
    fi
}

# ── Initial Snapshot ───────────────────────────────────────────────────────

initial_snapshot() {
    log INFO "Taking initial snapshots of all protected resources..."
    for section in "${SECTIONS[@]}"; do
        [[ "$section" == "general" ]] && continue
        local enabled
        enabled=$(cfg "$section" enabled "false")
        [[ "$enabled" != "true" ]] && continue
        take_snapshot "$section"
    done
    log INFO "Initial snapshots complete."
}

# ── Main ───────────────────────────────────────────────────────────────────

main() {
    mkdir -p "$BACKUP_DIR" "$STATE_DIR" "$(dirname "$LOG_FILE")"

    if [[ ! -f "$CONF_FILE" ]]; then
        echo "FATAL: Config not found: $CONF_FILE" >&2
        echo "Searched: \$GUARDIAN_CONF, ./guardian.conf, /etc/guardian/guardian.conf" >&2
        exit 1
    fi
    parse_config

    LOG_FILE=$(cfg general log_file "$LOG_FILE")
    MAX_LOG_SIZE=$(cfg general max_log_size "$MAX_LOG_SIZE")
    BACKUP_DIR=$(cfg general backup_dir "$BACKUP_DIR")
    BACKUP_GENERATIONS=$(cfg general backup_generations "$BACKUP_GENERATIONS")
    mkdir -p "$BACKUP_DIR" "$STATE_DIR"

    local interval
    interval=$(cfg general check_interval "60")

    # Count monitored sections
    local count=0
    for section in "${SECTIONS[@]}"; do
        [[ "$section" == "general" ]] && continue
        [[ "$(cfg "$section" enabled "false")" == "true" ]] && count=$((count + 1))
    done

    log INFO "=========================================="
    log INFO "Guardian starting"
    log INFO "  Config: $CONF_FILE"
    log INFO "  Monitoring: $count resources"
    log INFO "  Interval: ${interval}s"
    log INFO "  Backups: $BACKUP_DIR (${BACKUP_GENERATIONS} generations)"
    log INFO "=========================================="

    initial_snapshot

    while true; do
        rotate_log
        check_self_integrity
        for section in "${SECTIONS[@]}"; do
            [[ "$section" == "general" ]] && continue
            check_section "$section"
        done
        sleep "$interval"
    done
}

trap 'log INFO "Guardian shutting down (signal received)"; exit 0' SIGTERM SIGINT
main "$@"
