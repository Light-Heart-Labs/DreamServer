#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
    echo "Usage: $0 [REPORT_PATH]"
    echo "       $0 --help"
    echo ""
    echo "Generates a machine-readable diagnostics report for installer and runtime readiness."
    echo "Report includes capability profile, preflight-style analysis, and autofix_hints."
    echo ""
    echo "Arguments:"
    echo "  REPORT_PATH  Output JSON path (default: /tmp/dream-doctor-report.json)"
    echo ""
    echo "Exit codes: 0 = report generated, 1 = error (e.g. missing dependency)"
    echo ""
    echo "See docs/DREAM-DOCTOR.md for details."
}
case "${1:-}" in
    -h|--help) usage; exit 0 ;;
esac

REPORT_FILE="${1:-/tmp/dream-doctor-report.json}"

CAP_FILE="/tmp/dream-doctor-capabilities.json"
PREFLIGHT_FILE="/tmp/dream-doctor-preflight.json"

# Source service registry and safe env helpers
if [[ -f "$ROOT_DIR/lib/service-registry.sh" ]]; then
    export SCRIPT_DIR="$ROOT_DIR"
    . "$ROOT_DIR/lib/service-registry.sh"
    sr_load
fi
if [[ -f "$ROOT_DIR/lib/safe-env.sh" ]]; then
    . "$ROOT_DIR/lib/safe-env.sh"
fi

# Safe .env loading (no direct source to avoid injection)
load_env_safe() {
    local env_file="${1:-$ROOT_DIR/.env}"
    [[ -f "$env_file" ]] || return 0
    while IFS='=' read -r key value; do
        [[ "$key" =~ ^[[:space:]]*# ]] && continue
        [[ -z "$key" ]] && continue
        [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"
        value="${value#\'}"
        export "$key=$value"
    done < "$env_file"
}
load_env_safe "$ROOT_DIR/.env"
_DASHBOARD_PORT="${SERVICE_PORTS[dashboard]:-3001}"
_WEBUI_PORT="${SERVICE_PORTS[open-webui]:-3000}"

RAM_GB="$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print int($2/1024/1024)}' || echo 0)"
DISK_GB="$(df -BG "$HOME" 2>/dev/null | tail -1 | awk '{gsub(/G/,"",$4); print int($4)}' || echo 0)"

if [[ -x "$SCRIPT_DIR/scripts/build-capability-profile.sh" ]]; then
    CAP_ENV="$("$SCRIPT_DIR/scripts/build-capability-profile.sh" --output "$CAP_FILE" --env)"
    load_env_from_output <<< "$CAP_ENV"
else
    echo "scripts/build-capability-profile.sh not found/executable" >&2
    exit 1
fi

if [[ -x "$SCRIPT_DIR/scripts/preflight-engine.sh" ]]; then
    PREFLIGHT_ENV="$("$SCRIPT_DIR/scripts/preflight-engine.sh" \
        --report "$PREFLIGHT_FILE" \
        --tier "${CAP_RECOMMENDED_TIER:-T1}" \
        --ram-gb "$RAM_GB" \
        --disk-gb "$DISK_GB" \
        --gpu-backend "${CAP_LLM_BACKEND:-cpu}" \
        --gpu-vram-mb "${CAP_GPU_VRAM_MB:-0}" \
        --gpu-name "${CAP_GPU_NAME:-Unknown}" \
        --platform-id "${CAP_PLATFORM_ID:-unknown}" \
        --compose-overlays "${CAP_COMPOSE_OVERLAYS:-}" \
        --script-dir "$ROOT_DIR" \
        --env)"
    load_env_from_output <<< "$PREFLIGHT_ENV"
else
    echo "scripts/preflight-engine.sh not found/executable" >&2
    exit 1
fi

DOCKER_CLI="false"
DOCKER_DAEMON="false"
COMPOSE_CLI="false"
DASHBOARD_HTTP="false"
WEBUI_HTTP="false"

# Extension diagnostics (JSON array of objects)
EXT_DIAGNOSTICS="[]"

if command -v docker >/dev/null 2>&1; then
    DOCKER_CLI="true"
    if docker info >/dev/null 2>&1; then
        DOCKER_DAEMON="true"
    fi
    if docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1; then
        COMPOSE_CLI="true"
    fi
fi

if command -v curl >/dev/null 2>&1; then
    if curl -sf --max-time 10 "http://localhost:${_DASHBOARD_PORT}" >/dev/null 2>&1; then
        DASHBOARD_HTTP="true"
    fi
    if curl -sf --max-time 10 "http://localhost:${_WEBUI_PORT}" >/dev/null 2>&1; then
        WEBUI_HTTP="true"
    fi
fi

# Collect extension diagnostics (wrapped in function to allow local variables)
collect_extension_diagnostics() {
    # Use outer GPU_BACKEND or default to nvidia (don't make local to avoid set -u issues)
    local backend="${GPU_BACKEND-nvidia}"
    local EXT_DIAG_ITEMS=()

    for sid in "${SERVICE_IDS[@]}"; do
        # Skip core services
        [[ "${SERVICE_CATEGORIES[$sid]:-}" == "core" ]] && continue

        # Check if extension is enabled
        local compose_file="${SERVICE_COMPOSE[$sid]:-}"
        [[ -z "$compose_file" || ! -f "$compose_file" ]] && continue

        # Build diagnostic entry
        local container="${SERVICE_CONTAINERS[$sid]:-}"
        local container_state="unknown"
        local health_status="unknown"
        local issues=()

        # Check container state
        if [[ "$DOCKER_DAEMON" == "true" && -n "$container" ]]; then
            local inspect_output
            inspect_output=$(docker inspect --format '{{.State.Status}}' "$container" 2>&1)
            if [[ $? -eq 0 ]]; then
                container_state="$inspect_output"
            else
                container_state="not_found"
            fi

            # Check health endpoint if container running
            if [[ "$container_state" == "running" ]]; then
                local port="${SERVICE_PORTS[$sid]:-0}"
                local health="${SERVICE_HEALTH[$sid]:-}"
                if [[ "$port" != "0" && -n "$health" ]]; then
                    if curl -sf --max-time 5 "http://localhost:${port}${health}" >/dev/null 2>&1; then
                        health_status="healthy"
                    else
                        health_status="unhealthy"
                        issues+=("health_check_failed")
                    fi
                fi
            else
                issues+=("container_not_running")
            fi
        fi

        # Check GPU backend compatibility (only if SERVICE_GPU_BACKENDS array exists from PR #357)
        if declare -p SERVICE_GPU_BACKENDS &>/dev/null; then
            local gpu_backends="${SERVICE_GPU_BACKENDS[$sid]:-}"
            if [[ -n "$gpu_backends" && ! " $gpu_backends " =~ " $backend " ]]; then
                issues+=("gpu_backend_incompatible")
            fi
        fi

        # Check dependencies
        local deps="${SERVICE_DEPENDS[$sid]:-}"
        if [[ -n "$deps" ]]; then
            local dep
            for dep in $deps; do
                local dep_compose="${SERVICE_COMPOSE[$dep]:-}"
                local dep_cat="${SERVICE_CATEGORIES[$dep]:-}"
                if [[ "$dep_cat" != "core" && ! -f "$dep_compose" ]]; then
                    issues+=("missing_dependency:$dep")
                fi
            done
        fi

        # Build JSON object (escape quotes in values)
        local issues_json="[]"
        if [[ ${#issues[@]} -gt 0 ]]; then
            # Use printf with newline separator, then convert to JSON array
            issues_json="[\"$(printf '%s\n' "${issues[@]}" | sed 's/"/\\"/g' | tr '\n' ',' | sed 's/,$//' | sed 's/,/","/g')\"]"
        fi

        EXT_DIAG_ITEMS+=("{\"id\":\"$sid\",\"container_state\":\"$container_state\",\"health_status\":\"$health_status\",\"issues\":$issues_json}")
    done

    if [[ ${#EXT_DIAG_ITEMS[@]} -gt 0 ]]; then
        echo "[$(IFS=,; echo "${EXT_DIAG_ITEMS[*]}")]"
    else
        echo "[]"
    fi
}

# Collect extension diagnostics if service registry loaded
EXT_DIAGNOSTICS="[]"
if [[ "${#SERVICE_IDS[@]}" -gt 0 ]]; then
    EXT_DIAGNOSTICS=$(collect_extension_diagnostics)
fi

PYTHON_CMD="python3"
if [[ -f "$ROOT_DIR/lib/python-cmd.sh" ]]; then
    . "$ROOT_DIR/lib/python-cmd.sh"
    PYTHON_CMD="$(ds_detect_python_cmd)"
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
fi

"$PYTHON_CMD" - "$CAP_FILE" "$PREFLIGHT_FILE" "$REPORT_FILE" "$DOCKER_CLI" "$DOCKER_DAEMON" "$COMPOSE_CLI" "$DASHBOARD_HTTP" "$WEBUI_HTTP" "$_DASHBOARD_PORT" "$_WEBUI_PORT" "$EXT_DIAGNOSTICS" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

cap_file, preflight_file, report_file, docker_cli, docker_daemon, compose_cli, dashboard_http, webui_http, dashboard_port, webui_port, ext_diagnostics_json = sys.argv[1:]

cap = json.load(open(cap_file, "r", encoding="utf-8"))
pre = json.load(open(preflight_file, "r", encoding="utf-8"))
ext_diagnostics = json.loads(ext_diagnostics_json)

report = {
    "version": "1",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "autofix_hints": [],
    "capability_profile": cap,
    "preflight": pre,
    "runtime": {
        "docker_cli": docker_cli == "true",
        "docker_daemon": docker_daemon == "true",
        "compose_cli": compose_cli == "true",
        "dashboard_http": dashboard_http == "true",
        "webui_http": webui_http == "true",
    },
    "extensions": ext_diagnostics,
    "summary": {
        "preflight_blockers": pre.get("summary", {}).get("blockers", 0),
        "preflight_warnings": pre.get("summary", {}).get("warnings", 0),
        "runtime_ready": (docker_daemon == "true" and compose_cli == "true"),
        "extensions_total": len(ext_diagnostics),
        "extensions_healthy": sum(1 for e in ext_diagnostics if e.get("health_status") == "healthy"),
        "extensions_issues": sum(1 for e in ext_diagnostics if len(e.get("issues", [])) > 0),
    },
}

fix_hints = []
for check in pre.get("checks", []):
    status = check.get("status")
    action = (check.get("action") or "").strip()
    if status in {"blocker", "warn"} and action:
        fix_hints.append(action)

runtime = report["runtime"]
if not runtime["docker_cli"]:
    fix_hints.append("Install Docker CLI/Docker Desktop and reopen your terminal.")
if runtime["docker_cli"] and not runtime["docker_daemon"]:
    fix_hints.append("Start Docker daemon/Desktop before launching Dream Server.")
if not runtime["compose_cli"]:
    fix_hints.append("Install Docker Compose v2 plugin (or docker-compose).")
if runtime["docker_daemon"] and not runtime["dashboard_http"]:
    fix_hints.append(f"Run installer/start command, then verify dashboard on http://localhost:{dashboard_port}.")
if runtime["docker_daemon"] and not runtime["webui_http"]:
    fix_hints.append(f"Verify Open WebUI container and port {webui_port} mapping.")

# Extension-specific hints
for ext in ext_diagnostics:
    ext_id = ext.get("id", "unknown")
    issues = ext.get("issues", [])
    for issue in issues:
        if issue == "container_not_running":
            fix_hints.append(f"Extension {ext_id}: container not running. Run 'dream start {ext_id}'.")
        elif issue == "health_check_failed":
            fix_hints.append(f"Extension {ext_id}: health check failed. Check logs with 'docker logs dream-{ext_id}'.")
        elif issue == "gpu_backend_incompatible":
            fix_hints.append(f"Extension {ext_id}: incompatible with current GPU backend. Consider disabling.")
        elif issue.startswith("missing_dependency:"):
            dep = issue.split(":", 1)[1]
            fix_hints.append(f"Extension {ext_id}: missing dependency '{dep}'. Run 'dream enable {dep}'.")


# Deduplicate while preserving order
seen = set()
uniq_hints = []
for hint in fix_hints:
    if hint in seen:
        continue
    seen.add(hint)
    uniq_hints.append(hint)

report["autofix_hints"] = uniq_hints  # overwrite initial empty list

path = pathlib.Path(report_file)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
PY

echo "Dream Doctor report: $REPORT_FILE"
echo "  Preflight blockers: ${PREFLIGHT_BLOCKERS:-0}"
echo "  Preflight warnings: ${PREFLIGHT_WARNINGS:-0}"
echo "  Docker daemon: $DOCKER_DAEMON"
echo "  Compose CLI:   $COMPOSE_CLI"
"$PYTHON_CMD" - "$REPORT_FILE" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    data = json.load(open(path, "r", encoding="utf-8"))
except Exception:
    raise SystemExit(0)

# Show extension summary
summary = data.get("summary", {})
ext_total = summary.get("extensions_total", 0)
ext_healthy = summary.get("extensions_healthy", 0)
ext_issues = summary.get("extensions_issues", 0)

if ext_total > 0:
    print(f"  Extensions:    {ext_healthy}/{ext_total} healthy, {ext_issues} with issues")

hints = data.get("autofix_hints") or []
if hints:
    print("  Suggested fixes:")
    for hint in hints[:10]:
        print(f"    - {hint}")
PY
