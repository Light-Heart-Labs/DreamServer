#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

require_jq() {
  command -v jq >/dev/null 2>&1 || {
    echo "[FAIL] jq is required"
    exit 1
  }
}

assert_eq() {
  local got="$1"
  local expected="$2"
  local msg="$3"
  if [[ "$got" != "$expected" ]]; then
    echo "[FAIL] $msg (expected=$expected got=$got)"
    exit 1
  fi
}

require_jq

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "[contract] preflight fixture: linux-nvidia-good"
scripts/preflight-engine.sh \
  --report "$tmpdir/linux-nvidia-good.json" \
  --tier T2 \
  --ram-gb 64 \
  --disk-gb 200 \
  --gpu-backend nvidia \
  --gpu-vram-mb 24576 \
  --gpu-name "RTX 4090" \
  --platform-id linux \
  --compose-overlays docker-compose.base.yml,docker-compose.nvidia.yml \
  --script-dir "$ROOT_DIR" \
  --env >/dev/null
blockers="$(jq -r '.summary.blockers' "$tmpdir/linux-nvidia-good.json")"
assert_eq "$blockers" "0" "linux-nvidia-good blockers"

echo "[contract] preflight fixture: windows-mvp-good"
scripts/preflight-engine.sh \
  --report "$tmpdir/windows-mvp-good.json" \
  --tier T1 \
  --ram-gb 16 \
  --disk-gb 120 \
  --gpu-backend nvidia \
  --gpu-vram-mb 12288 \
  --gpu-name "RTX 3060" \
  --platform-id windows \
  --compose-overlays docker-compose.base.yml,docker-compose.nvidia.yml \
  --script-dir "$ROOT_DIR" \
  --env >/dev/null
blockers="$(jq -r '.summary.blockers' "$tmpdir/windows-mvp-good.json")"
assert_eq "$blockers" "0" "windows-mvp-good blockers"

echo "[contract] preflight fixture: macos-mvp-good"
scripts/preflight-engine.sh \
  --report "$tmpdir/macos-mvp-good.json" \
  --tier T1 \
  --ram-gb 16 \
  --disk-gb 80 \
  --gpu-backend apple \
  --gpu-vram-mb 16384 \
  --gpu-name "Apple Silicon" \
  --platform-id macos \
  --compose-overlays docker-compose.base.yml,docker-compose.amd.yml \
  --script-dir "$ROOT_DIR" \
  --env >/dev/null
blockers="$(jq -r '.summary.blockers' "$tmpdir/macos-mvp-good.json")"
assert_eq "$blockers" "0" "macos-mvp-good blockers"

echo "[contract] preflight fixture: disk-blocker"
scripts/preflight-engine.sh \
  --report "$tmpdir/disk-blocker.json" \
  --tier T3 \
  --ram-gb 64 \
  --disk-gb 20 \
  --gpu-backend nvidia \
  --gpu-vram-mb 24576 \
  --gpu-name "RTX 4090" \
  --platform-id linux \
  --compose-overlays docker-compose.base.yml,docker-compose.nvidia.yml \
  --script-dir "$ROOT_DIR" \
  --env >/dev/null
blockers="$(jq -r '.summary.blockers' "$tmpdir/disk-blocker.json")"
if [[ "$blockers" -lt 1 ]]; then
  echo "[FAIL] disk-blocker expected >=1 blocker, got $blockers"
  exit 1
fi

echo "[PASS] preflight fixture contracts"
