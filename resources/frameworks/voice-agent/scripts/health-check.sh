#!/bin/bash
# HVAC Grace Health Check Script

echo "=== HVAC Grace Health Check $(date) ==="

# Check services
echo -e "\n--- Service Status ---"
systemctl is-active hvac-grace-agent && echo "hvac-grace-agent: OK" || echo "hvac-grace-agent: FAILED"

# Check Docker containers
echo -e "\n--- Docker Containers ---"
for container in whisper-server vllm-qwen32b tts-server kokoro-tts; do
  if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
    echo "$container: RUNNING"
  else
    echo "$container: NOT RUNNING"
  fi
done

# Check endpoints
echo -e "\n--- Endpoint Health ---"
curl -s --max-time 5 http://localhost:8080/v1/models > /dev/null && echo "vLLM (8000): OK" || echo "vLLM (8000): FAILED"
curl -s --max-time 5 http://localhost:9000/ > /dev/null && echo "Whisper (8001): OK" || echo "Whisper (8001): FAILED"
curl -s --max-time 5 http://localhost:8880/ > /dev/null && echo "TTS (8002): OK" || echo "TTS (8002): FAILED"

# Check resources
echo -e "\n--- Resources ---"
free -h | grep Mem
df -h / | tail -1
nvidia-smi --query-gpu=temperature.gpu,memory.used,memory.total --format=csv,noheader 2>/dev/null || echo "GPU: N/A"


# Check recent errors
echo -e "\n--- Recent Errors (last 5 min) ---"
journalctl -u hvac-grace-agent --since "5 minutes ago" --no-pager 2>/dev/null | grep -iE "error|exception|failed" | tail -5 || echo "No recent errors"

echo -e "\n=== Health Check Complete ==="
