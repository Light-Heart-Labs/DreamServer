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

script_dir = pathlib.Path(sys.argv[1])
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
    try:
        import yaml
    except ImportError:
        import json as yaml  # fallback if yaml not available

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
            # GPU-specific overlay (filesystem discovery — not in manifest)
            gpu_overlay = service_dir / f"compose.{gpu_backend}.yaml"
            if gpu_overlay.exists():
                resolved.append(str(gpu_overlay.relative_to(script_dir)))
        except Exception as e:
            print(f"WARNING: skipping {service_dir.name}: {e}", file=sys.stderr)
            continue

# Include docker-compose.local.yml for local/hybrid mode (Linux GPU backends only)
# This gates open-webui on llama-server health — not appropriate for cloud mode
# (llama-server has no model in cloud mode, so its healthcheck never passes)
local_mode_overlay = script_dir / "docker-compose.local.yml"
if local_mode_overlay.exists() and gpu_backend not in ("apple",):
    # DREAM_MODE is read from .env rather than passed as a CLI arg because this script
    # is called from multiple contexts (dream-cli, installer, CI) that do not all pass
    # it as an argument. Reading .env keeps a single source of truth.
    # Future: pass DREAM_MODE as a CLI arg (like gpu_backend) to eliminate this read.
    dream_mode = ""
    env_file = script_dir / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("DREAM_MODE="):
                dream_mode = line.split("=", 1)[1].split("#")[0].strip().strip("\"'")
                break
    if dream_mode != "cloud":
        resolved.append("docker-compose.local.yml")

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
