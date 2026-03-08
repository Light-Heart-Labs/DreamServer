# Voice Agent Latency Optimization Research

> **Date:** 2026-02-08  
> **Author:** Todd  
> **Mission:** M2 (Democratized Voice Agent Systems), M4 (Deterministic Voice Agents)  
> **Status:** Research complete

---

## TL;DR

Human conversation requires **300-500ms** response window. Typical voice agent pipelines take **800ms-2s**. The gap is due to latency compounding across STT → LLM → TTS.

**Key optimizations:**
1. Streaming throughout the pipeline (don't wait for completion)
2. Semantic turn detection (respond before silence timeout)
3. Model selection (Gemini Flash 300ms vs GPT-4o 700ms)
4. Local inference where possible (eliminates network round-trip)

---

## The Latency Equation

```
Total = STT + LLM + TTS + Network + Processing
      = 200ms + 500ms + 150ms + 50ms + 100ms
      = ~1000ms (typical)
```

**Target:** Sub-500ms for natural conversation feel

---

## Component Breakdown

### Speech-to-Text (STT) — 100-500ms

| Provider | Latency | WER | Notes |
|----------|---------|-----|-------|
| Deepgram Nova-3 | 150ms | 18.3% | Best for speed |
| AssemblyAI Universal-2 | 300-600ms | 14.5% | Best accuracy |
| Whisper (self-hosted) | 1-5s batch, 380-520ms streaming | Best | Needs optimization |
| Groq Whisper | <300ms | Good | LPU acceleration |
| **Local Whisper (our setup)** | ~400ms | Good | Via port 9101 |

### Large Language Model — 350ms-1s+

| Model | Time-to-First-Token | Notes |
|-------|---------------------|-------|
| Gemini Flash 1.5 | ~300ms | Ultra-fast |
| Groq Llama | ~200ms | LPU hardware |
| GPT-4o-mini | ~400ms | Good balance |
| Claude 3.5 Haiku | ~350ms | Fast |
| GPT-4o | ~700ms | Standard |
| Claude 3.5 Sonnet | ~800ms | Standard |
| **Local Qwen 32B (our setup)** | ~500-800ms | Via port 9100 |

### Text-to-Speech (TTS) — 75-200ms

| Provider | Time-to-First-Audio | Notes |
|----------|---------------------|-------|
| Cartesia Sonic | 40-95ms | Purpose-built for RT |
| ElevenLabs Flash v2.5 | 75ms | Best quality |
| Deepgram Aura-2 | <150ms | Enterprise-grade |
| **Local Kokoro (our setup)** | ~150-200ms | Via port 9102 |

---

## Optimization Techniques

### 1. Streaming Throughout Pipeline

**Don't wait for completion** — start next stage as soon as partial data available:

```
STT streaming → LLM tokens stream → TTS synthesis starts immediately
```

### 2. Semantic Turn Detection

Instead of fixed silence timeout (600ms+), use semantic detection:
- Understand when user has finished their thought
- Can respond in <300ms without cutting off
- Reduces "dead air" feeling

### 3. Speculative Execution

Start LLM inference while user is still speaking:
- Predict likely responses
- Discard if prediction doesn't match
- Can achieve "negative latency" in some cases

### 4. LLM Hedging

Launch multiple LLM calls in parallel, use whichever returns first:
- Reduces long-tail latency
- Built-in failover

### 5. Model Routing

Route simple queries to fast models, complex to capable:
```python
if complexity == "simple":
    return "gemini-flash"  # 300ms
else:
    return "gpt-4o"  # 700ms
```

### 6. Prompt Caching

Cache system prompts (Anthropic: 90% cost reduction on cached prefixes)

### 7. Local Inference

Eliminates network round-trip:
- Our setup: STT, LLM, TTS all local
- Advantage: ~50-100ms saved per hop
- Challenge: Requires GPU resources

---

## Grace Latency Analysis

**Current Grace pipeline (estimated):**
- STT (local Whisper): ~400ms
- LLM (local Qwen or Claude): ~500-800ms local, ~400-800ms API
- TTS (local Kokoro): ~150-200ms
- Network/processing: ~100ms

**Total estimated:** 1150-1500ms

**Optimization opportunities:**
1. Enable streaming STT if not already
2. Use faster local model (Qwen 7B for simple queries?)
3. Implement semantic turn detection
4. Stream TTS synthesis while LLM generates

---

## Recommendations for Grace

### Quick Wins (No code changes)
- Ensure all components use streaming APIs
- Reduce VAD silence timeout to minimum viable (400-500ms)

### Medium Effort
- Implement model routing (fast vs capable)
- Add speculative execution for common intents

### Larger Effort
- Semantic turn detection
- End-to-end latency measurement and dashboard

---

## Local vs Cloud Tradeoffs

| Factor | Local | Cloud |
|--------|-------|-------|
| Latency | Eliminates network hops | +50-100ms per hop |
| Quality | Limited by hardware | Best models available |
| Cost | Fixed (hardware) | Per-call pricing |
| Scale | Limited concurrency | Unlimited scale |
| Control | Full | Dependent on provider |

**For Grace (low volume):** Local is likely optimal
**For scale:** Hybrid approach (local STT/TTS, cloud LLM)

---

## Next Steps

- [ ] Measure current Grace end-to-end latency
- [ ] Identify which components are streaming
- [ ] Test with Gemini Flash for simple queries
- [ ] Implement latency dashboard

---

## References

- Cresta: Engineering for Real-Time Voice Agent Latency
- Introl: Voice AI Infrastructure Guide 2025
- Arxiv: Low-Latency End-to-End Voice Agents (2508.04721)
- AssemblyAI: Lowest Latency Voice Agent Guide
