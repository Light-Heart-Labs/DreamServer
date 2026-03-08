# M6 Agent Swarm Patterns

**Mission:** M6 (Maximum Value, Minimum Hardware) + M7 (OpenClaw Frontier Pushing)  
**Purpose:** Document patterns for using local Qwen 2.5 32B via vLLM to spawn parallel sub-agents

## Infrastructure

**Available Compute:**
- `.122`: Qwen2.5-Coder-32B-Instruct-AWQ via vLLM (port 8000)
- `.143`: Qwen2.5-32B via vLLM (secondary GPU node)
- Capacity: 20+ concurrent sub-agents at $0/token

**Access:**
```bash
# Local Qwen via tool proxy
Tool: sessions_spawn
Model: qwen (local via port 8003)
```

## Pattern 1: Fan-Out Research

**Use case:** Research a topic from multiple angles simultaneously

**Workflow:**
1. Parent agent defines research questions
2. Spawn N sub-agents, each with one question
3. Sub-agents run in parallel on local Qwen
4. Aggregate results into unified document

**Example:**
```
Topic: "Local LLM tool calling success rates"
├── Sub-agent 1: Research vLLM tool calling patterns
├── Sub-agent 2: Research llama.cpp function calling
├── Sub-agent 3: Research mlx-lm tool use
└── Sub-agent 4: Aggregate benchmarks from papers
```

## Pattern 2: Divide-and-Conquer Code Review

**Use case:** Review large codebase sections in parallel

**Workflow:**
1. Split codebase into logical sections
2. Spawn sub-agents for each section
3. Each reviews for: bugs, security, performance
4. Aggregate findings into prioritized list

## Pattern 3: A/B Testing Prompts

**Use case:** Find optimal prompts for local models

**Workflow:**
1. Define base task
2. Spawn sub-agents with prompt variations
3. Each tests on same input set
4. Compare success rates and latencies

## Pattern 4: Data Generation

**Use case:** Generate training/test data locally

**Workflow:**
1. Define data schema and examples
2. Spawn sub-agents to generate batches
3. Validate and deduplicate results
4. Export for fine-tuning or testing

## Sub-Agent Configuration

**Optimal settings for local Qwen:**
```yaml
model: qwen  # Maps to local via tool proxy
timeout: 300  # 5 min for research tasks
thinking: low  # Fast responses
```

**Stop prompt:**
```
Reply Done. Do not output JSON. Do not loop.
```

## Cost Analysis

| Approach | Cost | Speed | Use Case |
|----------|------|-------|----------|
| Single frontier | $0.50-2.00 | Fast | Complex reasoning |
| 20x local Qwen | $0 | Parallel | Research, grinding |
| 5x frontier | $2.50-10 | Parallel | High-quality review |

**Break-even:** Local swarms win for tasks where parallelization > individual reasoning quality.

## Experiments to Run

1. **Latency vs Parallelism:** How many sub-agents before vLLM saturates?
2. **Success Rate Comparison:** Same task on frontier vs local swarm
3. **Optimal Task Size:** What's the smallest task worth spawning?
4. **Aggregation Strategies:** Best ways to merge sub-agent outputs

## Current Status

**Started:** 2026-02-11  
**First experiment:** Fan-out research on local LLM capabilities — **IN PROGRESS**
- 3 sub-agents spawned for parallel research:
  - `m6-swarm-vllm`: vLLM tool calling capabilities
  - `m6-swarm-llamacpp`: llama.cpp tool calling
  - `m6-swarm-mlx`: mlx-lm (Apple Silicon) tool calling
- Sub-agents actively researching (web searches initiated)
- Waiting for results to aggregate

**Deliverable:** Validated swarm patterns + documentation

## Experiment 1: Fan-Out Research — COMPLETE ✅

**Topic:** "Local LLM tool calling across inference engines"

**Spawned:** 2026-02-11 12:48 UTC  
**Completed:** 12:52 UTC (4 minutes total)  
**Sub-agents:** 3 parallel (vLLM, llama.cpp, mlx-lm)

### Results Aggregation

| Engine | Tool Calling | Best Models | Key Config | Limitations |
|--------|-------------|-------------|------------|-------------|
| **vLLM** | ✅ Native OpenAI-compatible | Llama 3.1/3.2, Hermes 2/3, Qwen 2.5, Granite | `--enable-auto-tool-choice --tool-call-parser llama3_json` | First call has FSM latency; no parallel in Llama 3.1 |
| **llama.cpp** | ✅ Native (via `--jinja`) | Qwen 2.5 7B/32B, Mistral Nemo, Llama 3.3 | `--jinja` flag required | Lower throughput than vLLM; single-GPU focused |
| **mlx-lm** | ⚠️ Via fine-tuning/external libs | Llama 3.2, Qwen 2.5, Mistral (all 4-bit) | LoRA fine-tuning for function calling | Not native; requires custom templates |

### Key Findings

**vLLM (Best for production):**
- OpenAI-compatible function calling API
- Supports named, auto, required, none tool_choice options
- Best models: Llama 3.1/3.2, Hermes 2 Pro, Qwen 2.5
- Limitation: First named tool call has FSM compilation latency

**llama.cpp (Best for edge):**
- Native function calling via `--jinja` flag
- Supports 10+ model formats (Llama 3.x, Hermes, Qwen, Mistral)
- Better for single-user/edge; vLLM wins on throughput
- Best models: Qwen 2.5 7B/32B, Mistral Nemo 12B

**mlx-lm (Best for Apple Silicon):**
- No native tool calling; requires fine-tuning or external libs
- XML-wrapped JSON format for function calls
- Performance: M3 Max 60+ tok/s, M4 Max 400+ tok/s with batching
- Best models: Llama 3.2 3B, Qwen 2.5 series (4-bit quantized)

### Swarm Pattern Validation

✅ **Fan-Out Research works:** 3 sub-agents researched in parallel, completed in 4 minutes
✅ **Aggregation successful:** Unified comparison table created from 3 distinct outputs
⚠️ **Cost note:** Sub-agents used kimi-k2.5 (not local Qwen) — need to configure local model routing

### Next Experiment
**Pattern 2:** Divide-and-Conquer Code Review (test on dream-server codebase)
