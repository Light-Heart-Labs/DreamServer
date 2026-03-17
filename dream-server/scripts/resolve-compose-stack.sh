#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(pwd)"
TIER="1"
GPU_BACKEND="nvidia"
PROFILE_OVERLAYS=""
ENV_MODE="false"

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

python3 - "$SCRIPT_DIR" "$TIER" "$GPU_BACKEND" "$PROFILE_OVERLAYS" "$ENV_MODE" <<'PY'
import pathlib
import sys
import json

script_dir = pathlib.Path(sys.argv[1]).resolve()
tier = (sys.argv[2] or "1").upper()
gpu_backend = (sys.argv[3] or "nvidia").lower()
profile_overlays = [x.strip() for x in (sys.argv[4] or "").split(",") if x.strip()]
env_mode = (sys.argv[5] or "false").lower() == "true"

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
    scripts_dir = script_dir / "scripts"
    if scripts_dir.exists():
        sys.path.insert(0, str(scripts_dir))

    from service_registry import ensure_registry_artifact, load_registry_artifact

    artifact_path = ensure_registry_artifact(root_dir=script_dir, strict=True)
    registry = load_registry_artifact(artifact_path)

    seen = set(resolved)
    services = registry.get("services", [])
    for service in services:
        if not isinstance(service, dict):
            continue

        backends = service.get("gpu_backends", ["amd", "nvidia"])
        if not isinstance(backends, list):
            backends = ["amd", "nvidia"]

        # "none" means CPU-only — compatible with any GPU backend
        if gpu_backend not in backends and "all" not in backends and "none" not in backends:
            continue

        compose_path_str = service.get("compose_path", "")
        if compose_path_str:
            compose_path = pathlib.Path(compose_path_str)
            if compose_path.exists():
                rel_compose = str(compose_path.relative_to(script_dir))
                if rel_compose not in seen:
                    resolved.append(rel_compose)
                    seen.add(rel_compose)

        # GPU-specific overlay (filesystem discovery — not in manifest)
        service_dir = pathlib.Path(service.get("service_dir", ""))
        if service_dir.exists():
            gpu_overlay = service_dir / f"compose.{gpu_backend}.yaml"
            if gpu_overlay.exists():
                rel_overlay = str(gpu_overlay.relative_to(script_dir))
                if rel_overlay not in seen:
                    resolved.append(rel_overlay)
                    seen.add(rel_overlay)

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
