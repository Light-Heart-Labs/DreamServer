#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(pwd)"
TIER="1"
GPU_BACKEND="nvidia"
PROFILE_OVERLAYS=""
ENV_MODE="false"
SKIP_BROKEN="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --script-dir)
            SCRIPT_DIR="${2:-$SCRIPT_DIR}"
            shift 2
            ;;
        --tier)
            TIER="${2:-$TIER}"
            shift 2
            ;;
        --gpu-backend)
            GPU_BACKEND="${2:-$GPU_BACKEND}"
            shift 2
            ;;
        --profile-overlays)
            PROFILE_OVERLAYS="${2:-$PROFILE_OVERLAYS}"
            shift 2
            ;;
        --skip-broken)
            SKIP_BROKEN="true"
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

ROOT_DIR="$SCRIPT_DIR"
PYTHON_CMD="python3"
if [[ -f "$ROOT_DIR/lib/python-cmd.sh" ]]; then
    . "$ROOT_DIR/lib/python-cmd.sh"
    PYTHON_CMD="$(ds_detect_python_cmd)"
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
fi

"$PYTHON_CMD" - "$SCRIPT_DIR" "$TIER" "$GPU_BACKEND" "$PROFILE_OVERLAYS" "$ENV_MODE" "$SKIP_BROKEN" <<'PY'
import os
import pathlib
import sys
import json

script_dir = pathlib.Path(sys.argv[1])
tier = (sys.argv[2] or "1").upper()
gpu_backend = (sys.argv[3] or "nvidia").lower()
profile_overlays = [x.strip() for x in (sys.argv[4] or "").split(",") if x.strip()]
env_mode = (sys.argv[5] or "false").lower() == "true"
skip_broken = (sys.argv[6] or "false").lower() == "true"
dream_mode = os.environ.get("DREAM_MODE", "local").lower()

def existing(overlays):
    return all((script_dir / f).exists() for f in overlays)

resolved = []
primary = "docker-compose.yml"

if profile_overlays and existing(profile_overlays):
    resolved = profile_overlays
    primary = profile_overlays[-1]
elif tier in {"AP_ULTRA", "AP_PRO", "AP_BASE"}:
    if existing(["docker-compose.base.yml", "docker-compose.apple.yml"]):
        resolved = ["docker-compose.base.yml", "docker-compose.apple.yml"]
        primary = "docker-compose.apple.yml"
    elif existing(["docker-compose.base.yml"]):
        resolved = ["docker-compose.base.yml"]
        primary = "docker-compose.base.yml"
elif tier in {"SH_LARGE", "SH_COMPACT"}:
    if existing(["docker-compose.base.yml", "docker-compose.amd.yml"]):
        resolved = ["docker-compose.base.yml", "docker-compose.amd.yml"]
        primary = "docker-compose.amd.yml"
elif gpu_backend == "apple":
    if existing(["docker-compose.base.yml", "docker-compose.apple.yml"]):
        resolved = ["docker-compose.base.yml", "docker-compose.apple.yml"]
        primary = "docker-compose.apple.yml"
    elif existing(["docker-compose.base.yml"]):
        resolved = ["docker-compose.base.yml"]
        primary = "docker-compose.base.yml"
elif gpu_backend == "amd":
    if existing(["docker-compose.base.yml", "docker-compose.amd.yml"]):
        resolved = ["docker-compose.base.yml", "docker-compose.amd.yml"]
        primary = "docker-compose.amd.yml"
else:
    if existing(["docker-compose.base.yml", "docker-compose.nvidia.yml"]):
        resolved = ["docker-compose.base.yml", "docker-compose.nvidia.yml"]
        primary = "docker-compose.nvidia.yml"
    elif (script_dir / "docker-compose.yml").exists():
        resolved = ["docker-compose.yml"]
        primary = "docker-compose.yml"

if not resolved:
    resolved = [primary]

# Discover enabled extension compose fragments via manifests
ext_dir = script_dir / "extensions" / "services"
if ext_dir.exists():
    try:
        import yaml
        yaml_available = True
    except ImportError:
        import json as yaml  # fallback if yaml not available
        yaml_available = False

    for service_dir in sorted(ext_dir.iterdir()):
        if not service_dir.is_dir():
            continue
        # Find manifest
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
                if manifest_path.suffix == ".json":
                    manifest = json.load(f)
                else:
                    manifest = yaml.safe_load(f)
            if manifest.get("schema_version") != "dream.services.v1":
                continue
            service = manifest.get("service", {})
            # Check GPU backend compatibility
            backends = service.get("gpu_backends", ["amd", "nvidia"])
            # "none" means CPU-only — compatible with any GPU backend
            if gpu_backend not in backends and "all" not in backends and "none" not in backends:
                continue
            # Get compose file from manifest
            compose_rel = service.get("compose_file", "")
            if compose_rel and not compose_rel.endswith(".disabled"):
                compose_path = service_dir / compose_rel
                if compose_path.exists():
                    resolved.append(str(compose_path.relative_to(script_dir)))
                elif (service_dir / f"{compose_rel}.disabled").exists():
                    continue  # Service disabled — skip all overlays
            # GPU-specific overlay (filesystem discovery — not in manifest)
            gpu_overlay = service_dir / f"compose.{gpu_backend}.yaml"
            if gpu_overlay.exists():
                resolved.append(str(gpu_overlay.relative_to(script_dir)))
            # Mode-specific overlay — depends_on for local/hybrid mode only
            if dream_mode in ("local", "hybrid"):
                local_mode_overlay = service_dir / "compose.local.yaml"
                if local_mode_overlay.exists():
                    resolved.append(str(local_mode_overlay.relative_to(script_dir)))
        except Exception as e:
            # Narrow exception handling to specific parse/structure errors
            yaml_error = yaml_available and hasattr(yaml, 'YAMLError') and isinstance(e, yaml.YAMLError)
            json_error = isinstance(e, json.JSONDecodeError)
            structure_error = isinstance(e, (KeyError, TypeError))

            if yaml_error or json_error or structure_error:
                print(f"ERROR: Failed to parse manifest for {service_dir.name}: {e}", file=sys.stderr)
                print(f"  Manifest path: {manifest_path}", file=sys.stderr)
                print(f"  This service will be skipped. Fix the manifest or disable the service.", file=sys.stderr)
                if skip_broken:
                    continue
                else:
                    sys.exit(1)
            else:
                # Unexpected error — re-raise to crash visibly
                raise

# Include docker-compose.override.yml if it exists (user customizations)
override = script_dir / "docker-compose.override.yml"
if override.exists():
    resolved.append("docker-compose.override.yml")

def to_flags(files):
    return " ".join(f"-f {f}" for f in files)

resolved_flags = to_flags(resolved)

if env_mode:
    def out(key, value):
        safe = str(value).replace("\\", "\\\\").replace('"', '\\"')
        print(f'{key}="{safe}"')
    out("COMPOSE_PRIMARY_FILE", primary)
    out("COMPOSE_FILE_LIST", ",".join(resolved))
    out("COMPOSE_FLAGS", resolved_flags)
else:
    print(resolved_flags)
PY
