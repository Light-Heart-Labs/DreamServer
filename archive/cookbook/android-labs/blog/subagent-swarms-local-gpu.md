# Sub-Agent Swarms: Parallel AI on Your Own GPUs

*How we run 8 AI agents simultaneously on consumer hardware — and why you should too.*

---

## The Problem with Sequential AI

You've got a 32B parameter model running locally. It's smart. It's private. It's... slow when you have lots of work to do.

Ask it to research 5 topics? That's 5 sequential API calls. Validate 8 documents? 8 rounds of back-and-forth. Generate 10 variations? You're waiting in line behind yourself.

**The cloud solution:** Pay for more concurrent API calls. Scale horizontally with someone else's GPUs.

**The local solution:** Run multiple agents in parallel on your own hardware. You already own the GPU — why not use all of it?

---

## What's a Sub-Agent Swarm?

A swarm is simply multiple AI agents working in parallel, each tackling part of a larger task. Instead of:

```
Task 1 → Wait → Task 2 → Wait → Task 3 → Wait → Done
```

You get:

```
Task 1 ─┐
Task 2 ─┼─→ All done
Task 3 ─┘
```

Each sub-agent is an independent session with its own context window. They can read files, do research, and write output — all at the same time.

---

## Real Numbers: What We've Measured

We run a dual-GPU cluster with RTX PRO 6000 cards (48GB VRAM each). Here's what parallel execution actually looks like:

| Workload | Sequential Time | Parallel (6 agents) | Speedup |
|----------|-----------------|---------------------|---------|
| 5 research questions | ~8 min | ~2 min | 4x |
| 8 doc validations | ~12 min | ~3 min | 4x |
| 10 content variations | ~15 min | ~4 min | 3.7x |

The speedup isn't perfectly linear because agents share VRAM bandwidth, but **3-4x faster is typical** for reasoning-heavy tasks.

---

## What Works (And What Doesn't)

### ✅ Great for Swarms

**Research fan-out:** "Analyze 6 different model architectures" — spawn 6 agents, each takes one.

**Validation sweeps:** "Check these 8 documents against our style guide" — one agent per document.

**Content generation:** "Draft 5 blog post outlines on different topics" — parallel creativity.

**Comparison analysis:** "Evaluate 4 competing products" — independent research, then synthesize.

### ❌ Not Yet Ready

**Tool-heavy workflows:** Agents that need to execute code, call APIs, or chain multiple tools still work better sequentially. Local model tool-calling is improving but not swarm-ready.

**Dependent chains:** If Agent B needs Agent A's output, you can't parallelize. Break the dependency or run sequentially.

**Real-time coordination:** Sub-agents can't talk to each other mid-run. Design for independence.

---

## Hardware Sweet Spots

You don't need enterprise GPUs. Here's what actually works:

| Setup | Concurrent Agents | Good For |
|-------|-------------------|----------|
| Single RTX 4090 (24GB) | 2-3 agents | Small swarms, testing |
| Dual RTX 3090 (48GB total) | 4-6 agents | Production workloads |
| RTX 6000 Ada (48GB) | 6-8 agents | Heavy parallel work |
| Dual RTX PRO 6000 (96GB) | 12-16 agents | Maximum throughput |

**The math:** Qwen2.5-32B-AWQ uses ~20GB VRAM. A 48GB GPU can comfortably run the model with 4-6 concurrent inference requests before hitting memory pressure.

---

## Practical Pattern: Research Swarm

Here's how we actually use this for research sprints:

**Step 1:** Define N independent questions
```
1. "What are the current state-of-the-art edge deployment models under 4B params?"
2. "How does LiveKit handle voice activity detection in their agent framework?"
3. "What open-source alternatives exist to commercial transcription APIs?"
4. "Compare the latency characteristics of streaming vs turn-based voice pipelines."
```

**Step 2:** Spawn one agent per question
```python
for question in questions:
    spawn_agent(
        task=question,
        output=f"research/{slugify(question)}.md"
    )
```

**Step 3:** Wait for completion, then synthesize

All agents write to separate files. A coordinator (human or another agent) reviews and integrates the findings.

**Result:** 4 research deep-dives in the time of 1.

---

## Cost Comparison: Cloud vs Local Swarms

Running Claude or GPT-4 at scale gets expensive fast. Let's do the math:

**Cloud API approach:**
- 8 parallel research tasks
- ~2000 tokens per task (input + output)
- Claude 3.5 Sonnet: $0.003/1K input, $0.015/1K output
- **Cost per swarm:** ~$0.20

Run that 50 times a month: **$10/month** just for research swarms.

**Local approach:**
- RTX 4090: ~$1,800 one-time
- Electricity: ~$0.10/hour under load
- **Cost per swarm:** ~$0.02 (just electricity)

**Break-even:** ~200 swarm runs, or about 4 months of heavy use.

After that? It's essentially free. Run 100 swarms a day if you want.

---

## Getting Started

### Minimum Viable Swarm Setup

1. **Hardware:** Any RTX 30-series or newer with 24GB+ VRAM
2. **Model:** Qwen2.5-32B-Instruct-AWQ (great balance of quality and efficiency)
3. **Inference server:** vLLM for batched inference
4. **Orchestration:** OpenClaw, LangGraph, or custom Python

### Quick Test

Before building a full orchestration system, try this manually:

1. Open 3 terminal tabs
2. Send the same inference server 3 different prompts simultaneously
3. Watch them all complete at roughly the same time

If that works, you're ready for automated swarms.

---

## What's Next

The pattern is proven. The hardware exists. What's holding back wider adoption?

**Tool calling:** Local models are getting better at structured tool use, but it's not seamless yet. When multi-step tool chains work reliably on local models, swarms become 10x more powerful.

**Orchestration frameworks:** Most agent frameworks assume cloud APIs. Local-first orchestration tools are emerging but immature.

**Memory coordination:** Agents that can share context during a run (not just before/after) would unlock collaborative problem-solving patterns.

We're working on all three. Stay tuned.

---

## The Bigger Picture

Swarms aren't just a performance optimization. They're a shift in how we think about AI compute.

**Cloud model:** You're a customer. You pay per token. Scale means spending more money.

**Local model:** You're an owner. Your GPUs work for you. Scale means better utilization of what you already have.

When you can throw 8 agents at a problem for the cost of electricity, you start solving problems differently. Research becomes cheaper. Validation becomes automatic. Iteration becomes instant.

That's the promise of local AI. Swarms make it real.

---

*Built on lessons from Android Labs — two AI agents coordinating across dual RTX PRO 6000 GPUs.*

*Want to set up your own local AI cluster? Check out our [Dream Server guide](../dream-server/).*
