# Dream Server Post-Install Checklist

Use this checklist after installation to confirm core and optional services are running and reachable. Default ports are in `.env.example`; override in `.env` if you changed them during install.

## Quick health check

From the **dream-server directory** (install path, e.g. `~/dream-server`):

```bash
# Comprehensive health check (exit 0=healthy, 1=degraded, 2=critical)
./scripts/health-check.sh

# JSON output for scripting
./scripts/health-check.sh --json

# Quiet (exit code only)
./scripts/health-check.sh --quiet
```

Exit codes: **0** = all checked services healthy, **1** = degraded (some optional down), **2** = critical (core services down).

## Core services (default ports)

| Service        | Default URL                  | Check |
|----------------|------------------------------|-------|
| Open WebUI     | http://localhost:3000        | [ ] Open in browser; log in or create admin. |
| Dashboard      | http://localhost:3001        | [ ] Open; verify status and links. |
| LLM API        | http://localhost:8080/v1    | [ ] `curl http://localhost:8080/v1/models` or use Chat UI. |
| llama-server   | (same as LLM API)            | [ ] Verify container: `docker ps \| grep llama` or `dream status`. |

Override ports via `.env` (e.g. `WEBUI_PORT`, `OLLAMA_PORT` or `LLAMA_SERVER_PORT`). See `.env.example` for all port variables.

## Optional services (if enabled)

| Service   | Default URL                   | Check |
|-----------|-------------------------------|-------|
| n8n       | http://localhost:5678         | [ ] Workflows UI loads. |
| Qdrant    | http://localhost:6333         | [ ] RAG/vector store if you enabled RAG. |
| Whisper   | http://localhost:9000/health | [ ] STT if you enabled voice. |
| TTS       | http://localhost:8880/health  | [ ] TTS if you enabled voice. |
| ComfyUI   | http://localhost:8188         | [ ] Image gen if you enabled images. |
| Perplexica | http://localhost:3004        | [ ] Deep research UI if enabled. |
| OpenClaw  | http://localhost:7860         | [ ] Agent if enabled. |

## llama-server (LLM)

- [ ] Verify llama-server is running (`dream status` or `docker ps`).
- [ ] Check logs for errors: `docker logs dream-llama-server` (or container name from your compose).
- [ ] Test from Chat UI: send a short message and confirm a reply.
- [ ] Optional: `curl -s http://localhost:8080/v1/models` shows the loaded model.

## Whisper (if enabled)

- [ ] Verify Whisper container is running.
- [ ] Check Whisper logs for any errors.
- [ ] Test with sample audio via Chat UI voice input or a script calling the Whisper API.

## TTS (if enabled)

- [ ] Verify TTS container is running.
- [ ] Check TTS logs for any errors.
- [ ] Test TTS with sample text (Chat UI or API).

## OpenClaw (if enabled)

- [ ] Verify OpenClaw is running.
- [ ] Check OpenClaw logs for any errors.
- [ ] Test basic functionality (agent reply or tool use).

## Config and extension validation

- [ ] Run `./dream-cli config validate` to check `.env` and extension manifest compatibility.
- [ ] From repo: `bash scripts/validate-manifests.sh` to see compatibility summary for all extensions.

## Dream CLI

- [ ] `./dream-cli status` — overall status.
- [ ] `./dream-cli list` — enabled services and ports.
- [ ] `./dream-cli config validate` — env and manifest validation.

For troubleshooting, see [INSTALL-TROUBLESHOOTING.md](INSTALL-TROUBLESHOOTING.md) and [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
