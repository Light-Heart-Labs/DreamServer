# M4 Intent Taxonomy

*Intent classification system for deterministic voice agent routing.*

**Version:** 1.1  
**Date:** 2026-02-11  
**Mission:** M4 (Deterministic Voice Agents)  
**Author:** Todd  
**Related:** `agent_m4.py`, `deterministic/classifier.py`, `deterministic/router.py`

> **Update v1.1:** Added `emergency_repair` as 9th Tier-1 intent. Classifier currently uses QwenClassifier (250ms, ~95% accuracy). DistilBERT pipeline ready for future optimization when training data reaches 500+ samples.

---

## Overview

The M4 deterministic layer uses a two-tier classification system:

1. **Intent Classifier** (DistilBERT) → predicts intent + confidence
2. **Threshold Router** → decides deterministic vs LLM path

This document defines the intent taxonomy, confidence thresholds, and FSM flow mappings.

---

## Intent Categories

### Tier 1: Deterministic-Only Intents (High Confidence ≥ 0.85)

These intents route directly to FSM flows without LLM involvement:

| Intent | Description | Example Utterances | FSM Flow |
|--------|-------------|-------------------|----------|
| `schedule_service` | Book/schedule an appointment | "I need to book a HVAC appointment for tomorrow", "Schedule a technician" | `service_scheduling` |
| `check_status` | Check order/appointment status | "What's the status of my order?", "Is my appointment confirmed?" | `status_check` |
| `hours_location` | Business hours or location | "What time do you close?", "Where are you located?" | `business_info` |
| `take_order` | Food/service order placement | "I'd like to order a pizza", "Add fries to my order" | `order_taking` |
| `troubleshoot` | Technical support request | "My internet isn't working", "I need help with my device" | `tech_support` |
| `cancel_reschedule` | Modify existing booking | "Cancel my appointment", "Reschedule to Friday" | `modification` |
| `transfer_human` | Request human agent | "Let me talk to a person", "Transfer me to support" | `human_transfer` |
| `goodbye` | End conversation | "That's all, thanks", "Goodbye" | `end_conversation` |
| `emergency_repair` | Urgent service request | "No heat, it's freezing!", "AC smoking, need help now!" | `emergency_dispatch` |

### Tier 2: LLM-Required Intents (Any Confidence)

These intents always route to LLM for complex reasoning:

| Intent | Description | Example |
|--------|-------------|---------|
| `complex_query` | Multi-part or ambiguous questions | "Compare the features and pricing of your three plans" |
| `creative_task` | Content generation | "Write me a poem about clouds" |
| `opinion_request` | Subjective recommendations | "What do you think is the best option for me?" |
| `fallback` | Unknown/no clear intent | "Uh, hmm, well..." |

### Tier 3: Context-Dependent (Router Decision)

The router evaluates context to decide path:

| Intent | Deterministic Trigger | LLM Trigger |
|--------|----------------------|-------------|
| `faq_question` | Known FAQ with exact match | Novel or nuanced question |
| `modify_order` | Simple add/remove items | Complex substitutions |
| `pricing_inquiry` | Standard price lookup | Custom quote needed |

---

## Confidence Thresholds

```python
THRESHOLDS = {
    "deterministic": 0.85,  # Route to FSM
    "ambiguous": 0.60,      # Clarification prompt
    "fallback": 0.30,       # Route to LLM
}
```

### Decision Matrix

| Confidence | Action | Latency Target |
|------------|--------|----------------|
| ≥ 0.85 | FSM deterministic | ~15ms |
| 0.60 - 0.85 | LLM with intent hint | ~800ms |
| 0.30 - 0.60 | LLM + clarification | ~1000ms |
| < 0.30 | LLM fallback | ~800ms |

---

## FSM Flow Definitions

### `service_scheduling`
**States:** `collect_date` → `collect_time` → `collect_service` → `confirm` → `booked`

**Slot Requirements:**
- `date` (required)
- `time_preference` (optional: "morning", "afternoon", "evening")
- `service_type` (required)
- `contact_info` (required if not authenticated)

**Transitions:**
- Missing slots → prompt for missing info
- Confirmation yes → `booked` state + confirmation TTS
- Confirmation no → restart `collect_date`

### `status_check`
**States:** `authenticate` → `lookup` → `report_status`

**Slot Requirements:**
- `order_id` OR `phone_number` (for lookup)

**Transitions:**
- Auth success → automatic lookup
- Auth fail → offer human transfer

### `order_taking`
**States:** `menu_present` → `collect_items` → `modify_check` → `confirm` → `placed`

**Slot Requirements:**
- `items[]` (array of {name, quantity, modifications})
- `delivery_method` (pickup/delivery)

**Transitions:**
- "Add X" → append to items[]
- "Remove X" → filter from items[]
- "That's all" → `modify_check` state

### `tech_support`
**States:** `identify_issue` → `run_diagnostic` → `suggest_fix` → `verify_resolution`

**Slot Requirements:**
- `device_type` (required)
- `issue_category` (required: "connectivity", "performance", "error")
- `symptoms[]` (optional array)

**Transitions:**
- Known issue → deterministic fix suggestion
- Unknown issue → escalate to LLM within flow
- Resolution confirmed → `end_conversation`
- Resolution failed → `human_transfer`

---

## Training Data Guidelines

### Positive Examples (Deterministic)

```json
{
  "text": "I need to schedule a technician for tomorrow morning",
  "intent": "schedule_service",
  "slots": {
    "date": "tomorrow",
    "time_preference": "morning"
  }
}
```

### Negative Examples (LLM Route)

```json
{
  "text": "My HVAC unit makes a weird grinding noise when I turn it on, but only in the morning, and it's been happening since last Tuesday. Do you think it needs repair or just maintenance?",
  "intent": "complex_query",
  "route": "llm"
}
```

### Ambiguous Examples (Clarification)

```json
{
  "text": "I need help with something",
  "intent": "fallback",
  "confidence": 0.45,
  "action": "clarify: 'Are you looking to schedule service, check a status, or get technical support?'"
}
```

---

## Testing Methodology

### Unit Tests

```python
# Test deterministic routing
assert route_intent("Book an appointment", 0.91) == ("fsm", "service_scheduling")

# Test LLM fallback
assert route_intent("Something weird is happening", 0.25) == ("llm", None)

# Test ambiguous handling
assert route_intent("Help", 0.50) == ("clarify", ["schedule", "status", "support"])
```

### Benchmark Suite

See `research/m8-deterministic-benchmark.py` for:
- Latency comparison (deterministic vs LLM)
- Token cost analysis
- Accuracy scoring
- Threshold tuning

### End-to-End Voice Tests

1. **LiveKit integration test**
   - Connect voice client
   - Speak each Tier 1 intent
   - Verify FSM state transitions
   - Measure end-to-end latency

2. **Fallback recovery test**
   - Speak ambiguous utterance
   - Verify clarification prompt
   - Respond to clarification
   - Verify correct routing

---

## Integration Points

### Classifier → Router

```python
from deterministic.classifier import IntentClassifier
from deterministic.router import ThresholdRouter

classifier = IntentClassifier()
router = ThresholdRouter()

intent, confidence = classifier.predict(text)
route = router.decide(intent, confidence, context)
```

### Router → FSM

```python
if route.action == "fsm":
    fsm = load_flow(route.flow_name)
    response = fsm.advance(text, slots)
    return response
elif route.action == "llm":
    return await llm.generate(text, intent_hint=intent)
```

### Router → LiveKit

See `research/M4-LIVEKIT-INTEGRATION-ARCH.md` for:
- `before_llm` hook implementation
- Streaming TTS integration
- State persistence across turns

---

## Performance Targets

| Metric | Target | Measured |
|--------|--------|----------|
| Classification latency | < 10ms | ~8ms |
| FSM execution latency | < 15ms | ~7ms |
| Deterministic hit rate | > 40% | 43.8% @ threshold=0.3 |
| Token savings | > 50% | 56% |
| End-to-end voice latency | < 500ms | TBD |

---

## Next Steps

1. **End-to-end testing** with Android-17
2. **Threshold tuning** based on real voice data
3. **Intent expansion** for additional verticals
4. **Visual flow editor** for non-technical users

---

*Document version 1.0 — Ready for end-to-end testing*
