# LiveKit Agents Architecture — Deep Research

> **Date:** 2026-02-08
> **Purpose:** Mission 2 — Democratizing Voice Agents
> **Researcher:** Todd (subagent)
> **Sources:** LiveKit official docs, GitHub repos, benchmarks

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Agent Dispatch System](#2-agent-dispatch-system)
3. [Self-Hosted vs Cloud — The Mix-and-Match Question](#3-self-hosted-vs-cloud)
4. [SFU (Selective Forwarding Unit) Requirements](#4-sfu-requirements)
5. [TURN/STUN Server Needs](#5-turnstun-server-needs)
6. [Bandwidth Estimates per Voice Call](#6-bandwidth-estimates)
7. [Open-Source Alternatives](#7-open-source-alternatives)
8. [Key Takeaways for Mission 2](#8-key-takeaways)

---

## 1. Architecture Overview

### What LiveKit Actually Is

LiveKit is an **open-source WebRTC Selective Forwarding Unit (SFU)** written in Go, built on top of the [Pion WebRTC](https://github.com/pion/webrtc) library. It's Apache 2.0 licensed — the entire stack is open source.

The **Agents Framework** (Python and Node.js SDKs) sits on top of the SFU and lets you build AI agents that join LiveKit rooms as full realtime participants.

### The Full Stack (All Open Source)

```
┌─────────────────────────────────────────────────────┐
│                  YOUR APPLICATION                     │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Frontend  │  │  Agent    │  │  Server APIs     │  │
│  │ (SDK)     │  │  (Python/ │  │  (Go/Node/Python)│  │
│  │           │  │   Node.js)│  │                  │  │
│  └─────┬─────┘  └─────┬─────┘  └────────┬─────────┘  │
│        │              │                  │            │
│  ══════╪══════════════╪══════════════════╪════════    │
│        │         WebRTC                  │ HTTP/WS    │
│        │              │                  │            │
│  ┌─────▼──────────────▼──────────────────▼─────────┐  │
│  │           LiveKit SFU Server (Go)               │  │
│  │  ┌────────┐ ┌─────────┐ ┌────────┐ ┌────────┐  │  │
│  │  │Signaling│ │  Media  │ │  NAT   │ │  TURN  │  │  │
│  │  │(WebSocket)│ │ Routing │ │Traversal│ │ Server │  │  │
│  │  └────────┘ └─────────┘ └────────┘ └────────┘  │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### How Voice Agents Work (STT → LLM → TTS Pipeline)

```
User speaks into microphone
        │
        ▼
┌──────────────────┐
│  WebRTC Audio    │ (Opus codec, ~32kbps)
│  → LiveKit SFU   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Agent Process   │ (Python/Node.js)
│  ┌─────────────┐ │
│  │ VAD (Silero) │ │ ← Voice Activity Detection (local model)
│  └──────┬──────┘ │
│         ▼        │
│  ┌─────────────┐ │
│  │ STT (e.g.   │ │ ← Speech-to-Text (API call or local)
│  │ Deepgram)   │ │
│  └──────┬──────┘ │
│         ▼        │
│  ┌─────────────┐ │
│  │ LLM (e.g.   │ │ ← Language Model (API call or local)
│  │ GPT-4.1)    │ │
│  └──────┬──────┘ │
│         ▼        │
│  ┌─────────────┐ │
│  │ TTS (e.g.   │ │ ← Text-to-Speech (API call or local)
│  │ Cartesia)   │ │
│  └──────┬──────┘ │
│         ▼        │
│  WebRTC Audio    │
│  → LiveKit SFU   │
└──────────────────┘
         │
         ▼
User hears AI response
```

### Key Architectural Insight

The agent code **does NOT run inside the SFU**. The agent is a separate process (Python/Node.js) that:
1. Registers with the LiveKit server over WebSocket
2. Receives dispatch requests
3. Joins the room as a WebRTC participant (just like a browser would)
4. Communicates with AI models via HTTP/WebSocket (standard API calls)

This means **the agent can run ANYWHERE** — same machine as the SFU, different machine, different data center, even a different continent (though latency matters).

### Core Components

| Component | What It Does | Language | License |
|-----------|-------------|----------|---------|
| **LiveKit Server** | SFU — routes media between participants | Go | Apache 2.0 |
| **Agents Framework** | Build AI agents as room participants | Python / Node.js | Apache 2.0 |
| **Client SDKs** | Connect frontends to rooms | JS, Swift, Android, Flutter, Rust, Unity, ESP32 | Apache 2.0 |
| **Egress** | Record/stream rooms | Go | Apache 2.0 |
| **Ingress** | Ingest RTMP/WHIP/HLS streams | Go | Apache 2.0 |
| **SIP** | Telephony integration (PSTN/SIP) | Go | Apache 2.0 |

---

## 2. Agent Dispatch System

### How Agents Get Routed to Rooms

This is one of the most elegant parts of the architecture.

#### Registration Phase
```
Agent Server (your code) ──WebSocket──▶ LiveKit Server
         "I'm available, here's my capacity"
         
LiveKit Server maintains a registry of all connected agent servers
```

#### Dispatch Flow
```
1. User connects to a room (or room is created)
2. LiveKit Server checks: "which agent servers are available?"
3. Sends dispatch request to an available agent server
4. Agent server accepts → spawns a NEW SUBPROCESS for this job
5. Subprocess joins the room as a participant
6. Each job is isolated — if one crashes, others survive
```

#### Dispatch Modes

**Automatic Dispatch (Default)**
- Every new room automatically gets an agent assigned
- Simplest setup — no additional code needed
- Best for: "every user gets the same agent"

**Explicit Dispatch**
- You set `agent_name` in the decorator → turns off auto-dispatch
- Agents must be explicitly dispatched via:
  - **API call** (AgentDispatchService)
  - **SIP dispatch rules** (for inbound phone calls)
  - **Participant token** (dispatch on connection)
- Best for: multiple agent types, conditional routing, SIP integrations

```python
# Explicit dispatch example
@server.rtc_session(agent_name="customer-support")
async def entrypoint(ctx: JobContext):
    # This agent only runs when explicitly dispatched
    ...
```

#### Dispatch Performance
- Supports **hundreds of thousands of new connections per second**
- Max dispatch time: **under 150ms**
- Built-in **round-robin load balancing** across agent servers

#### Load Balancing Details
- Agent servers report `load` (0.0 to 1.0) based on CPU utilization (default)
- `load_threshold` (default 0.7) — above this, stop accepting new jobs
- Custom `load_fnc` supported for app-specific metrics
- LiveKit Cloud adds **geographic affinity** — routes to nearest agent server

#### Job Metadata
- Explicit dispatch supports passing **metadata** (string, typically JSON)
- Available in `JobContext` — useful for user ID, phone number, preferences
- Room metadata and participant attributes also accessible

---

## 3. Self-Hosted vs Cloud — The Mix-and-Match Question

### The Comparison Table (from LiveKit docs)

| Feature | Self-Hosted | LiveKit Cloud |
|---------|------------|---------------|
| Realtime media | ✅ Full | ✅ Full |
| Egress/Ingress | ✅ Full | ✅ Full |
| SIP & telephony | ✅ Full | ✅ Full + managed phone numbers |
| Agents framework | ✅ Full | ✅ Full + managed hosting |
| Agent Builder | ❌ | ✅ Included |
| Built-in inference | ❌ | ✅ Included |
| Architecture | Single-home SFU | Global mesh SFU |
| Connection model | Single server per room | Each user → nearest edge |
| Max users/room | ~3,000 | No limit |
| Analytics | Custom/external | Cloud dashboard |
| SLA | N/A | 99.99% |

### 🔑 Critical Finding: Self-Hosted SFU + Self-Hosted Agents = Fully Viable

You can run **everything** on your own infrastructure:
- LiveKit Server (Go binary, Docker, or Kubernetes)
- Agent servers (Python/Node.js processes)
- Your own STT/LLM/TTS models (no cloud AI APIs needed)

This is the **full democratization path**.

### Can You Mix Self-Hosted SFU + Cloud Agents (or vice versa)?

**Self-hosted SFU + Self-hosted agents:** ✅ Fully supported, primary self-host model

**Self-hosted agents + LiveKit Cloud SFU:** ✅ Explicitly supported!
- From docs: "You can use LiveKit Cloud for media transport and agent observability regardless of whether your agents are deployed to a custom environment."
- Agent servers connect to LiveKit Cloud via WebSocket — just set `LIVEKIT_URL` to your Cloud project URL
- This gives you Cloud's global mesh SFU + your own agent compute

**Self-hosted SFU + LiveKit Cloud agents:** ❌ Not a standard pattern
- LiveKit Cloud managed agents expect to connect to LiveKit Cloud SFU
- But you could deploy your own agents connecting to your own SFU — that's the first option above

### Networking for Agents

**Key simplification:** Agent servers only make **outbound** connections:
- WebSocket to LiveKit server (for registration + dispatch)
- WebRTC to LiveKit server (for media)
- HTTPS to AI model APIs

**No inbound ports needed for agents!** This dramatically simplifies deployment.

---

## 4. SFU (Selective Forwarding Unit) Requirements

### What the SFU Does

Unlike MCUs (which decode and re-encode all media), an SFU:
- Receives media packets from publishers
- Forwards them to subscribers **without transcoding**
- Much lower CPU but higher bandwidth
- Handles signaling, NAT traversal, RTP routing, adaptive degradation

### Hardware Requirements

**For the SFU Server:**
- **CPU-bound** (not GPU) — compute-optimized instances recommended
- **Network: 10Gbps ethernet or faster** for production
- Host networking in Docker for optimal performance
- Recommended: compute-optimized VMs (e.g., c2-standard-16 on GCP)

**For Agent Servers (voice AI):**
- Recommended starting point: **4 cores, 8GB RAM per agent server**
- Handles **10-25 concurrent voice AI jobs** per server
- Load test results (4-core, 8GB machine with 30 concurrent agents):
  - CPU: ~3.8 cores utilized
  - Memory: ~2.8GB used
- No GPU needed unless running local AI models

**For Local AI Models (the democratization stack):**
- STT (Whisper): Needs GPU, ~2-4GB VRAM
- LLM: Needs GPU, varies by model (7B = ~6GB, 32B = ~20GB)
- TTS (Kokoro/etc): Needs GPU, ~2-4GB VRAM
- This is where our GPU cluster becomes essential

### Scaling

**Single node:** Up to ~3,000 participants per room (audio benchmark: 10 publishers + 3,000 subscribers at 80% CPU on 16-core)

**Multi-node (with Redis):**
- Redis as shared data store + message bus
- Nodes auto-discover each other and share load
- Rooms still must fit on a single node
- Unlimited total concurrent rooms across cluster
- Region-aware node selection available

**Draining/Graceful shutdown:**
- SIGTERM → draining mode
- Active rooms continue
- New rooms rejected
- Shutdown after all participants disconnect
- Agents need 10+ minute grace period for voice conversations

---

## 5. TURN/STUN Server Needs

### Why TURN/STUN Matters

WebRTC requires NAT traversal. Most users are behind NATs (home routers, corporate firewalls).

- **STUN:** Discovers your public IP/port. Lightweight, stateless.
- **TURN:** Relays media when direct connection fails. Required for strict NATs and corporate firewalls.

### LiveKit's Built-in TURN Server

**LiveKit includes an embedded TURN server** — you don't need to run a separate one (like coturn).

Features:
- Integrated authentication (only clients with established signal connections can use it)
- TURN/TLS support (looks like HTTPS to firewalls — broadest connectivity)
- TURN/UDP support on port 443 (for QUIC-friendly firewalls)

### Required Ports (Firewall Configuration)

| Port | Protocol | Purpose |
|------|----------|---------|
| 443 | TCP | Primary HTTPS + TURN/TLS |
| 80 | TCP | TLS certificate issuance |
| 7881 | TCP | WebRTC over TCP |
| 3478 | UDP | TURN/UDP |
| 50000-60000 | UDP | WebRTC over UDP (ICE candidates) |

**For TURN/TLS (recommended for corporate firewall traversal):**
- Needs its own domain + SSL certificate
- LiveKit performs TLS termination
- Port 443 if no load balancer
- Layer 4 LB supported for multiple instances

**For voice agents specifically:**
- If agent and SFU are co-located (same network): no TURN needed for agent↔SFU
- TURN is primarily for user↔SFU connections (users behind NATs)
- Agent servers only make outbound connections

### SSL/TLS Requirements
- Domain with DNS records required
- SSL certificate from trusted CA (no self-signed)
- Caddy reverse proxy auto-provisions via Let's Encrypt/ZeroSSL
- Separate TURN domain + cert if using TURN

---

## 6. Bandwidth Estimates per Voice Call

### Audio Codec: Opus

WebRTC voice calls typically use **Opus codec**:
- Variable bitrate: **6-128 kbps** (mono voice typically 24-48 kbps)
- LiveKit benchmarks used **~3 kbps average** for audio (likely compressed silence periods)
- Realistic voice conversation: **24-48 kbps per stream direction**

### Per-Call Bandwidth Estimate (Voice Agent)

```
User → SFU:           ~32 kbps (Opus voice uplink)
SFU → Agent:          ~32 kbps (forwarded to agent)
Agent → SFU:          ~32 kbps (TTS audio response)
SFU → User:           ~32 kbps (forwarded to user)
                      ─────────
Per call at SFU:      ~128 kbps total throughput
                      = ~16 KB/s
                      = ~57 MB/hour per call
```

### Overhead Considerations
- WebRTC DTLS/SRTP overhead: ~15-20% on top of payload
- Signaling WebSocket: negligible (~1-2 kbps)
- RTCP feedback: ~5% of media bandwidth
- **Realistic total: ~150-200 kbps per concurrent voice call** through the SFU

### Scaling Math

| Concurrent Calls | SFU Bandwidth | Monthly (8h/day) |
|-----------------|---------------|-------------------|
| 10 | ~2 Mbps | ~18 GB |
| 100 | ~20 Mbps | ~180 GB |
| 1,000 | ~200 Mbps | ~1.8 TB |
| 10,000 | ~2 Gbps | ~18 TB |

### Benchmark Validation (from LiveKit docs)

Audio-only benchmark on 16-core c2-standard-16:
- 10 publishers + 3,000 subscribers
- Inbound: 7.3 kBps / Outbound: 23 MBps
- 305 packets/s in / 959,156 packets/s out
- 80% CPU utilization

**This confirms voice is extremely lightweight** — the bottleneck is subscribers (fan-out), not per-call bandwidth.

---

## 7. Open-Source Alternatives to LiveKit

### Direct Competitors / Alternatives

| Project | Stack | License | Agent Support | Self-Host | Notes |
|---------|-------|---------|--------------|-----------|-------|
| **LiveKit** | Go (Pion WebRTC) | Apache 2.0 | ✅ Native (Python/Node.js) | ✅ Full | Best-in-class for AI agents |
| **Jitsi Meet** | Java + JS | Apache 2.0 | ❌ No agent framework | ✅ Full | Video conferencing focused, not AI agent optimized |
| **mediasoup** | C++/Node.js | ISC | ❌ Build your own | ✅ Full | Low-level SFU library, very flexible but more work |
| **Pion WebRTC** | Go | MIT | ❌ DIY | ✅ Full | Library that LiveKit is built on — build your own SFU |
| **Janus Gateway** | C | GPL v3 | ❌ No agent framework | ✅ Full | Mature, plugin-based, GPL license is restrictive |
| **Daily.co** | Proprietary | Proprietary | ✅ (via Pipecat) | ❌ Cloud only | Pipecat is open-source agent framework |
| **Agora** | Proprietary | Proprietary | ❌ Limited | ❌ Cloud only | Enterprise, expensive |
| **Twilio** | Proprietary | Proprietary | ❌ Limited | ❌ Cloud only | Telephony-first |

### The Pipecat Alternative (Worth Noting)

[**Pipecat**](https://github.com/pipecat-ai/pipecat) is an open-source voice/multimodal AI framework (Python) that's transport-agnostic:
- Works with LiveKit, Daily, WebSocket, or direct audio
- Similar STT → LLM → TTS pipeline
- Apache 2.0 licensed
- Could theoretically be used with a self-hosted SFU that isn't LiveKit

However, LiveKit's integrated approach (SFU + agents framework + dispatch + load balancing) is much more production-ready than cobbling together Pipecat + a generic SFU.

### Why LiveKit Wins for Our Use Case

1. **Fully open source** (Apache 2.0) — no license gotchas
2. **Integrated agent framework** — dispatch, load balancing, process isolation all built-in
3. **Plugin ecosystem** — drop-in STT/LLM/TTS providers, easy to swap local models
4. **Self-hosted is first-class** — not an afterthought
5. **Telephony/SIP** — can make/receive actual phone calls
6. **Written in Go** — single binary, easy deployment
7. **Active development** — 25K+ GitHub stars, funded company, strong community

---

## 8. Key Takeaways for Mission 2

### The Democratization Stack (Fully Self-Hosted, Zero Cloud Dependencies)

```
┌────────────────────────────────────────────────┐
│              FRONT END                          │
│   Mobile App (Flutter/React Native)             │
│   or Web App (React)                            │
│   or Phone Call (SIP)                           │
│   Uses LiveKit Client SDK                       │
└───────────────────┬────────────────────────────┘
                    │ WebRTC
                    ▼
┌────────────────────────────────────────────────┐
│         LiveKit SFU Server (Go)                 │
│   Self-hosted, single binary                    │
│   Handles: media routing, NAT traversal,        │
│   signaling, TURN, agent dispatch               │
│   Requirements: 2-4 cores, 4GB RAM              │
│   for ~100 concurrent voice calls               │
└───────────────────┬────────────────────────────┘
                    │ WebRTC + WebSocket
                    ▼
┌────────────────────────────────────────────────┐
│       LiveKit Agent Server (Python)             │
│   Self-hosted, runs your agent code             │
│   Requirements: 4 cores, 8GB RAM               │
│   for 10-25 concurrent voice sessions           │
│                                                 │
│   Pipeline:                                     │
│   ┌──────┐  ┌──────┐  ┌──────┐                │
│   │ VAD  │→ │ STT  │→ │ LLM  │→ ┌──────┐     │
│   │Silero│  │Whisper│  │Local │  │ TTS  │     │
│   │(CPU) │  │(GPU) │  │(GPU) │  │Kokoro│     │
│   └──────┘  └──────┘  └──────┘  │(GPU) │     │
│                                  └──────┘     │
└───────────────────┬────────────────────────────┘
                    │ HTTP/gRPC (localhost or LAN)
                    ▼
┌────────────────────────────────────────────────┐
│          GPU Inference Server                   │
│   Our existing cluster (.122 / .143)            │
│   Whisper STT (:9101)                           │
│   Local LLM (:9100)                             │
│   Kokoro TTS (:9102)                            │
│                                                 │
│   Already deployed! Already working!            │
└────────────────────────────────────────────────┘
```

### What We Need to Build

1. **LiveKit SFU deployment** — single Go binary on one of our servers, or Docker
2. **Agent code** — Python, using LiveKit Agents SDK with custom plugins pointing to our local models
3. **Custom plugins** for local models:
   - STT plugin → our Whisper server (:9101)
   - LLM plugin → our vLLM server (:9100)
   - TTS plugin → our Kokoro server (:9102)
4. **Frontend** — use any LiveKit Client SDK (React for web, Flutter for mobile)
5. **Optional: SIP integration** — for phone call access

### Cost Analysis: Self-Hosted vs Cloud

| Component | Cloud (LiveKit + APIs) | Self-Hosted |
|-----------|----------------------|-------------|
| SFU | $0.006/participant-min | $0 (our server) |
| STT (Deepgram) | $0.0043/min | $0 (our Whisper) |
| LLM (GPT-4.1) | ~$0.002/request | $0 (our Qwen) |
| TTS (Cartesia) | $0.015/1000 chars | $0 (our Kokoro) |
| **100 calls/day × 5 min** | ~$100-200/month | ~$50/month (electricity) |
| **1000 calls/day × 5 min** | ~$1000-2000/month | ~$50/month (electricity) |

### Risks & Considerations

1. **Latency:** Local models may be slower than cloud APIs for STT/TTS. Need to benchmark.
2. **Quality:** Local STT/TTS quality may not match Deepgram/Cartesia. Test carefully.
3. **TURN/NAT:** Need proper TURN setup for users behind corporate firewalls.
4. **SSL certificates:** Need a domain + valid SSL for production WebRTC.
5. **Scaling ceiling:** Single self-hosted SFU node maxes at ~3,000 participants per room.
6. **No built-in analytics:** Need to build/integrate monitoring yourself.

### Recommended Next Steps

1. **Deploy LiveKit Server** on .122 or .143 (Docker, 5 minutes)
2. **Write a minimal agent** using LiveKit Agents SDK with local model plugins
3. **Test latency** of local STT → LLM → TTS pipeline end-to-end
4. **Build a simple web frontend** with LiveKit React SDK
5. **Benchmark**: measure time-to-first-byte for agent responses
6. **Then:** Add SIP for phone access, mobile app, etc.

### Quick Start Commands

```bash
# Install LiveKit Server (on Linux)
curl -sSL https://get.livekit.io | bash

# Start in dev mode
livekit-server --dev --bind 0.0.0.0

# Install Agents SDK
pip install "livekit-agents[silero,turn-detector]~=1.0"

# Your agent needs these env vars:
export LIVEKIT_URL=ws://your-server:7880
export LIVEKIT_API_KEY=devkey
export LIVEKIT_API_SECRET=secret

# Run agent in dev mode
python my_agent.py dev
```

---

## Appendix: Key URLs

- **LiveKit Server repo:** https://github.com/livekit/livekit
- **Agents SDK (Python):** https://github.com/livekit/agents
- **Agents SDK (Node.js):** https://github.com/livekit/agents-js
- **Documentation:** https://docs.livekit.io/agents/
- **Self-hosting guide:** https://docs.livekit.io/transport/self-hosting/
- **Agent dispatch docs:** https://docs.livekit.io/agents/server/agent-dispatch/
- **Benchmarks:** https://docs.livekit.io/transport/self-hosting/benchmark/
- **Deployment guide:** https://docs.livekit.io/deploy/custom/deployments/
- **Config sample:** https://github.com/livekit/livekit/blob/master/config-sample.yaml
- **Helm charts:** https://github.com/livekit/livekit-helm
