#!/usr/bin/env bash
set -euo pipefail

REPORT_FILE="/tmp/dream-server-preflight-report.json"
TIER="${TIER:-1}"
RAM_GB="${RAM_GB:-0}"
DISK_GB="${DISK_GB:-0}"
GPU_BACKEND="${GPU_BACKEND:-nvidia}"
GPU_VRAM_MB="${GPU_VRAM_MB:-0}"
GPU_NAME="${GPU_NAME:-Unknown}"
PLATFORM_ID="${PLATFORM_ID:-linux}"
COMPOSE_OVERLAYS="${COMPOSE_OVERLAYS:-}"
SCRIPT_DIR="${SCRIPT_DIR:-$(pwd)}"
STRICT="false"
ENV_MODE="false"
ENV_FILE="${ENV_FILE:-}"
SCHEMA_FILE="${SCHEMA_FILE:-}"
ENV_STRICT="false"
SKIP_ENV_VALIDATION="false"
ENV_FILE_SET="false"
SCHEMA_FILE_SET="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --report)
            REPORT_FILE="${2:-$REPORT_FILE}"
            shift 2
            ;;
        --tier)
            TIER="${2:-$TIER}"
            shift 2
            ;;
        --ram-gb)
            RAM_GB="${2:-$RAM_GB}"
            shift 2
            ;;
        --disk-gb)
            DISK_GB="${2:-$DISK_GB}"
            shift 2
            ;;
        --gpu-backend)
            GPU_BACKEND="${2:-$GPU_BACKEND}"
            shift 2
            ;;
        --gpu-vram-mb)
            GPU_VRAM_MB="${2:-$GPU_VRAM_MB}"
            shift 2
            ;;
        --gpu-name)
            GPU_NAME="${2:-$GPU_NAME}"
            shift 2
            ;;
        --platform-id)
            PLATFORM_ID="${2:-$PLATFORM_ID}"
            shift 2
            ;;
        --compose-overlays)
            COMPOSE_OVERLAYS="${2:-$COMPOSE_OVERLAYS}"
            shift 2
            ;;
        --script-dir)
            SCRIPT_DIR="${2:-$SCRIPT_DIR}"
            shift 2
            ;;
        --env-file)
            ENV_FILE="${2:-$ENV_FILE}"
            ENV_FILE_SET="true"
            shift 2
            ;;
        --schema-file)
            SCHEMA_FILE="${2:-$SCHEMA_FILE}"
            SCHEMA_FILE_SET="true"
            shift 2
            ;;
        --env-strict)
            ENV_STRICT="true"
            shift
            ;;
        --skip-env-validation)
            SKIP_ENV_VALIDATION="true"
            shift
            ;;
        --strict)
            STRICT="true"
            shift
            ;;
        --env)
            ENV_MODE="true"
            shift
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 1
            ;;
    esac
done

if [[ "$ENV_FILE_SET" != "true" ]]; then
    ENV_FILE="${SCRIPT_DIR}/.env"
fi
if [[ "$SCHEMA_FILE_SET" != "true" ]]; then
    SCHEMA_FILE="${SCRIPT_DIR}/.env.schema.json"
fi

ENV_VALIDATION_FILE=""
ENV_VALIDATION_EXIT=""
ENV_VALIDATION_ATTEMPTED="false"
ENV_VALIDATION_STRICT="$ENV_STRICT"
cleanup_tmp() {
    if [[ -n "${ENV_VALIDATION_FILE:-}" && -f "${ENV_VALIDATION_FILE:-}" ]]; then
        rm -f "$ENV_VALIDATION_FILE"
    fi
}
trap cleanup_tmp EXIT
if [[ "$SKIP_ENV_VALIDATION" != "true" ]]; then
    validator="${SCRIPT_DIR}/scripts/validate-env.sh"
    if [[ -x "$validator" && -f "$ENV_FILE" && -f "$SCHEMA_FILE" ]]; then
        ENV_VALIDATION_ATTEMPTED="true"
        ENV_VALIDATION_FILE="$(mktemp)"
        set +e
        if [[ "$ENV_STRICT" == "true" ]]; then
            "$validator" --env-file "$ENV_FILE" --schema-file "$SCHEMA_FILE" --strict --json > "$ENV_VALIDATION_FILE"
        else
            "$validator" --env-file "$ENV_FILE" --schema-file "$SCHEMA_FILE" --warn-only --json > "$ENV_VALIDATION_FILE"
        fi
        ENV_VALIDATION_EXIT=$?
        set -e
    fi
fi

python3 - "$REPORT_FILE" "$TIER" "$RAM_GB" "$DISK_GB" "$GPU_BACKEND" "$GPU_VRAM_MB" "$GPU_NAME" "$PLATFORM_ID" "$COMPOSE_OVERLAYS" "$SCRIPT_DIR" "$ENV_MODE" "$STRICT" "$ENV_FILE" "$SCHEMA_FILE" "$ENV_VALIDATION_ATTEMPTED" "$ENV_VALIDATION_FILE" "$ENV_VALIDATION_EXIT" "$ENV_VALIDATION_STRICT" "$SKIP_ENV_VALIDATION" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

(
    report_file,
    tier,
    ram_gb,
    disk_gb,
    gpu_backend,
    gpu_vram_mb,
    gpu_name,
    platform_id,
    compose_overlays,
    script_dir,
    env_mode,
    strict_mode,
    env_file,
    schema_file,
    env_validation_attempted,
    env_validation_file,
    env_validation_exit,
    env_validation_strict,
    skip_env_validation,
) = sys.argv[1:]

env_mode = env_mode == "true"
strict_mode = strict_mode == "true"
env_validation_attempted = env_validation_attempted == "true"
env_validation_strict = env_validation_strict == "true"
skip_env_validation = skip_env_validation == "true"

try:
    ram_gb = int(float(ram_gb))
except Exception:
    ram_gb = 0
try:
    disk_gb = int(float(disk_gb))
except Exception:
    disk_gb = 0
try:
    gpu_vram_mb = int(float(gpu_vram_mb))
except Exception:
    gpu_vram_mb = 0

tier_key = str(tier).upper()
tier_rank_map = {
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "T1": 1,
    "T2": 2,
    "T3": 3,
    "T4": 4,
    "SH_COMPACT": 3,
    "SH_LARGE": 4,
}
tier_rank = tier_rank_map.get(tier_key, 1)

min_ram_map = {
    "1": 16,
    "2": 32,
    "3": 48,
    "4": 64,
    "SH_COMPACT": 64,
    "SH_LARGE": 96,
}
min_disk_map = {
    "1": 30,
    "2": 50,
    "3": 80,
    "4": 150,
    "SH_COMPACT": 80,
    "SH_LARGE": 120,
}
min_ram = min_ram_map.get(tier_key, 16)
min_disk = min_disk_map.get(tier_key, 50)

checks = []

def add_check(check_id, status, message, action):
    checks.append(
        {
            "id": check_id,
            "status": status,
            "message": message,
            "action": action,
        }
    )

# Platform support check
if platform_id in {"linux", "wsl"}:
    add_check(
        "platform-support",
        "pass",
        f"Platform '{platform_id}' is currently supported by install-core.sh.",
        "",
    )
elif platform_id in {"macos", "windows"}:
    add_check(
        "platform-support",
        "warn",
        f"Platform '{platform_id}' is supported via installer MVP path (not full parity yet).",
        "Continue with platform installer and follow generated doctor report recommendations.",
    )
else:
    add_check(
        "platform-support",
        "blocker",
        f"Platform '{platform_id}' is not yet supported by install-core.sh.",
        "Use Linux/WSL path for now or run platform-specific installer once implemented.",
    )

# Compose overlay existence check
overlays = [o.strip() for o in compose_overlays.split(",") if o.strip()]
if overlays:
    missing = [o for o in overlays if not (pathlib.Path(script_dir) / o).exists()]
    if missing:
        add_check(
            "compose-overlays",
            "blocker",
            f"Compose overlays are missing: {', '.join(missing)}.",
            "Restore missing compose files or update capability profile overlay mapping.",
        )
    else:
        add_check(
            "compose-overlays",
            "pass",
            f"Compose overlays resolved: {', '.join(overlays)}.",
            "",
        )
else:
    add_check(
        "compose-overlays",
        "warn",
        "No compose overlays supplied from capability profile.",
        "Ensure CAP_COMPOSE_OVERLAYS is populated; installer will use legacy fallback.",
    )

# RAM and disk checks
if ram_gb >= min_ram:
    add_check(
        "memory",
        "pass",
        f"RAM {ram_gb}GB meets tier {tier_key} recommendation ({min_ram}GB).",
        "",
    )
else:
    add_check(
        "memory",
        "warn",
        f"RAM {ram_gb}GB is below tier {tier_key} recommendation ({min_ram}GB).",
        f"Use a lower tier or increase memory to at least {min_ram}GB.",
    )

if disk_gb >= min_disk:
    add_check(
        "disk",
        "pass",
        f"Disk {disk_gb}GB meets tier {tier_key} recommendation ({min_disk}GB).",
        "",
    )
else:
    add_check(
        "disk",
        "blocker",
        f"Disk {disk_gb}GB is below required minimum for tier {tier_key} ({min_disk}GB).",
        f"Free at least {min_disk - disk_gb}GB or choose a smaller tier.",
    )

# GPU checks
gpu_backend = (gpu_backend or "").lower()
if gpu_backend == "amd":
    add_check(
        "gpu-backend",
        "pass",
        f"AMD backend selected ({gpu_name}).",
        "",
    )
elif gpu_backend == "nvidia":
    if gpu_name.strip().lower() in {"none", ""} or gpu_vram_mb <= 0:
        add_check(
            "gpu-vram",
            "warn",
            "NVIDIA backend selected but no NVIDIA GPU VRAM was detected.",
            "Install/verify NVIDIA drivers or switch to a supported AMD path.",
        )
    elif tier_rank >= 2 and gpu_vram_mb < 10000:
        add_check(
            "gpu-vram",
            "warn",
            f"NVIDIA VRAM {gpu_vram_mb}MB is below recommended floor for tier {tier_key}.",
            "Use tier 1 or a GPU with at least 12GB VRAM for better performance.",
        )
    else:
        add_check(
            "gpu-vram",
            "pass",
            f"NVIDIA backend selected ({gpu_name}, {gpu_vram_mb}MB VRAM).",
            "",
        )
elif gpu_backend == "apple":
    add_check(
        "gpu-backend",
        "warn",
        "Apple backend selected (experimental path).",
        "Use macOS installer preflight + doctor and run reduced profile set until Tier A parity is complete.",
    )
elif gpu_backend == "cpu":
    if platform_id in {"windows", "macos"}:
        add_check(
            "gpu-backend",
            "warn",
            "CPU fallback selected on non-Linux platform.",
            "Use reduced model/profile defaults; expect slower inference.",
        )
    else:
        add_check(
            "gpu-backend",
            "warn",
            "CPU fallback selected.",
            "Install/verify GPU drivers for best performance or continue with small models.",
        )
else:
    add_check(
        "gpu-backend",
        "warn",
        f"Unknown backend '{gpu_backend}'.",
        "Verify capability profile and hardware detection output.",
    )

env_validation: dict[str, object] = {
    "attempted": env_validation_attempted,
    "strict": env_validation_strict,
    "env_file": env_file,
    "schema_file": schema_file,
    "status": "not_run",
    "summary": {"errors": 0, "warnings": 0, "deprecated": 0},
}

if skip_env_validation:
    env_validation["status"] = "skipped"
elif env_validation_attempted:
    try:
        payload = json.loads(pathlib.Path(env_validation_file).read_text(encoding="utf-8"))
        summary = payload.get("summary", {}) if isinstance(payload, dict) else {}
        err_count = int(summary.get("errors", 0) or 0)
        warn_count = int(summary.get("warnings", 0) or 0)
        dep_count = int(summary.get("deprecated", 0) or 0)

        env_validation["summary"] = {
            "errors": err_count,
            "warnings": warn_count,
            "deprecated": dep_count,
        }
        env_validation["mode"] = payload.get("mode") if isinstance(payload, dict) else None
        env_validation["exit_code"] = int(env_validation_exit) if str(env_validation_exit).strip() else 0
        env_validation["status"] = "pass"

        if err_count > 0:
            env_validation["status"] = "failed"
            add_check(
                "env-validation",
                "blocker" if env_validation_strict else "warn",
                f".env validation found {err_count} error(s).",
                "Run ./scripts/validate-env.sh --strict and fix reported keys before proceeding.",
            )
        elif warn_count > 0 or dep_count > 0:
            env_validation["status"] = "warn"
            add_check(
                "env-validation",
                "warn",
                f".env validation warnings: {warn_count}, deprecated keys: {dep_count}.",
                "Run ./scripts/validate-env.sh and optionally ./scripts/migrate-config.sh autofix-env.",
            )
        else:
            add_check(
                "env-validation",
                "pass",
                ".env validation passed.",
                "",
            )
    except Exception as exc:
        env_validation["status"] = "error"
        env_validation["error"] = f"Failed to parse env validation report: {exc}"
        add_check(
            "env-validation",
            "warn",
            "Unable to parse env validation report.",
            "Re-run ./scripts/validate-env.sh manually to inspect configuration issues.",
        )
else:
    missing_bits = []
    if not pathlib.Path(env_file).exists():
        missing_bits.append(f"env file not found: {env_file}")
    if not pathlib.Path(schema_file).exists():
        missing_bits.append(f"schema not found: {schema_file}")
    if not pathlib.Path(script_dir, "scripts", "validate-env.sh").exists():
        missing_bits.append("validator script not found")
    if missing_bits:
        env_validation["status"] = "unavailable"
        env_validation["details"] = missing_bits
        add_check(
            "env-validation",
            "warn",
            "Env validation could not run (" + "; ".join(missing_bits) + ").",
            "Ensure .env, .env.schema.json, and scripts/validate-env.sh are present.",
        )

blockers = [c for c in checks if c["status"] == "blocker"]
warnings = [c for c in checks if c["status"] == "warn"]

report = {
    "version": "1",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "inputs": {
        "tier": tier_key,
        "ram_gb": ram_gb,
        "disk_gb": disk_gb,
        "gpu_backend": gpu_backend,
        "gpu_vram_mb": gpu_vram_mb,
        "gpu_name": gpu_name,
        "platform_id": platform_id,
        "compose_overlays": overlays,
        "script_dir": script_dir,
    },
    "summary": {
        "checks": len(checks),
        "blockers": len(blockers),
        "warnings": len(warnings),
        "can_proceed": len(blockers) == 0,
    },
    "env_validation": env_validation,
    "checks": checks,
}

report_path = pathlib.Path(report_file)
report_path.parent.mkdir(parents=True, exist_ok=True)
report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

if env_mode:
    def out(key, value):
        safe = str(value).replace("\\", "\\\\").replace('"', '\\"')
        print(f'{key}="{safe}"')

    out("PREFLIGHT_REPORT_FILE", str(report_path))
    out("PREFLIGHT_CHECK_COUNT", report["summary"]["checks"])
    out("PREFLIGHT_BLOCKERS", report["summary"]["blockers"])
    out("PREFLIGHT_WARNINGS", report["summary"]["warnings"])
    out("PREFLIGHT_CAN_PROCEED", str(report["summary"]["can_proceed"]).lower())
    out("PREFLIGHT_ENV_VALIDATION_STATUS", report["env_validation"].get("status", "not_run"))
    out("PREFLIGHT_ENV_VALIDATION_ERRORS", report["env_validation"].get("summary", {}).get("errors", 0))
    out("PREFLIGHT_ENV_VALIDATION_WARNINGS", report["env_validation"].get("summary", {}).get("warnings", 0))
    out("PREFLIGHT_ENV_VALIDATION_DEPRECATED", report["env_validation"].get("summary", {}).get("deprecated", 0))

env_status = str(report["env_validation"].get("status", "not_run"))
env_errors = int(report["env_validation"].get("summary", {}).get("errors", 0))
if env_validation_strict and (env_errors > 0 or env_status in {"unavailable", "error"}):
    raise SystemExit(1)

if strict_mode and blockers:
    raise SystemExit(1)
PY
