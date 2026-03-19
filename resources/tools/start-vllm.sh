#!/bin/bash
# Start vLLM serving a local model via Docker
#
# Configuration (override via environment variables):
#   VLLM_MODEL        - HuggingFace model ID (default: Qwen/Qwen3-Coder-Next-FP8)
#   VLLM_PORT         - Port for vLLM API (default: 8000)
#   VLLM_GPU_UTIL     - GPU memory utilization 0.0-1.0 (default: 0.92)
#   VLLM_MAX_LEN      - Max context length (default: 131072)
#   VLLM_VERSION      - vLLM Docker image tag (default: v0.15.1)
#   VLLM_TOOL_PARSER  - Tool call parser (default: qwen3_coder)
#   VLLM_EXTRA_ARGS   - Additional vLLM arguments (default: empty)
#
# CRITICAL FLAGS for Qwen3-Coder-Next:
#   --tool-call-parser qwen3_coder  (NOT hermes — wrong parser = broken tool calls)
#   --compilation_config.cudagraph_mode=PIECEWISE  (prevents CUDA errors with DeltaNet)
#   Do NOT use --kv-cache-dtype fp8 (causes assertion errors with this architecture)

set -euo pipefail

MODEL="${VLLM_MODEL:-Qwen/Qwen3-Coder-Next-FP8}"
PORT="${VLLM_PORT:-8000}"
GPU_UTIL="${VLLM_GPU_UTIL:-0.92}"
MAX_LEN="${VLLM_MAX_LEN:-131072}"
VERSION="${VLLM_VERSION:-v0.15.1}"
TOOL_PARSER="${VLLM_TOOL_PARSER:-qwen3_coder}"
EXTRA_ARGS="${VLLM_EXTRA_ARGS:-}"

echo "Starting vLLM..."
echo "  Model:      $MODEL"
echo "  Port:       $PORT"
echo "  GPU util:   $GPU_UTIL"
echo "  Max length: $MAX_LEN"
echo "  Version:    $VERSION"
echo "  Parser:     $TOOL_PARSER"

docker run -d \
  --name vllm-openclaw \
  --gpus all \
  --shm-size 16g \
  -p "${PORT}:${PORT}" \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  --restart unless-stopped \
  "vllm/vllm-openai:${VERSION}" \
  --model "$MODEL" \
  --port "$PORT" \
  --gpu-memory-utilization "$GPU_UTIL" \
  --max-model-len "$MAX_LEN" \
  --enable-auto-tool-choice \
  --tool-call-parser "$TOOL_PARSER" \
  --tensor-parallel-size 1 \
  --compilation_config.cudagraph_mode=PIECEWISE \
  $EXTRA_ARGS

echo ""
echo "Waiting for vLLM to start (model loading + CUDA graph compilation ~60-120s)..."
until curl -s "http://localhost:${PORT}/v1/models" > /dev/null 2>&1; do
  sleep 5
  echo "  Still loading..."
done

echo ""
echo "vLLM is ready!"
curl -s "http://localhost:${PORT}/v1/models" | python3 -m json.tool
