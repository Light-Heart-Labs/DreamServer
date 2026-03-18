# Dream Server Mode Switch

One-command switching between local, cloud, and hybrid LLM modes.

---

## Quick Start

```bash
# Check current mode
dream mode

# Switch to local mode (llama-server, requires GPU)
dream mode local

# Switch to cloud mode (LiteLLM + API keys, no GPU needed)
dream mode cloud

# Switch to hybrid mode (local primary, cloud fallback)
dream mode hybrid

# Restart to apply
dream restart
```

---

## How It Works

One env var (`LLM_API_URL`) controls where all services send LLM requests. Three modes set this automatically:

| Mode | `LLM_API_URL` | `DREAM_MODE` | LiteLLM config |
|------|---------------|--------------|-----------------|
| **local** | `http://llama-server:8080` | `local` | `config/litellm/local.yaml` |
| **cloud** | `http://litellm:4000` | `cloud` | `config/litellm/cloud.yaml` |
| **hybrid** | `http://litellm:4000` | `hybrid` | `config/litellm/hybrid.yaml` |

All compose files reference `${LLM_API_URL:-http://llama-server:8080}`, so existing installs work without changes.

---

## Modes

### Local Mode (default)
All inference runs on your hardware via llama-server.

| Aspect | Details |
|--------|---------|
| **LLM** | llama-server (GGUF models) |
| **Cost** | $0 (electricity only) |
| **Requires** | GPU or CPU with sufficient RAM |
| **Web Search** | via SearXNG |

```bash
dream mode local
```

### Cloud Mode
LLM requests routed through LiteLLM to cloud APIs.

| Aspect | Details |
|--------|---------|
| **LLM** | Claude, GPT-4o via LiteLLM |
| **Cost** | ~$0.003-0.06/1K tokens |
| **Requires** | Internet, API keys |
| **GPU** | Not needed |

```bash
dream mode cloud
```

**Required .env variables:**
```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

### Hybrid Mode
Local llama-server as primary, cloud APIs as fallback via LiteLLM.

| Aspect | Details |
|--------|---------|
| **LLM** | Local first, cloud on failure |
| **Cost** | $0 normally, cloud rates on fallback |
| **Requires** | GPU + API keys (recommended) |

```bash
dream mode hybrid
```

---

## .env Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DREAM_MODE` | `local` | Active mode: `local`, `cloud`, or `hybrid` |
| `LLM_API_URL` | `http://llama-server:8080` | Where services send LLM requests |
| `ANTHROPIC_API_KEY` | *(empty)* | Anthropic API key (cloud/hybrid) |
| `OPENAI_API_KEY` | *(empty)* | OpenAI API key (cloud/hybrid) |
| `TOGETHER_API_KEY` | *(empty)* | Together AI API key (optional) |

---

## Installer: `--cloud` Flag

Install in cloud mode (skips GPU detection and model download):

```bash
./install-core.sh --cloud
```

This sets `DREAM_MODE=cloud`, `LLM_API_URL=http://litellm:4000`, and auto-enables the LiteLLM extension.

---

## Model Management

```bash
# Show current model
dream model current

# List available tiers
dream model list

# Swap to a different tier
dream model swap T3
```

---

## Architecture

### Local Mode
```
User -> Open WebUI -> llama-server (local) -> Response
```

### Cloud Mode
```
User -> Open WebUI -> LiteLLM -> Cloud APIs (Claude/GPT-4o)
```

### Hybrid Mode
```
User -> Open WebUI -> LiteLLM -> llama-server (local) -> Response
                                      |
                                 [On timeout/error]
                                      |
                                 Cloud APIs (fallback)
```

---

## Files

| File | Purpose |
|------|---------|
| `config/litellm/local.yaml` | LiteLLM config for local mode |
| `config/litellm/cloud.yaml` | LiteLLM config for cloud mode |
| `config/litellm/hybrid.yaml` | LiteLLM config for hybrid mode |
| `scripts/mode-switch.sh` | Backend script for mode switching |
| `.env` | Stores `DREAM_MODE`, `LLM_API_URL`, API keys |

---

## Data Safety

**All modes share the same data volumes:**
- `./data/open-webui/` -- Conversations, users
- `./data/qdrant/` -- Vector database
- `./data/models/` -- Downloaded GGUF models

**Switching modes preserves all data.** Only the LLM routing changes.

---

## Mode Comparison

| Feature | Local | Cloud | Hybrid |
|---------|-------|-------|--------|
| Internet required | No | Yes | Yes (for fallback) |
| API keys required | No | Yes | Recommended |
| GPU required | Yes | No | Yes |
| Response quality | Good | Best | Best of both |
| Cost | $0 | $$$ | $0 or $$$ |
| Privacy | 100% local | Data to cloud | Local unless fallback |

---

## CLI Reference

```bash
# Mode commands
dream mode              # Show current mode
dream mode local        # Switch to local mode
dream mode cloud        # Switch to cloud mode
dream mode hybrid       # Switch to hybrid mode

# Model commands
dream model current     # Show current model
dream model list        # List available tiers
dream model swap T2     # Switch model tier

# Shorthand
dream m local           # Shorthand for mode local
```

---

## Troubleshooting

### Cloud mode: "No API keys found"
```bash
# Add your API keys to .env
dream config edit
# Add: ANTHROPIC_API_KEY=sk-ant-...
dream restart
```

### Local mode: llama-server won't start
```bash
# Check GPU status
nvidia-smi
# Check model is downloaded
ls -la data/models/*.gguf
# Check logs
dream logs llama-server
```

### Mode switch not taking effect
```bash
# Verify .env
grep DREAM_MODE .env
grep LLM_API_URL .env
# Restart all services
dream restart
```

---

## Rollback

If anything breaks, restore default behavior:
```bash
dream mode local
dream restart
```

Or manually edit `.env`:
```bash
DREAM_MODE=local
LLM_API_URL=http://llama-server:8080
```
