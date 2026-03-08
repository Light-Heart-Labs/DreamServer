# Qwen Model Family: Tool Calling Support Report

**Date:** 2026-02-08  
**Sources:** Qwen official docs, vLLM docs, HuggingFace model cards, BFCL leaderboard, our operational experience

---

## 1. Which Qwen Models Support Tool Calling

### Fully Supported (Instruct variants)
| Model | Params | Tool Calling | Notes |
|-------|--------|-------------|-------|
| Qwen2.5-Instruct (all sizes) | 0.5B–72B | ✅ | Hermes-style template built into tokenizer |
| Qwen2.5-Coder-Instruct (all sizes) | 1.5B–32B | ✅ | Same Hermes template; coding-optimized |
| Qwen3 (all sizes) | Various | ✅ | Latest; official docs recommend Hermes-style |
| Qwen3-Coder | Various | ✅ | Coding-specialized Qwen3 |
| Qwen2.5-32B-Instruct-AWQ | 32B | ✅ | Quantized; works identically |
| Qwen2.5-Coder-32B-Instruct-AWQ | 32B | ✅ | Quantized; works identically |

### Not Supported
- **Base models** (non-Instruct) — no tool calling template
- **Qwen2 and older** — different template format, less reliable

### Key Insight
All Qwen2.5+ Instruct models share the same Hermes-style tool calling template embedded in `tokenizer_config.json`. There is **no functional difference** between Coder and non-Coder variants for tool calling mechanics — both use identical templates. The difference is in the model's underlying capabilities (Coder is better at code generation within tool responses).

---

## 2. Required vLLM Flags & Configuration

### Mandatory Flags
```bash
vllm serve Qwen/Qwen2.5-32B-Instruct-AWQ \
  --enable-auto-tool-choice \
  --tool-call-parser hermes
```

### Flag Reference
| Flag | Required | Purpose |
|------|----------|---------|
| `--enable-auto-tool-choice` | **Yes** | Enables model to autonomously decide when to call tools |
| `--tool-call-parser hermes` | **Yes** | Parses Hermes-format `<tool_call>` blocks from model output |
| `--chat-template` | **No** | Qwen2.5+ has tool template in tokenizer_config.json already |

### Important Notes
- **Use `hermes` parser, NOT `openai`** — This is critical. The `openai` parser does not match Qwen's output format.
- No custom `--chat-template` needed for Qwen2.5+ models; the built-in template handles tool-role messages correctly.
- For Qwen3 reasoning models, vLLM also supports the thinking/no-thinking modes via `chat_template_kwargs`.

### vLLM `tool_choice` Options
| Value | Support | Behavior |
|-------|---------|----------|
| `"auto"` | ✅ | Model decides whether to call tools |
| `"required"` | ✅ (vLLM ≥0.8.3) | Forces at least one tool call |
| `"none"` | ✅ | No tool calls even if tools defined |
| `{"type":"function","function":{"name":"..."}}` | ✅ | Forces specific named function (uses structured output backend) |

---

## 3. Known Issues & Limitations

### vLLM-Specific
- **First named function call is slow**: When using `tool_choice` with a specific function name, vLLM compiles an FSM for structured output on first call. Expect several seconds of latency; subsequent calls are cached.
- **vLLM version matters**: Our .122 node runs v0.15.1, .143 runs v0.14.0. Both work with hermes parser. Older versions (<0.6) may lack full tool calling support.
- **Parallel tool calls**: Qwen2.5 supports generating multiple tool calls in a single response. The hermes parser handles this correctly.

### Model-Specific
- **Qwen3 thinking mode + tool calling**: For reasoning models (Qwen3), Qwen official docs warn against using stopword-based templates (like ReAct) because the model may output stopwords in the thinking section. Hermes template avoids this issue.
- **Quantized models (AWQ/GPTQ)**: No degradation in tool calling quality observed with AWQ quantization. Both AWQ models on our cluster achieve 100% success rate with proper templates.
- **Context window**: Tool definitions consume tokens. With many tools, effective context for user content shrinks. Qwen2.5-32B supports 32K (configurable to 128K with YaRN).

### Common Pitfalls
1. Using `--tool-call-parser openai` instead of `hermes` → tool calls not parsed
2. Forgetting `--enable-auto-tool-choice` → tools passed but model never calls them
3. Not including tool results in conversation history → model can't process multi-turn tool use
4. Providing poor tool descriptions → model picks wrong tools or generates bad arguments

---

## 4. Benchmark Results

### Berkeley Function Calling Leaderboard (BFCL)
The BFCL v4 evaluates tool calling across categories: simple, multiple, parallel, multi-turn, and agentic scenarios.

**Qwen2.5 performance** (approximate, from community reports):
- Qwen2.5-72B-Instruct scores in the **top tier of open-source models** on BFCL
- Qwen2.5-32B-Instruct performs competitively, typically within 2-5% of the 72B variant
- Qwen2.5-Coder-32B-Instruct shows **similar tool calling scores** to the general 32B model (tool calling is template-driven, not heavily affected by coding specialization)

### Qwen's Own Reported Benchmarks
From the Qwen2.5 blog:
- **Significant improvements** in structured output generation (especially JSON) over Qwen2
- Enhanced instruction following for function calling scenarios
- Better handling of system prompts and condition-setting

### Our Operational Results (Hydralisk Cluster)
- **100% success rate** with proper task templates on both Qwen2.5-Coder-32B-AWQ (.122) and Qwen2.5-32B-AWQ (.143)
- Hermes parser confirmed working on both vLLM v0.14.0 and v0.15.1
- 6-8 concurrent agents per GPU without degradation

---

## 5. Best Practices

### Configuration
1. **Always use `hermes` parser** for any Qwen2.5/Qwen3 model
2. **No custom chat template needed** — the built-in tokenizer template works
3. **Set `--gpu-memory-utilization 0.9`** for AWQ models (~20GB VRAM each)
4. **Use chunked prefill** (`--max-num-batched-tokens 8192`) for better concurrent throughput

### Tool Design
1. **Write clear, specific tool descriptions** — the model relies heavily on these
2. **Use JSON Schema properly** — include `required` fields, `enum` constraints, and `description` for each parameter
3. **Keep tool count reasonable** — fewer, well-described tools outperform many vague ones
4. **Include context in user messages** — e.g., current date, user location, session state

### Multi-Turn Tool Use
1. Always append tool results back to the conversation as `{"role": "tool", "content": "..."}` messages
2. The model can chain multiple tool calls across turns
3. For parallel tool calls, the model generates multiple `<tool_call>` blocks in a single response

### Qwen3 Specific
1. **Hermes-style recommended** over ReAct for tool calling (official recommendation)
2. For thinking models, control thinking with `chat_template_kwargs: {"enable_thinking": false}` to reduce latency when thinking isn't needed
3. Use `qwen-agent` library for the canonical function calling implementation

### Our Proven Launch Commands
```bash
# Coder model (.122)
vllm serve Qwen/Qwen2.5-Coder-32B-Instruct-AWQ \
  --enable-auto-tool-choice \
  --tool-call-parser hermes \
  --gpu-memory-utilization 0.9 \
  --max-model-len 32768 \
  --enable-chunked-prefill \
  --max-num-batched-tokens 8192

# General model (.143)
vllm serve Qwen/Qwen2.5-32B-Instruct-AWQ \
  --enable-auto-tool-choice \
  --tool-call-parser hermes \
  --gpu-memory-utilization 0.9 \
  --max-model-len 32768 \
  --enable-chunked-prefill \
  --max-num-batched-tokens 8192
```

---

## 6. Qwen2.5-Coder vs Qwen2.5: Tool Calling Differences

**TL;DR: No meaningful difference in tool calling capability.**

| Aspect | Qwen2.5-Instruct | Qwen2.5-Coder-Instruct |
|--------|-------------------|------------------------|
| Tool calling template | Hermes (identical) | Hermes (identical) |
| Tool parser in vLLM | `hermes` | `hermes` |
| Tool call format | `<tool_call>` blocks | `<tool_call>` blocks |
| Parallel tool calls | ✅ | ✅ |
| Quality of tool arguments | Good | Good (slightly better JSON structure) |
| Best use case | General agents, research | Coding agents, code-generation tools |

The Coder variant may produce slightly better-structured JSON in tool arguments due to its code training, but both are equally reliable for tool calling in practice. Choose based on downstream task requirements, not tool calling ability.

---

## Summary

Qwen2.5+ models are excellent for tool calling with vLLM. The critical configuration is simple: `--enable-auto-tool-choice --tool-call-parser hermes`. Both general and Coder variants work identically for tool mechanics. AWQ quantization does not degrade tool calling quality. Our cluster validates this with 100% success rates across both nodes.
