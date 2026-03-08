# Token Spy Phase 1 Architecture

**Status:** Implementation Complete  
**Date:** 2026-02-15  
**Owner:** Android-17

---

## Overview

Phase 1 transforms Token Spy from a personal SQLite-based tool into a production-ready, multi-tenant, configuration-driven proxy system backed by TimescaleDB.

---

## Components Delivered

### 1. Provider Plugin System (Configuration-Driven)

**Files:**
- `config/providers.yaml` — Provider definitions, pricing, auth
- `config_loader.py` — Runtime config loader with env var substitution

**Features:**
- YAML-based provider configuration (no code changes for new providers)
- Environment variable substitution (`${VAR:-default}`)
- Built-in adapters: `anthropic_messages`, `openai_chat`
- Pre-configured providers: Anthropic, OpenAI, Moonshot, Groq, DeepSeek, Azure, vLLM
- Custom pricing override support
- Request transformations (role mapping, header injection)

**Usage:**
```yaml
providers:
  my_custom_provider:
    name: "My Provider"
    adapter: openai_chat
    base_url: "https://api.example.com"
    models:
      my-model:
        input: 1.00
        output: 2.00
```

---

### 2. TimescaleDB Migration

**Files:**
- `docker-compose.timescaledb.yml` — Full stack with PostgreSQL/TimescaleDB
- `schema/001_init.sql` — Core tables, hypertables, indexes
- `schema/002_provider_keys.sql` — API keys, provider keys, tenants
- `schema/003_tenant_multitenancy.sql` — Multi-tenancy enhancements
- `migrations/migrate_sqlite_to_timescale.py` — Data migration script

**Architecture:**
```
api_requests (hypertable)
├── Time-series: token usage, cost, latency
├── Indexed: session_id, provider, model, tenant_id
└── Chunked: 1 day intervals

sessions
├── Session lifecycle tracking
└── Tenant-isolated

tenants
├── Multi-tenancy support
├── Plan tiers (free, starter, pro, enterprise)
└── Quota management

api_keys
├── Proxy authentication
├── Rate limiting (RPM, RPD)
├── Budget tracking
└── Provider restrictions

provider_keys
├── Encrypted upstream API keys
├── Per-tenant, per-provider
└── Rotation support
```

**Migration:**
```bash
# Start TimescaleDB stack
docker-compose -f docker-compose.timescaledb.yml up -d

# Migrate existing SQLite data
docker-compose -f docker-compose.timescaledb.yml --profile migrate run migrate-sqlite
```

---

### 3. Multi-Tenancy Architecture

**Tenant Isolation:**
- All queries scoped by `tenant_id`
- API keys map to tenants
- Provider keys are tenant-specific
- Resource quotas per tier

**API Key Format:**
- `tp_live_xxx` — Production keys
- `tp_test_xxx` — Test/sandbox keys
- SHA-256 hashed storage
- First 8 chars visible for display

**Plan Tiers:**
| Tier | API Keys | Provider Keys | Monthly Tokens | Monthly Cost |
|------|----------|---------------|----------------|--------------|
| Free | 2 | 1 | 100K | $10 |
| Starter | 5 | 3 | 1M | $100 |
| Pro | 20 | 10 | 10M | $1,000 |
| Enterprise | Unlimited | Unlimited | Custom | Custom |

---

## Deployment

### Quick Start (New Installation)

```bash
cd products/token-spy

# Copy and customize environment
cp .env.example .env
# Edit .env with your settings

# Start the stack
docker-compose -f docker-compose.timescaledb.yml up -d

# Verify
open http://localhost:9110/health
```

### Migration (Existing SQLite)

```bash
# Ensure existing data is backed up
cp data/usage.db data/usage.db.backup

# Start new stack
docker-compose -f docker-compose.timescaledb.yml up -d postgres migrate

# Run migration
docker-compose -f docker-compose.timescaledb.yml --profile migrate run migrate-sqlite

# Start proxy
docker-compose -f docker-compose.timescaledb.yml up -d token-spy
```

---

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | Required | PostgreSQL connection string |
| `POSTGRES_PASSWORD` | `token_spy_secret` | Database password |
| `ENCRYPTION_KEY` | Required | AES-256 key for provider secrets |
| `CONFIG_PATH` | `./config/providers.yaml` | Provider config file |
| `DEFAULT_PROVIDER` | `anthropic` | Fallback provider |
| `LOG_LEVEL` | `INFO` | Logging level |

### Provider YAML Structure

```yaml
providers:
  <provider_id>:
    name: "Display Name"
    adapter: <adapter_id>
    base_url: "https://api.example.com"
    api_version: "2023-06-01"  # Optional
    
    auth:
      type: header
      header_name: "x-api-key"
      header_prefix: "Bearer "  # Optional
    
    request_transforms:
      - type: role_map
        mapping:
          developer: system
    
    models:
      <model_id>:
        name: "Display Name"
        input: 1.00        # $ per 1M input tokens
        output: 2.00       # $ per 1M output tokens
        cache_read: 0.10   # $ per 1M cached tokens
        cache_write: 1.00  # $ per 1M cache writes
        context_window: 128000

adapters:
  <adapter_id>:
    name: "Display Name"
    request_format: openai|anthropic
    response_format: openai|anthropic
    streaming: true
    sse_event_types: false

settings:
  default_provider: anthropic
  default_rate_limit_rpm: 60
  default_rate_limit_rpd: 10000
  cost_alert_threshold_usd: 10.00
  default_session_char_limit: 200000
  retention_raw_days: 30
  retention_hourly_days: 365
```

---

## Phase 1 → Phase 2 Transition

**Phase 1 Completes:**
- ✅ Configuration-driven providers
- ✅ Multi-tenant database schema
- ✅ API key authentication
- ✅ Docker Compose deployment
- ✅ Migration path from SQLite

**Phase 2 Begins:**
- Analytics dashboard (Next.js/SvelteKit)
- Real-time WebSocket updates
- Model comparison views
- Cost anomaly detection
- Prompt economics analysis

---

## Files Added/Modified

```
products/token-spy/
├── config/
│   └── providers.yaml              # NEW: Provider definitions
├── config_loader.py                # NEW: YAML config loader
├── docker-compose.timescaledb.yml  # NEW: TimescaleDB stack
├── migrations/
│   └── migrate_sqlite_to_timescale.py  # NEW: Migration script
├── schema/
│   ├── 001_init.sql               # EXISTS: Core tables
│   ├── 002_provider_keys.sql      # EXISTS: Auth tables
│   └── 003_tenant_multitenancy.sql # EXISTS: Multi-tenancy
└── PHASE1-ARCHITECTURE.md         # NEW: This document
```

---

## Testing Checklist

- [ ] `docker-compose -f docker-compose.timescaledb.yml config` validates
- [ ] PostgreSQL starts with TimescaleDB extension
- [ ] Migrations apply cleanly
- [ ] Config loader parses `providers.yaml`
- [ ] Migration script runs in dry-run mode
- [ ] Health endpoint responds
- [ ] API key authentication works
- [ ] Provider routing uses config

---

## Notes for Phase 2

1. **Dashboard:** Replace inline HTML with Next.js frontend
2. **Real-time:** Add WebSocket endpoint for live updates
3. **Analytics:** Build on TimescaleDB continuous aggregates
4. **Auth:** Add session-based dashboard login
5. **API:** Document REST API for programmatic access
