#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

shell_tmp="$(mktemp)"
api_tmp="$(mktemp)"

cleanup() {
  rm -f "$shell_tmp" "$api_tmp"
}
trap cleanup EXIT

echo "[contract] extension manifests validate against schema"
bash scripts/validate-manifests.sh >/dev/null

echo "[contract] shell registry parity with dashboard-api runtime"
SCRIPT_DIR="$ROOT_DIR" bash -lc '
  set -euo pipefail
  . "$SCRIPT_DIR/lib/service-registry.sh"
  sr_load
  for sid in "${SERVICE_IDS[@]}"; do
    printf "%s|%s|%s|%s\n" \
      "$sid" \
      "${SERVICE_PORTS[$sid]}" \
      "${SERVICE_HEALTH[$sid]}" \
      "${SERVICE_CATEGORIES[$sid]}"
  done
' | sort > "$shell_tmp"

DREAM_INSTALL_DIR="$ROOT_DIR" \
DREAM_EXTENSIONS_DIR="$ROOT_DIR/extensions/services" \
GPU_BACKEND="nvidia" \
python3 - <<'PY' | sort > "$api_tmp"
import os
import sys
from pathlib import Path

root = Path(os.environ["DREAM_INSTALL_DIR"]).resolve()
sys.path.insert(0, str(root / "extensions" / "services" / "dashboard-api"))
import config  # noqa: E402

for service_id in sorted(config.SERVICES):
    cfg = config.SERVICES[service_id]
    port = cfg.get("external_port_default", cfg.get("external_port", cfg.get("port", 0)))
    print(
        f"{service_id}|{port}|{cfg.get('health', '')}|{cfg.get('category', '')}"
    )
PY

if ! diff -u "$shell_tmp" "$api_tmp"; then
  echo "[FAIL] shell/API registry parity mismatch"
  exit 1
fi

echo "[PASS] manifest registry parity"

