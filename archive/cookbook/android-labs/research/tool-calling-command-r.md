# Command-R Model Family: Tool Calling Support Report

**Date:** 2026-02-08  
**Researcher:** Android-18 (subagent)

## Executive Summary

Cohere's Command-R family has **strong native tool calling support** via the Cohere API, but **no official vLLM tool call parser exists** as of vLLM v0.15.1. Using Command-R models for tool calling with vLLM requires workarounds.

---

## 1. Which Command-R Models Support Tool Calling

| Model | Tool Calling | Multi-Step | Parallel Calls | Notes |
|-------|-------------|------------|----------------|-------|
| **Command-A (03-2025)** | ✅ Native | ✅ | ✅ | Latest, recommended by Cohere docs |
| **Command R+ (104B)** | ✅ Native | ✅ Multi-step tool use | ✅ | Open weights (CC-BY-NC), 128K context |
| **Command R (35B)** | ✅ Native | ✅ | ✅ | Smaller companion model |
| **Command R+ 08-2024** | ✅ Native | ✅ | ✅ | Updated release |
| **Command R 08-2024** | ✅ Native | ✅ | ✅ | Updated release |

All Command-R family models support tool use natively through Cohere's API. Tool use is a **core training objective** — these models are specifically fine-tuned for RAG, grounded generation, and multi-step tool use.

### Key Capabilities (via Cohere API)
- **Function calling** with OpenAI-compatible tool schema
- **Multi-step tool use** — model chains multiple tools across turns
- **Parallel tool calling** — multiple tool calls in a single response
- **Citation generation** — grounded responses with source citations
- **Tool plan generation** — model explains its reasoning before calling tools

---

## 2. vLLM Support Status

### ⚠️ No Official Tool Call Parser

As of vLLM v0.15.1 (stable), **Command-R / Cohere models are NOT listed** in the supported tool calling parsers. The officially supported parsers are:

| Parser | Models |
|--------|--------|
| `hermes` | Nous Hermes, Qwen2.5, Granite 4.0 |
| `mistral` | Mistral models |
| `llama3_json` | Llama 3.1/3.2/4 |
| `jamba` | AI21 Jamba |
| `internlm` | InternLM 2.5 |
| `xlam` | Salesforce xLAM |
| `deepseek_v3` | DeepSeek V3, R1 |
| `openai` | OpenAI OSS models |
| `pythonic` | Various (Llama 3.2, ToolACE) |

### Potential Workarounds

1. **Hermes parser** — Command-R uses its own tool format (not Hermes-style), so this is **unlikely to work directly**. Command-R has a unique chat template with `<|START_OF_TURN_TOKEN|>` style tokens and its own tool calling format.

2. **Custom tool parser plugin** — vLLM supports `--tool-parser-plugin` for custom parsers. You could write a Cohere-specific parser that handles Command-R's native tool output format.

3. **Custom chat template** — Provide a Jinja2 chat template that formats tools in Command-R's expected format and parse the output accordingly.

4. **Named function calling (structured outputs)** — vLLM's `tool_choice={"type": "function", "function": {"name": "..."}}` uses structured outputs and works with any model, but doesn't support `tool_choice="auto"`.

### Required vLLM Flags (if attempting workaround)

```bash
vllm serve CohereForAI/c4ai-command-r-plus \
  --enable-auto-tool-choice \
  --tool-call-parser hermes \  # or custom parser
  --chat-template /path/to/custom_cohere_tool_template.jinja \
  --tensor-parallel-size 4 \   # 104B needs multi-GPU
  --max-model-len 32768
```

**Note:** This is speculative — no confirmed community reports of reliable tool calling with Command-R on vLLM.

---

## 3. Known Issues and Limitations

### vLLM-Specific
- **No native parser:** The biggest limitation. Command-R's tool format differs from Hermes/Llama/Mistral formats.
- **Model size:** Command R+ is 104B parameters — requires significant GPU resources even quantized.
- **Chat template compatibility:** Command-R's tokenizer uses special tokens (`<|START_OF_TURN_TOKEN|>`, `<|CHATBOT_TOKEN|>`, etc.) that differ from other model families.
- **GitHub issues exist** (several open/closed issues mentioning Command-R + tool on vLLM repo) but no merged dedicated parser as of Feb 2026.

### General Command-R Limitations
- **License:** CC-BY-NC — not usable for commercial deployments without Cohere's commercial API.
- **Grounded generation format:** Command-R's tool output includes citation spans and document relevance predictions — richer but more complex to parse than standard function calling.
- **Tool schema:** Uses OpenAI-compatible schema via Cohere API v2, but the underlying prompt format for self-hosted models is Cohere-proprietary.

---

## 4. Benchmark Results

### Berkeley Function Calling Leaderboard (BFCL)
The BFCL V4 leaderboard evaluates tool/function calling. As of Feb 2026, Cohere models are **not prominently featured** on the public leaderboard (which is dominated by GPT-4, Claude, Llama, and xLAM models). The leaderboard data is dynamic and JS-rendered, so exact scores weren't extractable.

### Cohere's Self-Reported Performance
From Cohere's documentation and model cards:
- Command R+ achieves **74.6 average** on Open LLM Leaderboard (Arc, HellaSwag, MMLU, TruthfulQA, Winogrande, GSM8k)
- Cohere notes these benchmarks **don't capture RAG, multilingual, or tooling performance** which they consider Command R+'s strongest areas
- No public tool-calling-specific benchmark scores published by Cohere

### Community Sentiment
- Command-R models are generally regarded as **strong for RAG and grounded generation**
- Tool calling quality is considered **good via Cohere's API** but **uncertain for self-hosted vLLM deployments**
- Most community tool-calling benchmarks focus on Llama, Qwen, and Mistral families

---

## 5. Best Practices from Community

### If Using Cohere API (Recommended Path)
1. Use **Command-A (03-2025)** or **Command R+** for best tool calling
2. Follow the v2 API with OpenAI-compatible tool schema
3. Return tool results as **document objects** (not plain strings) for citation support
4. Use descriptive tool names and parameter descriptions — quality matters
5. Leverage **tool_plan** field to understand model reasoning
6. Support **multi-turn tool use** — model may need multiple rounds

### If Self-Hosting on vLLM
1. **Consider alternatives first:** Qwen2.5-32B with `hermes` parser has proven 100% success rate for tool calling on vLLM (per our own TOOLS.md)
2. If Command-R is required, plan to **write a custom tool parser plugin**
3. Use the model's built-in chat template from `tokenizer_config.json` as a starting point
4. Test with `tool_choice="required"` (structured outputs) before attempting `tool_choice="auto"`
5. Monitor vLLM GitHub for future Cohere parser contributions

### Architecture Considerations
- Command R+ (104B) needs **~52GB+ VRAM** even with AWQ quantization — not practical for single consumer GPUs
- Command R (35B) is more feasible at ~18-20GB quantized
- For our GPU cluster setup: Qwen2.5 models are the better choice for tool calling workloads

---

## 6. Recommendation for Our Setup

**Do not use Command-R for tool calling on vLLM.** The lack of a native parser makes it unreliable. Our current Qwen2.5-Coder-32B and Qwen2.5-32B setup with `hermes` parser is the proven, reliable path for self-hosted tool calling.

If Cohere tool calling is needed, use the **Cohere API** directly rather than self-hosting.

---

## Sources
- [vLLM Tool Calling Documentation](https://docs.vllm.ai/en/stable/features/tool_calling/)
- [Cohere Tool Use Documentation](https://docs.cohere.com/docs/tool-use-overview)
- [Command R+ Model Card (HuggingFace)](https://huggingface.co/CohereLabs/c4ai-command-r-plus)
- [Berkeley Function Calling Leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html)
- vLLM GitHub Issues (command-r + tool search)
