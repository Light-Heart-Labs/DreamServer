#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPORT_FILE="${1:-/tmp/dream-doctor-report.json}"

CAP_FILE="/tmp/dream-doctor-capabilities.json"
PREFLIGHT_FILE="/tmp/dream-doctor-preflight.json"

# Source service registry for port resolution
if [[ -f "$ROOT_DIR/lib/service-registry.sh" ]]; then
    export SCRIPT_DIR="$ROOT_DIR"
    . "$ROOT_DIR/lib/service-registry.sh"
    sr_load
    if [[ -f "$ROOT_DIR/.env" ]]; then
        set -a
        while IFS='=' read -r key value; do
            [[ "$key" =~ ^[[:space:]]*# ]] && continue
            [[ -z "$key" ]] && continue
            [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
            value="${value%\"}"
            value="${value#\"}"
            value="${value%\'}"
            value="${value#\'}"
            export "$key=$value"
        done < "$ROOT_DIR/.env"
        set +a
    fi
fi
_DASHBOARD_PORT="${SERVICE_PORTS[dashboard]:-3001}"
_WEBUI_PORT="${SERVICE_PORTS[open-webui]:-3000}"

RAM_GB="$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print int($2/1024/1024)}' || echo 0)"
DISK_GB="$(df -BG "$HOME" 2>/dev/null | tail -1 | awk '{gsub(/G/,"",$4); print int($4)}' || echo 0)"

if [[ -x "$SCRIPT_DIR/build-capability-profile.sh" ]]; then
    CAP_ENV="$("$SCRIPT_DIR/build-capability-profile.sh" --output "$CAP_FILE" --env)"
    eval "$CAP_ENV"
else
    echo "build-capability-profile.sh not found/executable" >&2
    exit 1
fi

if [[ -x "$SCRIPT_DIR/preflight-engine.sh" ]]; then
    PREFLIGHT_ENV="$("$SCRIPT_DIR/preflight-engine.sh" \
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
        --env-file "$ROOT_DIR/.env" \
        --schema-file "$ROOT_DIR/.env.schema.json" \
        --env)"
    eval "$PREFLIGHT_ENV"
else
    echo "preflight-engine.sh not found/executable" >&2
    exit 1
fi

DOCKER_CLI="false"
DOCKER_DAEMON="false"
COMPOSE_CLI="false"
DASHBOARD_HTTP="false"
WEBUI_HTTP="false"

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
    if curl -sf "http://localhost:${_DASHBOARD_PORT}" >/dev/null 2>&1; then
        DASHBOARD_HTTP="true"
    fi
    if curl -sf "http://localhost:${_WEBUI_PORT}" >/dev/null 2>&1; then
        WEBUI_HTTP="true"
    fi
fi

python3 - "$CAP_FILE" "$PREFLIGHT_FILE" "$REPORT_FILE" "$DOCKER_CLI" "$DOCKER_DAEMON" "$COMPOSE_CLI" "$DASHBOARD_HTTP" "$WEBUI_HTTP" "$_DASHBOARD_PORT" "$_WEBUI_PORT" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

cap_file, preflight_file, report_file, docker_cli, docker_daemon, compose_cli, dashboard_http, webui_http, dashboard_port, webui_port = sys.argv[1:]

cap = json.load(open(cap_file, "r", encoding="utf-8"))
pre = json.load(open(preflight_file, "r", encoding="utf-8"))

report = {
    "version": "1",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "capability_profile": cap,
    "preflight": pre,
    "runtime": {
        "docker_cli": docker_cli == "true",
        "docker_daemon": docker_daemon == "true",
        "compose_cli": compose_cli == "true",
        "dashboard_http": dashboard_http == "true",
        "webui_http": webui_http == "true",
    },
    "summary": {
        "preflight_blockers": pre.get("summary", {}).get("blockers", 0),
        "preflight_warnings": pre.get("summary", {}).get("warnings", 0),
        "env_validation_status": pre.get("env_validation", {}).get("status", "not_run"),
        "env_validation_errors": pre.get("env_validation", {}).get("summary", {}).get("errors", 0),
        "env_validation_warnings": pre.get("env_validation", {}).get("summary", {}).get("warnings", 0),
        "env_validation_deprecated": pre.get("env_validation", {}).get("summary", {}).get("deprecated", 0),
        "runtime_ready": (docker_daemon == "true" and compose_cli == "true"),
    },
}

fix_hints = []
for check in pre.get("checks", []):
    status = check.get("status")
    action = (check.get("action") or "").strip()
    if status in {"blocker", "warn"} and action:
        fix_hints.append(action)

env_validation = pre.get("env_validation", {}) or {}
env_status = str(env_validation.get("status", "not_run"))
env_summary = env_validation.get("summary", {}) or {}
env_errs = int(env_summary.get("errors", 0) or 0)
env_warns = int(env_summary.get("warnings", 0) or 0)
env_deprecated = int(env_summary.get("deprecated", 0) or 0)
if env_status in {"failed", "error"} or env_errs > 0:
    fix_hints.append("Fix .env validation errors: ./scripts/validate-env.sh --strict")
if env_deprecated > 0:
    fix_hints.append("Auto-fix deprecated env keys: ./scripts/migrate-config.sh autofix-env")
if env_status == "unavailable":
    fix_hints.append("Ensure .env, .env.schema.json, and scripts/validate-env.sh exist in install dir.")

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

# Deduplicate while preserving order
seen = set()
uniq_hints = []
for hint in fix_hints:
    if hint in seen:
        continue
    seen.add(hint)
    uniq_hints.append(hint)

report["autofix_hints"] = uniq_hints

path = pathlib.Path(report_file)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
PY

echo "Dream Doctor report: $REPORT_FILE"
echo "  Preflight blockers: ${PREFLIGHT_BLOCKERS:-0}"
echo "  Preflight warnings: ${PREFLIGHT_WARNINGS:-0}"
echo "  Env validation: ${PREFLIGHT_ENV_VALIDATION_STATUS:-not_run} (errors=${PREFLIGHT_ENV_VALIDATION_ERRORS:-0}, warnings=${PREFLIGHT_ENV_VALIDATION_WARNINGS:-0}, deprecated=${PREFLIGHT_ENV_VALIDATION_DEPRECATED:-0})"
echo "  Docker daemon: $DOCKER_DAEMON"
echo "  Compose CLI:   $COMPOSE_CLI"
python3 - "$REPORT_FILE" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    data = json.load(open(path, "r", encoding="utf-8"))
except Exception:
    raise SystemExit(0)
hints = data.get("autofix_hints") or []
if hints:
    print("  Suggested fixes:")
    for hint in hints[:6]:
        print(f"    - {hint}")
PY
