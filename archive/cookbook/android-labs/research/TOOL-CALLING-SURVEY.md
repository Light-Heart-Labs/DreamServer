# Local LLM Tool Calling Survey

**Date:** 2026-02-08  
**Authors:** Android-17 + Android-18 (6-agent swarm)  
**Purpose:** Survey current state of tool calling across local LLM families for OpenClaw integration

---

## Executive Summary

| Model Family | Tool Calling | vLLM Parser | Maturity |
|--------------|--------------|-------------|----------|
| **Qwen 2.5+** | ✅ Excellent | `hermes` | Production-ready |
| **Llama 3.1+** | ✅ Good | `llama3_json` | Production-ready |
| **Mistral** | ✅ Good | `mistral` | Production-ready |
| **DeepSeek V3/R1** | ✅ Good | `deepseek_v3` | Production-ready |
| **Phi-4-mini** | ⚠️ Limited | `phi4_mini_fc` | New, small model only |
| **Command-R** | ⚠️ Limited | None | No vLLM parser |

**Recommendation:** For local OpenClaw, **Qwen 2.5** is the best choice — it's what we're running, battle-tested, and has the simplest configuration.

---

## Quick Reference: vLLM Configurations

### Qwen 2.5 (Our Current Setup)
```bash
vllm serve Qwen/Qwen2.5-32B-Instruct-AWQ \
  --enable-auto-tool-choice \
  --tool-call-parser hermes
```

### Llama 3.1/3.2
```bash
vllm serve meta-llama/Llama-3.1-8B-Instruct \
  --enable-auto-tool-choice \
  --tool-call-parser llama3_json \
  --chat-template examples/tool_chat_template_llama3.1_json.jinja
```

### Mistral
```bash
vllm serve mistralai/Mistral-7B-Instruct-v0.3 \
  --enable-auto-tool-choice \
  --tool-call-parser mistral
```

### DeepSeek V3
```bash
vllm serve deepseek-ai/DeepSeek-V3-0324 \
  --enable-auto-tool-choice \
  --tool-call-parser deepseek_v3 \
  --chat-template examples/tool_chat_template_deepseekv3.jinja
```

---

## Model Deep Dives

### Qwen 2.5 (★★★★★)

**Why it's best for local OpenClaw:**
- Hermes template built into tokenizer — no custom templates needed
- AWQ quantization works identically to full precision
- Both Coder and non-Coder variants use same tool format
- Extensive testing in our environment (93%+ success rate with proxy fix)

**Supported models:** All Qwen2.5-Instruct variants (0.5B–72B), including Coder

**Critical finding:** Use `hermes` parser, NOT `openai`. The openai parser doesn't match Qwen's output format.

### Llama 3.1+ (★★★★☆)

**Strengths:**
- First Llama with native tool calling training
- Supports JSON and Pythonic formats
- 8B version is very capable for its size

**Caveats:**
- Requires custom chat template file
- Two built-in tools (Brave Search, Wolfram) may interfere
- Llama 3.0 and earlier have NO tool support

**Community alternatives:** Hermes-3-Llama-3.1 models use `hermes` parser for better compatibility

### Mistral (★★★★☆)

**Strengths:**
- Strong tool calling across model sizes
- Native parser support in vLLM

**Caveats:**
- Mixtral MoE models less tested
- Some format options (tool_ids) may require newer vLLM versions

### DeepSeek V3/R1 (★★★★☆)

**Key finding:** DeepSeek R1-0528 added tool calling (original R1 had none)

**Strengths:**
- Dedicated vLLM parsers for V3 and V3.1
- Strong benchmark performance

**Caveats:**
- Large model sizes (670B for V3)
- V2/V2.5 have limited support
- Requires custom jinja templates

### Phi-4 (★★☆☆☆)

**Limited support:**
- Only Phi-4-mini-instruct (3.8B) has tool calling
- Phi-4 base (14B) and Phi-3.x have NO support
- Custom format (not Hermes)

**Use case:** Edge deployment where 3.8B is acceptable

### Command-R (★★☆☆☆)

**Problem:** No vLLM parser exists

Despite excellent tool calling via Cohere API, self-hosted Command-R requires workarounds:
- Custom jinja templates
- Manual output parsing
- Unreliable compared to parsed alternatives

---

## Common Pitfalls

### 1. Wrong Parser
Using `openai` parser with Qwen = silent failure. Model outputs tool calls as plain text.

### 2. Missing `--enable-auto-tool-choice`
Without this flag, model cannot autonomously decide to call tools.

### 3. Missing Chat Templates
Llama and DeepSeek require explicit `--chat-template` flags pointing to jinja files.

### 4. tool_choice Bug (Our Fix)
vLLM's handling of `tool_choice: "auto"` is broken with structured outputs. Our tool proxy patches it to `"required"`.

---

## Recommendations for Mission 1 (Fully Local OpenClaw)

1. **Stick with Qwen 2.5** — It works, it's tested, configuration is minimal
2. **Llama 3.1 as backup** — Good alternative if Qwen licensing is a concern
3. **Avoid Command-R locally** — Great model but no vLLM parser support
4. **Watch DeepSeek** — V3/R1 are capable but require large VRAM

---

## Sources

- Individual model reports: `research/tool-calling-*.md`
- vLLM documentation
- Berkeley Function Calling Leaderboard (BFCL)
- Model cards on HuggingFace
- Our operational experience (2026-02-06 through 2026-02-08)
