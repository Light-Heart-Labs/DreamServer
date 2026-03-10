# Dream Server — System Architecture

High-level service layout and data flow.

## Service Layout

- **Core:** llama-server, open-webui, dashboard, dashboard-api
- **Optional:** n8n, whisper, tts, comfyui, perplexica, qdrant, openclaw

## Data Flow

```
User → Open WebUI → LiteLLM → llama-server (local)
                         └→ OpenAI/Anthropic (cloud)
```

## Port Map (Default)

| Port | Service |
|------|---------|
| 3000 | Open WebUI |
| 3001 | Dashboard |
| 3002 | Dashboard API |
| 4000 | LiteLLM |
| 8080 | llama-server |

See [TECHNOLOGY.md](../../TECHNOLOGY.md) for full stack.
