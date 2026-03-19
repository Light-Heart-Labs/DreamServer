#!/bin/bash
# Start the vLLM tool call proxy
#
# Configuration (override via environment variables):
#   PROXY_PORT  - Port for the proxy (default: 8003)
#   VLLM_URL    - vLLM base URL (default: http://localhost:8000)
#
# Prerequisites: pip3 install flask requests

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROXY_SCRIPT="${SCRIPT_DIR}/vllm-tool-proxy.py"
PORT="${PROXY_PORT:-8003}"
VLLM="${VLLM_URL:-http://localhost:8000}"
LOG_FILE="/tmp/vllm-proxy.log"

# Kill existing proxy if running
pkill -f "vllm-tool-proxy.py" 2>/dev/null || true
sleep 1

echo "Starting vLLM Tool Call Proxy..."
echo "  Proxy port: $PORT"
echo "  vLLM URL:   $VLLM"
echo "  Log file:   $LOG_FILE"

nohup python3 "$PROXY_SCRIPT" \
  --port "$PORT" \
  --vllm-url "$VLLM" \
  > "$LOG_FILE" 2>&1 &

echo "  PID: $!"
sleep 2

# Verify
if curl -s "http://localhost:${PORT}/health" | grep -q '"status"'; then
  echo ""
  echo "Proxy is healthy!"
  curl -s "http://localhost:${PORT}/health" | python3 -m json.tool
else
  echo ""
  echo "ERROR: Proxy failed to start. Check $LOG_FILE"
  tail -20 "$LOG_FILE"
  exit 1
fi
