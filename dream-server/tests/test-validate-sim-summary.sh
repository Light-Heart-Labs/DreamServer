#!/bin/bash
# validate-sim-summary.py regression tests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET="$ROOT_DIR/scripts/validate-sim-summary.py"

PASS=0
FAIL=0

pass() { echo "PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL  $1"; FAIL=$((FAIL + 1)); }

run_expect() {
    local expected_exit="$1"
    local label="$2"
    shift 2
    set +e
    "$@" >/tmp/dream-sim-test.out 2>/tmp/dream-sim-test.err
    local exit_code=$?
    set -e
    if [[ "$exit_code" -eq "$expected_exit" ]]; then
        pass "$label"
    else
        fail "$label (expected $expected_exit, got $exit_code)"
        sed -n '1,10p' /tmp/dream-sim-test.err
    fi
}

[[ -f "$TARGET" ]] || { echo "missing $TARGET"; exit 1; }
python3 -m py_compile "$TARGET"
pass "script compiles"

run_expect 0 "--help exits 0" python3 "$TARGET" --help

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR" /tmp/dream-sim-test.out /tmp/dream-sim-test.err' EXIT

run_expect 2 "missing file exits 2" python3 "$TARGET" "$TMP_DIR/missing.json"

printf '{bad json' > "$TMP_DIR/bad.json"
run_expect 3 "invalid JSON exits 3" python3 "$TARGET" "$TMP_DIR/bad.json"

cat > "$TMP_DIR/valid.json" <<'EOF'
{
  "version": "1",
  "generated_at": "2026-03-15T12:34:56Z",
  "runs": {
    "linux_dryrun": {
      "exit_code": 0,
      "signals": {
        "capability_loaded": true,
        "hardware_class_logged": true,
        "backend_contract_loaded": true,
        "preflight_report_logged": true,
        "compose_selection_logged": true
      },
      "log": "artifacts/linux-dryrun.log",
      "install_summary": {}
    },
    "macos_installer_mvp": {
      "exit_code": 0,
      "log": "artifacts/macos-installer.log",
      "preflight": null,
      "doctor": null
    },
    "windows_scenario_preflight": {
      "report": {
        "summary": {
          "blockers": 0,
          "warnings": 1
        }
      }
    },
    "doctor_snapshot": {
      "exit_code": 0,
      "report": {
        "autofix_hints": [],
        "summary": {
          "runtime_ready": true
        }
      }
    }
  }
}
EOF

run_expect 0 "valid summary exits 0" python3 "$TARGET" "$TMP_DIR/valid.json"
if grep -q "\[PASS\]" /tmp/dream-sim-test.out; then
    pass "valid summary prints PASS marker"
else
    fail "valid summary prints PASS marker"
fi

python3 - "$TMP_DIR/valid.json" "$TMP_DIR/missing-signal.json" <<'PY'
import json, sys
src, dest = sys.argv[1], sys.argv[2]
data = json.load(open(src, encoding="utf-8"))
del data["runs"]["linux_dryrun"]["signals"]["compose_selection_logged"]
json.dump(data, open(dest, "w", encoding="utf-8"))
PY
run_expect 2 "missing signal exits 2" python3 "$TARGET" "$TMP_DIR/missing-signal.json"
if grep -q "compose_selection_logged" /tmp/dream-sim-test.out; then
    pass "missing signal is named in output"
else
    fail "missing signal is named in output"
fi

python3 - "$TMP_DIR/valid.json" "$TMP_DIR/no-generated-at.json" <<'PY'
import json, sys
src, dest = sys.argv[1], sys.argv[2]
data = json.load(open(src, encoding="utf-8"))
data.pop("generated_at", None)
json.dump(data, open(dest, "w", encoding="utf-8"))
PY
run_expect 2 "strict mode requires generated_at" python3 "$TARGET" --strict "$TMP_DIR/no-generated-at.json"

echo "Result: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
