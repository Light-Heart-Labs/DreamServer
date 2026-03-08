# Voice Agent Scaling Architecture — 2026
*Todd — 2026-02-09*
*Mission: M2 (Democratized Voice Agent Systems), M4 (Deterministic Voice Agents)*

## Overview

Research on scaling voice AI agents for production deployments. Key focus: how to handle many concurrent users with local hardware.

---

## The Impedance Mismatch Problem

**Core issue:** WebRTC (streaming, stateful) vs AI APIs (transactional, stateless).

Naive approach fails:
```
Client → WebRTC → Manual chunking → STT API → LLM API → TTS API → Manual streaming → Client
```

Results:
- 3-4 second latency
- Fragile interruption handling
- Debugging nightmare
- Huge technical debt

**Solution:** Agent as full WebRTC session participant, not external API call.

---

## LiveKit Agents Architecture

### Worker-Job Model
- **Job:** Isolated task for single session
- **Worker:** Executor running agent logic
- **Key benefits:**
  - Session isolation (crash doesn't affect others)
  - Horizontal scaling (more workers = more capacity)
  - Fault tolerance (job can restart on another worker)

### Scaling Pattern
```
[LiveKit SFU] ←→ [Worker Pool]
                    ├── Worker 1 (Jobs 1-10)
                    ├── Worker 2 (Jobs 11-20)
                    ├── Worker 3 (Jobs 21-30)
                    └── ...
```

10,000 concurrent sessions = scale worker pool accordingly.

---

## Low-Latency Techniques

### 1. Interruptions
User can interrupt agent mid-speech. Framework immediately:
- Stops TTS playback
- Discards pending response
- Switches to listening mode

### 2. Preemptive Synthesis
Don't wait for full LLM response. As soon as first words arrive:
- Start TTS synthesis
- Stream audio while LLM continues generating

**Impact:** Perceived latency drops dramatically.

### 3. Semantic Turn Detection
Instead of waiting for silence timeout:
- Analyze speech semantics
- Detect complete phrases
- Pass to LLM immediately

---

## Service Selection Matrix

| Service | Type | Strength | Best For |
|---------|------|----------|----------|
| Groq | LLM | Ultra-low latency | Fast Q&A, simple tasks |
| GPT-4o | LLM | Reasoning quality | Complex support, logic |
| Deepgram | STT | Speed + accuracy | Call center, fast speech |
| ElevenLabs | TTS | Natural voice | Premium UX |
| Cartesia | TTS | <100ms latency | Maximum responsiveness |

### Local Alternatives (for M2/M6)
| Service | Local Option | Notes |
|---------|--------------|-------|
| STT | Whisper (vLLM :9101) | Good quality, local |
| LLM | Qwen 32B (vLLM :9100) | Deterministic for simple intents |
| TTS | Kokoro (vLLM :9102) | Local synthesis |

---

## Multi-Agent Handoffs (M4 Connection)

Complex scenarios use specialized agents in chain:
1. **Greeting Agent** — Welcome, language detection
2. **Data Collection Agent** — Gather info (order #, name)
3. **Verification Agent** — Check database
4. **Problem Solving Agent** — Main logic
5. **Handoff Agent** — Transfer to human if needed

This is essentially a **Finite State Machine (FSM)** — exactly what we're building for M4!

**Key insight:** Use cheaper/faster models for simple agents, powerful models only where needed.

---

## Capacity Planning (Local Hardware)

### From M8 Capacity Testing (RTX PRO 6000 Blackwell)
- 20+ concurrent users, no degradation
- ~9 req/sec throughput
- 2s avg latency, 4s p95
- 70°C max temp

### Scaling Estimates (Single GPU)
| Task | Concurrent Sessions | Latency |
|------|---------------------|---------|
| STT only | 50+ | <200ms |
| LLM only (32B) | 8-12 | ~1s |
| TTS only | 30+ | <200ms |
| Full pipeline | 6-10 | ~2s |

**Bottleneck:** LLM inference. Solutions:
1. Smaller models (7B-13B)
2. Quantization (AWQ, GGUF)
3. Deterministic routing (M4) — skip LLM for simple intents
4. Multi-GPU setup

---

## Cost Analysis (Local vs Cloud)

### Cloud Voice AI Costs (per minute)
| Provider | Cost/min |
|----------|----------|
| OpenAI Realtime | $0.06-0.24 |
| ElevenLabs | $0.01-0.03 |
| Deepgram | $0.005-0.01 |
| **Total cloud stack** | ~$0.10-0.30/min |

### Local Voice AI Costs
- **Hardware:** RTX 5090 (~$3,000)
- **Electricity:** ~$65/month (24/7)
- **Amortized cost/min:** ~$0.002 (at 10 concurrent)

**Break-even:** ~1,500-5,000 voice minutes/month

---

## Recommendations for M2 (Democratized Voice)

### Phase 1: Single-GPU Setup
- LiveKit self-hosted (open source)
- Local Whisper + Qwen + Kokoro
- 6-10 concurrent voice sessions
- Deterministic routing for common intents (M4)

### Phase 2: Multi-GPU Scaling
- Worker pool across 2+ GPUs
- Load balancing via LiveKit SFU
- 20-40 concurrent sessions

### Phase 3: Cluster Deployment
- Kubernetes worker orchestration
- Auto-scaling based on load
- Geographic distribution for latency

---

## Traffic Routing Considerations

### WebRTC SFU (Selective Forwarding Unit)
LiveKit acts as SFU — routes media without transcoding:
- Low server CPU usage
- Horizontal scaling
- Sub-100ms latency

### Worker Distribution
- STT workers (CPU-heavy, lower GPU)
- LLM workers (GPU-heavy)
- TTS workers (moderate GPU)

Can mix worker types on same GPU with VRAM budgeting.

---

## Integration with M4 Deterministic Pipeline

```
[User Audio] → [Whisper STT] → [Intent Classifier] → Decision:
                                                      │
                    ┌─────────────────────────────────┴─────────────────────────────────┐
                    ↓                                                                   ↓
              [Simple Intent]                                                    [Complex Intent]
                    ↓                                                                   ↓
              [FSM Executor] ─────────────────────────────────────────────────→ [LLM Fallback]
                    ↓                                                                   ↓
              [Template Response]                                                [LLM Response]
                    ↓                                                                   ↓
              [Kokoro TTS] ←────────────────────────────────────────────────────────────┘
                    ↓
              [User Audio]
```

**Key optimization:** Skip LLM for 60-80% of calls that match simple intents.

---

## References
- LiveKit Agents documentation
- Moravio architectural analysis
- M8 capacity testing results (our data)
- M4 deterministic pipeline research

---

*This research informs M2 scaling decisions and validates M4 deterministic approach.*
