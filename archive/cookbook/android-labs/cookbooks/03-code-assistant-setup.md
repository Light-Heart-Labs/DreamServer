# Recipe 3: Local Code Assistant

*Local AI Cookbook | 2026-02-09*

A practical guide for setting up a local code assistant using Qwen2.5-Coder via vLLM.

---

## Components

| Component | Purpose | Model |
|-----------|---------|-------|
| **vLLM** | Inference server | Qwen2.5-Coder-32B-AWQ |
| **Tool calling** | File ops, shell commands | Hermes parser |
| **Integration** | IDE, CLI, API | VS Code, Continue, etc. |

---

## Hardware Requirements

| Model Size | GPU | VRAM | Notes |
|------------|-----|------|-------|
| 7B | RTX 3060 12GB | ~6GB | Good for simple tasks |
| 14B | RTX 4070 12GB | ~8GB | Balanced |
| 32B AWQ | RTX 4090 24GB | ~18GB | Best quality |
| 32B AWQ | RTX 6000 48GB | ~18GB | Production with headroom |

**Recommendation:** Qwen2.5-Coder-32B-AWQ on RTX 4090 for best quality/cost balance.

---

## vLLM Configuration

### Start the server

```bash
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-Coder-32B-Instruct-AWQ \
  --quantization awq \
  --dtype float16 \
  --gpu-memory-utilization 0.9 \
  --max-model-len 32768 \
  --enable-auto-tool-choice \
  --tool-call-parser hermes \
  --port 8000
```

**Light Heart Cluster:** Coder model available at `192.168.0.122:8000`

### Key flags explained

| Flag | Purpose |
|------|---------|
| `--quantization awq` | 4-bit quantization, reduces VRAM |
| `--max-model-len 32768` | Context window size |
| `--enable-auto-tool-choice` | Enable function calling |
| `--tool-call-parser hermes` | Parser for tool calls (critical!) |

---

## Tool Calling Setup

### Define tools in OpenAI format

```python
tools = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read contents of a file",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "File path"}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write contents to a file",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"}
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Execute a shell command",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string"}
                },
                "required": ["command"]
            }
        }
    }
]
```

### Execute tool calls

```python
from openai import OpenAI
import subprocess
import json

# Light Heart Cluster: use 192.168.0.122:8000 for Coder model
client = OpenAI(base_url="http://localhost:8000/v1", api_key="none")

def execute_tool(tool_call):
    name = tool_call.function.name
    args = json.loads(tool_call.function.arguments)
    
    if name == "read_file":
        with open(args["path"], "r") as f:
            return f.read()
    elif name == "write_file":
        with open(args["path"], "w") as f:
            f.write(args["content"])
        return "File written successfully"
    elif name == "run_command":
        result = subprocess.run(args["command"], shell=True, capture_output=True)
        return result.stdout.decode()

# Use in conversation loop
response = client.chat.completions.create(
    model="Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
    messages=[{"role": "user", "content": "Read main.py and add error handling"}],
    tools=tools
)

if response.choices[0].message.tool_calls:
    for tool_call in response.choices[0].message.tool_calls:
        result = execute_tool(tool_call)
        # Continue conversation with tool result...
```

---

## Context Window Management

### For large codebases

1. **Selective inclusion:** Only include relevant files
2. **Summarization:** Summarize large files
3. **Chunking:** Process in segments

```python
def get_codebase_context(paths, max_tokens=16000):
    context = []
    total_tokens = 0
    
    for path in paths:
        with open(path, "r") as f:
            content = f.read()
        
        # Rough token estimate (4 chars per token)
        tokens = len(content) // 4
        
        if total_tokens + tokens < max_tokens:
            context.append(f"# {path}\n```\n{content}\n```")
            total_tokens += tokens
        else:
            # Summarize or truncate
            context.append(f"# {path} (truncated)\n```\n{content[:2000]}...\n```")
    
    return "\n\n".join(context)
```

---

## Prompt Engineering for Code

### System prompt template

```
You are an expert software engineer. You have access to tools for reading files, writing files, and running commands.

When asked to modify code:
1. First read the relevant files
2. Understand the existing structure
3. Make minimal, targeted changes
4. Test your changes if possible
5. Explain what you changed and why

Always write clean, well-documented code that follows best practices.
```

### Effective prompts

| Task | Prompt Style |
|------|--------------|
| Bug fix | "Fix the bug in X where Y happens instead of Z" |
| Feature | "Add a feature that does X. It should work like Y." |
| Refactor | "Refactor X to use Y pattern. Keep behavior identical." |
| Review | "Review this code for issues: security, performance, style" |

---

## Performance: Local vs Cloud

| Metric | Local (32B AWQ) | Cloud (GPT-4) |
|--------|-----------------|---------------|
| Latency (first token) | 200-500ms | 500-2000ms |
| Throughput | ~30 tok/s | ~50 tok/s |
| Privacy | ✅ Complete | ❌ Data leaves |
| Cost | $0 per query | $0.03-0.06/1K tokens |
| Availability | 100% | Depends on API |

**Bottom line:** Local wins on privacy and cost; cloud wins on peak quality for complex tasks.

---

## Integration Options

### VS Code (Continue extension)
```json
// .continue/config.json
{
  "models": [{
    "title": "Local Qwen Coder",
    "provider": "openai",
    "model": "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
    "apiBase": "http://localhost:8000/v1"
  }]
}
```

### CLI wrapper
```bash
#!/bin/bash
# code-assist.sh
curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"Qwen/Qwen2.5-Coder-32B-Instruct-AWQ\", \"messages\": [{\"role\": \"user\", \"content\": \"$1\"}]}" \
  | jq -r '.choices[0].message.content'
```

---

*This recipe is part of the Local AI Cookbook — practical guides for self-hosted AI systems.*
