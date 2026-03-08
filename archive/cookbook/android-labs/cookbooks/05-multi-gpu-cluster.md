# Multi-GPU Cluster Setup Guide

*Premium consulting content — based on real dual RTX PRO 6000 Blackwell (96GB each) production setup*

## Hardware Topology

### NVLink vs PCIe

| Interconnect | Bandwidth | Best For |
|--------------|-----------|----------|
| NVLink | 600+ GB/s | Tensor parallelism, large model sharding |
| PCIe 4.0 | ~32 GB/s | Independent services, pipeline parallelism |
| PCIe 5.0 | ~64 GB/s | Mixed workloads |

**When to use NVLink:**
- Running single models split across GPUs (tensor parallelism)
- High inter-GPU communication needed
- Maximum throughput for parallel processing

**When PCIe is fine:**
- Running separate services on each GPU (LLM on one, STT on another)
- Independent workloads with minimal data sharing
- Cost-sensitive deployments

## Load Balancing Strategies

### Round-Robin
```
Request 1 → GPU 0
Request 2 → GPU 1
Request 3 → GPU 0
...
```
**Best for:** Evenly balanced, stateless workloads

### VRAM-Based Routing
```
if GPU_0.vram_free > GPU_1.vram_free:
    route_to(GPU_0)
else:
    route_to(GPU_1)
```
**Best for:** Variable-size requests, preventing OOM

### Least-Connections
```
route_to(gpu_with_fewest_active_requests)
```
**Best for:** Requests with variable processing time

### Model Sharding
```
[Model Layer 1-16] → GPU 0
[Model Layer 17-32] → GPU 1
```
**Best for:** Models too large for single GPU

## vLLM Multi-GPU Configuration

### Tensor Parallelism (TP)
Splits model layers horizontally across GPUs.

```bash
# 2-GPU tensor parallel
python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen2.5-72B-Instruct \
    --tensor-parallel-size 2 \
    --port 8000
```

**When to use:**
- Model too large for single GPU VRAM
- GPUs connected via NVLink
- Latency-sensitive (single request uses all GPUs)

### Pipeline Parallelism (PP)
Splits model layers vertically (sequential stages).

```bash
# 2-GPU pipeline parallel
python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen2.5-72B-Instruct \
    --pipeline-parallel-size 2 \
    --port 8000
```

**When to use:**
- High throughput needed (batch processing)
- GPUs on PCIe (lower bandwidth OK)
- Can tolerate slightly higher latency

### Hybrid (TP + PP)
```bash
# 4 GPUs: 2 TP × 2 PP
python -m vllm.entrypoints.openai.api_server \
    --model Qwen/Qwen2.5-72B-Instruct \
    --tensor-parallel-size 2 \
    --pipeline-parallel-size 2 \
    --port 8000
```

## Smart Proxy Architecture

### Health Check Script

```python
#!/usr/bin/env python3
"""GPU cluster health checker."""

import requests
import subprocess
import json

NODES = [
    {"name": "node122", "ip": "192.168.0.122", "port": 9100},
    {"name": "node143", "ip": "192.168.0.143", "port": 9100},
]

def check_vllm_health(node):
    """Check if vLLM is responding."""
    try:
        r = requests.get(f"http://{node['ip']}:{node['port']}/v1/models", timeout=5)
        return r.status_code == 200
    except:
        return False

def check_embeddings_health(ip, port=9103):
    """Check if embeddings service is responding (uses different endpoint)."""
    try:
        r = requests.post(
            f"http://{ip}:{port}/v1/embeddings",
            json={"input": "test", "model": "default"},
            timeout=5
        )
        return r.status_code == 200
    except:
        return False

def get_gpu_stats(node):
    """Get GPU stats via SSH."""
    try:
        result = subprocess.run(
            ["ssh", f"michael@{node['ip']}", 
             "nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10
        )
        util, mem_used, mem_total, temp = result.stdout.strip().split(", ")
        return {
            "gpu_util": int(util),
            "vram_used_gb": int(mem_used) / 1024,
            "vram_total_gb": int(mem_total) / 1024,
            "temp_c": int(temp)
        }
    except:
        return None

def cluster_status():
    """Get full cluster status."""
    status = {"healthy": True, "nodes": []}
    for node in NODES:
        node_status = {
            "name": node["name"],
            "vllm_healthy": check_vllm_health(node),
            "gpu": get_gpu_stats(node)
        }
        if not node_status["vllm_healthy"]:
            status["healthy"] = False
        status["nodes"].append(node_status)
    return status

if __name__ == "__main__":
    print(json.dumps(cluster_status(), indent=2))
```

### Failover Logic

```python
def route_request(request):
    """Route to healthiest available GPU."""
    status = cluster_status()
    
    available = [n for n in status["nodes"] if n["vllm_healthy"]]
    
    if not available:
        raise Exception("No healthy nodes!")
    
    if len(available) == 1:
        return available[0]  # Only option
    
    # Route to GPU with most free VRAM
    return min(available, key=lambda n: n["gpu"]["vram_used_gb"])
```

## Service Distribution

### Recommended Layout (Dual 96GB GPUs)

```
GPU 0 (.122) — "Coder"          GPU 1 (.143) — "Sage"
├── vLLM: Qwen2.5-Coder-32B     ├── vLLM: Qwen2.5-32B
├── VRAM: ~35GB                 ├── VRAM: ~35GB
└── Role: Code, tool calling    └── Role: General, research

Shared Services (either GPU, load balanced):
├── Whisper STT (~2GB)
├── Kokoro TTS (~1GB)
├── Embeddings (~1GB)
└── Headroom for spikes
```

### Alternative: Specialized Nodes

```
GPU 0 — "Voice Stack"           GPU 1 — "LLM Heavy"
├── Whisper Large-v3 (3GB)      ├── vLLM: Qwen2.5-72B (TP=1)
├── Kokoro TTS (1GB)            ├── VRAM: ~80GB
├── Small LLM for routing       └── Role: Complex reasoning
└── VRAM: ~20GB total
```

## Monitoring

### nvidia-smi One-Liner

```bash
watch -n 1 'nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv'
```

### Prometheus + DCGM Exporter

```yaml
# docker-compose.monitoring.yml
services:
  dcgm-exporter:
    image: nvcr.io/nvidia/k8s/dcgm-exporter:3.1.7-3.1.4-ubuntu22.04
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    ports:
      - "9400:9400"

  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
```

### Alert Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| GPU Utilization | >90% sustained | >95% for 5min |
| VRAM Usage | >85% | >95% |
| Temperature | >75°C | >83°C |
| Request Latency | >5s p95 | >10s p95 |

## Example Configs

### Nginx Load Balancer

```nginx
upstream vllm_cluster {
    least_conn;
    server 192.168.0.122:9100 weight=1 max_fails=3 fail_timeout=30s;
    server 192.168.0.143:9100 weight=1 max_fails=3 fail_timeout=30s;
}

upstream whisper_cluster {
    least_conn;
    server 192.168.0.122:9101;
    server 192.168.0.143:9101;
}

server {
    listen 9100;
    
    location / {
        proxy_pass http://vllm_cluster;
        proxy_connect_timeout 60s;
        proxy_read_timeout 300s;  # LLM can be slow
        proxy_set_header X-Real-IP $remote_addr;
        
        # Add routing header for debugging
        add_header X-Routed-To $upstream_addr;
    }
    
    location /health {
        access_log off;
        return 200 "healthy\n";
    }
}
```

### HAProxy with Health Checks

```haproxy
global
    log stdout format raw local0

defaults
    log global
    mode http
    option httplog
    option dontlognull
    timeout connect 10s
    timeout client 300s
    timeout server 300s
    
frontend vllm_frontend
    bind *:9100
    default_backend vllm_backend

backend vllm_backend
    balance leastconn
    option httpchk GET /v1/models
    http-check expect status 200
    
    server node122 192.168.0.122:8000 check inter 5s fall 3 rise 2
    server node143 192.168.0.143:8000 check inter 5s fall 3 rise 2
```

### Status Endpoint (Python/FastAPI)

```python
from fastapi import FastAPI
import httpx

app = FastAPI()

NODES = [
    {"name": "node122", "url": "http://192.168.0.122:9100"},
    {"name": "node143", "url": "http://192.168.0.143:9100"},
]

@app.get("/status")
async def cluster_status():
    status = []
    async with httpx.AsyncClient(timeout=5) as client:
        for node in NODES:
            try:
                r = await client.get(f"{node['url']}/v1/models")
                status.append({"node": node["name"], "healthy": True})
            except:
                status.append({"node": node["name"], "healthy": False})
    return {"nodes": status, "healthy": all(n["healthy"] for n in status)}
```

## Quick Start Checklist

1. [ ] Verify GPU topology: `nvidia-smi topo -m`
2. [ ] Install vLLM on all nodes
3. [ ] Configure load balancer (nginx/haproxy)
4. [ ] Set up health checks
5. [ ] Configure monitoring (prometheus + grafana)
6. [ ] Test failover by killing one node
7. [ ] Load test to find capacity limits
8. [ ] Document your specific configuration

---

*Recipe by The Collective — based on Michael's production dual RTX PRO 6000 Blackwell cluster*
