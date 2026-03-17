# Grace V2 Single-Agent Postmortem

**Date:** February 2, 2026  
**Researcher:** OpenClaw Subagent  
**Archive Location:** `./archive/`

---

## 1. What Was the V2 Single-Agent Architecture?

### Core Concept
V2 attempted to replace the multi-agent portal/specialist architecture with a **single `GraceV2Agent`** that used **dynamic prompt rebuilding** based on call state. Instead of swapping agents via `session.update_agent()`, V2 updated the agent's instructions on every turn using `await self.update_instructions(new_prompt)`.

### Key Components

| Component | Purpose | File |
|-----------|---------|------|
| **GraceV2Agent** | Single agent handling all call phases | `grace_agent.py` |
| **CallState** | Centralized state tracking | `state.py` |
| **PromptBuilder** | Dynamic prompt generation | `prompt_builder.py` |
| **CFC System** | Conversation Flow Control (loop prevention) | `cfc_integration.py` |
| **LoopDetector** | Response fingerprinting for repetition detection | `loop_detector.py` |
| **ProgressMonitor** | Semantic progress tracking | `semantic_progress_monitor.py` |
| **TurnLimiter** | Hard limits on conversation turns | `turn_limiter.py` |
| **ContextCompactor** | Compresses context when prompts get too long | `context_compactor.py` |
| **StateMachine** | Phases: greeting → intake → closing | `department_state_machine.py` |

### Architecture Diagram (V2)
```
┌─────────────────────────────────────────────────────────────┐
│                      GraceV2Agent                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │               on_user_turn_completed()               │   │
│  │  1. Extract caller info                              │   │
│  │  2. Customer lookup                                  │   │
│  │  3. FAQ check                                        │   │
│  │  4. Department detection                             │   │
│  │  5. Ticket field extraction                          │   │
│  │  6. CFC processing (if enabled)                      │   │
│  │  7. Build new prompt                                 │   │
│  │  8. update_instructions(new_prompt) ← CRITICAL       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ CallState    │  │ PromptBuilder│  │ CFC System   │      │
│  │ (shared)     │  │ (dynamic)    │  │ (complex)    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. How Did V2 Differ from Current Multi-Agent?

| Aspect | V2 Single-Agent | Current Multi-Agent |
|--------|-----------------|---------------------|
| **Agent count** | 1 (`GraceV2Agent`) | 9 (Portal + 7 specialists + Closing) |
| **Prompt strategy** | Dynamic rebuild every turn | Static per-agent prompts |
| **Department routing** | Internal mode switch | `session.update_agent()` handoff |
| **State management** | Single `CallState` + CFC | Shared `CallData` passed between agents |
| **Loop prevention** | CFC system with 6+ components | TTS filter + hardcoded on_enter messages |
| **Context handling** | ContextCompactor (compression) | Fresh LLM context per agent |
| **Complexity** | ~15 Python files, ~500+ lines CFC alone | ~1 file, specialized prompts externalized |

### V2 File Count in Archive
```
grace_agent.py              - 400+ lines (main agent)
cfc_integration.py          - 200+ lines
context_compactor.py        - 180+ lines
department_state_machine.py - 250+ lines
loop_detector.py            - 400+ lines (!)
semantic_progress_monitor.py - 350+ lines
semantic_progress_monitor_v2.py - 300+ lines
turn_limiter.py             - 100+ lines
ticket_completion.py        - 150+ lines
prompt_builder.py           - 400+ lines
```

**Total V2 CFC complexity: ~2,500+ lines just for loop/flow control**

---

## 3. What Specific Problems Occurred?

### Problem A: Race Condition with Instruction Updates

**The Critical Bug (documented in code comments):**
```python
"""
CRITICAL FIX (Feb 1, 2026): Moved state processing to on_user_turn_completed
to ensure instructions are updated BEFORE LLM generates responses.
"""
```

The original V2 used `@session.on("user_input_transcribed")` which fires **AFTER** the LLM starts generating. By the time the prompt was updated, the LLM was already producing output with the OLD instructions.

**Evidence from the code:**
```python
@session.on("user_input_transcribed")
def on_user_speech(event):
    """
    NOTE: State processing has been moved to on_user_turn_completed in the agent class.
    This event fires AFTER the LLM starts generating, so it is too late to update instructions.
    We keep this handler only for logging purposes.
    """
    # DO NOT process here - it is too late! Processing happens in on_user_turn_completed
```

### Problem B: Loop Detection Was Reactive, Not Preventive

The CFC system detected loops AFTER they happened:
```python
def _check_for_loop(self, response: str) -> bool:
    """Check if response indicates a stuck loop."""
    response_lower = response.lower()
    
    for pattern in self._stuck_patterns:
        if re.search(pattern, response_lower):
            return True
```

**Stuck patterns they had to detect:**
```python
self._stuck_patterns = [
    r"let me gather.*information",
    r"i understand\.?\s*let me",
    r"let me get.*details",
    r"if that.s okay",
]
```

This proves Grace was repeatedly saying these phrases even with all the loop prevention code.

### Problem C: Complexity Explosion

The CFC "fix" added massive complexity:
1. **LoopDetector** with response fingerprinting and semantic hashing
2. **ProgressMonitor** tracking "turns without progress" 
3. **TurnLimiter** with hard caps
4. **StateMachine** with phase transitions
5. **ContextCompactor** to shrink prompts that got too big
6. **TicketCompletionDetector** to know when to stop

Each component had its own thresholds, metrics, and edge cases.

### Problem D: Prompt Size Management

V2 needed a `ContextCompactor` because the single-agent prompt grew with:
- Full BASE_PERSONA
- Department-specific script
- Known caller information
- Collected ticket fields
- Recent transcript
- CFC escape prompts
- Turn limit warnings
- Phase-specific guidance

The compactor tried to solve this:
```python
if self.compactor.should_compact():
    await self.compactor.compact_async()
```

But compression meant losing context the LLM needed.

### Problem E: Multi-Department Calls Were Problematic

When a caller had multiple issues (service + billing):
```python
# 7. Detect department changes
new_dept = detect_department(text)
if new_dept and should_switch_department(new_dept, call_state, text):
    # Finalize current ticket if complete before switching
    if is_ticket_complete(call_state) and call_state.tickets_in_progress.get(call_state.department):
        await submit_ticket(call_state, call_state.department)
    
    call_state.switch_department(new_dept)
```

The mode switch happened, but the LLM didn't naturally transition - it had to be told via updated instructions, creating awkward conversation flow.

---

## 4. Why Did V2 Fail?

### Root Cause 1: Fighting the LLM's Nature
V2 tried to make one LLM context handle everything by constantly rewriting its instructions. But LLMs work best when they have:
- Stable, clear instructions
- Focused role/context
- Natural conversation flow

Constantly changing the rules mid-conversation confused the model.

### Root Cause 2: Complexity Begets Complexity
Each bug fix introduced new complexity:
- Loops detected → Add LoopDetector → Still loops → Add fingerprinting
- Prompts too long → Add ContextCompactor → Lost context → Add ProgressMonitor
- Missed info → Add TicketCompletionDetector → Wrong phase → Add StateMachine

The CFC system became a complex state machine trying to control LLM behavior from the outside.

### Root Cause 3: Wrong Layer of Abstraction
V2 tried to solve conversation problems with code:
- Response similarity thresholds
- Turn counters
- Phase state machines
- Escape prompts

Multi-agent solves it structurally:
- Each agent has ONE job
- Agent swap = natural breakpoint
- Fresh context = no accumulated confusion

### Root Cause 4: Timing Sensitivity
The `update_instructions()` approach requires perfect timing:
- Process input before LLM generates
- Update prompt before LLM sees it
- Don't interrupt ongoing generation

The LiveKit SDK's event model made this fragile.

---

## 5. Lessons for the New Approach

### ✅ DO: Keep Agents Focused
Multi-agent works because each specialist:
- Has a single clear purpose
- Gets a fresh LLM context
- Has focused, static instructions
- Doesn't carry baggage from other departments

### ✅ DO: Fix the Seams, Not the Model
Current multi-agent issues (jarring handoffs, repeated questions) are **handoff problems**, not architecture problems. Solutions:
- Pass context in transition messages
- Remove hardcoded `on_enter()` greetings
- Inject transcript into specialist prompts

### ❌ DON'T: Add Detection for Things You Should Prevent
Loop detection = treating symptoms. Better:
- Don't give the LLM ambiguous instructions
- Use structured data extraction, not open-ended questions
- Let agent swaps create natural conversation boundaries

### ❌ DON'T: Dynamically Rewrite Core Instructions
If you find yourself constantly updating `instructions=`, you're fighting the framework. Options:
- Use tool returns to inject knowledge (not instruction rewrites)
- Use multi-agent with focused prompts
- Use structured output with validation

### ❌ DON'T: Solve Conversation Problems in Code
These are signs you're over-engineering:
- Response fingerprinting classes
- Semantic similarity thresholds  
- Turn counting state machines
- Escape prompt injection

The LLM should just... converse. If it can't, the prompt is wrong, not the code.

### ✅ DO: Preserve What Works in Multi-Agent

The current system successfully:
- Handles 7+ departments
- Creates tickets
- Records calls
- Extracts structured data

The problems are:
- Abrupt handoffs
- Repeated questions
- Inconsistent personality

These are fixable with the recommendations in `seamless-handoffs.md`.

---

## 6. Recommended Path Forward

Based on this analysis, **DO NOT attempt V2's single-agent-with-dynamic-prompts again.**

Instead, evolve multi-agent with Phase 1 quick wins from the project plan:
1. Remove hardcoded `on_enter()` greetings (let LLM handle)
2. Inject transcript context into specialist prompts
3. Add transition messages to route tools
4. Unify personality across all prompts

This preserves multi-agent's structural benefits while smoothing the seams.

---

## Files Referenced

| File | Key Evidence |
|------|-------------|
| `./archive/grace_agent.py` | Main V2 agent with race condition fix comments |
| `./archive/cfc_integration.py` | CFC system integration |
| `./archive/loop_detector.py` | Response fingerprinting complexity |
| `./archive/prompt_builder.py` | Dynamic prompt construction |
| `./hvac_agent.py` | Current multi-agent for comparison |
| `./seamless-handoffs.md` | Recommended fixes for multi-agent |

---

*Postmortem generated by OpenClaw subagent research task*
