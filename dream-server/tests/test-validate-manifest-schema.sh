#!/usr/bin/env bash
# Regression coverage for scripts/validate-manifest-schema.sh.
# Ensures the validator stays aligned with current manifest schema semantics.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VALIDATOR="$ROOT_DIR/scripts/validate-manifest-schema.sh"
SCHEMA="$ROOT_DIR/extensions/library/schema/service-manifest.v1.json"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

write_manifest() {
  local service_dir="$1"
  local gpu_backend="$2"
  mkdir -p "$service_dir"
  cat > "$service_dir/manifest.yaml" <<YAML
schema_version: dream.services.v1
service:
  id: $(basename "$service_dir")
  name: Test Service
  port: 0
  health: ""
  type: docker
  category: optional
  gpu_backends: [$gpu_backend]
features:
  - id: $(basename "$service_dir")
    name: Test Feature
    description: Test feature
    icon: Box
    category: testing
    requirements:
      services: [$(basename "$service_dir")]
    priority: 1
    gpu_backends: [$gpu_backend]
YAML
}

assert_success() {
  local label="$1"
  shift
  if ! "$@" >/tmp/validate-manifest-schema-success.log 2>&1; then
    echo "[FAIL] $label" >&2
    cat /tmp/validate-manifest-schema-success.log >&2
    exit 1
  fi
  echo "[PASS] $label"
}

assert_failure() {
  local label="$1"
  shift
  if "$@" >/tmp/validate-manifest-schema-failure.log 2>&1; then
    echo "[FAIL] $label unexpectedly succeeded" >&2
    cat /tmp/validate-manifest-schema-failure.log >&2
    exit 1
  fi
  echo "[PASS] $label"
}

schema_validate_manifests() {
  python3 - "$SCHEMA" "$@" <<'PY'
import json
import sys
from pathlib import Path

import yaml

try:
    import jsonschema
except ImportError:  # pragma: no cover - exercised only on minimal CI images
    jsonschema = None

schema_path = Path(sys.argv[1])
targets = [Path(arg) for arg in sys.argv[2:]]
schema = json.loads(schema_path.read_text())
failed = False

if jsonschema:
    validator = jsonschema.Draft202012Validator(schema)

    def iter_errors(manifest):
        for err in sorted(validator.iter_errors(manifest), key=lambda error: list(error.path)):
            location = ".".join(str(part) for part in err.path) or "<root>"
            yield location, err.message
else:
    service_schema = schema["properties"]["service"]
    service_required = set(service_schema["required"])
    service_properties = service_schema["properties"]
    service_type_values = set(service_properties["type"]["enum"])
    category_values = set(service_properties["category"]["enum"])
    gpu_values = set(service_properties["gpu_backends"]["items"]["enum"])

    def iter_errors(manifest):
        if manifest.get("schema_version") != "dream.services.v1":
            yield "schema_version", "must be dream.services.v1"
        service = manifest.get("service")
        if not isinstance(service, dict):
            yield "service", "must be an object"
            return
        required = set(service_required)
        if not service.get("host_network", False):
            required.add("health")
        for field in sorted(required):
            if field not in service:
                yield "service", f"'{field}' is a required property"
        if "description" in required:
            yield "service", "schema drift: service.description must remain optional"
        if service.get("type") not in service_type_values:
            yield "service.type", f"{service.get('type')!r} is not a valid service type"
        if service.get("category") not in category_values:
            yield "service.category", f"{service.get('category')!r} is not a valid service category"
        port = service.get("port")
        if not isinstance(port, int) or not (0 <= port <= 65535):
            yield "service.port", f"{port!r} is not a valid port"
        for backend in service.get("gpu_backends", []) or []:
            if backend not in gpu_values:
                yield "service.gpu_backends", f"{backend!r} is not a valid gpu backend"
        for feature in manifest.get("features", []) or []:
            for backend in feature.get("gpu_backends", []) or []:
                if backend not in gpu_values:
                    yield "features.gpu_backends", f"{backend!r} is not a valid gpu backend"

for target in targets:
    paths = [target]
    if target.is_dir():
        paths = sorted(target.glob("*/manifest.y*ml"))
    for path in paths:
        manifest = yaml.safe_load(path.read_text())
        for location, message in iter_errors(manifest):
            failed = True
            print(f"{path}: {location}: {message}", file=sys.stderr)

raise SystemExit(1 if failed else 0)
PY
}

assert_success "current bundled and library manifests validate" bash "$VALIDATOR"
assert_success "current bundled and library manifests satisfy JSON schema" \
  schema_validate_manifests "$ROOT_DIR/extensions/services" "$ROOT_DIR/extensions/library/services"

write_manifest "$TMP_DIR/cpu-backend/service-cpu" "cpu"
assert_success "cpu gpu backend validates in custom validator" \
  env DREAM_MANIFEST_DIRS="$TMP_DIR/cpu-backend" bash "$VALIDATOR"
assert_success "cpu gpu backend satisfies JSON schema" \
  schema_validate_manifests "$TMP_DIR/cpu-backend/service-cpu/manifest.yaml"

NO_SERVICE_DIR="$TMP_DIR/no-service/no-service"
mkdir -p "$NO_SERVICE_DIR"
cat > "$NO_SERVICE_DIR/manifest.yaml" <<'YAML'
schema_version: dream.services.v1
features:
  - id: no-service
    name: No Service
    description: Manifest missing required top-level service object
    icon: Box
    category: testing
    requirements:
      services: [no-service]
    priority: 1
    gpu_backends: [none]
YAML
assert_failure "manifest without top-level service fails JSON schema" \
  schema_validate_manifests "$NO_SERVICE_DIR/manifest.yaml"

HOST_NETWORK_DIR="$TMP_DIR/hostnet/tailscale-like"
mkdir -p "$HOST_NETWORK_DIR"
cat > "$HOST_NETWORK_DIR/manifest.yaml" <<'YAML'
schema_version: dream.services.v1
service:
  id: tailscale-like
  name: Tailscale Like
  host_network: true
  port: 0
  type: docker
  category: optional
  gpu_backends: [none]
features:
  - id: tailscale-like
    name: Tailscale Like
    description: Host network service with compose/native health
    icon: Globe
    category: testing
    requirements:
      services: [tailscale-like]
    priority: 1
    gpu_backends: [none]
YAML
assert_success "host_network service may omit service.health and use gpu_backends none" \
  env DREAM_MANIFEST_DIRS="$TMP_DIR/hostnet" bash "$VALIDATOR"
assert_success "host_network service without service.health satisfies JSON schema" \
  schema_validate_manifests "$HOST_NETWORK_DIR/manifest.yaml"

DOCKER_WITHOUT_HEALTH_DIR="$TMP_DIR/docker-no-health/docker-no-health"
mkdir -p "$DOCKER_WITHOUT_HEALTH_DIR"
cat > "$DOCKER_WITHOUT_HEALTH_DIR/manifest.yaml" <<'YAML'
schema_version: dream.services.v1
service:
  id: docker-no-health
  name: Docker No Health
  port: 8080
  type: docker
  category: optional
  gpu_backends: [none]
features:
  - id: docker-no-health
    name: Docker No Health
    description: Docker service missing required HTTP health path
    icon: Box
    category: testing
    requirements:
      services: [docker-no-health]
    priority: 1
    gpu_backends: [none]
YAML
assert_failure "non-host-network service without service.health is rejected" \
  env DREAM_MANIFEST_DIRS="$TMP_DIR/docker-no-health" bash "$VALIDATOR"
assert_failure "non-host-network service without service.health fails JSON schema" \
  schema_validate_manifests "$DOCKER_WITHOUT_HEALTH_DIR/manifest.yaml"

HOST_SYSTEMD_DIR="$TMP_DIR/hostsystemd/opencode-like"
mkdir -p "$HOST_SYSTEMD_DIR"
cat > "$HOST_SYSTEMD_DIR/manifest.yaml" <<'YAML'
schema_version: dream.services.v1
service:
  id: opencode-like
  name: OpenCode Like
  port: 3003
  health: /
  type: host-systemd
  category: optional
  gpu_backends: [all]
features:
  - id: opencode-like
    name: OpenCode Like
    description: Host systemd service
    icon: Code
    category: testing
    requirements:
      services: [opencode-like]
    priority: 1
    gpu_backends: [all]
YAML
assert_success "host-systemd service type validates" \
  env DREAM_MANIFEST_DIRS="$TMP_DIR/hostsystemd" bash "$VALIDATOR"

write_manifest "$TMP_DIR/bad/service-bad" "quantum"
assert_failure "invalid service gpu backend is rejected" \
  env DREAM_MANIFEST_DIRS="$TMP_DIR/bad" bash "$VALIDATOR"

write_manifest "$TMP_DIR/empty-service-gpu/service-empty-gpu" "all"
python3 - "$TMP_DIR/empty-service-gpu/service-empty-gpu/manifest.yaml" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
lines = path.read_text().splitlines()
for idx, line in enumerate(lines):
    if line.strip() == "gpu_backends: [all]":
        lines[idx] = line.replace("[all]", "[]")
        break
else:
    raise SystemExit("service gpu_backends line not found")
path.write_text("\n".join(lines) + "\n")
PY
assert_failure "empty service gpu_backends is rejected" \
  env DREAM_MANIFEST_DIRS="$TMP_DIR/empty-service-gpu" bash "$VALIDATOR"
assert_failure "empty service gpu_backends fails JSON schema" \
  schema_validate_manifests "$TMP_DIR/empty-service-gpu/service-empty-gpu/manifest.yaml"

write_manifest "$TMP_DIR/bad-feature/service-bad-feature" "all"
python3 - "$TMP_DIR/bad-feature/service-bad-feature/manifest.yaml" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
lines = path.read_text().splitlines()
seen_gpu_backends = 0
for idx, line in enumerate(lines):
    if line.strip() == "gpu_backends: [all]":
        seen_gpu_backends += 1
        if seen_gpu_backends == 2:
            lines[idx] = line.replace("[all]", "[quantum]")
            break
else:
    raise SystemExit("feature gpu_backends line not found")
path.write_text("\n".join(lines) + "\n")
PY
assert_failure "invalid feature gpu backend is rejected" \
  env DREAM_MANIFEST_DIRS="$TMP_DIR/bad-feature" bash "$VALIDATOR"

write_manifest "$TMP_DIR/bad-feature-required/service-bad-feature-required" "all"
python3 - "$TMP_DIR/bad-feature-required/service-bad-feature-required/manifest.yaml" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
lines = [line for line in path.read_text().splitlines() if line.strip() != "description: Test feature"]
path.write_text("\n".join(lines) + "\n")
PY
assert_failure "missing feature required field is rejected" \
  env DREAM_MANIFEST_DIRS="$TMP_DIR/bad-feature-required" bash "$VALIDATOR"
assert_failure "missing feature required field fails JSON schema" \
  schema_validate_manifests "$TMP_DIR/bad-feature-required/service-bad-feature-required/manifest.yaml"

write_manifest "$TMP_DIR/bad-feature-id/service-bad-feature-id" "all"
python3 - "$TMP_DIR/bad-feature-id/service-bad-feature-id/manifest.yaml" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text().replace("  - id: service-bad-feature-id", "  - id: service_bad_feature_id")
path.write_text(text)
PY
assert_failure "invalid feature id is rejected" \
  env DREAM_MANIFEST_DIRS="$TMP_DIR/bad-feature-id" bash "$VALIDATOR"
assert_failure "invalid feature id fails JSON schema" \
  schema_validate_manifests "$TMP_DIR/bad-feature-id/service-bad-feature-id/manifest.yaml"

write_manifest "$TMP_DIR/bad-feature-priority/service-bad-feature-priority" "all"
python3 - "$TMP_DIR/bad-feature-priority/service-bad-feature-priority/manifest.yaml" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text().replace("    priority: 1", "    priority: 0")
path.write_text(text)
PY
assert_failure "invalid feature priority is rejected" \
  env DREAM_MANIFEST_DIRS="$TMP_DIR/bad-feature-priority" bash "$VALIDATOR"
assert_failure "invalid feature priority fails JSON schema" \
  schema_validate_manifests "$TMP_DIR/bad-feature-priority/service-bad-feature-priority/manifest.yaml"

write_manifest "$TMP_DIR/bad-env-var/service-bad-env-var" "all"
python3 - "$TMP_DIR/bad-env-var/service-bad-env-var/manifest.yaml" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
text = path.read_text().replace("features:\n", "  env_vars:\n    - description: Missing required key\nfeatures:\n")
path.write_text(text)
PY
assert_failure "env var without key is rejected" \
  env DREAM_MANIFEST_DIRS="$TMP_DIR/bad-env-var" bash "$VALIDATOR"
assert_failure "env var without key fails JSON schema" \
  schema_validate_manifests "$TMP_DIR/bad-env-var/service-bad-env-var/manifest.yaml"

echo "validate-manifest-schema regression tests passed"
