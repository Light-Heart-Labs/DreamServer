# Token Spy 🔍

**Track every token, every dollar, every LLM call.**

Token Spy is a transparent proxy that sits between your applications and LLM APIs. It logs every request, tracks token usage, and shows real-time cost analytics — without changing your code.

## Features

- **Zero code changes** — Drop-in proxy, just point your API base URL
- **Multi-provider** — OpenAI, Anthropic, any OpenAI-compatible API
- **Real-time dashboard** — Live token counts, costs, and request history
- **Cost tracking** — Per-model pricing with daily aggregates
- **Self-hosted** — Your data stays on your infrastructure

## Quick Start

### Prerequisites

- Docker & Docker Compose
- `make` (optional, for convenience commands)

### 1. Clone and Configure

```bash
cd products/token-spy

# Copy environment template
cp .env.example .env

# Edit with your settings (required: POSTGRES_PASSWORD, DEFAULT_UPSTREAM_URL)
nano .env
```

### 2. Start Services

```bash
# Using make (recommended)
make start

# Or manually
docker compose up -d
```

### 3. Verify Installation

```bash
# Check all services are healthy
make logs

# Or check individual endpoints
curl http://localhost:8080/health    # Proxy health
curl http://localhost:8000/health    # API health
```

### 4. Access the Dashboard

- **Dashboard**: http://localhost:3001
- **Proxy Endpoint**: http://localhost:8080/v1
- **API Docs**: http://localhost:8000/docs

## Usage

Point your LLM client to Token Spy instead of the provider directly:

```python
# Before
client = OpenAI(api_key="sk-...", base_url="https://api.openai.com/v1")

# After — just change the base_url
client = OpenAI(api_key="sk-...", base_url="http://localhost:8080/v1")
```

Token Spy transparently forwards requests and logs everything to TimescaleDB.

## Configuration

Copy `.env.example` to `.env` and set required values:

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_PASSWORD` | ✅ | Database password (generate strong one) |
| `DEFAULT_UPSTREAM_URL` | ✅ | Your LLM API (e.g., `https://api.openai.com/v1`) |
| `DEFAULT_API_KEY` | | API key for upstream (if required) |
| `TOKEN_SPY_PROXY_PORT` | | Proxy port (default: 8080) |
| `TOKEN_SPY_DASHBOARD_PORT` | | Dashboard port (default: 3001) |
| `DASHBOARD_ALLOWED_ORIGINS` | | Dashboard CORS allowlist (CSV or JSON array). Leave empty for secure default (no cross-origin access). |
| `DASHBOARD_CORS_ALLOW_CREDENTIALS` | | Whether CORS allows credentials (default: `true`; requires explicit origins) |

### Dashboard CORS Security

Token Spy dashboard CORS is environment-driven via `DASHBOARD_ALLOWED_ORIGINS`.

- **Secure default (recommended):** leave `DASHBOARD_ALLOWED_ORIGINS` empty to disable cross-origin browser access.
- **Production:** set explicit trusted origins only.
- **Local development override:** set localhost origins as a CSV or JSON array.

Examples:

```bash
# Production
DASHBOARD_ALLOWED_ORIGINS=https://dashboard.example.com

# Local development (CSV)
DASHBOARD_ALLOWED_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Local development (JSON array)
DASHBOARD_ALLOWED_ORIGINS=["http://localhost:3000","http://127.0.0.1:3000"]
```

> ⚠️ Startup validation rejects insecure combinations. If `DASHBOARD_CORS_ALLOW_CREDENTIALS=true`, wildcard `*` is not allowed in `DASHBOARD_ALLOWED_ORIGINS` and the dashboard will fail fast with an error log.

### Generating a Secure Password

```bash
# Linux/macOS
openssl rand -base64 32

# Or use any strong password generator
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Your App    │────▶│ Token Spy   │────▶│ LLM API     │
│             │◀────│ Proxy       │◀────│ (OpenAI etc)│
└─────────────┘     └──────┬──────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │ TimescaleDB │
                    │ (metrics)   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Dashboard   │
                    └─────────────┘
```

**Components:**
- **Proxy** (`:8080`): Transparent LLM API interceptor
- **API** (`:8000`): FastAPI backend for dashboard data
- **Dashboard** (`:3001`): React frontend for analytics
- **TimescaleDB**: Time-series database for metrics
- **Redis**: Caching and rate limiting


## Database Backend Modules

- **Canonical DB layer:** `resources/products/token-spy/sidecar/db_backend.py` is the runtime backend API used by the sidecar (`get_db`, `DatabaseBackend`, pool lifecycle, usage/API/provider/tenant models).
- **Deprecated compatibility module:** `resources/products/token-spy/db_backend.py` is now a thin import-forwarding shim for legacy scripts.
- **Migration status:** new code should import from `sidecar.db_backend`; the top-level module remains only for backward compatibility and will be removed in a future cleanup once downstream scripts are migrated.

## Make Commands

```bash
make setup    # First-time setup (creates .env from template)
make start    # Start all services
make stop     # Stop all services
make restart  # Restart all services
make logs     # View logs
make test     # Run tests
make clean    # Remove containers and volumes
make help     # Show all commands
```

## Troubleshooting

### Services won't start
```bash
# Check for port conflicts
lsof -i :8080  # Proxy port
lsof -i :3001  # Dashboard port
lsof -i :5432  # Database port (if exposing)

# View startup validation
./validate-startup.sh
```

### Database connection errors
- Verify `POSTGRES_PASSWORD` is set in `.env`
- Check TimescaleDB is healthy: `docker compose ps`

### No data showing in dashboard
- Verify proxy is receiving traffic
- Check TimescaleDB has data: `docker compose exec token-spy-db psql -U token_spy -c "SELECT COUNT(*) FROM api_requests;"`

## Supported Providers

- **OpenAI** — GPT-4o, GPT-4, GPT-3.5-turbo, etc.
- **Anthropic** — Claude 3.5 Sonnet, Claude 3 Opus, etc.
- **OpenAI-compatible** — vLLM, Ollama, LocalAI, any OpenAI-format API

Provider-specific pricing is configured in `config/providers.yaml`.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

Apache 2.0 — see [LICENSE](LICENSE).

---

Built by [Light Heart Labs](https://lightheartlabs.com)
