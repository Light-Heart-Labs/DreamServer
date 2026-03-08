# M2: Voice Agent Latency Optimization

*Research for M2: Democratized Voice Agent Systems — 2026-02-10*

## 1. Streaming vs Turn-Based Tradeoffs

| Aspect | Streaming | Turn-Based |
|--------|-----------|------------|
| **Latency** | 200-300ms | 500-1000ms+ |
| **Flexibility** | Better barge-in handling | Simpler implementation |
| **Cost** | Higher (continuous) | Lower |
| **Production** | Complex testing | Simpler deployment |
| **Quality** | Natural conversation | May feel delayed |

**Recommendation:** Streaming for production voice agents, turn-based for prototyping.

## 2. GPU Requirements for Real-Time Pipeline

**Full STT → LLM → TTS Pipeline:**

| Component | Model | VRAM | Latency |
|-----------|-------|------|---------|
| STT | Whisper-medium | ~2GB | 50-100ms |
| LLM | Qwen 32B AWQ | ~18GB | 100-200ms |
| TTS | Kokoro/Qwen3-TTS | ~2GB | 50-100ms |
| **Total** | — | ~22GB | 200-400ms |

**Hardware Recommendations:**
- **RTX 4060 (8GB):** 7B models only, basic voice
- **RTX 4090 (24GB):** Full 32B pipeline, production-ready
- **Dual GPU:** Separate STT/TTS from LLM for parallel processing

## 3. Concurrent User Capacity

| Latency Target | Concurrent Users | Hardware |
|----------------|------------------|----------|
| 200-250ms | 5-10 | Single RTX 4090 |
| 500ms | 20-50 | Single RTX 4090 |
| 1000ms | 100+ | Dual GPU or cluster |

**Scaling strategies:**
- Increase latency tolerance to handle more users
- Deploy edge servers to reduce network hops
- Use model sharding across GPUs

## 4. Best Practices

### Precomputation
- Cache common phrases (greetings, confirmations)
- Pre-generate TTS for known responses
- Reduces playback latency to near-zero for cached content

### Pipeline Interleaving
- Start TTS as first LLM tokens arrive (don't wait for full response)
- Interleave GPU workloads between STT/LLM/TTS
- Use streaming APIs end-to-end

### Model Optimization
- Keep `maxTokens` at 150-200 for voice (shorter = faster)
- Use smaller models where quality permits
- Quantization (AWQ) reduces memory + latency

### Deployment
- Deploy close to users (edge)
- Process in-region to minimize network RTT
- Monitor latency continuously

## M2 Implications

For fully local voice agents:
1. **Single RTX 4090** can handle 5-10 concurrent users at 200ms
2. **Our cluster** (.122 + .143) could handle 20+ concurrent voice sessions
3. **Bottleneck** is usually LLM inference, not STT/TTS

---

*Part of M2: Democratized Voice Agent Systems*
