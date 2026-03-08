# Microsoft Phi Model Family — Tool Calling Support Report

**Date:** 2026-02-08  
**Research Agent:** Android-18 (subagent)

---

## Executive Summary

Microsoft's Phi model family has **partial and evolving** tool calling support. Only **Phi-4-mini-instruct** has first-class, documented tool/function calling. The base Phi-4 (14B) and Phi-3.x models lack native tool calling support. vLLM added a dedicated `phi4_mini_fc` tool call parser via PR #14886 (merged April 2025).

---

## Model-by-Model Tool Calling Support

| Model | Params | Tool Calling | vLLM Parser | Notes |
|-------|--------|-------------|-------------|-------|
| **Phi-4-mini-instruct** | 3.8B | ✅ Native | `phi4_mini_fc` | Official support, dedicated format |
| **Phi-4** (base) | 14B | ❌ None | N/A | No tool calling in model card or training |
| **Phi-3.5-mini-instruct** | 3.8B | ❌ None | N/A | No function calling mentioned |
| **Phi-3.5-MoE-instruct** | 42B (6.6B active) | ❌ None | N/A | No function calling support |
| **Phi-3-mini-instruct** | 3.8B | ❌ None | N/A | No function calling support |
| **Phi-4-mini-reasoning** | 3.8B | ❓ Unknown | N/A | Reasoning variant, likely no tool use |
| **Phi-4-multimodal-instruct** | — | ❓ Unknown | N/A | Multimodal focus |

---

## Phi-4-mini-instruct: Tool Calling Details

### Native Format

Phi-4-mini uses a custom tool calling format with `<|tool|>` / `<|/tool|>` special tokens:

```
<|system|>You are a helpful assistant with some tools.<|tool|>[{"name": "get_weather_updates", "description": "Fetches weather updates for a given city", "parameters": {"city": {"description": "City name", "type": "str", "default": "London"}}}]<|/tool|><|end|><|user|>What is the weather like in Paris today?<|end|><|assistant|>
```

This is **not** the Hermes format — it's a Phi-specific format.

### vLLM Configuration

**Minimum vLLM version:** 0.7.3 (for basic Phi-4-mini support), but tool calling parser added in ~0.8.x via PR #14886.

```bash
vllm serve microsoft/Phi-4-mini-instruct \
  --enable-auto-tool-choice \
  --tool-call-parser phi4_mini_fc \
  --trust-remote-code
```

**Key flags:**
- `--enable-auto-tool-choice` — Required for auto tool selection
- `--tool-call-parser phi4_mini_fc` — Phi-4-mini specific parser (added PR #14886, April 2025)
- `--trust-remote-code` — Required for Phi-4-mini
- `--chat-template` — Optional; model's built-in template should work

### Requirements
```
flash_attn==2.7.4.post1
torch==2.5.1
vllm>=0.7.3  # minimum, but >=0.8.x recommended for tool calling
```

---

## Known Issues & Limitations

1. **No Phi-3.x tool calling** — Phi-3 and Phi-3.5 models were NOT trained for function calling. Attempting to use them with tool calling parsers (e.g., hermes) will produce unreliable results.

2. **Phi-4 (14B) has no tool calling** — The full-size Phi-4 model does not mention function calling anywhere in its documentation. Only the mini variant was fine-tuned for this.

3. **Custom format, not Hermes** — Phi-4-mini uses its own `<|tool|>` token format, not the standard Hermes `<tool_call>` format. The `hermes` parser will NOT work correctly.

4. **Small model limitations** — At 3.8B parameters, Phi-4-mini has limited capacity for complex multi-tool orchestration. Microsoft notes: "The model simply does not have the capacity to store too much factual knowledge."

5. **Multiple closed vLLM issues** — Several GitHub issues (#18257, #18141, #16109, #11985, #8791) were filed and closed as "not planned," indicating community friction with Phi tool calling in vLLM before the official parser was merged.

6. **Parallel tool calls** — No documentation confirms parallel tool calling support for Phi-4-mini. Likely single-call only given model size.

---

## Benchmark Results

### Phi-4-mini-instruct vs Competitors (from Microsoft)

| Benchmark | Phi-4-mini (3.8B) | Phi-3.5-mini (3.8B) | Qwen2.5-3B | Llama-3.1-8B | GPT-4o-mini |
|-----------|-------------------|---------------------|------------|--------------|-------------|
| MMLU (5-shot) | **67.3** | 65.5 | 65.0 | 68.1 | 77.2 |
| MATH (0-shot) | **64.0** | 49.8 | 61.7 | 47.6 | 70.2 |
| GSM8K (8-shot) | **88.6** | 76.9 | 80.6 | 82.4 | 91.3 |
| BigBench Hard | **70.4** | 63.1 | 56.2 | 63.4 | 80.4 |
| Arena Hard | 32.8 | 34.4 | 32.0 | 25.7 | 53.7 |

**No published function-calling-specific benchmarks** (e.g., BFCL/Berkeley Function Calling Leaderboard) were found for any Phi model. Microsoft's release notes mention "better post-training techniques for function calling" but provide no quantitative tool-use benchmarks.

---

## Best Practices

1. **Use Phi-4-mini-instruct only** — It's the only Phi model with documented, trained tool calling capability.

2. **Use the official vLLM parser** — `--tool-call-parser phi4_mini_fc` (not `hermes`, not `openai`).

3. **Keep tool schemas simple** — Given the 3.8B parameter size, use clear, concise tool descriptions with few parameters.

4. **Single tool at a time** — Don't expect reliable parallel tool calling from a 3.8B model.

5. **Augment with RAG** — Microsoft explicitly recommends augmenting with search engines for factual tasks.

6. **Test thoroughly** — Community reports mixed reliability; validate tool calling accuracy for your specific use case before production deployment.

7. **Consider alternatives** — For serious tool calling workloads, Qwen2.5-series with hermes parser or Llama-3.1+ with llama3_json parser have more mature ecosystems and community validation.

---

## Relevance to Our Setup

Our current cluster runs **Qwen2.5-Coder-32B** and **Qwen2.5-32B** with the `hermes` parser at 100% success rate. Phi-4-mini-instruct (3.8B) would be significantly smaller and less capable for tool calling tasks. It could serve as a **lightweight fallback** or for **edge deployment** scenarios where VRAM is extremely constrained, but is not recommended as a replacement for our current Qwen setup.

---

## Sources

- [Phi-4-mini-instruct Model Card](https://huggingface.co/microsoft/Phi-4-mini-instruct)
- [Phi-4 Model Card](https://huggingface.co/microsoft/phi-4)
- [Phi-3.5-mini-instruct Model Card](https://huggingface.co/microsoft/Phi-3.5-mini-instruct)
- [vLLM Tool Calling Documentation](https://docs.vllm.ai/en/latest/features/tool_calling/)
- [vLLM PR #14886: Phi-4-mini function calling support](https://github.com/vllm-project/vllm/pull/14886)
- [vLLM GitHub Issues: Phi tool calling](https://github.com/vllm-project/vllm/issues?q=phi+tool+calling)
