#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

echo "[contract] Windows AMD local compose overlay"

for f in \
  docker-compose.base.yml \
  installers/windows/docker-compose.windows-amd.yml \
  installers/windows/docker-compose.windows-amd.local.yml; do
  test -f "$f" || { echo "[FAIL] missing $f"; exit 1; }
done

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "[SKIP] docker compose unavailable"
  exit 0
fi

tmp_env="$(mktemp)"
trap 'rm -f "$tmp_env"' EXIT
cat > "$tmp_env" <<'ENV_EOF'
WEBUI_SECRET=ci-placeholder
OLLAMA_PORT=11434
LLM_API_BASE_PATH=/api/v1
ENV_EOF

rendered="$(
  docker compose \
    --env-file "$tmp_env" \
    -f docker-compose.base.yml \
    -f installers/windows/docker-compose.windows-amd.yml \
    -f installers/windows/docker-compose.windows-amd.local.yml \
    config
)"

grep -q 'http://host.docker.internal:8080/api/v1/health' <<<"$rendered" \
  || { echo "[FAIL] Lemonade readiness probe must use native Windows port 8080"; exit 1; }
grep -q 'http://host.docker.internal:8080/health' <<<"$rendered" \
  || { echo "[FAIL] llama-server readiness probe must use native Windows port 8080"; exit 1; }
if grep -q 'host.docker.internal:11434' <<<"$rendered"; then
  echo "[FAIL] Windows AMD local overlay must not inherit OLLAMA_PORT=11434"
  exit 1
fi
grep -q 'condition: service_healthy' <<<"$rendered" \
  || { echo "[FAIL] open-webui must wait for llama-server-ready health"; exit 1; }

echo "[PASS] Windows AMD local compose overlay"
