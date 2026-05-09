#!/usr/bin/env bash
set -euo pipefail
INSTALL_DIR="${1:-${HOME}/.dream-server-hermes/dreamserver}"
DREAM_DIR="${INSTALL_DIR}/DreamServer/dream-server"
if [[ -x "${DREAM_DIR}/dream" ]]; then exec "${DREAM_DIR}/dream" status-json; fi
if [[ -f "${DREAM_DIR}/docker-compose.yml" ]]; then cd "$DREAM_DIR"; exec docker compose ps; fi
echo '{"status":"not_installed"}'
