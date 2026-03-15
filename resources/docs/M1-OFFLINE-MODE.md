# M1 Offline Mode — Fully Air-Gapped Operation

*Dream Server can run completely offline with no internet dependency.*

## Overview

M1 mode configures Dream Server for fully air-gapped operation:
- **No cloud API calls** — All inference runs locally
- **No telemetry** — Nothing phones home
- **Local RAG** — Qdrant replaces web search
- **GGUF embeddings** — Memory search works without external APIs

## Installation

```bash
# Standard offline install
./install.sh --offline --all

# Offline with specific tier
./install.sh --offline --tier 2 --voice --rag

# Offline + bootstrap (fastest start)
./install.sh --offline --bootstrap --all
```

## What's Included in Offline Mode

| Component | Status | Notes |
|-----------|--------|-------|
| llama-server (local LLM) | ✅ | All inference local |
| Open WebUI | ✅ | Local web interface |
| Whisper STT | ✅ | `--voice` flag |
| Kokoro TTS | ✅ | `--voice` flag |
| Qdrant (RAG) | ✅ | `--rag` flag |
| n8n workflows | ⚠️ | Local execution, but many integrations need internet |
| OpenClaw | ✅ | With local memory_search |

## What's Disabled

- **Web search** — Brave/Perplexity APIs require internet
- **Cloud APIs** — OpenAI, Anthropic keys cleared
- **Telemetry** — All usage tracking disabled
- **Update checks** — No auto-update pings

## Post-Installation

### Verify Offline Operation

```bash
# Check services are running
dream status

# Test LLM (should work offline)
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "local", "messages": [{"role": "user", "content": "Hello"}]}'

# Test memory search (OpenClaw)
# Should use local GGUF embeddings
```

### Full Air-Gap Procedure

1. Complete installation with `--offline` flag
2. Verify all services running: `dream status`
3. Test core functionality while online
4. Disconnect network (unplug ethernet / disable WiFi)
5. Verify services still work

### Reconnecting (Optional)

If you need to reconnect for updates:

```bash
# Temporarily enable internet
# Download model updates
docker compose pull

# Update OpenClaw (if installed)
openclaw update

# Disconnect again for air-gapped operation
```

## Pre-Downloaded Models

Offline mode pre-downloads:
- **LLM** — Based on your tier selection
- **GGUF embeddings** — `nomic-embed-text-v1.5.Q4_K_M.gguf` (~300MB)
- **Whisper** — If `--voice` enabled
- **Piper voices** — If `--voice` enabled

## Replacing Web Search

Since web search requires internet, use local RAG instead:

### Option 1: Pre-Load Knowledge Base

```bash
# Index local documents into Qdrant
curl -X POST http://localhost:6333/collections/knowledge/points \
  -H "Content-Type: application/json" \
  -d '{...your documents...}'
```

### Option 2: Configure OpenClaw for Local RAG

In `config/openclaw/openclaw-m1.yaml`:

```yaml
# Already configured by --offline flag
webSearch:
  enabled: false
  
localRag:
  enabled: true
  qdrantUrl: http://qdrant:6333
  collection: knowledge
```

## Troubleshooting

### Memory Search Not Working

Check GGUF embeddings downloaded:
```bash
ls -la models/embeddings/
# Should see: nomic-embed-text-v1.5.Q4_K_M.gguf
```

### Services Won't Start Without Internet

All images should be pre-pulled during installation. If not:
```bash
# While connected
docker compose pull

# Then disconnect
```

### n8n Workflows Failing

Many n8n integrations require internet (Gmail, Slack, etc.).
Use only local-compatible workflows:
- File operations
- Local API calls
- Database operations
- Webhook receivers (internal)

## Security Benefits

Air-gapped operation provides:
- **Data sovereignty** — Nothing leaves your network
- **Compliance** — Suitable for regulated environments
- **Privacy** — No usage tracking possible
- **Resilience** — Works during internet outages

## Files Created

```
dream-server/
├── .offline-mode              # Marker file
├── .env                       # Updated with offline settings
├── config/
│   └── openclaw/
│       └── openclaw-m1.yaml   # OpenClaw offline config
├── models/
│   └── embeddings/
│       └── nomic-embed-text-v1.5.Q4_K_M.gguf
└── docs/
    └── M1-OFFLINE-MODE.md     # This file
```

---

*Part of M5: Clonable Dream Setup Server*
*Integrates findings from M1: Fully Local OpenClaw*
