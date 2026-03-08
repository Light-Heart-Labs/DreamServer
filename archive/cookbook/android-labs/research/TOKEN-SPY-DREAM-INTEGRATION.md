# Token Spy + Dream Server Integration Plan

**Status:** Draft  
**Created:** 2026-02-12  
**Purpose:** Define how Token Spy should be integrated into Dream Server as an optional service

---

## Executive Summary

Token Spy provides real-time LLM API usage monitoring and cost attribution. This plan outlines how to integrate it into Dream Server as an optional profile-based service, enabling users to track token consumption across local and external LLM providers.

---

## 1. Docker Compose Service Definition

### 1.1 New Service: `token-spy`

Add to `docker-compose.yml` under a new `token-spy` profile:

```yaml
  # ============================================
  # Token Spy — LLM Usage Monitoring
  # ============================================
  token-spy:
    image: ghcr.io/lightheartdevs/token-spy:v1.0.0  # Pinned stable release
    container_name: dream-token-spy
    restart: unless-stopped
    user: "1000:1000"
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:noexec,nosuid,size=100M
    environment:
      - AGENT_NAME=${AGENT_NAME:-dream-server}
      - PROXY_PORT=8080
      - UPSTREAM_BASE_URL=${TOKEN_SPY_UPSTREAM_URL:-http://vllm:8000/v1}
      - UPSTREAM_API_KEY=${TOKEN_SPY_API_KEY:-not-needed}
      - API_PROVIDER=${TOKEN_SPY_PROVIDER:-generic}
      - DB_PATH=/app/data/usage.db
      - SESSION_CHAR_LIMIT=${SESSION_CHAR_LIMIT:-100000}
      - POLL_INTERVAL_MINUTES=${POLL_INTERVAL_MINUTES:-5}
    volumes:
      - ./data/token-spy:/app/data
    ports:
      - "${TOKEN_SPY_PORT:-8095}:8080"
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 2G
        reservations:
          cpus: '0.25'
          memory: 512M
    profiles:
      - token-spy
      - monitoring
      - full
    depends_on:
      vllm:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

### 1.2 Multi-Provider Support (Optional)

For users monitoring both local vLLM and external APIs:

```yaml
  # External API Monitor (e.g., Anthropic backup)
  token-spy-external:
    image: ghcr.io/lightheartdevs/token-spy:v1.0.0
    container_name: dream-token-spy-external
    restart: unless-stopped
    environment:
      - AGENT_NAME=external-backup
      - PROXY_PORT=8080
      - UPSTREAM_BASE_URL=${EXTERNAL_API_URL}
      - UPSTREAM_API_KEY=${EXTERNAL_API_KEY}
      - API_PROVIDER=${EXTERNAL_API_PROVIDER:-anthropic}
      - DB_PATH=/app/data/external.db
    volumes:
      - ./data/token-spy-external:/app/data
    ports:
      - "8096:8080"
    profiles:
      - token-spy-external
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

---

## 2. Environment Variable Wiring

### 2.1 New Variables for `.env` Template

Add to the installer-generated `.env` file:

```bash
#=== Token Spy Settings ===
TOKEN_SPY_ENABLED=false                    # Set to true to enable during install
TOKEN_SPY_PORT=8095                        # Dashboard/API port
AGENT_NAME=dream-server                    # Identifier for this instance
TOKEN_SPY_UPSTREAM_URL=http://vllm:8000/v1 # Target API to monitor
TOKEN_SPY_API_KEY=not-needed               # API key if required
TOKEN_SPY_PROVIDER=generic                 # generic, anthropic, moonshot, openai
SESSION_CHAR_LIMIT=100000                  # Auto-reset sessions at this size
POLL_INTERVAL_MINUTES=5                    # Session cleanup frequency

# External API monitoring (optional)
EXTERNAL_API_URL=                          # e.g., https://api.anthropic.com
EXTERNAL_API_KEY=                          # Your external API key
EXTERNAL_API_PROVIDER=anthropic            # Provider type
```

### 2.2 Installer Integration

Update `install.sh` feature selection menu:

```bash
show_install_menu() {
    echo ""
    echo -e "${BLUE}What would you like to install?${NC}"
    echo ""
    echo -e "  ${GREEN}[1]${NC} Full Stack ${YELLOW}(recommended)${NC}"
    echo "      Chat + Voice + Workflows + Document Q&A"
    echo "      Uses ~14GB VRAM, all features enabled"
    echo ""
    echo -e "  ${GREEN}[2]${NC} Core Only"
    echo "      Chat interface + API"
    echo "      Uses ~12GB VRAM, minimal footprint"
    echo ""
    echo -e "  ${GREEN}[3]${NC} Custom"
    echo "      Choose exactly what you want"
    echo ""
}

# In interactive mode, add:
read -p "  Enable Token Spy usage monitoring? [y/N] " -n 1 -r
echo
[[ $REPLY =~ ^[Yy]$ ]] && ENABLE_TOKEN_SPY=true
```

### 2.3 Profile Wiring

Add to the profiles builder in `install.sh`:

```bash
[[ "$ENABLE_TOKEN_SPY" == "true" ]] && PROFILES="$PROFILES --profile token-spy"
```

---

## 3. Dashboard Integration Points

### 3.1 Dashboard API Endpoints

Add to `dashboard-api/main.py`:

```python
@app.get("/api/token-spy/status")
async def get_token_spy_status():
    """Get Token Spy service status and basic metrics."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get("http://localhost:8095/health")
            health = response.json()
            
            # Get usage summary
            summary_response = await client.get("http://localhost:8095/api/summary?hours=24")
            summary = summary_response.json()
            
            return {
                "enabled": True,
                "healthy": health.get("status") == "ok",
                "uptime_seconds": health.get("uptime_seconds", 0),
                "requests_24h": summary.get("request_count", 0),
                "tokens_24h": summary.get("total_tokens", 0),
                "cost_24h_usd": summary.get("estimated_cost_usd", 0),
                "active_sessions": summary.get("active_sessions", 0)
            }
    except Exception as e:
        return {"enabled": False, "error": str(e)}

@app.get("/api/token-spy/metrics")
async def get_token_spy_metrics(hours: int = 24):
    """Get detailed token usage metrics."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"http://localhost:8095/api/summary?hours={hours}")
            return response.json()
    except Exception as e:
        return {"error": str(e)}
```

### 3.2 Dashboard UI Components

Add new card to dashboard frontend (`dashboard/src/components/`):

**TokenSpyCard.tsx:**
```typescript
import React, { useEffect, useState } from 'react';

interface TokenSpyMetrics {
  requests_24h: number;
  tokens_24h: number;
  cost_24h_usd: number;
  active_sessions: number;
}

export const TokenSpyCard: React.FC = () => {
  const [metrics, setMetrics] = useState<TokenSpyMetrics | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetch('/api/token-spy/status')
      .then(r => r.json())
      .then(data => {
        if (data.enabled) {
          setMetrics(data);
        }
      })
      .catch(e => setError(e.message));
  }, []);

  if (error) return null; // Don't show if not available
  if (!metrics) return <div className="metric-card">Loading Token Spy...</div>;

  return (
    <article className="metric-card">
      <p className="metric-label">Token Usage (24h)</p>
      <div className="metric-grid">
        <div>
          <p className="metric-value">{metrics.requests_24h.toLocaleString()}</p>
          <small>Requests</small>
        </div>
        <div>
          <p className="metric-value">{(metrics.tokens_24h / 1000).toFixed(1)}k</p>
          <small>Tokens</small>
        </div>
        <div>
          <p className="metric-value">${metrics.cost_24h_usd.toFixed(2)}</p>
          <small>Est. Cost</small>
        </div>
      </div>
      <small style={{ color: 'var(--muted-color)' }}>
        {metrics.active_sessions} active sessions
      </small>
      <a href="http://localhost:8095/dashboard" className="dashboard-link">
        View Dashboard →
      </a>
    </article>
  );
};
```

### 3.3 Dashboard Navigation

Add to dashboard sidebar/menu:

```javascript
const menuItems = [
  { label: 'Overview', path: '/' },
  { label: 'GPU Metrics', path: '/gpu' },
  { label: 'Cluster', path: '/cluster' },
  { label: 'Token Usage', path: '/token-spy', external: 'http://localhost:8095/dashboard' },
];
```

---

## 4. Update/Migration Path

### 4.1 Migration Script (`migrations/migrate-v2.1.0.sh`)

```bash
#!/bin/bash
# Migration: Add Token Spy support (v2.1.0)
# Run by dream-update.sh when upgrading to v2.1.0+

set -e

INSTALL_DIR="${INSTALL_DIR:-$HOME/dream-server}"
ENV_FILE="$INSTALL_DIR/.env"

echo "[Token Spy Migration] Checking configuration..."

# Add new environment variables if not present
if [[ -f "$ENV_FILE" ]]; then
    # Check if TOKEN_SPY_PORT exists
    if ! grep -q "TOKEN_SPY_PORT" "$ENV_FILE"; then
        echo "" >> "$ENV_FILE"
        echo "#=== Token Spy Settings (added in v2.1.0) ===" >> "$ENV_FILE"
        echo "TOKEN_SPY_ENABLED=false" >> "$ENV_FILE"
        echo "TOKEN_SPY_PORT=8095" >> "$ENV_FILE"
        echo "AGENT_NAME=dream-server" >> "$ENV_FILE"
        echo "TOKEN_SPY_UPSTREAM_URL=http://vllm:8000/v1" >> "$ENV_FILE"
        echo "TOKEN_SPY_API_KEY=not-needed" >> "$ENV_FILE"
        echo "TOKEN_SPY_PROVIDER=generic" >> "$ENV_FILE"
        echo "SESSION_CHAR_LIMIT=100000" >> "$ENV_FILE"
        echo "POLL_INTERVAL_MINUTES=5" >> "$ENV_FILE"
        echo "[Token Spy Migration] Added environment variables to .env"
    fi
fi

# Create data directory
mkdir -p "$INSTALL_DIR/data/token-spy"

echo "[Token Spy Migration] Complete. Set TOKEN_SPY_ENABLED=true to enable."
```

### 4.2 Version Manifest Update

Add to `manifest.json` for v2.1.0:

```json
{
  "version": "2.1.0",
  "name": "Token Spy Integration",
  "changelog": [
    "Add Token Spy optional service for LLM usage monitoring",
    "New dashboard integration for token metrics",
    "Support for local vLLM and external API monitoring",
    "Automatic cost attribution per request"
  ],
  "migrations": ["migrate-v2.1.0.sh"],
  "config_files": [
    "docker-compose.yml"
  ],
  "new_profiles": ["token-spy", "monitoring"]
}
```

### 4.3 Update Flow

When `dream-update.sh` runs:

1. Fetches manifest for new version
2. Detects `new_profiles` includes `token-spy`
3. Runs `migrate-v2.1.0.sh` to add env vars
4. User can optionally enable with `--profile token-spy`

---

## 5. Setup Wizard Integration

### 5.1 Wizard Flow

Add to Phase 2 (Feature Selection) of `install.sh`:

```bash
show_phase 2 6 "Feature Selection" "~1 minute"
show_install_menu

# ... existing options ...

# Token Spy option
if [[ "$ENABLE_TOKEN_SPY" != "true" ]]; then
    echo ""
    echo -e "  ${CYAN}Token Spy${NC} — LLM Usage Monitoring"
    echo "      Track token consumption, costs, and session health"
    echo "      Per-request visibility into your AI operations"
    echo ""
    read -p "  Enable Token Spy? [y/N] " -n 1 -r
    echo
    [[ $REPLY =~ ^[Yy]$ ]] && ENABLE_TOKEN_SPY=true
fi
```

### 5.2 Configuration Prompts (if enabled)

```bash
if [[ "$ENABLE_TOKEN_SPY" == "true" ]]; then
    echo ""
    echo -e "${BLUE}Token Spy Configuration${NC}"
    echo ""
    
    # Agent name
    read -p "  Agent name [dream-server]: " agent_name
    AGENT_NAME="${agent_name:-dream-server}"
    
    # Port selection
    read -p "  Dashboard port [8095]: " port
    TOKEN_SPY_PORT="${port:-8095}"
    
    # External API monitoring (optional)
    echo ""
    echo "  External API monitoring (optional):"
    read -p "  Monitor external API in addition to local vLLM? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ENABLE_TOKEN_SPY_EXTERNAL=true
        read -p "  External API URL: " EXTERNAL_API_URL
        read -p "  External API key: " -s EXTERNAL_API_KEY
        echo ""
        read -p "  Provider (anthropic/moonshot/openai): " EXTERNAL_API_PROVIDER
    fi
fi
```

### 5.3 Summary Display

In the final installation summary:

```bash
# Additional service info
echo -e "${CYAN}━━━ All Services ━━━${NC}"
echo "  • Chat UI:       http://localhost:3000"
echo "  • Dashboard:     http://localhost:3001"
echo "  • LLM API:       http://localhost:8000/v1"
[[ "$ENABLE_TOKEN_SPY" == "true" ]] && echo "  • Token Spy:     http://localhost:8095/dashboard"
[[ "$ENABLE_TOKEN_SPY_EXTERNAL" == "true" ]] && echo "  • Token Spy Ext: http://localhost:8096/dashboard"
```

### 5.4 Non-Interactive Mode

Support flags for automated deployment:

```bash
# install.sh flags
--token-spy                    # Enable Token Spy
--token-spy-port PORT          # Custom port
--token-spy-external URL KEY   # Enable external monitoring
--agent-name NAME              # Set agent identifier

# Example non-interactive install:
./install.sh --tier 3 --all --token-spy --agent-name production-01 --non-interactive
```

---

## 6. Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Dream Server                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Open WebUI  │    │    n8n       │    │  Other Apps  │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                    │                    │              │
│         └────────────────────┴────────────────────┘              │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  Token Spy Proxy (localhost:8095)                    │       │
│  │  • Captures requests/responses                       │       │
│  │  • Logs usage to SQLite                             │       │
│  │  • Forwards to upstream                             │       │
│  └──────────────────────────┬───────────────────────────┘       │
│                             │                                    │
│                             ▼                                    │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  vLLM (local)  │  Anthropic API  │  Moonshot API    │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │  Dashboard (localhost:3001)                          │       │
│  │  • Pulls metrics from Token Spy API                  │       │
│  │  • Displays usage cards alongside GPU metrics        │       │
│  └──────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Security Considerations

### 7.1 API Key Handling

- External API keys stored in `.env` (permissions 600)
- Local vLLM uses `not-needed` placeholder (no auth required)
- Token Spy does not log API keys in request/response

### 7.2 Database Security

```yaml
# Token Spy runs as non-root
user: "1000:1000"

# Database stored in user-owned directory
volumes:
  - ./data/token-spy:/app/data  # Host directory owned by $USER
```

### 7.3 Network Isolation

Token Spy communicates only within `dream-network`:
- Receives requests from Open WebUI, n8n, etc.
- Forwards to vLLM (internal) or external APIs (outbound)
- Dashboard API queries Token Spy metrics endpoint

---

## 8. Testing Checklist

### 8.1 Installation Tests

- [ ] Clean install with `--token-spy` flag
- [ ] Interactive install with Token Spy enabled
- [ ] Non-interactive install with all flags
- [ ] Install without Token Spy (default, backward compatible)

### 8.2 Functionality Tests

- [ ] Token Spy health endpoint returns OK
- [ ] Dashboard displays Token Spy card when enabled
- [ ] Dashboard hides Token Spy card when disabled
- [ ] Requests through proxy are logged to SQLite
- [ ] Cost attribution calculates correctly
- [ ] Session reset at `SESSION_CHAR_LIMIT`

### 8.3 Migration Tests

- [ ] Update from v2.0.x adds env vars correctly
- [ ] Existing installs can enable Token Spy post-update
- [ ] Migration script idempotent (safe to run twice)

---

## 9. Documentation Updates

### 9.1 README.md Sections to Add

```markdown
## Token Spy (Optional)

Track your LLM usage and costs:

```bash
# Enable during install
./install.sh --token-spy

# Or add to existing installation
cd ~/dream-server
docker compose --profile token-spy up -d token-spy
```

Access the Token Spy dashboard at `http://localhost:8095/dashboard`.

### External API Monitoring

Monitor both local vLLM and external providers:

```bash
export EXTERNAL_API_URL=https://api.anthropic.com
export EXTERNAL_API_KEY=sk-ant-...
export EXTERNAL_API_PROVIDER=anthropic
docker compose --profile token-spy-external up -d
```
```

### 9.2 New Docs to Create

- `docs/TOKEN-SPY.md` — Full usage guide
- `docs/MONITORING.md` — Overview of all monitoring options

---

## 10. Implementation Priority

| Priority | Item | Est. Effort |
|----------|------|-------------|
| P0 | Docker Compose service definition | 1 hour |
| P0 | Environment variable wiring in installer | 2 hours |
| P1 | Dashboard API endpoints | 2 hours |
| P1 | Dashboard UI card component | 3 hours |
| P1 | Migration script | 1 hour |
| P2 | Setup wizard integration | 2 hours |
| P2 | Non-interactive flags | 1 hour |
| P3 | Multi-provider support | 4 hours |
| P3 | Documentation | 3 hours |

**Total Estimated Effort:** ~19 hours

---

## Appendix A: File Changes Summary

### Modified Files
1. `dream-server/docker-compose.yml` — Add token-spy service
2. `dream-server/install.sh` — Add feature selection prompts
3. `dream-server/dream-update.sh` — No changes needed (uses migrations)
4. `dream-server/dashboard-api/main.py` — Add token-spy endpoints
5. `dream-server/dashboard/` — Add TokenSpyCard component

### New Files
1. `dream-server/migrations/migrate-v2.1.0.sh` — Migration script
2. `dream-server/docs/TOKEN-SPY.md` — Documentation
3. `manifest.json` (in release) — Version manifest with migration

---

*End of Integration Plan*
