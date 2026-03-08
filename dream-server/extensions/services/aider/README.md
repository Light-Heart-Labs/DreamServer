# Aider Extension for Dream Server

## Overview

Aider is AI pair programming in your terminal. It allows you to edit code in your local git repository using natural language instructions, with support for multiple AI models.

## Features

- Edit code using natural language
- Multi-file editing with git awareness
- Integrates with git (commits, diffs, branches)
- Support for OpenAI, Anthropic, and local models
- Code linting and test execution
- Voice coding support (with Piper TTS)

## Usage

### Enable the extension

```bash
dream extensions enable aider
```

### Run Aider

```bash
# Start an interactive session
docker compose run --rm aider

# Edit specific files
docker compose run --rm aider src/main.py src/utils.py

# With a specific model
docker compose run --rm aider --model ollama/llama3 src/
```

## Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `AIDER_MODEL` | Main model (default: openrouter/anthropic/claude-sonnet-4) |
| `AIDER_WEAK_MODEL` | Weak/fast model for simple tasks |
| `AIDER_OPENAI_API_BASE` | Custom OpenAI-compatible endpoint |

### Using with Local Models

To use with Dream Server's local LLM:

```bash
docker compose run --rm aider \
  --model openai/local-model \
  --openai-api-base http://host.docker.internal:8000/v1 \
  src/
```

## Data Persistence

Place your projects in `./data/aider/` to make them available to Aider.

## Integration

Aider works with:
- **Local LLMs** — Via OpenAI-compatible API
- **Git repositories** — Automatic commit management
- **Piper TTS** — Voice coding support

## Uninstall

```bash
dream extensions disable aider
```

Your projects in `./data/aider/` are preserved.

## Documentation

Full docs: <https://aider.chat/docs/>
