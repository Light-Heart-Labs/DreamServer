#!/usr/bin/env bash
# AMD/Lemonade compose stack contract tests.
# Validates that the AMD overlay + extension overlays produce a correct
# compose configuration for Lemonade-based inference.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

PASS=0
FAIL=0

pass() { echo "[PASS] $1"; PASS=$((PASS + 1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL + 1)); }

# ---------------------------------------------------------------------------
# 1. Required compose files exist
# ---------------------------------------------------------------------------
echo "[contract] AMD compose files exist"
for f in docker-compose.base.yml docker-compose.amd.yml \
         extensions/services/litellm/compose.yaml \
         extensions/services/litellm/compose.amd.yaml \
         extensions/services/litellm/compose.local.yaml \
         extensions/services/llama-server/Dockerfile.amd; do
    if [[ -f "$f" ]]; then
        pass "exists: $f"
    else
        fail "missing: $f"
    fi
done

# ---------------------------------------------------------------------------
# 2. Lemonade entrypoint uses absolute path
# ---------------------------------------------------------------------------
echo "[contract] Lemonade entrypoint uses absolute path"
if grep -q '/opt/lemonade/lemonade-server' docker-compose.amd.yml; then
    pass "entrypoint: absolute path /opt/lemonade/lemonade-server"
else
    fail "entrypoint: must use absolute path /opt/lemonade/lemonade-server"
fi

# ---------------------------------------------------------------------------
# 3. Lemonade healthcheck uses /api/v1/health
# ---------------------------------------------------------------------------
echo "[contract] Lemonade healthcheck endpoint"
if grep -q '/api/v1/health' docker-compose.amd.yml; then
    pass "healthcheck: /api/v1/health"
else
    fail "healthcheck: must use /api/v1/health (not /health)"
fi

# ---------------------------------------------------------------------------
# 4. LiteLLM AMD overlay blanks LITELLM_MASTER_KEY
# ---------------------------------------------------------------------------
echo "[contract] LiteLLM auth disabled for AMD"
if grep -q 'unset LITELLM_MASTER_KEY' extensions/services/litellm/compose.amd.yaml 2>/dev/null; then
    pass "litellm compose.amd.yaml: LITELLM_MASTER_KEY unset in entrypoint"
else
    fail "litellm compose.amd.yaml: must unset LITELLM_MASTER_KEY (empty string still enables auth)"
fi

# ---------------------------------------------------------------------------
# 5. Lemonade config has no master_key
# ---------------------------------------------------------------------------
echo "[contract] Lemonade LiteLLM config has no master_key"
if [[ -f config/litellm/lemonade.yaml ]]; then
    if grep -q 'master_key' config/litellm/lemonade.yaml; then
        fail "lemonade.yaml: must not contain master_key"
    else
        pass "lemonade.yaml: no master_key"
    fi
else
    fail "lemonade.yaml: file missing"
fi

# ---------------------------------------------------------------------------
# 6. Dockerfile.amd installs libatomic1
# ---------------------------------------------------------------------------
echo "[contract] Dockerfile.amd includes libatomic1"
if grep -q 'libatomic1' extensions/services/llama-server/Dockerfile.amd; then
    pass "Dockerfile.amd: libatomic1 installed"
else
    fail "Dockerfile.amd: must install libatomic1"
fi

# ---------------------------------------------------------------------------
# 7. Dockerfile.amd pins image tag (not :latest)
# ---------------------------------------------------------------------------
echo "[contract] Dockerfile.amd pins Lemonade image tag"
if grep -q 'lemonade-server:latest' extensions/services/llama-server/Dockerfile.amd; then
    fail "Dockerfile.amd: must pin a specific tag, not :latest"
elif grep -q 'lemonade-server:v' extensions/services/llama-server/Dockerfile.amd; then
    pass "Dockerfile.amd: pinned image tag"
else
    fail "Dockerfile.amd: no lemonade-server image reference found"
fi

# ---------------------------------------------------------------------------
# 8. Context size is configurable
# ---------------------------------------------------------------------------
echo "[contract] Lemonade context size configurable"
if grep -q 'LEMONADE_CTX_SIZE' docker-compose.amd.yml; then
    pass "CTX_SIZE passed to Lemonade container"
else
    fail "docker-compose.amd.yml must pass LEMONADE_CTX_SIZE"
fi

# ---------------------------------------------------------------------------
# 9. Service registry health override exists
# ---------------------------------------------------------------------------
echo "[contract] Service registry AMD health override"
if grep -q 'SERVICE_HEALTH.*api/v1/health' lib/service-registry.sh; then
    pass "service-registry.sh: AMD health endpoint override"
else
    fail "service-registry.sh: must override health endpoint for AMD/Lemonade"
fi

# ---------------------------------------------------------------------------
# 10. Schema allows DREAM_MODE=lemonade
# ---------------------------------------------------------------------------
echo "[contract] .env schema allows lemonade mode"
if grep -q '"lemonade"' .env.schema.json; then
    pass ".env.schema.json: lemonade in DREAM_MODE enum"
else
    fail ".env.schema.json: must include lemonade in DREAM_MODE enum"
fi

# ---------------------------------------------------------------------------
# 11. APE healthcheck does not use curl
# ---------------------------------------------------------------------------
echo "[contract] APE healthcheck uses python (not curl)"
if grep -q 'urllib.request' extensions/services/ape/compose.yaml; then
    pass "ape compose.yaml: python urllib healthcheck"
elif grep -q 'curl' extensions/services/ape/compose.yaml; then
    fail "ape compose.yaml: must not use curl (not in slim image)"
else
    fail "ape compose.yaml: no healthcheck found"
fi

# ---------------------------------------------------------------------------
# 12. Compose stack resolver includes lemonade in local mode overlay
# ---------------------------------------------------------------------------
echo "[contract] Compose resolver loads local overlays for lemonade mode"
if grep -q 'lemonade' scripts/resolve-compose-stack.sh; then
    pass "resolve-compose-stack.sh: lemonade mode recognized"
else
    fail "resolve-compose-stack.sh: must recognize lemonade mode for local overlays"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "AMD/Lemonade contracts: $PASS passed, $FAIL failed"
if [[ $FAIL -gt 0 ]]; then
    exit 1
fi
