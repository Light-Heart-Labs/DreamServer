#!/bin/bash
# Regression tests for scripts/extension-catalog.py

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CATALOG_SCRIPT="$PROJECT_DIR/scripts/extension-catalog.py"

PASS=0
FAIL=0

pass() {
    echo "PASS  $1"
    PASS=$((PASS + 1))
}

fail() {
    echo "FAIL  $1"
    FAIL=$((FAIL + 1))
}

run_expect() {
    local expected_exit="$1"
    local label="$2"
    shift 2

    set +e
    "$@" >/tmp/dream-catalog-test.out 2>/tmp/dream-catalog-test.err
    local exit_code=$?
    set -e

    if [[ "$exit_code" -eq "$expected_exit" ]]; then
        pass "$label"
    else
        fail "$label (expected $expected_exit, got $exit_code)"
        sed -n '1,20p' /tmp/dream-catalog-test.err
    fi
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

[[ -f "$CATALOG_SCRIPT" ]] || { echo "missing $CATALOG_SCRIPT"; exit 1; }
python3 -m py_compile "$CATALOG_SCRIPT"
pass "extension-catalog.py compiles"

run_expect 0 "--help exits 0" python3 "$CATALOG_SCRIPT" --help

run_expect 0 "default JSON output succeeds" \
    python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR"
python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" >/tmp/dream-catalog.json
if assert_json_expr /tmp/dream-catalog.json "payload['summary']['service_count'] > 0"; then
    pass "default payload has services"
else
    fail "default payload has services"
fi

run_expect 0 "category filter works" \
    python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --category core
python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --category core >/tmp/dream-catalog-core.json
if assert_json_expr /tmp/dream-catalog-core.json "all(s['category'] == 'core' for s in payload['services'])"; then
    pass "category filter only returns core"
else
    fail "category filter only returns core"
fi

run_expect 0 "status filter works" \
    python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --status enabled
python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --status enabled >/tmp/dream-catalog-enabled.json
if assert_json_expr /tmp/dream-catalog-enabled.json "all(s['status'] == 'enabled' for s in payload['services'])"; then
    pass "status filter only returns enabled"
else
    fail "status filter only returns enabled"
fi

run_expect 0 "service filter works" \
    python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --service whisper
python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --service whisper >/tmp/dream-catalog-whisper.json
if assert_json_expr /tmp/dream-catalog-whisper.json "payload['summary']['service_count'] == 1 and payload['services'][0]['id'] == 'whisper'"; then
    pass "service filter returns whisper"
else
    fail "service filter returns whisper"
fi

run_expect 0 "gpu backend filter works" \
    python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --gpu-backend amd
python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --gpu-backend amd >/tmp/dream-catalog-amd.json
if assert_json_expr /tmp/dream-catalog-amd.json "all('amd' in s['gpu_backends'] for s in payload['services'])"; then
    pass "gpu filter includes only amd-capable services"
else
    fail "gpu filter includes only amd-capable services"
fi

run_expect 0 "include-features adds feature payload" \
    python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --service whisper --include-features
python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --service whisper --include-features >/tmp/dream-catalog-features.json
if assert_json_expr /tmp/dream-catalog-features.json "'features' in payload['services'][0]"; then
    pass "include-features returns features list"
else
    fail "include-features returns features list"
fi

run_expect 0 "summary-only JSON works" \
    python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --summary-only
python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --summary-only >/tmp/dream-catalog-summary.json
if assert_json_expr /tmp/dream-catalog-summary.json "'service_count' in payload and 'categories' in payload"; then
    pass "summary-only has expected keys"
else
    fail "summary-only has expected keys"
fi

run_expect 0 "markdown output works" \
    python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --format markdown
python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --format markdown >/tmp/dream-catalog-markdown.txt
if grep -q "| ID | Category | Status | Type | Features | GPU | Aliases | Depends On |" /tmp/dream-catalog-markdown.txt; then
    pass "markdown table header present"
else
    fail "markdown table header present"
fi

run_expect 0 "ndjson output works" \
    python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --format ndjson --service whisper
python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --format ndjson --service whisper >/tmp/dream-catalog.ndjson
if python3 - <<'PY'
import json
line = open("/tmp/dream-catalog.ndjson", encoding="utf-8").read().strip()
obj = json.loads(line)
raise SystemExit(0 if obj["id"] == "whisper" else 1)
PY
then
    pass "ndjson emits valid object lines"
else
    fail "ndjson emits valid object lines"
fi

run_expect 0 "output file option writes content" \
    python3 "$CATALOG_SCRIPT" --project-dir "$PROJECT_DIR" --output /tmp/dream-catalog-output.json
if [[ -s /tmp/dream-catalog-output.json ]]; then
    pass "output file created"
else
    fail "output file created"
fi

FIXTURE_ROOT=$(mktemp -d)
trap 'rm -rf "$FIXTURE_ROOT" /tmp/dream-catalog-test.out /tmp/dream-catalog-test.err /tmp/dream-catalog.json /tmp/dream-catalog-core.json /tmp/dream-catalog-enabled.json /tmp/dream-catalog-whisper.json /tmp/dream-catalog-amd.json /tmp/dream-catalog-features.json /tmp/dream-catalog-summary.json /tmp/dream-catalog-markdown.txt /tmp/dream-catalog.ndjson /tmp/dream-catalog-output.json /tmp/dream-catalog-fixture.json' EXIT

mkdir -p "$FIXTURE_ROOT/extensions/services/bad-service"
cat > "$FIXTURE_ROOT/extensions/services/bad-service/manifest.yaml" <<'EOF'
schema_version: dream.services.v1
service:
  id: bad-service
  name: Bad Service
  category: invalid-category
  type: docker
  compose_file: compose.yaml
EOF
cat > "$FIXTURE_ROOT/extensions/services/bad-service/compose.yaml" <<'EOF'
services:
  bad-service:
    image: example/bad:latest
EOF

run_expect 2 "strict mode fails on catalog issues" \
    python3 "$CATALOG_SCRIPT" --project-dir "$FIXTURE_ROOT" --strict
python3 "$CATALOG_SCRIPT" --project-dir "$FIXTURE_ROOT" >/tmp/dream-catalog-fixture.json
if assert_json_expr /tmp/dream-catalog-fixture.json "payload['summary']['issues']['errors'] >= 1"; then
    pass "fixture reports catalog errors"
else
    fail "fixture reports catalog errors"
fi

echo "Result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
