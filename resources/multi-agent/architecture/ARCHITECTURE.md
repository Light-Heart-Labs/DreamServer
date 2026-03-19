# Architecture — How It All Fits Together

> **Scope:** This document covers the internal architecture of the vLLM Tool Call Proxy. For the architecture of the full multi-agent system this proxy serves, see [COLLECTIVE.md](../COLLECTIVE.md). For transferable patterns applicable to any agent framework, see [PATTERNS.md](PATTERNS.md).

## The Problem

OpenClaw can't talk directly to vLLM for tool-calling tasks because of three
incompatibilities:

1. **OpenClaw always streams** (`stream: true`) — this is hardcoded in its
   internal LLM communication layer, not configurable
2. **Tool call extraction requires the full response** — you can't parse JSON
   tool calls from a stream of chunks
3. **vLLM returns extra fields** that OpenClaw doesn't expect, causing parse errors

## The Solution: Tool Call Proxy

A lightweight Flask proxy sits between OpenClaw and vLLM, fixing all three
issues transparently:

```
OpenClaw (stream: true)
    ↓
Tool Call Proxy (:8003)
    │
    ├─ Has tools? → Force stream: false
    │                    ↓
    │               Forward to vLLM (non-streaming)
    │                    ↓
    │               Extract tool calls from text
    │                    ↓
    │               Clean response fields
    │                    ↓
    │               Re-wrap as SSE stream → back to OpenClaw
    │
    └─ No tools? → Pure streaming passthrough → vLLM → OpenClaw
```

## Request Flow (Detailed)

```
1. OpenClaw sends:     POST /v1/chat/completions
                        {stream: true, tools: [...], messages: [...]}

2. Proxy checks:       Has tools? Yes → force stream: false
                        (saves original was_streaming = true)

3. Proxy strips:       stream_options (vLLM rejects this when stream=false)

4. Proxy checks:       Tool call count in messages > 500? → abort

5. Proxy forwards:     POST to vLLM:8000/v1/chat/completions
                        {stream: false, tools: [...], messages: [...]}

6. vLLM responds:      {choices: [{message: {content: "..."}}]}

7. Proxy extracts:     Parses tool calls from content → tool_calls array
                        Cleans remaining text content

8. Proxy cleans:       Strips vLLM-specific fields

9. Proxy re-wraps:     Converts JSON → SSE chunks:
                        data: {"choices":[{"delta":{"role":"assistant"}}]}
                        data: {"choices":[{"delta":{"content":"..."}}]}
                        data: {"choices":[{"delta":{"tool_calls":[...]}}]}
                        data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
                        data: [DONE]

10. OpenClaw receives: Proper SSE stream with structured tool calls
```

## Tool Call Extraction

Models may output tool calls in several formats. The proxy handles all of them:

### Format 1: `<tools>` tags
```
<tools>
{"name": "read", "arguments": {"path": "/tmp/test.txt"}}
</tools>
```

### Format 2: Bare JSON
```
{"name": "exec", "arguments": {"command": "ls -la"}}
```

### Format 3: Multi-line JSON
```
{"name": "write", "arguments": {"path": "/tmp/a.txt", "content": "hello"}}
{"name": "write", "arguments": {"path": "/tmp/b.txt", "content": "world"}}
```

Models with native tool calling (like Qwen3-Coder-Next with `qwen3_coder`
parser) will usually produce proper `tool_calls` format directly, making the
extraction a safety net rather than the primary path.

## OpenClaw Config Resolution

OpenClaw reads config in this order:

1. `~/.openclaw/openclaw.json` — your config (source of truth)
2. `~/.openclaw/agents/main/agent/models.json` — auto-generated cache
3. Built-in defaults in the OpenAI SDK layer

**Important:** When changing `openclaw.json`, always delete the models cache:
```bash
rm -f ~/.openclaw/agents/main/agent/models.json
```

## The `compat` Block

The most critical part of the config. OpenClaw's internal LLM layer
auto-detects compatibility settings from the provider URL. For unknown
providers (like vLLM), it defaults to settings that break:

| Setting | Default (wrong) | Override (correct) |
|---------|-----------------|-------------------|
| `supportsStore` | `true` → sends `store: false` | `false` → omits it |
| `maxTokensField` | `"max_completion_tokens"` | `"max_tokens"` |
| `supportsDeveloperRole` | `true` | `false` |

Without the compat overrides, vLLM silently rejects the extra parameters and
you get mysterious failures.

## Session Storage

OpenClaw stores conversations as JSONL files:
```
~/.openclaw/agents/main/sessions/*.jsonl
```

Each line is a JSON object with types: `session`, `model_change`, `message`,
`tool_result`. Session files grow over time; monitoring their size is how the
session watchdog knows when context is getting full.

## Gateway Architecture

The OpenClaw gateway is a long-running Node.js process:

```
systemd (user service)
  └─ openclaw-gateway
       ├─ Gateway WebSocket server (ws://0.0.0.0:18791)
       ├─ Agent runner
       │    ├─ Model via vLLM proxy
       │    └─ Built-in tools (file ops, exec, etc.)
       ├─ Discord plugin (optional)
       ├─ Cron scheduler (optional)
       └─ Canvas host
```
