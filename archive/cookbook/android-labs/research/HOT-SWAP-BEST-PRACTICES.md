# Hot-Swapping LLM Models in Production

*Best practices for zero-downtime model upgrades*

---

## Overview

Hot-swapping allows you to upgrade from one model to another (e.g., 1.5B → 32B) without interrupting active connections. This is essential for the bootstrap pattern where users start with a small model and upgrade to a larger one.

---

## vLLM Model Reload

### Option 1: Container Restart (Simple)

```bash
# Stop current container
docker compose stop vllm

# Update .env with new model
sed -i 's/LLM_MODEL=.*/LLM_MODEL=Qwen\/Qwen2.5-32B-Instruct-AWQ/' .env

# Start with new model
docker compose up -d vllm
```

**Downtime:** 30-60 seconds for model loading

### Option 2: Blue-Green Deployment (Zero Downtime)

1. Start new vLLM instance with new model on different port
2. Wait for health check to pass
3. Update load balancer/proxy to point to new instance
4. Stop old instance

```bash
# Start new instance
docker run -d --name vllm-new -p 8001:8000 \
  -v $HOME/.cache/huggingface:/root/.cache/huggingface \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-32B-Instruct-AWQ

# Wait for health
until curl -s http://localhost:8001/health | grep -q "ok"; do sleep 5; done

# Switch traffic (update nginx/traefik/etc)
# ...

# Stop old instance
docker stop vllm-old && docker rm vllm-old
```

---

## Graceful Connection Draining

Before stopping a container, drain existing connections:

```bash
# 1. Mark instance as unhealthy (stops new connections)
docker exec vllm touch /tmp/drain

# 2. Wait for in-flight requests to complete (30-60s typical)
sleep 60

# 3. Stop container
docker stop vllm
```

For vLLM specifically, in-flight requests complete naturally. The key is not accepting new requests during drain.

---

## Health Check Coordination

### Docker Compose Health Checks

```yaml
services:
  vllm:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 120s  # Allow time for model loading
```

### Dependent Service Startup

```yaml
services:
  webui:
    depends_on:
      vllm:
        condition: service_healthy
```

---

## Dream Server Bootstrap Pattern

The bootstrap system in `scripts/model-bootstrap.sh` implements:

1. **Preload:** Download 1.5B model before starting containers
2. **Background Download:** Fetch 32B model while user chats with 1.5B
3. **Swap Marker:** Touch file when download complete
4. **Hot Swap:** Restart vLLM with new model when ready

```bash
# Start bootstrap flow
./scripts/model-bootstrap.sh preload
docker compose up -d
./scripts/model-bootstrap.sh download Qwen/Qwen2.5-32B-Instruct-AWQ
./scripts/model-bootstrap.sh daemon &
```

---

## Key Metrics to Monitor

| Metric | Target | Why |
|--------|--------|-----|
| Health check latency | <5s | Detect model readiness |
| Request queue depth | <100 | Avoid timeouts during swap |
| Model load time | <60s | Minimize swap window |
| Memory usage | <90% | Prevent OOM during load |

---

## Failure Recovery

If hot-swap fails:

1. Check model download completed: `./scripts/model-bootstrap.sh status`
2. Check GPU memory: `nvidia-smi`
3. Check container logs: `docker compose logs vllm`
4. Rollback: Update .env to previous model, restart

---

*Part of Dream Server — Local AI Infrastructure*
