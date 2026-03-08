# vLLM Tool Calling Research Summary

## 1. Tool Calling Formats Supported

vLLM supports **OpenAI-compatible function calling** through its `/v1/chat/completions` API:

- **Named function calling** (default): Specify exact tool via `tool_choice={"type": "function", "function": {"name": "xyz"}}`
- **Automatic tool choice** (`tool_choice="auto"`): Model decides when to use tools
- **Required tool** (`tool_choice="required"`, vLLM >= 0.8.3): Forces at least one tool call
- **None** (`tool_choice="none"`): Disables tool calling even if tools provided

Supports standard OpenAI format with `tools`, `tool_choice`, and returns `tool_calls` array with `id`, `type`, `function.name`, and `function.arguments`.

## 2. Configuration

Enable tool calling at server startup with flags:

```bash
# Basic auto tool choice
vllm serve meta-llama/Llama-3.1-8B-Instruct \
  --enable-auto-tool-choice \
  --tool-call-parser llama3_json \
  --chat-template examples/tool_chat_template_llama3.1_json.jinja
```

**Key flags:**
- `--enable-auto-tool-choice` - Required for automatic tool selection
- `--tool-call-parser <parser>` - Parser for model's tool format
- `--chat-template <path>` - Custom template handling tool messages (optional for some models)
- `--tool-parser-plugin <path>` - Load custom parser plugins

**Note:** Named/required calling uses structured outputs backend - first call has latency overhead (FSM compilation).

## 3. Best Models for Tool Calling

| Model Family | Parser | Notes |
|--------------|--------|-------|
| **Llama 3.1/3.2/4** | `llama3_json` | Most stable; parallel calls supported in 3.2+ and 4.x |
| **Hermes 2 Pro / Hermes 3** | `hermes` | Excellent tool reliability |
| **Qwen 2.5** | `hermes` | Good tool support via Hermes-style templates |
| **Mistral 7B** | `mistral` | Use parallel template for better results |
| **IBM Granite 3.x/4.x** | `granite` | Solid for function calling |
| **OpenAI gpt-oss** | `openai` | Newer option |
| **DeepSeek-V3/V3.1** | `deepseek_v3` | Requires custom templates |

**Avoid:** Smaller models (<7B) struggle with tool calling consistency (e.g., Llama 3.2 1B/3B).

## 4. Limitations & Gotchas

- **Latency on first tool call**: Named/required tool choice compiles FSM on first use → several seconds delay (cached afterward)
- **Parallel tool calls**: Not supported for Llama 3.1 (works in 3.2+, 4.x, Hermes, Granite)
- **Chat templates matter**: Some models need custom templates for vLLM compatibility (especially Mistral, Llama 3.2)
- **Quality vs parseability**: vLLM guarantees *parseable* output via structured outputs, not necessarily *high-quality* tool calls
- **Tool call IDs**: Mistral requires 9-digit IDs (shorter than vLLM default) - templates provided handle this
- **Llama 3.2 small models**: Often fail to emit tool calls correctly
- **JSON format issues**: Models may serialize arrays as strings instead of proper JSON

## Quick Reference

```python
# Client example (OpenAI SDK)
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8000/v1", api_key="dummy")

response = client.chat.completions.create(
    model="model-name",
    messages=[{"role": "user", "content": "Weather in SF?"}],
    tools=[tools_def],
    tool_choice="auto"
)
```

**Template location:** `examples/tool_chat_template_*.jinja` in vLLM repo
