# Deterministic Call Flow Research

> **Date:** 2026-02-09  
> **Author:** Todd  
> **Mission:** M4 (Deterministic Voice Agents)  
> **Status:** Research complete

---

## TL;DR

Reduce LLM dependence in voice agents by treating conversation flows as **Finite State Machines (FSMs)**. The LLM becomes the language layer while a simple policy (the FSM) acts as the reliable control plane.

**Key insight:** LLMs have ~50% multi-turn function calling accuracy. Deterministic state machines provide predictable behavior for compliance-critical flows.

---

## The Problem

LLMs in voice agents face two issues:

1. **Latency:** Each LLM call adds 350ms-1s+
2. **Reliability:** Multi-turn instruction following is ~50% accurate (GPT-4o BFCL benchmark)

For business-critical flows (appointment booking, compliance scripts, data collection), this unpredictability is unacceptable.

---

## The Solution: FSM-Style Conversation Design

### Core Architecture

```
User Speech → STT → Intent Classifier → FSM Controller → NLG Templates → TTS
                         ↓
                    [State Machine]
                         ↓
                    LLM (language layer only)
```

**Key principle:** LLM generates natural language, but FSM controls the flow.

### FSM Components

| Component | Purpose |
|-----------|---------|
| **States** | Named steps in conversation (S0_opening, S1_info, S2_confirm) |
| **Transitions** | User intents that move between states |
| **NLG Templates** | Pre-written responses (strict or soft) |
| **Entities** | Typed data to capture (datetime, boolean, string) |
| **Validators** | Rules for entity validation |
| **Edge Cases** | Handlers for interruptions, language switches, vague answers |

### Example FSM Spec (YAML)

```yaml
domain: "appointment_booking"
policy:
  initial: S0_opening
  states:
    S0_opening:
      say: nlg.opening
      on:
        ask_info: S1_info
        not_interested: 
          say: nlg.close
          end: closed
    S1_info:
      say: nlg.info_outline
      on:
        provide_time: S2_confirm
        vague_time:
          say: nlg.time_request
          then: S1_info
    S2_confirm:
      say: nlg.confirm_time
      capture: [meeting_time]
      end: booked

nlg:
  opening:
    strictness: soft
    template: "Hi, quick call to see if now is a good time..."
  time_request:
    strictness: strict  # Compliance-critical
    template: "Could you tell me a specific date and time?"
```

---

## When to Use Each Approach

| Scenario | Approach | LLM Role |
|----------|----------|----------|
| Open-ended conversation | Full LLM | Everything |
| Structured data collection | FSM + LLM | Language generation only |
| Compliance scripts | FSM + Templates | None (strict NLG) |
| Hybrid (guided + freeform) | FSM with escape states | Selected turns |

---

## Benefits of Deterministic Flows

### 1. Improved Latency
- Skip LLM for predictable responses
- Template-based NLG: <50ms vs 500ms+ LLM call
- Only use LLM for complex language generation

### 2. Increased Reliability
- Guaranteed state transitions
- Predictable behavior for compliance
- Testable scenarios (YAML → unit tests)

### 3. Easier Parallelism
- Simple state machines scale infinitely
- No GPU bottleneck for control logic
- LLM only called when needed

### 4. Better Observability
- Clear state tracking
- Deterministic paths = debuggable logs
- Easy to identify where conversations fail

---

## Implementation Options

### 1. Pipecat Flows
**GitHub:** github.com/pipecat-ai/pipecat

Pipecat has a `flows` module for FSM-style conversation design:
- Declarative flow definitions
- State machine execution
- LLM integration for language layer

### 2. Vocode
**GitHub:** github.com/vocodedev/vocode-core

State-based conversation management with:
- Conversation trees
- Action handlers
- Integration with LiveKit/Twilio

### 3. Custom Implementation
Build minimal FSM in Python:

```python
class ConversationFSM:
    def __init__(self, spec):
        self.state = spec['initial']
        self.policy = spec['states']
        self.nlg = spec['nlg']
    
    def process(self, intent: str) -> tuple[str, bool]:
        """Returns (response_text, is_complete)"""
        current = self.policy[self.state]
        
        if intent in current['on']:
            transition = current['on'][intent]
            if isinstance(transition, str):
                self.state = transition
            else:
                self.state = transition.get('then', self.state)
            
            next_state = self.policy[self.state]
            template = self.nlg[next_state['say'].split('.')[1]]
            
            return template['template'], 'end' in next_state
        
        return "I didn't understand that.", False
```

---

## Application to Grace (HVAC Voice Agent)

Grace could benefit from FSM for:

### Deterministic Flows
- Appointment scheduling
- Service request intake
- Basic troubleshooting scripts

### Hybrid Flows
- FSM for structure, LLM for technical Q&A
- Escape to full LLM for complex queries
- Return to FSM for data capture

### Example Grace States
```yaml
states:
  S0_greeting:
    say: "Thanks for calling Grace HVAC. How can I help today?"
    on:
      schedule_service: S1_collect_info
      technical_question: S_llm_mode  # Escape to LLM
      emergency: S_emergency_transfer
  
  S1_collect_info:
    say: "I can help schedule that. What's your address?"
    capture: [address]
    on:
      address_provided: S2_time_preference
```

---

## Latency Impact Analysis

| Flow Type | Turns | LLM Calls | Est. Latency/Turn |
|-----------|-------|-----------|-------------------|
| Full LLM | 5 | 5 | 800ms |
| FSM + Templates | 5 | 0 | 200ms |
| Hybrid (3 FSM, 2 LLM) | 5 | 2 | 440ms avg |

**Savings:** 45-75% latency reduction for structured flows

---

## Recommendations for M4

### Phase 1: Identify Candidates
- [ ] Map Grace conversation types
- [ ] Identify deterministic vs open-ended flows
- [ ] Prioritize high-volume, structured interactions

### Phase 2: Build FSM Framework
- [ ] Evaluate Pipecat Flows vs custom
- [ ] Create YAML schema for Grace flows
- [ ] Implement basic FSM executor

### Phase 3: Hybrid Integration
- [ ] Add escape states to LLM
- [ ] Implement smooth transitions
- [ ] A/B test deterministic vs full LLM

---

## References

- Medium: "Treat Prompts Like State Machines" (Oct 2025)
- Daily.co: "Advice on Building Voice AI" (June 2025)
- Pipecat Flows: github.com/pipecat-ai/pipecat
- Berkeley Function-Calling Leaderboard: gorilla.cs.berkeley.edu
