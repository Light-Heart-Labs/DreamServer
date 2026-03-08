# OSS LLM Landscape — February 2026

*Research for M9: Open Source > Closed Systems*

## Latest Releases

### Qwen3 Series (Released April 2025)
- **Flagship:** Qwen3-235B-A22B (MoE architecture, 1T+ effective parameters)
- **Capabilities:**
  - 119 languages supported
  - 92.3% accuracy on AIME25 (math benchmark)
  - 74.1% on LiveCodeBench v6 (real-world coding)
- **Key variants:**
  - Qwen3-Coder-30B-A3B-Instruct — coding specialist
  - Qwen3-30B-A3B-Thinking-2507 — reasoning focus
  - Qwen3-VL — multimodal (vision+language)
- **MoE Benefits:** Sparse activation means ~22B active params from 235B total

### New Players to Watch

| Model | Size | Specialty | Notes |
|-------|------|-----------|-------|
| **GLM-4.5-Air** | ? | Agent workflows | Top-rated for tool calling |
| **MiMo-V2-Flash** | ~100B? | Software engineering | Beats DeepSeek-V3.2 |
| **GPT-OSS 20B** | 20B | Reasoning, tool use | Runs on consumer GPUs |
| **DeepSeek-V3.2** | 236B | General | Strong baseline |

## Best Models for Agent/Tool Calling (2026)

Based on SiliconFlow benchmarks:

1. **GLM-4.5-Air** — Best overall for agent workflows
2. **Qwen3-Coder-30B-A3B-Instruct** — Best for code-heavy agents
3. **Qwen3-30B-A3B-Thinking** — Best for reasoning chains
4. **GPT-OSS 20B** — Best for consumer hardware

## What We're Running

Our cluster uses **Qwen2.5-Coder-32B-Instruct-AWQ**:
- Works on dual RTX 4090 (via vLLM)
- Good for sub-agent tasks
- ~50-60% success rate on autonomous agent tasks
- Loop bug with tool call format (emits JSON in text)

**Upgrade candidates:**
- Qwen3-Coder-30B-A3B — when AWQ quantization available
- GLM-4.5-Air — if we get hardware for larger model

## Comparison: Qwen2.5 vs Qwen3

| Feature | Qwen2.5 (Current) | Qwen3 |
|---------|-------------------|-------|
| Languages | ~30 | 119 |
| Math (AIME25) | ~70% | 92.3% |
| Code (LiveCodeBench) | ~60% | 74.1% |
| MoE | No (dense) | Yes (sparse) |
| Context | 32K | 128K+ |

## Recommendations for M1 (Fully Local)

1. **Current setup works** — Qwen2.5-32B is sufficient for sub-agents
2. **Upgrade path:** Wait for Qwen3-30B AWQ quantizations
3. **For tool calling:** Consider GLM-4.5-Air when feasible
4. **Stay with vLLM** — Best throughput for our hardware

---

*Sources: llm-stats.com, Qwen blog, SiliconFlow, BentoML*
