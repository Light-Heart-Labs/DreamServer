# LiveKit Self-Hosting Research

*Research: Android-17 | Date: 2026-02-09 | Mission: M2 Voice Systems*

## Executive Summary

LiveKit is an open-source WebRTC SFU (Selective Forwarding Unit) that can be fully self-hosted. It's a strong candidate for Michael's voice agent infrastructure — real-time bidirectional audio/video with sub-100ms latency, no cloud dependency.

**Bottom line:** Self-hosting is straightforward for small deployments. Our GPU cluster (.122/.143) is overkill for LiveKit itself, but ideal for the AI pipeline it feeds into (STT → LLM → TTS).

---

## Architecture Overview

### What LiveKit Is

- **SFU (Selective Forwarding Unit)** — Routes media streams without transcoding
- **Written in Go** using Pion WebRTC implementation
- **Horizontally scalable** — Single node or multi-node with Redis
- **Single room per node** — Each room fits on one server; multi-node = multiple rooms

### Why SFU > MCU for Voice Agents

| Aspect | MCU | SFU (LiveKit) |
|--------|-----|---------------|
| CPU usage | High (transcoding) | Low (forwarding only) |
| Latency | Higher | Lower |
| Flexibility | Fixed layouts | Full control per track |
| Scale | Vertical | Horizontal |

For voice agents, we want individual audio tracks we can route to Whisper — SFU is the right choice.

---

## Hardware Requirements

### Official Benchmarks (16-core c2-standard-16)

| Use Case | Publishers | Subscribers | CPU Usage |
|----------|------------|-------------|-----------|
| Large audio room | 10 | 3000 | 80% |
| Large video meeting | 150 | 150 | 85% |
| Livestreaming | 1 | 3000 | 92% |

### For Small Deployment (1-10 concurrent users)

**Minimum viable:**
- 2-4 CPU cores
- 2-4 GB RAM
- 100 Mbps bandwidth (audio only: ~10 Mbps sufficient)

**Our cluster:** Way overkill for LiveKit itself, but perfect for the AI pipeline:
- LiveKit → Whisper (STT) → Qwen (LLM) → Kokoro (TTS) → LiveKit

---

## Deployment Options

### Option 1: Official Docker Compose (Recommended)

```bash
# Generate config for your domain
docker run --rm -it -v$PWD:/output livekit/generate
```

Creates:
- `caddy.yaml` — Reverse proxy + TLS termination
- `docker-compose.yaml` — LiveKit + Redis + Caddy
- `livekit.yaml` — Server config
- `redis.conf` — Redis config
- `init_script.sh` / `cloud_init.yaml` — Setup scripts

### Option 2: Dev Mode (Quick Local Testing)

```bash
# Download binary
wget https://github.com/livekit/livekit/releases/latest/...

# Run in dev mode (no TLS)
./livekit-server --dev --bind 0.0.0.0
```

Default dev credentials: `devkey` / `secret`

### Option 3: Kubernetes

Official Helm chart available. Probably overkill for our setup.

---

## Network Requirements

### Ports (Must be open on firewall)

| Port | Protocol | Purpose |
|------|----------|---------|
| 443 | TCP | Primary HTTPS + TURN/TLS |
| 80 | TCP | TLS certificate issuance |
| 7880 | TCP | Signal server (internal) |
| 7881 | TCP | WebRTC over TCP fallback |
| 3478 | UDP | TURN/UDP |
| 50000-60000 | UDP | WebRTC media (default range) |

**For Ingress (optional):**
- 1935/TCP — RTMP ingress
- 7885/UDP — WHIP ingress

### TURN Server

LiveKit includes an **embedded TURN server** — no need for external coturn.

- TURN/TLS on port 443 for corporate firewalls
- TURN/UDP on port 443 for HTTP/3-friendly networks
- Integrated auth with LiveKit (no separate credentials)

---

## Configuration Highlights

From `config-sample.yaml`:

```yaml
port: 7880  # Main service port

# For multi-node: requires Redis
redis:
  address: redis.host:6379

# WebRTC config
rtc:
  port_range_start: 50000
  port_range_end: 60000
  tcp_port: 7881
  use_external_ip: true  # Auto-discover public IP via STUN

# API keys (for JWT auth)
keys:
  myapikey: mysecret

# Built-in TURN (optional but recommended)
turn:
  enabled: true
  udp_port: 3478
  tls_port: 443  # Requires SSL cert
```

---

## Local Network Considerations (Home Lab)

### The Challenge

LiveKit's official deploy assumes:
1. Public domain with DNS
2. Let's Encrypt for TLS
3. Internet-accessible server

Our setup is **local network only** — different approach needed.

### Solutions

**Option A: Local DNS + DNS-01 Challenge**
- Use acme-dns for internal TLS certs
- Point local DNS to 192.168.0.122
- See: github.com/anguzo/livekit-self-hosted

**Option B: Dev Mode + mTLS**
- Run in dev mode on local network
- Use mTLS between services
- Simpler, less production-ready

**Option C: Tailscale/ZeroTier**
- VPN mesh network with magic DNS
- Get proper TLS without public exposure
- Clean solution if clients are also on mesh

### Recommended for Us

**Start with dev mode** for prototyping. When it works, add Tailscale for proper TLS without exposing anything to the internet.

---

## Integration with Our Voice Pipeline

```
┌─────────────┐     ┌───────────┐     ┌─────────────┐
│   Client    │────▶│  LiveKit  │────▶│   Whisper   │
│ (Browser/   │     │    SFU    │     │  STT :9101  │
│  Mobile)    │◀────│  :7880    │◀────│             │
└─────────────┘     └───────────┘     └─────────────┘
                          │                  │
                          │                  ▼
                          │           ┌─────────────┐
                          │           │    Qwen     │
                          │           │  LLM :9100  │
                          │           │             │
                          │           └─────────────┘
                          │                  │
                          │                  ▼
                          │           ┌─────────────┐
                          ◀───────────│   Kokoro    │
                                      │  TTS :9102  │
                                      └─────────────┘
```

**Integration points:**
1. LiveKit Agents SDK (Python/JS) — handles room management
2. Audio tracks → Extract PCM → Whisper
3. Response text → Kokoro → Audio track → Client

---

## Common Gotchas

1. **DNS must resolve before starting** — Caddy needs DNS for cert issuance
2. **Use host networking in Docker** — Required for WebRTC UDP performance
3. **Increase UDP buffers:**
   ```bash
   sysctl -w net.core.rmem_max=2500000
   sysctl -w net.core.wmem_max=2500000
   ```
4. **File handle limits:** `ulimit -n 65535` for production
5. **Redis required for multi-node** — Single node works without
6. **One room per node** — Rooms can't span multiple servers

---

## Next Steps

1. [ ] Spin up LiveKit in dev mode on .122
2. [ ] Test with browser client (LiveKit Meet example)
3. [ ] Write audio extraction → Whisper bridge
4. [ ] Integrate response pipeline (Qwen → Kokoro)
5. [ ] Add Tailscale for proper TLS
6. [ ] Load test with multiple concurrent sessions

---

## References

- Docs: https://docs.livekit.io
- GitHub: https://github.com/livekit/livekit
- Config sample: https://github.com/livekit/livekit/blob/master/config-sample.yaml
- Local hosting example: https://github.com/anguzo/livekit-self-hosted
- Agents SDK: https://github.com/livekit/agents
