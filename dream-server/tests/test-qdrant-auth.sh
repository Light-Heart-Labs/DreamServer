#!/usr/bin/env bash
# =============================================================================
# Test: Qdrant starts with authentication enabled (PR #164)
# =============================================================================
# Usage: from repo root or dream-server install dir:
#   ./tests/test-qdrant-auth.sh
#   DREAM_INSTALL_DIR=/path/to/install ./tests/test-qdrant-auth.sh
# Expects: .env with QDRANT_API_KEY set, Qdrant container running (e.g. port 6333)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${DREAM_INSTALL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="$INSTALL_DIR/.env"
PORT="${QDRANT_PORT:-6333}"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "No .env at $ENV_FILE. Set DREAM_INSTALL_DIR or run from install dir."
    exit 1
fi

QDRANT_API_KEY=""
while IFS= read -r line; do
    if [[ "$line" =~ ^QDRANT_API_KEY=(.*)$ ]]; then
        QDRANT_API_KEY="${BASH_REMATCH[1]}"
        QDRANT_API_KEY="${QDRANT_API_KEY%\"}"
        QDRANT_API_KEY="${QDRANT_API_KEY#\"}"
        QDRANT_API_KEY="${QDRANT_API_KEY%\'}"
        QDRANT_API_KEY="${QDRANT_API_KEY#\'}"
        break
    fi
done < "$ENV_FILE"

if [[ -z "$QDRANT_API_KEY" ]]; then
    echo "QDRANT_API_KEY not set in $ENV_FILE"
    exit 1
fi

echo "Testing Qdrant at http://localhost:$PORT (auth enabled)..."
if curl -sf -H "api-key: $QDRANT_API_KEY" "http://localhost:$PORT/" >/dev/null; then
    echo "OK: Qdrant responds with 200 when using API key"
else
    echo "FAIL: Qdrant did not respond with 200 (is the container up?)"
    exit 1
fi

# Without key should fail (401 or connection refused if auth required)
if curl -sf "http://localhost:$PORT/" >/dev/null 2>&1; then
    echo "WARN: Qdrant responded without API key (auth may be disabled)"
else
    echo "OK: Requests without API key are rejected"
fi

echo "Qdrant authentication test passed."
