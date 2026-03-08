# M4 Deterministic Voice Agents — Research Summary

*Author: Android-17 | Date: 2026-02-11*
*Mission: Reduce LLM dependence in voice agents through deterministic systems*

---

## Executive Summary

**Current Status:** Prototype complete, integration pending

M4 has a working deterministic voice pipeline that can reduce LLM calls by 60-80% for structured conversations. The system uses:
1. **Intent classification** (DistilBERT) — 95% accuracy, <10ms latency
2. **FSM executor** — Deterministic state machine for call flows
3. **Template NLG** — Pre-written responses, no LLM needed for happy path

**Gap:** Integration with Grace's LiveKit agent is partial. The classifier works but the full pipeline isn't wired into production.

---

## Architecture

### Pipeline Flow

```
┌─────────┐    ┌─────────────┐    ┌──────────────┐    ┌─────────┐
│  Audio  │───→│  Whisper    │───→│   Intent     │───→│   FSM   │
│  Input  │    │    STT      │    │ Classifier   │    │ Executor│
└─────────┘    └─────────────┘    └──────────────┘    └────┬────┘
                                                             │
                              ┌──────────────────────────────┼──────┐
                              │                              ↓      │
                              │  ┌─────────┐    ┌───────────────┐  │
                              └──│  LLM    │←───│  Template NLG │  │
                                 │ Fallback│    │   (Primary)   │  │
                                 └────┬────┘    └───────────────┘  │
                                      └──────────────────────────────┘
                                                             │
                                                             ↓
┌─────────┐    ┌─────────────┐    ┌───────────────────────────────┐
│  Audio  │←───│    Kokoro   │←───│         Response Text         │
│  Output │    │     TTS     │    │                               │
└─────────┘    └─────────────┘    └───────────────────────────────┘
```

### Components

#### 1. Intent Classifier (`distilbert_classifier.py`)

| Metric | Value |
|--------|-------|
| Model | DistilBERT-base-uncased (fine-tuned) |
| Size | 66MB |
| Latency | <10ms CPU, <5ms GPU |
| Accuracy | 95.2% (HVAC domain) |
| Confidence threshold | 0.85 for FSM routing |

**Fallback strategy:**
- ≥0.85: Route to FSM (deterministic)
- 0.70-0.85: Route to department, use LLM for response
- <0.70: Full LLM fallback

#### 2. FSM Executor (`fsm_executor.py`)

Executes conversation flows defined in JSON:
- States with entry/exit actions
- Transitions based on intent + entity conditions
- Template-based NLG (no LLM)
- Entity capture with validation

**Example flow states:**
```json
{
  "S1_gather_info": {
    "say": "ask_name",
    "expect": ["provide_name", "ask_skip"],
    "capture": {"customer_name": "entity_name"},
    "next": {
      "provide_name": "S2_confirm",
      "ask_skip": "S2_confirm_no_name"
    }
  }
}
```

#### 3. Voice Pipeline (`voice_pipeline.py`)

Orchestrates the full flow:
- Audio → STT (Whisper)
- Text → Intent → FSM/LLM decision
- Response → TTS (Kokoro)
- Latency tracking per component

**Benchmarked latencies:**
| Component | Latency | Cached |
|-----------|---------|--------|
| STT (Whisper tiny) | 500ms | N/A |
| Intent classifier | 8ms | Yes |
| FSM execution | 2ms | Yes |
| Template NLG | 1ms | Yes |
| LLM (Qwen 7B) | 1500ms | No |
| TTS (Kokoro) | 50ms | Partial |
| **Total (FSM path)** | **~560ms** | — |
| **Total (LLM path)** | **~2050ms** | — |

**3.7x faster** when using deterministic path vs LLM.

---

## Current Flow Definitions

| Domain | File | States | Use Case |
|--------|------|--------|----------|
| HVAC Appointment | `hvac_appointment.json` | 8 | Schedule service calls |
| Order Status | `order_status.json` | 6 | Check order/delivery status |
| Restaurant | `restaurant_reservation.json` | 10 | Book tables |
| Tech Support | `tech_support_triage.json` | 12 | Route to right department |

---

## Integration Status

### What's Working ✅

1. **Standalone pipeline** — Can run end-to-end tests
2. **Intent classifier** — Trained and benchmarked
3. **FSM executor** — Handles all flow logic
4. **Grace keyword fallback** — Integration adapter exists

### What's Missing 🔧

1. **LiveKit plugin** — Not wired into Grace's agent.py
2. **Flow editor UI** — No visual tool for creating flows
3. **Multi-domain routing** — How to select which flow to use
4. **Real-world testing** — Only synthetic tests so far
5. **Confidence calibration** — Thresholds may need tuning per-domain

---

## Performance Impact

### Simulation: 1000 Conversations

| Metric | LLM-Only | M4 Hybrid | Improvement |
|--------|----------|-----------|-------------|
| LLM calls | 1000 | 200 | **80% reduction** |
| Avg latency | 2050ms | 850ms | **2.4x faster** |
| GPU hours | 100% | 25% | **75% savings** |
| Cost (API) | $5.00 | $1.00 | **80% savings** |
| Accuracy | 94% | 96% | **+2%** (structured flows) |

*Assumes 80% of conversations follow happy path (FSM-handled)*

---

## Research Gaps

### 1. When to Use FSM vs LLM?

**FSM good for:**
- Structured data collection (forms, appointments)
- Known conversation patterns (ordering, support triage)
- Compliance-sensitive interactions (healthcare, finance)

**LLM needed for:**
- Open-ended Q&A
- Complex reasoning
- Novel situations
- Emotional/complex conversations

**Hybrid approach:**
- Start with FSM for structure
- Escalate to LLM on low confidence or escape intent
- Learn from escalations to improve FSM coverage

### 2. Flow Authoring at Scale

Current method (JSON by hand) doesn't scale.

**Options:**
1. **Visual editor** — React flow-builder, export to JSON
2. **LLM-assisted authoring** — Describe flow, LLM generates FSM JSON
3. **Learning from transcripts** — Mine successful conversations, auto-extract patterns

### 3. Confidence Calibration

Fixed thresholds (0.85, 0.70) may not work across domains.

**Approaches:**
- Domain-specific thresholds
- Dynamic thresholds based on user behavior
- Uncertainty quantification (ensemble methods)

### 4. Multi-Turn Context

Current FSM resets each call. Need:
- Session state persistence
- Cross-call context (customer history)
- Long-term memory integration

---

## Recommendations

### Near-term (This Week)

1. **Wire M4 into Grace's LiveKit agent**
   - Replace keyword classifier with DistilBERT
   - Add FSM path before LLM fallback
   - Measure real-world LLM call reduction

2. **Deploy HVAC flow to production**
   - Start with appointment scheduling
   - A/B test: FSM vs LLM-only
   - Measure user satisfaction + latency

### Medium-term (Next 2 Weeks)

3. **Build flow editor MVP**
   - React-based visual editor
   - Export to FSM JSON
   - Live preview/test mode

4. **Add learning loop**
   - Log all LLM escalations
   - Weekly review: which could be FSM-handled?
   - Iteratively expand flow coverage

### Long-term (Next Month)

5. **Multi-domain routing**
   - Intent classifier selects flow (not just department)
   - Shared entities across flows (customer info)
   - Flow composition (sub-flows)

6. **Predictive escalation**
   - Don't wait for low confidence — predict when LLM will be needed
   - Pre-warm LLM context for faster fallback

---

## Key Metrics to Track

| Metric | Target | Current |
|--------|--------|---------|
| FSM coverage | 80% of conversations | Unknown (not deployed) |
| Avg latency | <1000ms | 850ms (simulated) |
| LLM cost reduction | 70% | — |
| User satisfaction | ≥ LLM-only | — |
| Intent accuracy | 95% | 95.2% |

---

## Files Reference

```
tools/deterministic-voice/
├── distilbert_classifier.py    # ML intent classifier (66MB)
├── fsm_executor.py             # State machine executor
├── voice_pipeline.py           # Full pipeline orchestration
├── grace_integration.py        # Grace HVAC adapter
├── latency_benchmarks.py       # Performance testing
├── test_*.py                   # Unit tests
└── flows/
    ├── hvac_appointment.json   # 8-state HVAC flow
    ├── order_status.json       # 6-state order flow
    ├── restaurant_reservation.json
    └── tech_support_triage.json
```

---

## Next Actions

1. **Integrate with Grace's LiveKit agent** — Replace keyword routing
2. **A/B test HVAC flows** — Measure real-world impact
3. **Build flow editor MVP** — Enable non-devs to create flows
4. **Document flow authoring guide** — How to write effective FSMs

---

*Status: Prototype ready for integration | Last Updated: 2026-02-11*
