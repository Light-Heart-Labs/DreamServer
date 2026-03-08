# Mistral/Mixtral Tool Calling Support Report

**Date:** 2026-02-08  
**Sources:** vLLM docs, Mistral AI docs, Berkeley Function Calling Leaderboard

---

## 1. Which Models Support Tool Calling

### Mistral AI Official Models (via API)

**General Models:**
- Mistral Large 3 (`mistral-large-latest`)
- Mistral Medium 3.1 (`mistral-medium-latest`)
- Mistral Small 3.2 (`mistral-small-latest`)
- Mistral Small Creative (`labs-mistral-small-creative`)
- Ministral 3 14B (`ministral-14b-latest`)
- Ministral 3 8B (`ministral-8b-latest`)
- Ministral 3 3B (`ministral-3b-latest`)

**Specialized Models:**
- Devstral 2.0 (`devstral-latest`)
- Devstral Small 2 (`devstral-small-latest`)
- Voxtral Small (`voxtral-small-latest`)
- Codestral (`codestral-latest`)

**Reasoning Models:**
- Magistral Medium 1.2 (`magistral-medium-latest`)
- Magistral Small 1.2 (`magistral-small-latest`)

### Open-Weight Models (via vLLM)

- **mistralai/Mistral-7B-Instruct-v0.3** — confirmed working with `mistral` parser
- Additional Mistral function-calling models are listed as compatible
- **Mixtral models** — not explicitly listed in vLLM's supported parsers; the `mistral` parser should work for Mixtral-8x7B-Instruct-v0.1 and 8x22B but this is less tested

---

## 2. Required vLLM Flags/Config

### Core Flags (Required for Auto Tool Choice)

```bash
--enable-auto-tool-choice        # Mandatory for auto tool calling
--tool-call-parser mistral       # Use the Mistral-specific parser
```

### Format Options

**Option A: Official Mistral format (default)**
```bash
vllm serve mistralai/Mistral-7B-Instruct-v0.3 \
  --tokenizer_mode mistral \
  --config_format mistral \
  --load_format mistral \
  --enable-auto-tool-choice \
  --tool-call-parser mistral
```
Uses `mistral-common` tokenizer backend.

**Option B: Transformers/HuggingFace format**
```bash
vllm serve mistralai/Mistral-7B-Instruct-v0.3 \
  --tokenizer_mode hf \
  --config_format hf \
  --load_format hf \
  --enable-auto-tool-choice \
  --tool-call-parser mistral \
  --chat-template examples/tool_chat_template_mistral_parallel.jinja
```

### Chat Templates (provided by vLLM)

| Template | Description |
|----------|-------------|
| `tool_chat_template_mistral.jinja` | Official Mistral template, tweaked for vLLM tool call IDs (truncated to 9 digits) |
| `tool_chat_template_mistral_parallel.jinja` | Better version with tool-use system prompt; much better reliability for parallel tool calls |

### tool_choice Options

- `"auto"` — model decides whether to call tools (default)
- `"required"` — forces at least one tool call (vLLM ≥ 0.8.3)
- `"none"` — no tool calls generated
- `{"type": "function", "function": {"name": "..."}}` — named function calling

---

## 3. Known Issues and Limitations

### Mistral 7B Specific
- **Parallel tool calls are unreliable.** Mistral 7B struggles to generate multiple tool calls correctly in a single response.
- Use `tool_chat_template_mistral_parallel.jinja` for best parallel calling results.

### Tool Call ID Mismatch (Transformers backend only)
- Mistral's `tokenizer_config.json` requires tool call IDs that are **exactly 9 digits**
- vLLM generates longer IDs by default → causes exceptions
- **Fix:** Use the provided modified jinja templates which truncate IDs to 9 digits

### Mixtral (MoE) Models
- Not explicitly listed in vLLM's confirmed supported models for the `mistral` parser
- Community reports suggest Mixtral-8x7B-Instruct works but with less reliability than dedicated smaller models
- Mixtral-8x22B has better tool calling quality than 8x7B

### General vLLM Limitations
- Named function calling uses structured outputs backend → **first call has multi-second latency** while FSM compiles (cached after)
- `tool_choice='none'` still includes tool definitions in prompt unless `--exclude-tools-when-tool-choice-none` is set

---

## 4. Benchmark Results

### Berkeley Function Calling Leaderboard (BFCL V4)
The BFCL evaluates LLMs on function/tool calling accuracy across categories: simple, multiple, parallel, parallel-multiple, and multi-turn interactions.

**Key notes:**
- The leaderboard is dynamically rendered (JavaScript) so exact scores couldn't be extracted via fetch
- Mistral Large models generally rank in the **upper-mid tier** on BFCL
- Mistral Small/7B models rank lower, especially on parallel tool calling
- Top performers are typically GPT-4o, Claude 3.5, and Gemini models
- Among open-weight models, Mistral Large competes well but Qwen2.5 and Llama 3.1 70B+ tend to outperform on tool calling specifically

### Mistral's Own Claims
- Mistral AI positions their function calling as production-ready across their model lineup
- Supports: sequential, successive, and parallel function calling patterns
- `tool_choice` values: `"auto"`, `"any"` (forces tool use), `"none"`
- `parallel_tool_calls`: true/false control

---

## 5. Best Practices

### For vLLM Deployment
1. **Use the `mistral` parser** — not `hermes` — for Mistral-family models
2. **Use the parallel jinja template** (`tool_chat_template_mistral_parallel.jinja`) even for single tool calls — it includes a better system prompt
3. **Prefer official Mistral format** (`--tokenizer_mode mistral`) when available; fall back to HF format for quantized/community variants
4. **Avoid parallel tool calls on 7B models** — they're unreliable; use sequential calling instead
5. **For Mixtral MoE models**, test thoroughly before production — less community validation than dense models

### For API Usage (Mistral API)
1. Always provide clear function descriptions and parameter schemas
2. Use `tool_choice: "any"` when you know a tool call is needed (avoids the model deciding not to call)
3. Set `parallel_tool_calls: false` if you need deterministic sequential execution
4. Include a system prompt guiding tool usage behavior

### Model Selection for Tool Calling
| Use Case | Recommended Model | Notes |
|----------|-------------------|-------|
| Production (API) | Mistral Large 3 | Best tool calling quality |
| Cost-effective (API) | Mistral Small 3.2 | Good balance |
| Self-hosted (single GPU) | Mistral-7B-Instruct-v0.3 | Works but limited parallel calls |
| Self-hosted (multi-GPU) | Mixtral-8x22B-Instruct | Better quality than 8x7B |
| Coding + tools | Devstral / Codestral | Specialized for code tasks |

### Comparison with Our Current Setup
Our cluster currently runs **Qwen2.5 models with the `hermes` parser** at 100% success rate. Switching to Mistral would require:
- Changing parser from `hermes` → `mistral`
- Adding custom chat templates
- Accepting potential regression on parallel tool calls (especially at 7B/8x7B scale)
- **Recommendation: Stick with Qwen2.5 for tool calling unless Mistral Large-class models are needed for other capabilities**

---

## Sources
- vLLM Tool Calling Documentation: https://docs.vllm.ai/en/latest/features/tool_calling/
- Mistral AI Function Calling Docs: https://docs.mistral.ai/capabilities/function_calling/
- Berkeley Function Calling Leaderboard: https://gorilla.cs.berkeley.edu/leaderboard.html
