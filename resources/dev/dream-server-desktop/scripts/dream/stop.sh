#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${1:-${HOME}/.dream-server-hermes/dreamserver}"
DREAM_DIR="${INSTALL_DIR}/DreamServer/dream-server"
if [[ -f "${DREAM_DIR}/dream-macos.sh" ]]; then exec bash "${DREAM_DIR}/dream-macos.sh" stop; fi
if [[ -f "${DREAM_DIR}/docker-compose.yml" ]]; then cd "$DREAM_DIR"; exec docker compose stop; fi
echo "DreamServer stack not installed."
