#!/bin/bash
set -euo pipefail
# repair-perplexica.sh — Re-seed Perplexica config via HTTP API
# Called by: dream repair perplexica
# Requires: Perplexica container running, python3 available

PERPLEXICA_URL="${1:-http://localhost:3004}"
LLM_MODEL="${2:-qwen3-14b}"

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_CMD="python3"
if [[ -f "$SCRIPT_DIR/lib/python-cmd.sh" ]]; then
    . "$SCRIPT_DIR/lib/python-cmd.sh"
    PYTHON_CMD="$(ds_detect_python_cmd)"
elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
fi

# Wait for Perplexica to be ready (up to 60s)
for i in $(seq 1 12); do
    if curl -sf --max-time 5 "${PERPLEXICA_URL}/api/config" >/dev/null 2>&1; then
        break
    fi
    [[ $i -lt 12 ]] && sleep 5
done

# Seed config via API — export vars so Python reads from env (no shell interpolation)
export PERPLEXICA_URL LLM_MODEL

curl -sf --max-time 10 "${PERPLEXICA_URL}/api/config" | \
"$PYTHON_CMD" -c '
import sys, os, json, urllib.request

config = json.load(sys.stdin)["values"]
providers = config.get("modelProviders", [])
openai_prov = next((p for p in providers if p["type"] == "openai"), None)
transformers_prov = next((p for p in providers if p["type"] == "transformers"), None)

if not openai_prov:
    print("error: no openai provider found")
    sys.exit(1)

url = os.environ["PERPLEXICA_URL"] + "/api/config"
model = os.environ["LLM_MODEL"]

def post(key, value):
    data = json.dumps({"key": key, "value": value}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req)

# Set connection details
openai_prov["apiKey"] = "no-key"
openai_prov["baseUrl"] = "http://llama-server:8080/v1"
openai_prov["chatModels"] = [{"key": model, "name": model}]
post("modelProviders", providers)

# Set default providers and models
post("preferences", {
    "defaultChatProvider": openai_prov["id"],
    "defaultChatModel": model,
    "defaultEmbeddingProvider": transformers_prov["id"] if transformers_prov else openai_prov["id"],
    "defaultEmbeddingModel": "Xenova/all-MiniLM-L6-v2"
})

# Mark setup complete to bypass the wizard
post("setupComplete", True)
print("ok")
'
