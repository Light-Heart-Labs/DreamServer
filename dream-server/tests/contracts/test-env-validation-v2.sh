#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[FAIL] missing required command: $1"
    exit 1
  }
}

require_cmd jq
require_cmd python3

SCHEMA="$ROOT_DIR/.env.schema.json"
VALIDATOR="$ROOT_DIR/scripts/validate-env.sh"
MIGRATOR="$ROOT_DIR/scripts/migrate-config.sh"
PREFLIGHT="$ROOT_DIR/scripts/preflight-engine.sh"

[[ -f "$SCHEMA" ]] || { echo "[FAIL] schema missing: $SCHEMA"; exit 1; }
[[ -x "$VALIDATOR" ]] || { echo "[FAIL] validator not executable: $VALIDATOR"; exit 1; }
[[ -x "$MIGRATOR" ]] || { echo "[FAIL] migrator not executable: $MIGRATOR"; exit 1; }
[[ -x "$PREFLIGHT" ]] || { echo "[FAIL] preflight not executable: $PREFLIGHT"; exit 1; }

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "[contract] env parser handles quotes + inline comments"
cat > "$tmpdir/local.env" <<'ENV'
DREAM_MODE=local
WEBUI_SECRET="abc#123" # trailing comment should be ignored
N8N_USER=admin
N8N_PASS='pass # literal hash stays in value'
LITELLM_KEY=sk-test
OPENCLAW_TOKEN=token-123
GGUF_FILE="Qwen3-8B-Q4_K_M.gguf"
LLM_MODEL=qwen3-8b
CTX_SIZE=16384
ENV

"$VALIDATOR" --env-file "$tmpdir/local.env" --schema-file "$SCHEMA" --strict --json > "$tmpdir/local.json"
jq -e '.success == true and .summary.errors == 0 and .mode == "local"' "$tmpdir/local.json" >/dev/null \
  || { echo "[FAIL] local mode env should pass strict validation"; exit 1; }

echo "[contract] cloud mode requires at least one cloud API key"
cat > "$tmpdir/cloud-missing.env" <<'ENV'
DREAM_MODE=cloud
WEBUI_SECRET=secret
N8N_USER=admin
N8N_PASS=pass
LITELLM_KEY=sk-test
OPENCLAW_TOKEN=token-123
ENV

set +e
"$VALIDATOR" --env-file "$tmpdir/cloud-missing.env" --schema-file "$SCHEMA" --strict --json > "$tmpdir/cloud-missing.json"
rc=$?
set -e
if [[ "$rc" -ne 2 ]]; then
  echo "[FAIL] cloud mode missing cloud key should fail strict (rc=2), got rc=$rc"
  exit 1
fi
jq -e '.errors[] | select(.type == "missing_mode_any")' "$tmpdir/cloud-missing.json" >/dev/null \
  || { echo "[FAIL] expected missing_mode_any error for cloud mode"; exit 1; }

echo "[contract] cloud mode passes when one cloud key is set"
cat > "$tmpdir/cloud-valid.env" <<'ENV'
DREAM_MODE=cloud
WEBUI_SECRET=secret
N8N_USER=admin
N8N_PASS=pass
LITELLM_KEY=sk-test
OPENCLAW_TOKEN=token-123
OPENAI_API_KEY=sk-openai
ENV

"$VALIDATOR" --env-file "$tmpdir/cloud-valid.env" --schema-file "$SCHEMA" --strict --json > "$tmpdir/cloud-valid.json"
jq -e '.success == true and .summary.errors == 0 and .mode == "cloud"' "$tmpdir/cloud-valid.json" >/dev/null \
  || { echo "[FAIL] cloud mode with OPENAI_API_KEY should pass"; exit 1; }

echo "[contract] migrate-config autofix-env rewrites deprecated keys"
install_dir="$tmpdir/install"
mkdir -p "$install_dir"
cp "$SCHEMA" "$install_dir/.env.schema.json"
cat > "$install_dir/.env" <<'ENV'
WEBUI_SECRET=secret
N8N_USER=admin
N8N_PASS=pass
LITELLM_KEY=sk-test
OPENCLAW_TOKEN=token-123
LLAMA_SERVER_PORT=11434
MAX_CONTEXT=8192
ENV

INSTALL_DIR="$install_dir" "$MIGRATOR" autofix-env >/dev/null

grep -q '^OLLAMA_PORT=11434$' "$install_dir/.env" || { echo "[FAIL] expected LLAMA_SERVER_PORT -> OLLAMA_PORT"; exit 1; }
grep -q '^CTX_SIZE=8192$' "$install_dir/.env" || { echo "[FAIL] expected MAX_CONTEXT -> CTX_SIZE"; exit 1; }
if grep -q '^LLAMA_SERVER_PORT=' "$install_dir/.env"; then
  echo "[FAIL] LLAMA_SERVER_PORT should be removed"
  exit 1
fi
if grep -q '^MAX_CONTEXT=' "$install_dir/.env"; then
  echo "[FAIL] MAX_CONTEXT should be removed"
  exit 1
fi

echo "[contract] preflight env-strict blocks invalid env"
cat > "$tmpdir/preflight-invalid.env" <<'ENV'
DREAM_MODE=cloud
WEBUI_SECRET=secret
N8N_USER=admin
N8N_PASS=pass
LITELLM_KEY=sk-test
OPENCLAW_TOKEN=token-123
ENV

set +e
"$PREFLIGHT" \
  --report "$tmpdir/preflight-invalid.json" \
  --tier T1 \
  --ram-gb 64 \
  --disk-gb 200 \
  --gpu-backend nvidia \
  --gpu-vram-mb 24576 \
  --gpu-name "RTX 4090" \
  --platform-id linux \
  --compose-overlays docker-compose.base.yml,docker-compose.nvidia.yml \
  --script-dir "$ROOT_DIR" \
  --env-file "$tmpdir/preflight-invalid.env" \
  --schema-file "$SCHEMA" \
  --env-strict
rc=$?
set -e
if [[ "$rc" -ne 1 ]]; then
  echo "[FAIL] preflight --env-strict should fail with invalid env"
  exit 1
fi
jq -e '.env_validation.status == "failed" and .env_validation.summary.errors > 0' "$tmpdir/preflight-invalid.json" >/dev/null \
  || { echo "[FAIL] preflight report should include failed env validation"; exit 1; }

echo "[PASS] env validation v2 contracts"
