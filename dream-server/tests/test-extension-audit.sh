#!/bin/bash
# Regression tests for scripts/audit-extensions.py

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
AUDIT_SCRIPT="$PROJECT_DIR/scripts/audit-extensions.py"

PASS=0
FAIL=0

pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }

make_fixture_root() {
    local root
    root=$(mktemp -d)
    mkdir -p "$root/extensions/services"
    echo "$root"
}

write_service() {
    local root="$1"
    local service_id="$2"
    shift 2
    local dir="$root/extensions/services/$service_id"
    mkdir -p "$dir"
    "$@" "$dir"
}

service_llama() {
    local dir="$1"
    cat > "$dir/manifest.yaml" <<'EOF'
schema_version: dream.services.v1

service:
  id: llama-server
  name: llama-server
  aliases: [llm]
  container_name: dream-llama-server
  port: 8080
  external_port_env: OLLAMA_PORT
  external_port_default: 8080
  health: /health
  type: docker
  gpu_backends: [amd, nvidia]
  category: core
  depends_on: []
EOF
}

service_search() {
    local dir="$1"
    cat > "$dir/manifest.yaml" <<'EOF'
schema_version: dream.services.v1

service:
  id: search
  name: Search
  aliases: [search-ui]
  container_name: dream-search
  port: 8080
  external_port_env: SEARCH_PORT
  external_port_default: 8888
  health: /healthz
  type: docker
  gpu_backends: [amd, nvidia]
  compose_file: compose.yaml
  category: recommended
  depends_on: [llama-server]

features:
  - id: search-ui
    name: Search UI
    description: Private search
    category: productivity
    priority: 3
    requirements:
      services: [search]
    enabled_services_all: [search]
EOF
    cat > "$dir/compose.yaml" <<'EOF'
services:
  search:
    image: example/search:latest
    container_name: dream-search
    ports:
      - "127.0.0.1:${SEARCH_PORT:-8888}:8080"
    healthcheck:
      test: ["CMD", "wget", "--spider", "--quiet", "http://localhost:8080/healthz"]
EOF
}

service_image_gen() {
    local dir="$1"
    cat > "$dir/manifest.yaml" <<'EOF'
schema_version: dream.services.v1

service:
  id: image-gen
  name: Image Generation
  aliases: []
  container_name: dream-image-gen
  port: 8188
  external_port_env: IMAGE_GEN_PORT
  external_port_default: 8188
  health: /
  type: docker
  gpu_backends: [amd, nvidia]
  compose_file: compose.yaml
  category: optional
  depends_on: []
EOF
    cat > "$dir/compose.yaml" <<'EOF'
services: {}
EOF
    cat > "$dir/compose.amd.yaml" <<'EOF'
services:
  image-gen:
    image: example/image-gen:amd
    container_name: dream-image-gen
    ports:
      - "${IMAGE_GEN_PORT:-8188}:8188"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8188/"]
EOF
    cat > "$dir/compose.nvidia.yaml" <<'EOF'
services:
  image-gen:
    image: example/image-gen:nvidia
    container_name: dream-image-gen
    ports:
      - "${IMAGE_GEN_PORT:-8188}:8188"
    healthcheck:
      test: ["CMD", "wget", "--spider", "--quiet", "http://localhost:8188/"]
EOF
}

create_valid_project() {
    local root="$1"
    write_service "$root" "llama-server" service_llama
    write_service "$root" "search" service_search
    write_service "$root" "image-gen" service_image_gen
}

run_audit() {
    python3 "$AUDIT_SCRIPT" --project-dir "$1" "${@:2}"
}

assert_json_expr() {
    local file="$1"
    local expr="$2"
    python3 - "$file" "$expr" <<'PY'
import json
import sys
payload = json.load(open(sys.argv[1], encoding="utf-8"))
expr = sys.argv[2]
value = eval(expr, {"payload": payload})
raise SystemExit(0 if value else 1)
PY
}

ROOT_A=$(make_fixture_root)
ROOT_B=$(make_fixture_root)
ROOT_C=$(make_fixture_root)
ROOT_D=$(make_fixture_root)
ROOT_E=$(make_fixture_root)
trap 'rm -rf "$ROOT_A" "$ROOT_B" "$ROOT_C" "$ROOT_D" "$ROOT_E"' EXIT

create_valid_project "$ROOT_A"
if run_audit "$ROOT_A" --json > /tmp/ext-audit-a.json; then
    pass "valid fixture passes"
else
    fail "valid fixture passes"
fi
assert_json_expr /tmp/ext-audit-a.json "payload['summary']['result'] == 'pass'" && pass "valid fixture reports pass" || fail "valid fixture reports pass"

create_valid_project "$ROOT_B"
python3 - "$ROOT_B/extensions/services/search/manifest.yaml" <<'PY'
import yaml, sys
path = sys.argv[1]
doc = yaml.safe_load(open(path, encoding="utf-8"))
doc["service"]["depends_on"] = ["missing-service"]
yaml.safe_dump(doc, open(path, "w", encoding="utf-8"), sort_keys=False)
PY
if run_audit "$ROOT_B" --json > /tmp/ext-audit-b.json 2>/dev/null; then
    fail "missing dependency should fail"
else
    pass "missing dependency fails"
fi
assert_json_expr /tmp/ext-audit-b.json "any(issue['code'] == 'dependency-missing' for svc in payload['services'] for issue in svc['issues'])" && pass "missing dependency is reported" || fail "missing dependency is reported"

create_valid_project "$ROOT_C"
rm -f "$ROOT_C/extensions/services/image-gen/compose.nvidia.yaml"
if run_audit "$ROOT_C" --json > /tmp/ext-audit-c.json 2>/dev/null; then
    fail "missing overlay should fail"
else
    pass "missing overlay fails"
fi
assert_json_expr /tmp/ext-audit-c.json "any(issue['code'] == 'overlay-required' for svc in payload['services'] for issue in svc['issues'])" && pass "missing overlay is reported" || fail "missing overlay is reported"

create_valid_project "$ROOT_D"
python3 - "$ROOT_D/extensions/services/search/compose.yaml" <<'PY'
import yaml, sys
path = sys.argv[1]
doc = yaml.safe_load(open(path, encoding="utf-8"))
doc["services"]["search"]["ports"] = ["127.0.0.1:${SEARCH_PORT:-8888}:9090"]
yaml.safe_dump(doc, open(path, "w", encoding="utf-8"), sort_keys=False)
PY
if run_audit "$ROOT_D" --json > /tmp/ext-audit-d.json 2>/dev/null; then
    fail "port mismatch should fail"
else
    pass "port mismatch fails"
fi
assert_json_expr /tmp/ext-audit-d.json "any(issue['code'] == 'compose-port-mismatch' for svc in payload['services'] for issue in svc['issues'])" && pass "port mismatch is reported" || fail "port mismatch is reported"

create_valid_project "$ROOT_E"
python3 - "$ROOT_E/extensions/services/image-gen/manifest.yaml" <<'PY'
import yaml, sys
path = sys.argv[1]
doc = yaml.safe_load(open(path, encoding="utf-8"))
doc["service"]["aliases"] = ["search-ui"]
yaml.safe_dump(doc, open(path, "w", encoding="utf-8"), sort_keys=False)
PY
if run_audit "$ROOT_E" --json > /tmp/ext-audit-e.json 2>/dev/null; then
    fail "alias collision should fail"
else
    pass "alias collision fails"
fi
assert_json_expr /tmp/ext-audit-e.json "any(issue['code'] == 'alias-collision' for svc in payload['services'] for issue in svc['issues'])" && pass "alias collision is reported" || fail "alias collision is reported"

echo "Result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
