# Local Agent Swarm: Lessons Learned

**Date:** 2026-02-06  
**Model:** Qwen 2.5 32B Instruct AWQ  
**Task:** Server documentation scrub via SSH  
**Agents Spawned:** 13  
**Success Rate:** ~77% (10/13 completed with usable output)

---

## Overall Rating: 7/10

**Pros:**
- Multi-step tool calling WORKS reliably (PP=2 fix was critical)
- SSH commands execute correctly
- File writing works when model follows through
- Parallel execution (12+ agents simultaneously)
- $0.00 total cost for 148KB of documentation

**Cons:**
- Inconsistent task completion (sometimes stops before final write)
- Doesn't understand indirect instructions ("SSH as: user@host")
- Smaller context = less sophisticated reasoning
- Concurrency can overwhelm single GPU

---

## What Made Agents SUCCEED

### 1. Explicit SSH Commands ✅
```
GOOD: "Run: ssh michael@192.168.0.122 'nvidia-smi'"
BAD:  "SSH as: michael@192.168.0.122, then run nvidia-smi"
```
The 32B model needs literal commands, not instructions to construct commands.

### 2. Numbered Step Lists ✅
```
GOOD:
1. Run: ssh michael@192.168.0.122 "command1"
2. Run: ssh michael@192.168.0.122 "command2"
3. Write ALL findings to: /path/to/file.md

BAD:
Run the following commands on the server and document them...
```

### 3. Explicit File Path ✅
```
GOOD: "Write to: /home/node/.openclaw/workspace/research/server-scrub/122-gpu.md"
BAD:  "Document your findings in the server-scrub directory"
```

### 4. "Do Not Stop" Reinforcement ✅
```
GOOD: "Do not stop until the file is written."
```
Helps prevent premature task termination.

### 5. Single Focus Per Agent ✅
```
GOOD: "You are Server-122 GPU Agent. Document GPU and CUDA setup."
BAD:  "Document everything about the server."
```

---

## What Made Agents STRUGGLE

### 1. Indirect Instructions ❌
```
FAIL: "SSH as: michael@192.168.0.122"
```
Model ran commands locally instead of via SSH.

### 2. Ambiguous Scope ❌
```
FAIL: "Document all security configuration"
```
Too open-ended for 32B reasoning capacity.

### 3. Multi-Server in One Task ❌
```
STRUGGLE: "Check both .122 and .143"
```
Model sometimes lost track of which server it was documenting.

### 4. Complex Conditional Logic ❌
```
STRUGGLE: "If X exists, do Y, otherwise do Z"
```
32B handles this less reliably than Claude.

### 5. Long Output Generation ❌
```
STRUGGLE: Very large command outputs
```
Sometimes truncated or stopped mid-generation.

---

## Optimal Task Template

```
You are [ROLE] Agent.

Complete ALL of these steps:

1. Run: ssh michael@192.168.0.122 "[COMMAND1]"
2. Run: ssh michael@192.168.0.122 "[COMMAND2]"
3. Run: ssh michael@192.168.0.122 "[COMMAND3]"
4. Write ALL findings to: /absolute/path/to/output.md

Include raw command outputs. Do not summarize or omit.
Do not stop until the file is written.
```

---

## Concurrency Recommendations

| Agents | GPU Load | Recommendation |
|--------|----------|----------------|
| 1-4 | Light | Fast, reliable |
| 5-8 | Medium | Good throughput |
| 9-12 | Heavy | Some queuing |
| 13+ | Overloaded | Timeouts possible |

**Optimal:** 6-8 concurrent agents on single 96GB GPU

---

## When to Use Local vs Claude

### Use Local Qwen 32B For:
- High-volume parallel tasks
- Simple SSH command execution
- File operations
- Data gathering / scraping
- Cost-sensitive batch work

### Use Claude For:
- Complex multi-step reasoning
- Nuanced instruction interpretation
- Error recovery and adaptation
- Customer-facing output
- Tasks requiring judgment

---

## Task Success Patterns

| Pattern | Success Rate |
|---------|--------------|
| Explicit SSH + numbered steps + file path | ~90% |
| Role assignment + single focus | ~85% |
| "SSH as:" indirect instruction | ~30% |
| Multi-server in one task | ~50% |
| Open-ended exploration | ~40% |

---

## Configuration That Works

```bash
# vLLM serving (CRITICAL: no PP=2!)
vllm serve Qwen/Qwen2.5-32B-Instruct-AWQ \
    --tensor-parallel-size 1 \
    --port 8000 \
    --host 0.0.0.0 \
    --gpu-memory-utilization 0.92 \
    --enable-auto-tool-choice \
    --tool-call-parser hermes \
    --max-model-len 32768
```

```json
// OpenClaw config
{
  "agents": {
    "defaults": {
      "subagents": {
        "model": "local-vllm/Qwen/Qwen2.5-32B-Instruct-AWQ"
      }
    }
  }
}
```

---

## Future Improvements

1. **Try 72B model** — More reasoning capacity, still fits single GPU at FP8
2. **Task templates** — Pre-built prompts for common sub-agent tasks
3. **Retry logic** — Auto-retry if file not written
4. **Output validation** — Check file exists before marking success
5. **Load balancing** — Spread agents across both GPUs

---

*Lessons captured by Android-17 after first major local swarm deployment*
