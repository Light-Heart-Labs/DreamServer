#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

command -v jq >/dev/null 2>&1 || {
  echo "[FAIL] jq is required"
  exit 1
}

echo "[contract] backend contract files"
for f in config/backends/amd.json config/backends/nvidia.json config/backends/cpu.json config/backends/apple.json; do
  test -f "$f" || { echo "[FAIL] missing $f"; exit 1; }
  jq -e '.id and .llm_engine and .service_name and .public_api_port and .public_health_url and .provider_name and .provider_url' "$f" >/dev/null \
    || { echo "[FAIL] invalid backend contract: $f"; exit 1; }
done

echo "[contract] hardware class mapping"
test -f config/hardware-classes.json || { echo "[FAIL] missing config/hardware-classes.json"; exit 1; }
jq -e '.version and (.classes | type=="array" and length>0)' config/hardware-classes.json >/dev/null \
  || { echo "[FAIL] invalid hardware-classes root structure"; exit 1; }

for class_id in strix_unified nvidia_pro apple_silicon cpu_fallback; do
  jq -e --arg id "$class_id" '.classes[] | select(.id==$id) | .recommended.backend and .recommended.tier and .recommended.compose_overlays' config/hardware-classes.json >/dev/null \
    || { echo "[FAIL] missing/invalid class: $class_id"; exit 1; }
done

echo "[contract] capability profile schema has hardware_class"
jq -e '.properties.hardware_class and (.required | index("hardware_class"))' config/capability-profile.schema.json >/dev/null \
  || { echo "[FAIL] capability profile schema missing hardware_class"; exit 1; }

echo "[contract] canonical port contract parity"
test -x tests/contracts/test-port-contracts.sh || { echo "[FAIL] script not executable: tests/contracts/test-port-contracts.sh"; exit 1; }
bash tests/contracts/test-port-contracts.sh

echo "[contract] resolver scripts executable"
for s in scripts/build-capability-profile.sh scripts/classify-hardware.sh scripts/load-backend-contract.sh scripts/resolve-compose-stack.sh scripts/preflight-engine.sh scripts/dream-doctor.sh scripts/simulate-installers.sh; do
  test -x "$s" || { echo "[FAIL] script not executable: $s"; exit 1; }
done

echo "[contract] Langfuse telemetry suppression"
grep -q 'TELEMETRY_ENABLED.*false' extensions/services/langfuse/compose.yaml.disabled 2>/dev/null || \
  grep -q 'TELEMETRY_ENABLED.*false' extensions/services/langfuse/compose.yaml 2>/dev/null || \
  { echo "[FAIL] Langfuse app telemetry not disabled"; exit 1; }

grep -q 'NEXT_TELEMETRY_DISABLED.*1' extensions/services/langfuse/compose.yaml.disabled 2>/dev/null || \
  grep -q 'NEXT_TELEMETRY_DISABLED.*1' extensions/services/langfuse/compose.yaml 2>/dev/null || \
  { echo "[FAIL] Next.js telemetry not disabled"; exit 1; }

grep -q 'MINIO_TELEMETRY_DISABLED.*1' extensions/services/langfuse/compose.yaml.disabled 2>/dev/null || \
  grep -q 'MINIO_TELEMETRY_DISABLED.*1' extensions/services/langfuse/compose.yaml 2>/dev/null || \
  { echo "[FAIL] MinIO telemetry not disabled"; exit 1; }

echo "[PASS] installer contracts"
