# n8n

Workflow automation platform for Dream Server

## Overview

n8n is a visual workflow automation platform that connects Dream Server's AI capabilities to external services and APIs. It runs at `http://localhost:5678` and is pre-integrated with llama-server for LLM-powered automations. The Dream Server dashboard can install and manage curated workflow templates directly into n8n.

## Features

- **Visual workflow editor**: Drag-and-drop node-based automation builder
- **400+ integrations**: HTTP requests, webhooks, databases, cloud services, messaging apps
- **LLM tool use**: Connect local LLM (llama-server) as an AI agent within workflows
- **Dashboard integration**: Install pre-built workflows from the Dream Server workflow catalog
- **Webhook triggers**: Expose local automations as HTTP endpoints
- **Scheduled runs**: Cron-based workflow scheduling
- **Persistent storage**: Workflow definitions and execution history in `data/n8n/`

## Configuration

Environment variables (set in `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `N8N_USER` | `admin` | Admin username (required) |
| `N8N_PASS` | *(required)* | Admin password — set before first start |
| `N8N_PORT` | `5678` | External port (maps to internal 5678) |
| `N8N_AUTH` | `true` | Enable basic authentication |
| `N8N_HOST` | `localhost` | Hostname used in generated URLs |
| `N8N_WEBHOOK_URL` | `http://localhost:5678` | Public webhook base URL (set to your LAN IP for external access) |
| `TIMEZONE` | `UTC` | Timezone for scheduled workflows |

## API

n8n exposes its own REST API at `/api/v1/`. The Dream Server Dashboard API uses this to manage workflows programmatically.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Health check |
| `GET` | `/api/v1/workflows` | List all workflows |
| `POST` | `/api/v1/workflows` | Create/import a workflow |
| `PATCH` | `/api/v1/workflows/{id}` | Update a workflow (e.g. activate) |
| `DELETE` | `/api/v1/workflows/{id}` | Delete a workflow |
| `GET` | `/api/v1/executions` | List execution history |

## Dashboard Workflow Catalog

The Dream Server dashboard provides a curated catalog of workflow templates at `/api/workflows`. Templates are stored in `config/n8n/` as JSON files and can be installed with one click from the Workflows page.

```bash
# Check available workflows via dashboard API
curl http://localhost:3002/api/workflows

# Install a workflow
curl -X POST http://localhost:3002/api/workflows/my-workflow-id/enable
```

## Data Persistence

| Path (host) | Mounted at (container) | Contents |
|-------------|------------------------|----------|
| `data/n8n/` | `/home/node/.n8n` | Workflows, credentials, execution history |
| `config/n8n/` | `/home/node/workflows` | Pre-built workflow templates |

## LLM Integration

To connect n8n to the local LLM, add an HTTP Request node pointing to llama-server:

- **URL**: `http://llama-server:8080/v1/chat/completions`
- **Method**: POST
- **Auth**: None (internal network)

Or use LiteLLM as a unified gateway (requires `LITELLM_KEY`):

- **URL**: `http://litellm:4000/v1/chat/completions`
- **Header**: `Authorization: Bearer YOUR_LITELLM_KEY`

## Files

- `compose.yaml` — Service definition
- `manifest.yaml` — Service metadata and feature definitions

## Troubleshooting

**Service not starting:**
```bash
docker compose ps n8n
docker compose logs n8n
```

**Cannot log in:**
- Verify `N8N_USER` and `N8N_PASS` are set in `.env`
- Credentials are read on first start; to change them, update `.env` and recreate the container: `docker compose up -d --force-recreate n8n`

**Webhooks not receiving external traffic:**
- Set `N8N_WEBHOOK_URL` to your machine's LAN IP (e.g. `http://192.168.1.100:5678`)
- Ensure port 5678 is accessible on your firewall

**Workflow import failing via dashboard:**
- Confirm n8n is healthy: `curl http://localhost:5678/healthz`
- Check dashboard-api logs: `docker compose logs dashboard-api`

**File permission errors on startup:**
- n8n runs as `UID:GID` set in `.env` (default `1000:1000`)
- Ensure `data/n8n/` is owned by that user: `chown -R 1000:1000 dream-server/data/n8n`

## License

Part of Dream Server — Local AI Infrastructure
