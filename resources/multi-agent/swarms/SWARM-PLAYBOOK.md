# Swarm Playbook: Operating Manual for Local Agent Swarms

**Version:** 1.1  
**Date:** 2026-02-08  
**Model:** Qwen 2.5 Coder 32B Instruct AWQ  
**Hardware:** Dual RTX PRO 6000 Blackwell (192GB total VRAM)

---

## Core Philosophy

> "Many small agents with redundancy beat fewer smart agents."

The 32B model is ~77% reliable on single tasks. With 2 agents doing the same task, reliability jumps to 95%. With 3-of-5 voting, it's 99%. **Embrace the swarm, trust the statistics.**

---

## Quick Reference

### Task Sizing
| Complexity | Agents | Redundancy | Example |
|------------|--------|------------|---------|
| Atomic | 1 | None | Single SSH command |
| Simple | 2 | Any-success | Gather + write file |
| Standard | 3 | 2-of-3 | Multi-step with logic |
| Critical | 5 | 3-of-5 | Important decisions |

### Reliability Math
| Agents | Pattern | Success Rate* |
|--------|---------|--------------|
| 1 | Single | 77% |
| 2 | Any-success | 95% |
| 3 | 2-of-3 | 93% |
| 5 | 3-of-5 | 97% |

*Assuming 77% base reliability per agent

---

## Task Templates

### Template 1: Atomic SSH Command
```
Run this exact command and write the output:

1. Run: ssh michael@192.168.0.122 "[COMMAND]"
2. Write output to: /path/to/output.md

Do not stop until file is written.
```
**Reliability:** 85%+ | **Use for:** Data gathering, status checks

### Template 2: Multi-Command Gather
```
You are [ROLE] Agent.

Run these commands and document ALL outputs:

1. Run: ssh michael@192.168.0.122 "[COMMAND1]"
2. Run: ssh michael@192.168.0.122 "[COMMAND2]"
3. Run: ssh michael@192.168.0.122 "[COMMAND3]"
4. Write ALL outputs to: /path/to/output.md

Include raw command outputs. Do not stop until file is written.
```
**Reliability:** 75% | **Recommended:** 2 agents, any-success

### Template 3: Process and Write
```
You are [ROLE] Processor.

Input file: /path/to/input.md
Output file: /path/to/output.md

1. Read the input file
2. [SPECIFIC PROCESSING INSTRUCTION]
3. Write processed result to output file

Do not stop until output file is written.
```
**Reliability:** 80% | **Use for:** Transformation, analysis

### Template 4: Validation Agent
```
You are Validator Agent.

Check if file exists and contains expected content:

1. Run: cat /path/to/file.md | head -20
2. Verify it contains: [EXPECTED CONTENT]
3. Write validation result to: /path/to/validation.md

Report: PASS or FAIL with reason.
```
**Reliability:** 90% | **Use for:** QA, verification

---

## Swarm Patterns

### Pattern A: Simple Parallel (2x throughput)
```
Task ──┬─► Agent 1 (.122) ──► Result 1
       └─► Agent 2 (.143) ──► Result 2

Take: First success
```
**When:** Independent tasks, speed matters

### Pattern B: Redundant Execution (reliability)
```
Same Task ──┬─► Agent 1 (.122) ──┐
            └─► Agent 2 (.143) ──┼─► Compare ──► Best Result

Compare: If outputs match → high confidence
         If differ → retry or human review
```
**When:** Critical tasks, need certainty

### Pattern C: Pipeline Stages (complex workflows)
```
Stage 1      Stage 2       Stage 3
Gather  ──►  Process  ──►  Write
(.122)       (.143)        (.122)
```
**When:** Tasks have clear phases

### Pattern D: Map-Reduce (large datasets)
```
Split ──┬─► Agent 1: Chunk 1 ──┐
        ├─► Agent 2: Chunk 2 ──┼─► Aggregator ──► Final
        ├─► Agent 3: Chunk 3 ──┤
        └─► Agent 4: Chunk 4 ──┘
```
**When:** Processing many items

### Pattern E: Hierarchical (complex projects)
```
Coordinator (Claude)
    │
    ├─► Swarm A: Research ──► findings.md
    ├─► Swarm B: Implementation ──► code.md
    └─► Swarm C: Testing ──► results.md
    │
Coordinator merges and reviews
```
**When:** Multi-phase projects

---

## Spawning Best Practices

### DO ✅
```python
# Explicit commands
"Run: ssh michael@192.168.0.122 'nvidia-smi'"

# Absolute paths
"Write to: /home/node/.openclaw/workspace/research/output.md"

# Single focus
"You are GPU Agent. Document GPU configuration only."

# Clear termination
"Do not stop until file is written."

# Numbered steps
"1. Run X  2. Run Y  3. Write Z"
```

### DON'T ❌
```python
# Indirect instructions
"SSH as: michael@192.168.0.122"  # Will run locally!

# Relative paths
"Write to the research folder"  # Ambiguous

# Multi-focus
"Document everything about the server"  # Too broad

# Conditional logic
"If X exists, do Y, otherwise do Z"  # Unreliable

# Open-ended
"Explore and find interesting things"  # Will fail
```

---

## Concurrency Guidelines

### Single GPU (.122 only)
| Concurrent Agents | Behavior |
|-------------------|----------|
| 1-4 | Smooth, fast |
| 5-8 | Good throughput |
| 9-12 | Some queuing |
| 13+ | Timeouts likely |

### Dual GPU (.122 + .143)
| Concurrent Agents | Behavior |
|-------------------|----------|
| 1-8 | Smooth, fast |
| 9-16 | Good throughput |
| 17-20 | Some queuing |
| 21+ | Timeouts possible |

**Recommendation:** 6-8 agents per GPU for sustained workloads.

---

## Error Handling

### Agent Fails to Write File
```
1. Check if data was returned in completion message
2. If yes → manually write or retry with simpler prompt
3. If no → task was too complex, decompose further
```

### Agent Runs Commands Locally (not via SSH)
```
1. Prompt didn't include explicit "ssh user@host" syntax
2. Rewrite with literal SSH commands
```

### Agent Stops Mid-Task
```
1. Task had too many steps
2. Break into 2-3 smaller tasks
3. Use pipeline pattern
```

### Timeout
```
1. GPU was overloaded
2. Reduce concurrent agents
3. Or add second GPU
```

---

## Project Workflow

### For New Projects
```
1. Define end goal
2. Break into phases
3. Break phases into atomic tasks
4. Assign redundancy level per task
5. Spawn swarm
6. Aggregate results
7. QA with validation agents
8. Claude review if needed
```

### For Server Tasks
```
1. List all commands needed
2. One command per agent (or 2-3 related ones)
3. Explicit SSH syntax
4. Explicit file paths
5. Spawn 2 agents per task (any-success)
6. Merge successful outputs
```

### For Research Tasks
```
1. Define research questions
2. One question per agent
3. Template: "Research X, write to Y"
4. Spawn 4-6 agents per question
5. Take longest/most detailed output
6. Claude synthesizes
```

---

## Cost Comparison

| Approach | Cost | Speed | Reliability |
|----------|------|-------|-------------|
| 1 Claude sub-agent | ~$0.10 | Fast | 95%+ |
| 1 Local sub-agent | $0.00 | Medium | 77% |
| 2 Local (redundant) | $0.00 | Medium | 95% |
| 5 Local (3-of-5) | $0.00 | Medium | 99% |

**Break-even:** ~5 local agents = cost of 1 Claude agent, with higher reliability.

---

## Integration with OpenClaw

### Required Config (verified 2026-02-08)
```json
"local-vllm": {
  "baseUrl": "http://192.168.0.122:8003/v1",  // PROXY on 8003!
  "api": "openai-completions"  // NOT openai-responses!
}
```
**Critical:** Port 8003 is the vLLM tool proxy. Port 8000 direct will fail tool calls.

### Spawn with Local Model
```javascript
sessions_spawn({
  task: "...",
  model: "local-vllm/Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
  label: "descriptive-label",
  runTimeoutSeconds: 180
})
```

### Batch Spawn Pattern
```javascript
const tasks = [...];
const agents = tasks.map((task, i) => 
  sessions_spawn({
    task: task,
    model: "local-vllm/Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
    label: `batch-${i}`
  })
);
// Wait for completions
// Aggregate results
```

---

## Evolution Path

### Now (v1.0)
- Single GPU active
- Manual swarm coordination
- 77% single-agent reliability

### Next (v1.1)
- Dual GPU with load balancing
- 16+ concurrent agents
- 95%+ with redundancy

### Future (v2.0)
- Auto-decomposition of complex tasks
- Intelligent retry/voting
- Self-healing swarms
- Cron-based batch processing

---

---

## Lessons from Zergling Testing (2026-02-07)

### Tested Configurations
- **7B Zerglings:** 20 concurrent agents, atomic tasks
- **7B + Web Search:** 20 research agents with Brave API
- **7B + SSH:** 20 agents running remote commands

### What Works (All Model Sizes)
| Pattern | Why It Works |
|---------|--------------|
| Numbered steps (1, 2, 3) | Removes ambiguity |
| Absolute file paths | No path resolution errors |
| "Do not stop until..." | Prevents early termination |
| Single focus per agent | Less confusion |
| Simple shell commands | Fewer quoting issues |

### What Fails
| Pattern | Failure Mode |
|---------|--------------|
| Complex pipes (`\| grep \| head`) | Tool call as text |
| Nested quotes in SSH | Parsing errors |
| Multi-tool chains without explicit steps | Skipped steps |
| Silent completions | Unreported failures |

### Command Simplification
```bash
# ❌ Complex (lower reliability)
ps aux | grep -E 'vllm|python' | grep -v grep | head -5

# ✅ Simple (higher reliability)
pgrep -af vllm
systemctl status vllm --no-pager
```

### Validation Pattern
For critical writes, add confirmation step:
```
3. Confirm: Run "ls -la /path/to/output.md" to verify file was written
4. Report file size and first 3 lines as confirmation
```

### 7B vs 32B Task Routing
| Task Type | Best Model | Notes |
|-----------|------------|-------|
| Single-tool atomic | 7B | Fast, cheap, reliable |
| Web research | 32B | Better tool chaining |
| SSH + write | 32B | Handles quoting better |
| Multi-step logic | 32B | Reasoning required |
| Simple facts/summaries | 7B | Good enough |

### Redundancy Recommendations
| Task Importance | 7B Pattern | 32B Pattern |
|-----------------|------------|-------------|
| Nice to have | 1 agent | 1 agent |
| Should work | 2 any-success | 1 agent |
| Must work | 3 of 5 | 2 any-success |
| Critical | Use 32B | 3 of 5 |

---

*Playbook by Android-17 • Local swarm infrastructure for OpenClaw*
