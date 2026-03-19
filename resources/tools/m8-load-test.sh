#!/bin/bash
# M8 Load Testing Script for vLLM
# Tests concurrent request handling

VLLM_URL="${VLLM_URL:-http://192.168.0.122:8003/v1}"
MODEL="Qwen/Qwen2.5-Coder-32B-Instruct-AWQ"
CONCURRENT="${1:-5}"
PROMPT="Write a haiku about AI."

echo "=== M8 vLLM Load Test ==="
echo "URL: $VLLM_URL"
echo "Model: $MODEL"
echo "Concurrent requests: $CONCURRENT"
echo ""

# Function to make a timed request
make_request() {
    local id=$1
    local start=$(date +%s.%N)
    
    response=$(curl -s -X POST "$VLLM_URL/chat/completions" \
        -H "Content-Type: application/json" \
        -d "{
            \"model\": \"$MODEL\",
            \"messages\": [{\"role\": \"user\", \"content\": \"$PROMPT\"}],
            \"max_tokens\": 50
        }")
    
    local end=$(date +%s.%N)
    local duration=$(awk "BEGIN {print $end - $start}")
    
    # Extract token count if available
    tokens=$(echo "$response" | jq -r '.usage.total_tokens // "n/a"')
    
    echo "Request $id: ${duration}s (tokens: $tokens)"
}

echo "Starting $CONCURRENT concurrent requests..."
start_time=$(date +%s.%N)

# Launch concurrent requests
for i in $(seq 1 $CONCURRENT); do
    make_request $i &
done

# Wait for all to complete
wait

end_time=$(date +%s.%N)
total_time=$(awk "BEGIN {print $end_time - $start_time}")

echo ""
echo "=== Results ==="
echo "Total time for $CONCURRENT requests: ${total_time}s"
echo "Average time per request: $(awk "BEGIN {printf \"%.2f\", $total_time / $CONCURRENT}")s"
