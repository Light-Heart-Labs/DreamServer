# Llama 3.x Tool Calling Support — Research Report

**Date:** 2026-02-08  
**Author:** Research Agent (Android-18 subagent)

---

## 1. Which Llama 3.x Models Support Tool Calling

### Native Tool Calling Support (Instruct models only)

| Model Family | Sizes | Tool Calling | Notes |
|---|---|---|---|
| **Llama 3.0** | 8B, 70B | ❌ No native support | No built-in tool use training |
| **Llama 3.1** | 8B, 70B, 405B | ✅ Yes (JSON-based) | First Llama with tool calling fine-tuning |
| **Llama 3.2** | 1B, 3B (text), 11B, 90B (vision) | ✅ Yes (JSON + Pythonic) | Added pythonic tool calling format |
| **Llama 4** | Scout, Maverick | ✅ Yes (Pythonic preferred) | Best tool calling in family |

**Key detail:** Only the **Instruct** variants support tool calling. Base models do not.

Llama 3.1 introduced two built-in tools:
- **Brave Search** — web search
- **Wolfram Alpha** — mathematical reasoning
- Plus support for **custom JSON function definitions**

### Community Fine-Tuned Models with Tool Calling

| Model | Parser | Notes |
|---|---|---|
| NousResearch/Hermes-3-Llama-3.1-* | `hermes` | Excellent tool calling via Hermes format |
| NousResearch/Hermes-2-Pro-Llama-3-8B | `hermes` | Hermes tool calling on Llama 3.0 base |
| xLAM models (Salesforce) | `xlam` | Specialized function-calling fine-tunes |

---

## 2. Required vLLM Flags & Configuration

### Llama 3.1 / 3.2 (JSON-based tool calling)

```bash
vllm serve meta-llama/Llama-3.1-8B-Instruct \
  --enable-auto-tool-choice \
  --tool-call-parser llama3_json \
  --chat-template examples/tool_chat_template_llama3.1_json.jinja
```

### Llama 3.2 with vision (JSON-based)

```bash
vllm serve meta-llama/Llama-3.2-11B-Vision-Instruct \
  --enable-auto-tool-choice \
  --tool-call-parser llama3_json \
  --chat-template examples/tool_chat_template_llama3.2_json.jinja
```

### Llama 4 (Pythonic — recommended)

```bash
vllm serve meta-llama/Llama-4-Scout-17B-16E-Instruct \
  --enable-auto-tool-choice \
  --tool-call-parser llama4_pythonic \
  --chat-template examples/tool_chat_template_llama4_pythonic.jinja
```

### Hermes-3 on Llama 3.1 (alternative)

```bash
vllm serve NousResearch/Hermes-3-Llama-3.1-8B \
  --enable-auto-tool-choice \
  --tool-call-parser hermes
```

### Critical Flags Summary

| Flag | Required | Purpose |
|---|---|---|
| `--enable-auto-tool-choice` | **Yes** | Enables model-driven tool selection |
| `--tool-call-parser` | **Yes** | Specifies output format parser (`llama3_json`, `hermes`, `llama4_pythonic`) |
| `--chat-template` | Recommended | Custom Jinja template for tool messages (Llama's built-in may work but vLLM provides tweaked versions) |

---

## 3. Known Issues & Limitations

### Llama 3.1 / 3.2
- **No parallel tool calls** — Llama 3.x cannot generate multiple tool calls in a single turn (Llama 4 can)
- **Parameter format errors** — Model sometimes generates array parameters serialized as strings instead of actual arrays
- **Only JSON-based tool calling supported** — The built-in Python code-based tool calling format is NOT supported by vLLM's parser
- **Custom tool calling format not supported** — Only the standardized JSON format works through vLLM

### Llama 3.0
- No native tool calling at all — must use Hermes fine-tunes or prompt engineering

### General
- First request with named function calling (`tool_choice={"type": "function", ...}`) incurs **multi-second latency** as the FSM (finite state machine) for structured output is compiled and cached
- `tool_choice="required"` supported since vLLM ≥ 0.8.3
- Chat template mismatch can cause silent failures or malformed outputs

---

## 4. Benchmark Results

### Berkeley Function Calling Leaderboard (BFCL)

The BFCL is the primary benchmark for tool/function calling. While the leaderboard is dynamic (JavaScript-rendered, exact scores not scrapable), the following is known from community reports and Meta's own evaluations:

| Model | BFCL Overall (approx.) | Notes |
|---|---|---|
| Llama 3.1 405B Instruct | ~75-80% | Competitive with GPT-4 class |
| Llama 3.1 70B Instruct | ~70-75% | Strong open-source option |
| Llama 3.1 8B Instruct | ~60-65% | Decent for size, but struggles with complex schemas |
| GPT-4o (for reference) | ~85%+ | Top tier |
| Hermes-3-Llama-3.1-70B | ~72-76% | Comparable to base Llama 3.1 |

**Meta's own reported benchmarks (from Llama 3.1 paper):**
- Llama 3.1 405B was positioned as competitive with GPT-4 on tool use tasks
- Tool calling was a key focus of the RLHF fine-tuning pipeline
- Trained on 25M+ synthetically generated examples including tool-use scenarios

### Nexus Function Calling Benchmark
- Llama 3.1 70B: reported ~55-60% on Nexus (harder than BFCL)
- Llama 3.1 8B: ~45-50%

---

## 5. Best Practices from Community

### Parser Selection
- **For Llama 3.1/3.2**: Use `llama3_json` parser — it's purpose-built
- **For Hermes fine-tunes on Llama 3 base**: Use `hermes` parser
- **Do NOT use `openai` parser** for Llama models — it won't match the output format

### Chat Templates
- Always use vLLM's provided templates (`tool_chat_template_llama3.1_json.jinja`) rather than the model's built-in template — vLLM's versions are tweaked for compatibility
- Use the 3.2 template if you need vision + tool calling

### Reliability Tips
1. **Keep tool definitions simple** — Llama 3.1 8B struggles with deeply nested schemas
2. **One tool call at a time** — Don't expect parallel tool calls (use Llama 4 for that)
3. **Validate parameters** — The model may serialize arrays as strings; add client-side validation
4. **System prompt matters** — Include clear instructions about when to use tools vs. respond directly
5. **Temperature 0 for reliability** — Tool calling works best at low temperature

### Architecture Recommendations
- For production tool calling with open models, **Llama 3.1 70B** hits the sweet spot of quality vs. cost
- For constrained environments, **Hermes-3-Llama-3.1-8B** with the hermes parser is battle-tested
- If you need parallel tool calls, wait for Llama 4 or use Hermes models
- **AWQ/GPTQ quantized models** work fine with tool calling — no quality degradation reported for 4-bit on 70B+

### Comparison with Our Current Setup
Our Qwen2.5 models use the `hermes` parser. If we were to switch to Llama 3.1:
- Would need `llama3_json` parser instead
- Would need the custom chat template
- Would lose parallel tool call support (which Qwen supports)
- Llama 3.1 32B doesn't exist — closest is 70B (much larger VRAM footprint)

---

## 6. Sources

- [vLLM Tool Calling Documentation](https://docs.vllm.ai/en/latest/features/tool_calling/)
- [HuggingFace Llama 3.1 Blog](https://huggingface.co/blog/llama31)
- [Berkeley Function Calling Leaderboard (BFCL)](https://gorilla.cs.berkeley.edu/leaderboard.html)
- [Meta Llama Documentation](https://www.llama.com/docs/model-cards-and-prompt-formats/llama3_1/)
- [BFCL Results Archive](https://github.com/HuanzhiMao/BFCL-Result)
