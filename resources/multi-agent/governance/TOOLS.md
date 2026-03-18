# Tools & Environment

## Architecture

```
OpenClaw Gateway → vLLM Tool Proxy (:8003) → vLLM (:8000)
```

- **OpenClaw** sends requests with `stream: true` (always)
- **Proxy** forces `stream: false` when tools are present, extracts tool calls,
  re-wraps as SSE stream
- **vLLM** serves the local model with native tool calling

## Key Ports

| Port | Service |
|------|---------|
| 8000 | vLLM direct (don't use for agents — no tool extraction) |
| 8003 | vLLM tool proxy (USE THIS) |
| 18791 | OpenClaw gateway WebSocket |

## Important

- Always point `baseUrl` in openclaw.json to port **8003** (proxy), never 8000
- The proxy handles SSE re-wrapping, tool call extraction, and response cleaning
