# DeepSeek Model Family — Tool Calling Support Report

**Date:** 2026-02-08  
**Status:** Research complete

---

## Summary

DeepSeek has multiple model families with varying levels of tool/function calling support. vLLM has **native parser support** for DeepSeek-V3 and DeepSeek-V3.1 as of recent versions. DeepSeek R1-0528 also gained tool calling support. The DeepSeek API itself supports function calling with an OpenAI-compatible interface.

---

## Which DeepSeek Models Support Tool Calling

| Model | Tool Calling | vLLM Parser | Notes |
|-------|-------------|-------------|-------|
| **DeepSeek-V3-0324** | ✅ Yes | `deepseek_v3` | Dedicated parser + jinja template |
| **DeepSeek-V3.1** | ✅ Yes | `deepseek_v31` | Separate parser from V3 |
| **DeepSeek-R1-0528** | ✅ Yes | `deepseek_v3` | Uses same parser as V3, different chat template |
| **DeepSeek-R1 (original, Jan 2025)** | ❌ No native | N/A | Reasoning-only model, no tool calling training |
| **DeepSeek-V2/V2.5** | ⚠️ Limited | No dedicated parser | May work via hermes parser with custom template |
| **DeepSeek-Coder-V2** | ⚠️ Limited | No dedicated parser | API supports it; self-hosted requires custom work |
| **DeepSeek-Chat (API)** | ✅ Yes | N/A (API only) | `deepseek-chat` model via API supports function calling |

### Key Finding: DeepSeek R1-0528 Added Tool Calling
The R1-0528 update explicitly lists "enhanced support for function calling" as a feature. Benchmark results confirm this:
- **BFCL_v3_MultiTurn:** 37.0% accuracy
- **Tau-Bench:** 53.5% (Airline) / 63.9% (Retail)

These benchmarks were not available for the original R1 — tool calling was added in the 0528 revision.

---

## Required vLLM Flags & Configuration

### DeepSeek-V3-0324
```bash
vllm serve deepseek-ai/DeepSeek-V3-0324 \
  --enable-auto-tool-choice \
  --tool-call-parser deepseek_v3 \
  --chat-template examples/tool_chat_template_deepseekv3.jinja
```

### DeepSeek-R1-0528
```bash
vllm serve deepseek-ai/DeepSeek-R1-0528 \
  --enable-auto-tool-choice \
  --tool-call-parser deepseek_v3 \
  --chat-template examples/tool_chat_template_deepseekr1.jinja
```
> **Note:** Uses the `deepseek_v3` parser but a **different chat template** (`deepseekr1.jinja` vs `deepseekv3.jinja`).

### DeepSeek-V3.1
```bash
vllm serve deepseek-ai/DeepSeek-V3.1 \
  --enable-auto-tool-choice \
  --tool-call-parser deepseek_v31 \
  --chat-template examples/tool_chat_template_deepseekv31.jinja
```

### Mandatory Flags (all DeepSeek models)
- `--enable-auto-tool-choice` — Required for automatic tool selection
- `--tool-call-parser <parser>` — Must match model family
- `--chat-template <template>` — Model-specific jinja template required

---

## Known Issues & Limitations

1. **No parser for older DeepSeek models** — V2, V2.5, and DeepSeek-Coder-V2 have no dedicated vLLM tool parser. Community workarounds exist using `hermes` parser but are unreliable.

2. **R1 original has no tool calling** — Only the 0528 revision added function calling. The original DeepSeek-R1 (January 2025) is reasoning-only.

3. **V3 vs V3.1 parsers are separate** — Do not use `deepseek_v3` parser for V3.1 or vice versa. The output formats differ.

4. **Massive model size** — DeepSeek-V3 (671B MoE) and R1 (671B MoE) require significant infrastructure (multi-node, tensor parallelism). This limits practical self-hosted tool calling to those with substantial GPU resources.

5. **Ongoing vLLM refactoring** — RFC #32713 proposes unifying tool calling/reasoning parsers into a single `Parser` class, which would eventually auto-detect the correct parser based on model. Not yet merged.

6. **DeepSeek API strict mode is beta** — The `strict: true` function calling mode (which guarantees schema compliance) requires the beta base URL (`api.deepseek.com/beta`) and has limited JSON schema type support (no `minLength`, `maxLength`, `minItems`, `maxItems`).

---

## Benchmark Results

### DeepSeek-R1-0528 Tool Use Benchmarks
| Benchmark | Score |
|-----------|-------|
| BFCL_v3_MultiTurn (Acc) | 37.0% |
| Tau-Bench Airline (Pass@1) | 53.5% |
| Tau-Bench Retail (Pass@1) | 63.9% |

No public BFCL or Tau-Bench results are available for DeepSeek-V3-0324 or V3.1 specifically. The original R1 was not benchmarked on tool calling.

### Context: Competitive Landscape
For comparison, leading tool-calling models like GPT-4.1 and Claude score significantly higher on BFCL. DeepSeek R1-0528's 37% on BFCL_v3_MultiTurn suggests **functional but not best-in-class** tool calling — reasonable for agentic workflows but may need prompt engineering for complex multi-tool scenarios.

---

## Best Practices from Community

1. **Always use the correct chat template** — The parser and template must match. Using `deepseekv3.jinja` for R1 or vice versa will produce parsing failures.

2. **For smaller DeepSeek models (distilled):** No tool calling support exists for the distilled R1 variants (1.5B, 7B, 8B, 14B, 32B, 70B). These are reasoning-only distillations.

3. **DeepSeek API is easier for tool calling** — If you don't need self-hosted, the DeepSeek API (`api.deepseek.com`) supports function calling out of the box with OpenAI-compatible format, no special configuration needed.

4. **Use `strict` mode for reliability** — When using the DeepSeek API, enabling `strict: true` on tool definitions ensures valid JSON output at the cost of slight latency.

5. **Consider alternatives for tool-heavy workloads** — If tool calling is the primary use case (not reasoning), Qwen2.5 with `hermes` parser or Llama 3.1+ with `llama3_json` parser may offer better reliability at smaller sizes.

6. **vLLM version matters** — DeepSeek V3/R1 tool parsers are relatively new additions. Ensure you're running vLLM ≥0.8.x for `deepseek_v3` parser support, and the latest for `deepseek_v31`.

---

## Relevance to Our Setup

Our current Hydralisk setup runs **Qwen2.5-32B** models with the `hermes` parser at 100% success rate. DeepSeek models would require:
- Much larger GPU footprint (671B MoE vs 32B)
- Different parser configuration
- Likely lower tool-calling reliability than our current Qwen setup

**Recommendation:** DeepSeek models are not a good fit for our tool-calling workloads given current hardware. Qwen2.5 with hermes parser remains the better choice for our 2x RTX PRO 6000 setup. DeepSeek is better suited for reasoning-heavy tasks where tool calling is secondary.
