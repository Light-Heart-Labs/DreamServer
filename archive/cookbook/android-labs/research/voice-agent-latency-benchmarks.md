# Voice Agent Latency Benchmarks — Research Summary
*Todd | 2026-02-09 | Feeds into M4 + M8*

---

## Human Expectations (The 300ms Rule)

Research shows human conversation operates on a 200-300ms response window — hardwired across all cultures.

| Latency | Perception |
|---------|------------|
| < 300ms | Instantaneous, magical |
| 300-400ms | Beginning of awkwardness |
| 500ms | Users wonder if heard |
| 800ms | Sweet spot for production |
| 1000ms | Connection failure assumption |
| 1500ms+ | Neurological stress response |

**Critical insight:** 68% of customers abandon calls when systems feel sluggish.

---

## Production Reality (Based on 4M+ calls)

| Percentile | Response Time | User Experience |
|------------|---------------|-----------------|
| P50 (median) | 1.4-1.7s | Noticeable delay, functional |
| P90 | 3.3-3.8s | Significant frustration |
| P95 | 4.3-5.4s | Severe delay, interruptions |
| P99 | 8.4-15.3s | Complete breakdown |

**The gap:** Humans expect 300ms. Production delivers 1,400-1,700ms. That's 5x slower.

---

## Component Latency Breakdown

| Component | Typical | Optimized | Notes |
|-----------|---------|-----------|-------|
| STT | 200-400ms | 100-200ms | Streaming reduces this |
| LLM Inference | 300-1000ms | 200-400ms | Highly model-dependent |
| TTS | 150-500ms | 100-250ms | TTFB, not full synthesis |
| Network | 100-300ms | 50-150ms | Multiple round trips |
| Processing | 50-200ms | 20-50ms | Queuing, serialization |
| Turn Detection | 200-800ms | 200-400ms | Configurable silence |
| **Total** | **1000-3200ms** | **670-1450ms** | End-to-end |

---

## M4 Value Proposition: The Deterministic Advantage

Deterministic path (keyword → FSM) **bypasses LLM entirely**. That's 300-1000ms saved per call.

### Projected Deterministic Path Latency:
| Component | Local Target |
|-----------|-------------|
| STT (local Whisper) | ~150ms |
| Deterministic routing | ~50ms |
| TTS (local Kokoro) | ~150ms |
| Processing | ~30ms |
| **Total** | **~380ms** |

**Result:** Deterministic calls hit sub-500ms (ideal range). LLM fallback hits 800-1200ms (acceptable).

---

## Target Thresholds for M8 Testing

| Tier | Latency | Target |
|------|---------|--------|
| Excellent | < 500ms | Deterministic path goal |
| Good | 500-800ms | LLM fallback acceptable |
| Acceptable | 800-1200ms | Complex queries |
| Poor | 1200-1500ms | Needs optimization |
| Broken | > 1500ms | Fail, do not ship |

---

## Test Scenarios for 17's Harness

### Simple intents (should hit deterministic):
- "I need to schedule an appointment"
- "My AC isn't working"
- "What are your hours?"
- "I want to cancel my service"

### Complex intents (will hit LLM):
- "My unit makes a clicking sound when it first turns on but only in the morning and I'm not sure if it's the compressor or the fan"
- Multi-turn negotiation
- Ambiguous requests requiring clarification

### Edge cases:
- Back-to-back calls (queue depth)
- Peak hours (concurrent load)
- Long pauses (turn detection)
- Interruptions (barge-in handling)

---

## Sources

- Hamming AI: Voice AI Latency analysis (4M+ calls)
- Telnyx: Voice AI agent latency benchmarks
- RetellAI: Sub-second latency voice assistants
- Twilio: Core latency in AI voice agents

---

*This research feeds directly into 17's M8 test harness and validates M4's deterministic routing approach.*
