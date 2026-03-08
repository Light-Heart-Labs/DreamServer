# Ollama Extension for Dream Server

## Overview

Ollama is a simple way to run open-source LLMs locally. This extension provides a dedicated Ollama instance integrated with Dream Server's stack.

## Features

- Runs Ollama with GPU acceleration (NVIDIA/AMD)
- Pre-configured model: `llama3` (default)
- Persistent storage for downloaded models
- Health endpoint at `/api/health`

## Usage

### Enable the extension

```bash
dream extensions enable ollama
```

### Load a different model

Edit `.env` and set:

```
OLLAMA_MODEL=llama3:70b
```

Then restart:

```bash
docker compose down ollama && docker compose up -d ollama
```

### API endpoint

```
http://localhost:${OLLAMA_PORT:-11434}/api/generate
http://localhost:${OLLAMA_PORT:-11434}/api/chat
```

## Integration

Ollama works with:
- **Open WebUI** — Use as the LLM backend
- **LiteLLM** — Route requests through LiteLLM proxy
- **n8n workflows** — Trigger LLM generations via webhook

## Uninstall

```bash
dream extensions disable ollama
```

This removes the container and stops the service. Your downloaded models in `./data/ollama/` are preserved.
