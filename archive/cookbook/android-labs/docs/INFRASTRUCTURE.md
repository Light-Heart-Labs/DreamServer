# INFRASTRUCTURE.md — Shared Reference

*Single source of truth for cluster and server details. Pull, don't duplicate.*

## GPU Cluster

| Node | IP | Hostname | GPU |
|------|----|----------|-----|
| .122 | 192.168.0.122 | lightheartworker | RTX PRO 6000 Blackwell (96GB) |
| .143 | 192.168.0.143 | Tower2 | RTX PRO 6000 Blackwell (96GB) |

### Smart Proxy Ports (hit either node)

| Port | Service | Notes |
|------|---------|-------|
| 8000 | vLLM (direct) | Per-node |
| 9100 | vLLM Proxy | Round-robin Coder/Sage |
| 9101 | Whisper STT | Round-robin |
| 9102 | TTS (Kokoro) | Round-robin |
| 9103 | Embeddings | Round-robin |
| 9104 | Flux (images) | VRAM-based |
| 9107 | Coder only (.122) | Single |
| 9108 | Sage only (.143) | Single |
| 9199 | Cluster status | Health check |

### Models Running

- **.122**: Qwen2.5-Coder-32B-Instruct-AWQ (32K context)
- **.143**: Qwen2.5-32B-Instruct-AWQ (32K context)

### Failover
- Automatic: if one node dies, 100% routes to survivor
- Health check every 3 seconds

## Grace HVAC Voice Agent

- **Server**: michael@192.168.0.122
- **Code**: /home/michael/HVAC_Grace/
- **GitHub**: https://github.com/Lightheartdevs/GLO
- **Service**: hvac-grace-agent.service (auto-restart)
- **Logs**: /tmp/hvac_agent.log
- **Restart**: `pkill -f hvac_agent.py`

### Related Services
- Flask API: port 8097
- n8n: port 5678
- PostgreSQL: port 5433

## SSH Access

- **Grace**: `ssh michael@192.168.0.122` (key auth)

## Dream Server Docker Networking (.122)

Production containers run outside the compose stack but need `dream-network` for health checks:

```bash
# Connect production containers to dream-network (required after container recreation)
docker network connect dream-network vllm-coder
docker network connect dream-network openwebui-prod
docker network connect dream-network n8n-prod
docker network connect dream-network qdrant-prod
```

The dashboard-api expects these hostnames on dream-network:
- `vllm-coder:8000`
- `openwebui-prod:8080` (internal port, not 3000)
- `n8n-prod:5678`
- `qdrant-prod:6333`

## GitHub Repos

| Repo | Purpose |
|------|---------|
| Android-Labs | Collective workspace, experiments, research |
| GLO | Grace production code |
| Server-Setup | Full tower state snapshots |

## Known Issues

**Git SSH on .122**: The `android-collective` deploy key is registered but GitHub rejects it.
Public key fingerprint: `SHA256:bBlmyF+929Mh9oITS6daPMz1b0mQ01mbw5qn4u9RbIk`
Workaround: scp files or push from sandbox. Needs Michael to re-add the key to GitHub.

**NVIDIA Driver Mismatch (.122 & .143) — 2026-02-12**
- NVML version mismatch (580.126) prevents GPU containers from starting
- **Workaround**: vLLM traffic routed to `.143:8000` only (port 9100 cluster proxy + direct access)
- **Impact**: .122 GPU unavailable until Michael fixes host driver
- **Status**: M4/M6 development continuing via .143 single-node routing

## T-1000 Guardian (Critical Safety System)

**⚠️ Awareness:** The T-1000 Guardian is a self-healing infrastructure watchdog that runs **as root** and is **immutable** (`chattr +i`). This is intentional and critical to the setup's resilience.

### What It Does
- Monitors 10+ critical resources across 4 tiers (gateways, API routing, memory/context, agent helpers)
- Auto-restarts failed services with 3-strike recovery (soft restart ×3 → restore from backup)
- Maintains 5 generations of snapshots in `/var/lib/guardian/backups/`
- Self-integrity: re-sets its own immutable flags if cleared

### Why Immutable + Root
- **Agents cannot kill or modify it** — prevents accidental (or intentional) disruption
- **Survives corruption** — even if agents manage to break something 3 times, it restores from known-good backups
- **Last line of defense** — ensures the critical chain stays intact regardless of agent actions

### Location
- Script: `/usr/local/bin/guardian.sh`
- Service: `t1000-guardian.service`
- Status: `systemctl status t1000-guardian`

**Do not modify or disable without explicit coordination.**

