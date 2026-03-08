# Local AI Best Practices
*Compiled from hands-on experience running the Light Heart Labs GPU cluster*
*Last updated: 2026-02-08*

---

## Overview

This document captures lessons learned from running local LLMs on dual RTX PRO 6000 Blackwell GPUs (192GB VRAM total). These practices emerged from real production use, not theory.

**Hardware context:** Two nodes (.122 and .143), each with 96GB VRAM, running Qwen2.5 32B models via vLLM.

---

## 1. Model Selection

### What Works
| Model | Use Case | Why |
|-------|----------|-----|
| Qwen2.5-Coder-32B-Instruct-AWQ | Agent/tool tasks | Reliable tool calling, optimized for code |
| Qwen2.5-32B-Instruct-AWQ | Research/reasoning | General instruction following |

### What Doesn't (Yet)
- **80B+ MoE models** — vLLM support incomplete for hybrid attention architectures
- **Pipeline parallelism for tool calling** — FSM state machines don't sync across stages (GitHub #7194)

### Key Insight
**Working smaller models > fancy models that crash.** A 32B model at 100% reliability beats an 80B model at 60% reliability every time.

---

## 2. vLLM Configuration

### Critical Settings
```bash
# Tool calling (REQUIRED for agent work)
--enable-auto-tool-choice
--tool-call-parser hermes

# Memory management
--gpu-memory-utilization 0.90  # NOT 0.95 — Triton needs headroom

# Performance
--enable-chunked-prefill
--max-num-batched-tokens 8192
```

### Why 0.90 Memory Utilization?
First inference triggers Triton kernel autotuning, which needs extra VRAM for compilation. At 0.95, this causes OOM → crash → restart loop.

### Tool Parser Selection
| Model Family | Parser |
|--------------|--------|
| Qwen2.5 (non-Coder) | `hermes` ✓ |
| Qwen2.5-Coder | `hermes` with proxy (see below) |
| Qwen3-Next | ❌ Not yet supported |

### The Coder Tool Proxy Problem
Qwen2.5-Coder outputs `<tools>...</tools>` tags but vLLM's hermes parser expects `<tool_call>...</tool_call>`. Solution: Run a proxy (port 8003) that:
1. Forces `tool_choice: "required"` when tools present
2. Falls back to extracting tool calls from `<tools>` tags

---

## 3. OpenClaw Integration

### Model Provider Config
```json5
{
  "baseUrl": "http://192.168.0.143:8000/v1",
  "api": "openai-completions",  // NOT openai-responses!
  "models": [{
    "id": "Qwen/Qwen2.5-32B-Instruct-AWQ",
    "compat": {
      "supportedParameters": ["tools", "tool_choice"]
    }
  }]
}
```

### Why `openai-completions`?
vLLM's tool calling uses the chat completions endpoint. The `openai-responses` API doesn't pass tools correctly.

### The `supportedParameters` Fix
Without this, OpenClaw doesn't send tool definitions to the model. The model has no idea what tools exist.

---

## 4. Agent Task Design

### Template That Works (~100% success rate)
```
You are [ROLE] Agent.

Complete ALL of these steps:

1. Run: ssh michael@192.168.0.122 "[COMMAND1]"
2. Run: ssh michael@192.168.0.122 "[COMMAND2]"
3. Write ALL findings to: /absolute/path/to/output.md

Do not stop until the file is written.
```

### What Makes Agents Succeed
- ✅ Explicit SSH commands (full command, not "SSH as: user@host")
- ✅ Numbered step lists
- ✅ Absolute file paths
- ✅ "Do not stop" reinforcement
- ✅ Single focus per agent

### What Makes Agents Struggle
- ❌ Indirect instructions ("figure out how to...")
- ❌ Ambiguous scope
- ❌ Multi-server in one task
- ❌ Complex conditional logic
- ❌ Vague success criteria

### Concurrency
- **Optimal:** 6-8 agents per 96GB GPU
- **Max tested:** 20 concurrent agents across cluster
- **Bottleneck:** Token throughput, not VRAM

---

## 5. Multi-Agent Orchestration

### When to Fan Out
- Data gathering across multiple sources
- Parallel research on independent topics
- Bulk file operations
- Tasks where speed > coherence

### When to Stay Sequential
- Tasks requiring judgment calls
- Error recovery
- Customer-facing outputs
- Complex reasoning chains

### The Command Structure
```
Claude (coordinator) → spawns → Local Qwen agents (workers)
```

Coordinators (Claude) have judgment. Workers (local Qwen) have throughput. Don't reverse this.

### Rate Limiting
Anthropic API limits for Claude orchestrators:
| Model | Requests/min | Input Tokens/min |
|-------|--------------|------------------|
| Claude 4.x | 1,000 | 450K |

**Safe parallel count:** 2-4 heavy agents at a time to avoid cooldowns.

---

## 6. Reliability Patterns

### Proven: Dual-Agent Verification
Run same task on two agents independently. Compare outputs. Consensus = confidence.

**Benchmark result:** Single agent 67% → Dual agent 100% task completion.

### Proven: Explicit Over Implicit
Never assume the model knows context. State everything:
- What files exist
- What commands to run
- What success looks like
- Where to write output

### Proven: Fail Fast
If an agent is stuck for >2 tool calls on same step, it's lost. Kill and retry with clearer instructions.

---

## 7. Infrastructure Resilience

### Smart Proxy Pattern
Both nodes run identical proxies. Benefits:
- Automatic failover (if peer dies, 100% routes to survivor)
- Health check every 3 seconds
- Round-robin for load balancing
- VRAM-based routing for memory-heavy tasks

### State Versioning (Critical)
Before ANY experiment:
1. Snapshot current state to git
2. Push to remote
3. THEN experiment
4. If broken → diff old versions

**Rule:** If it's not in git, it doesn't exist for rollback.

---

## 8. What We're Still Learning

- Optimal prefix caching strategies for multi-agent
- When MoE models become reliable in vLLM
- Voice agent latency optimization (pending research)
- Cross-cluster coordination patterns

---

## Summary

The key insight from our experience: **reliability beats capability**. A well-configured 32B model with proper tool calling will outperform a poorly-configured 80B model every time.

Focus on:
1. Getting tool calling working reliably
2. Writing explicit agent tasks
3. Using fan-out for appropriate workloads
4. Maintaining rollback capability

Everything else is optimization.
