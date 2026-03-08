# LiveKit Voice Agent Deployment Guide

*Complete guide to deploying self-hosted voice agents with LiveKit + local AI*

---

## Overview

This guide covers deploying a production voice agent system using:
- **LiveKit** — Real-time audio/video SFU
- **vLLM** — Local LLM inference (Qwen 32B)
- **Whisper** — Speech-to-text
- **Kokoro** — Text-to-speech

**Architecture:**
```
Client → LiveKit → Whisper (STT) → vLLM (LLM) → Kokoro (TTS) → LiveKit → Client
```

---

## Prerequisites

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 16GB | 32GB+ |
| GPU | RTX 3060 12GB | RTX 4090 24GB |
| Network | 100 Mbps | 1 Gbps |

### Software Requirements

- Docker + Docker Compose
- NVIDIA drivers + nvidia-container-toolkit
- Open ports: 7880-7882/tcp, 50000-60000/udp

---

## Step 1: Deploy vLLM + Voice Services

If you don't already have our cluster running, use Dream Server:

```bash
# Clone and run
git clone https://github.com/Lightheartdevs/Android-Labs
cd Android-Labs/dream-server
./install.sh

# Or manual Docker:
docker compose --profile voice up -d
```

**Verify services:**
```bash
# LLM
curl http://localhost:8000/v1/models

# STT (Whisper)
curl http://localhost:9101/health

# TTS (Kokoro)
curl http://localhost:9102/health
```

---

## Step 2: Deploy LiveKit Server

### Option A: Dev Mode (Quick Testing)

```bash
# Download LiveKit binary
wget https://github.com/livekit/livekit/releases/latest/download/livekit_linux_amd64.tar.gz
tar xf livekit_linux_amd64.tar.gz

# Run in dev mode
./livekit-server --dev --bind 0.0.0.0
```

Default credentials: `devkey` / `secret`

### Option B: Docker Compose (Production)

```yaml
# livekit-server/docker-compose.yml
version: '3'
services:
  livekit:
    image: livekit/livekit-server:latest
    command: --config /etc/livekit.yaml --dev
    ports:
      - "7880:7880"
      - "7881:7881"
      - "7882:7882/udp"
      - "50000-60000:50000-60000/udp"
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml
    network_mode: host  # Required for WebRTC UDP
```

```yaml
# livekit.yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 60000
  tcp_port: 7881
  use_external_ip: true
keys:
  devkey: secret
logging:
  level: info
```

```bash
docker compose up -d
```

---

## Step 3: Deploy Voice Agent

The voice agent bridges LiveKit audio to our AI pipeline.

### Create Agent Directory

```bash
mkdir -p voice-agent && cd voice-agent
```

### Python Agent (agent.py)

```python
#!/usr/bin/env python3
"""LiveKit Voice Agent - bridges audio to local AI"""

import asyncio
import os
from livekit import agents, rtc
from livekit.agents import stt, tts, llm
from livekit.plugins import openai, silero

# Configuration from environment
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "ws://localhost:7880")
# NOTE: Set these in environment - never hardcode in production!
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "<YOUR-LIVEKIT-API-KEY>")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "<YOUR-LIVEKIT-API-SECRET>")
OPENAI_API_BASE = os.getenv("OPENAI_API_BASE", "http://localhost:8000/v1")
WHISPER_URL = os.getenv("WHISPER_URL", "http://localhost:9101")
TTS_URL = os.getenv("TTS_URL", "http://localhost:9102")

async def entrypoint(ctx: agents.JobContext):
    # Connect to room
    await ctx.connect()
    
    # Initialize components
    chat_ctx = llm.ChatContext().append(
        role="system",
        text="You are a helpful voice assistant. Be concise and natural."
    )
    
    # Use local vLLM
    llm_plugin = openai.LLM(
        base_url=OPENAI_API_BASE,
        model="Qwen/Qwen2.5-32B-Instruct-AWQ",
        api_key="not-needed"
    )
    
    # Use local Whisper
    stt_plugin = openai.STT(
        base_url=WHISPER_URL,
        model="large-v3"
    )
    
    # Use local TTS
    tts_plugin = openai.TTS(
        base_url=TTS_URL,
        voice="af_bella"
    )
    
    # Create voice agent
    agent = agents.VoicePipelineAgent(
        vad=silero.VAD.load(),
        stt=stt_plugin,
        llm=llm_plugin,
        tts=tts_plugin,
        chat_ctx=chat_ctx,
    )
    
    agent.start(ctx.room)
    await asyncio.sleep(float('inf'))

if __name__ == "__main__":
    agents.cli.run_app(agents.WorkerOptions(entrypoint_fnc=entrypoint))
```

### Requirements (requirements.txt)

```
livekit-agents>=0.8.0
livekit-plugins-openai>=0.8.0
livekit-plugins-silero>=0.8.0
```

### Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agent.py .

CMD ["python", "agent.py", "start"]
```

### Docker Compose for Agent

```yaml
# docker-compose.yml
version: '3'
services:
  voice-agent:
    build: .
    environment:
      - LIVEKIT_URL=ws://host.docker.internal:7880
      # NOTE: Set these via environment - never commit to git!
      - LIVEKIT_API_KEY=<YOUR-LIVEKIT-API-KEY>
      - LIVEKIT_API_SECRET=<YOUR-LIVEKIT-API-SECRET>
      - OPENAI_API_BASE=http://192.168.0.122:9100/v1
      - WHISPER_URL=http://192.168.0.122:9101
      - TTS_URL=http://192.168.0.122:9102
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

---

## Step 4: Test the System

### Start Everything

```bash
# Terminal 1: LiveKit server
./livekit-server --dev

# Terminal 2: Voice agent
cd voice-agent && docker compose up

# Or without Docker:
python agent.py start
```

### Test with LiveKit Playground

1. Open https://meet.livekit.io
2. Enter your LiveKit URL: `ws://YOUR-IP:7880`
3. Use API key/secret from config
4. Join a room and speak

### Test with Simple Client

```html
<!-- test-client.html -->
<!DOCTYPE html>
<html>
<head><title>Voice Agent Test</title></head>
<body>
  <button id="connect">Connect</button>
  <script type="module">
    import { Room, RoomEvent } from 'livekit-client';
    
    document.getElementById('connect').onclick = async () => {
      // Get token from your backend (or hardcode for testing)
      const room = new Room();
      await room.connect('ws://localhost:7880', 'YOUR-TOKEN');
      
      // Enable microphone
      await room.localParticipant.setMicrophoneEnabled(true);
      
      // Listen for responses
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === 'audio') {
          const audio = track.attach();
          document.body.appendChild(audio);
        }
      });
    };
  </script>
</body>
</html>
```

---

## Step 5: Production Hardening

### Add TLS (Required for Production)

**Option A: Caddy Reverse Proxy**

```yaml
# caddy/Caddyfile
voice.yourdomain.com {
  reverse_proxy localhost:7880
}
```

**Option B: Tailscale (Local Network)**

```bash
# Install Tailscale on server
tailscale up

# Access via Tailscale hostname
# Uses automatic TLS without exposing to internet
```

### System Tuning

```bash
# Increase UDP buffers (critical for WebRTC)
echo 'net.core.rmem_max=2500000' | sudo tee -a /etc/sysctl.conf
echo 'net.core.wmem_max=2500000' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Increase file handles
echo '* soft nofile 65535' | sudo tee -a /etc/security/limits.conf
echo '* hard nofile 65535' | sudo tee -a /etc/security/limits.conf
```

### Firewall Rules

```bash
# UFW
sudo ufw allow 7880/tcp
sudo ufw allow 7881/tcp
sudo ufw allow 7882/udp
sudo ufw allow 50000:60000/udp

# Or iptables
iptables -A INPUT -p tcp --dport 7880:7882 -j ACCEPT
iptables -A INPUT -p udp --dport 50000:60000 -j ACCEPT
```

---

## Troubleshooting

### Audio Not Working

1. **Check browser permissions** — Microphone must be allowed
2. **Check WebRTC connectivity** — Try `--dev` mode first
3. **Check firewall** — UDP 50000-60000 must be open
4. **Check TURN** — May need for restrictive networks

### High Latency

| Symptom | Cause | Fix |
|---------|-------|-----|
| >1s to start speaking | STT model loading | Use smaller Whisper model |
| >2s response time | LLM inference | Use faster model/GPU |
| Choppy audio | Network jitter | Enable TURN, check bandwidth |

### Connection Issues

```bash
# Check LiveKit is running
curl http://localhost:7880/api/health

# Check room exists
curl -H "Authorization: Bearer YOUR-TOKEN" \
  http://localhost:7880/twirp/livekit.RoomService/ListRooms

# Check agent connected
docker logs voice-agent
```

### vLLM Not Responding

```bash
# Check vLLM health
curl http://192.168.0.122:9100/health

# Check model loaded
curl http://192.168.0.122:9100/v1/models

# Check cluster status
curl http://192.168.0.122:9199/status
```

---

## Capacity Planning

Based on M8 benchmarks on our dual PRO 6000 cluster:

| Use Case | Per GPU | Both GPUs |
|----------|---------|-----------|
| Voice agents (<2s latency) | 10-20 | 20-40 |
| Interactive chat (<5s) | ~50 | ~100 |
| Batch (latency flexible) | 100+ | 200+ |

**For single RTX 4090:**
- 5-10 concurrent voice agents (comfortable)
- 15-20 maximum (with latency degradation)

---

## Related Documentation

- `research/LIVEKIT-SELF-HOSTING.md` — Detailed architecture
- `research/LIVEKIT-AGENTS-ARCHITECTURE.md` — Agent SDK deep-dive
- `research/LIVEKIT-SDK-INTEGRATION.md` — Client integration
- `docs/M2-LIVEKIT-TRAFFIC-ROUTING.md` — Traffic patterns
- `cookbook/07-grace-voice-agent.md` — Grace implementation example

---

*Mission M2 | Last updated: 2026-02-09*
