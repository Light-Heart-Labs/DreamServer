# Dream Server Extension Catalog

This catalog lists all **bundled extensions** (services) that ship with Dream Server. Each extension has a `manifest.yaml` that declares its id, ports, health endpoint, and **version compatibility** (`compatibility.dream_min` / `dream_max`) so they work seamlessly for the Dream Server version you are on.

For adding or authoring extensions, see [EXTENSIONS.md](../docs/EXTENSIONS.md) and [schema/README.md](schema/README.md).

## Catalog overview

| Service ID      | Name                     | Category    | Default port | GPU backends   | Description |
|-----------------|--------------------------|------------|-------------|----------------|-------------|
| llama-server    | llama-server (LLM)       | core       | 8080        | amd, nvidia    | Main LLM inference API (Ollama-compatible). |
| open-webui      | Open WebUI (Chat)        | core       | 3000        | amd, nvidia    | Chat UI; talks to llama-server. |
| dashboard       | Dashboard (Control Center) | core     | 3001        | amd, nvidia    | Control center and status. |
| dashboard-api   | Dashboard API            | core       | 3002        | amd, nvidia    | Backend API for the dashboard. |
| litellm         | LiteLLM (API Gateway)   | recommended | 4000       | amd, nvidia    | Unified API gateway for multiple backends. |
| searxng         | SearXNG (Web Search)     | recommended | 8888      | amd, nvidia    | Metasearch for web. |
| token-spy       | Token Spy (Usage Monitor) | recommended | 3005     | amd, nvidia    | Token and usage monitoring. |
| n8n             | n8n (Workflows)          | optional   | 5678        | amd, nvidia    | Workflow automation. |
| qdrant          | Qdrant (Vector DB)       | optional   | 6333        | amd, nvidia    | Vector store for RAG. |
| whisper         | Whisper (STT)            | optional   | 9000        | amd, nvidia    | Speech-to-text. |
| tts             | Kokoro (TTS)             | optional   | 8880        | amd, nvidia    | Text-to-speech. |
| comfyui         | ComfyUI (Image Gen)      | optional   | 8188        | amd, nvidia    | Image generation (e.g. FLUX). |
| openclaw        | OpenClaw (Agents)        | optional   | 7860        | amd, nvidia    | Agent with tools. |
| perplexica      | Perplexica (Deep Research) | optional | 3004        | amd, nvidia    | Deep research UI. |
| embeddings      | TEI (Embeddings)        | optional   | 8090        | amd, nvidia    | Text embeddings for RAG. |
| privacy-shield  | Privacy Shield           | optional   | 8085        | amd, nvidia    | PII detection and protection. |
| opencode        | OpenCode (IDE)           | optional   | 3003        | amd, nvidia    | In-browser IDE integration. |

## Categories

- **core** — Always part of the base stack (llama-server, open-webui, dashboard, dashboard-api).
- **recommended** — Enabled by default in the installer; can be disabled (litellm, searxng, token-spy).
- **optional** — User opts in during install or later (n8n, qdrant, whisper, tts, comfyui, openclaw, perplexica, embeddings, privacy-shield, opencode).

## Ports and .env

Each service’s external port can be overridden in `.env` via the `external_port_env` field in its manifest (e.g. `WEBUI_PORT`, `OLLAMA_PORT`/`LLAMA_SERVER_PORT`). Defaults are in the table above and in `.env.example`.

The installer (phase 04) checks that these ports are free before proceeding. The service registry (`lib/service-registry.sh`) and scripts like `health-check.sh` use these ports for health checks and URLs.

## Version compatibility

All bundled extensions declare `compatibility.dream_min: "2.0.0"` (or equivalent) so that:

- `scripts/validate-manifests.sh` and `dream config validate` can report whether each extension is compatible with the current Dream Server version.
- Future core releases can enforce or warn when an extension’s `dream_min` is newer than the installed core, or when `dream_max` is older.

See [schema/README.md](schema/README.md) for the manifest schema and compatibility block.

## Where manifests live

```
extensions/services/
  open-webui/manifest.yaml
  llama-server/manifest.yaml
  dashboard/manifest.yaml
  dashboard-api/manifest.yaml
  n8n/manifest.yaml
  qdrant/manifest.yaml
  whisper/manifest.yaml
  tts/manifest.yaml
  comfyui/manifest.yaml
  openclaw/manifest.yaml
  perplexica/manifest.yaml
  embeddings/manifest.yaml
  litellm/manifest.yaml
  searxng/manifest.yaml
  token-spy/manifest.yaml
  privacy-shield/manifest.yaml
  opencode/manifest.yaml
```

Each directory typically also has a `compose.yaml` (and optional overlay like `compose.nvidia.yaml`). The resolver `scripts/resolve-compose-stack.sh` builds the full compose command from enabled extensions and the selected GPU backend.

## Enabling and disabling

- **During install:** Phase 03 (features) lets you enable optional features; the installer enables the corresponding extensions.
- **After install:** Use `dream-cli` (e.g. `dream enable n8n`, `dream disable comfyui`) or enable/disable by renaming `compose.yaml` to `compose.yaml.disabled` (and back) in the service directory under the install path.

The service registry only loads manifests for extensions that are “enabled” (compose file present), so disabled extensions do not appear in `sr_list_enabled` or port checks.
