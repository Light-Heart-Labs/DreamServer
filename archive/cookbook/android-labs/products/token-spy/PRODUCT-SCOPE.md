# Token Spy — Product Scope & Roadmap
*Mission 12 in `MISSIONS.md`. Product Priority #2.*

## Vision

**Token Spy is the Morningstar of LLM APIs.**

Morningstar turned opaque mutual fund markets into transparent, comparable, navigable decisions for everyday investors. Hugging Face did the same for ML models — leaderboards, model cards, community benchmarks, a town square for the ecosystem.

The LLM API market is in the exact same position today. There are 50+ providers with wildly different pricing, latency, quality, and cache behavior. Every provider reports usage differently. There's no standardized way to compare real-world cost-per-quality across providers. Agent frameworks are exploding and every one burns tokens differently, but nobody can see *how*.

Token Spy makes the invisible visible. It starts as a transparent proxy that captures everything — then evolves into the platform where developers, teams, and enterprises go to understand, compare, optimize, and control their entire LLM spend.

**Phase 1**: See everything your AI spends. Change nothing in your code.
**Phase 2**: Compare models, providers, and patterns with real production data.
**Phase 3**: The platform tells you what to do — model routing, budget enforcement, quality scoring.
**Phase 4**: The community contributes benchmarks, provider adapters, and optimization playbooks. Token Spy becomes the place you go before choosing an LLM API, and the place you stay to keep optimizing.

---

## Executive Summary

Token Spy is a **transparent API proxy** that captures per-request token usage, cost, and session health metrics for LLM-powered agents — with **zero code changes** to downstream applications. It currently runs as a personal tool monitoring two AI agents across two LLM providers (Anthropic, Moonshot/Kimi).

This document scopes the path from personal tool to the definitive platform for LLM API intelligence — targeting developers and teams running LLM-powered agents, workflows, and applications who need visibility into what they're spending, where, and why.

---

## Core Value Proposition

**"See everything your AI spends. Change nothing in your code."**

Unlike SDK-based observability tools (LangSmith, Langfuse, W&B Weave) that require instrumenting every call site, and unlike competing proxy tools (Helicone, Portkey) that still require a base URL change and auth header, Token Spy operates as a truly transparent proxy — point your agent's traffic through it and every LLM interaction is automatically captured, analyzed, and visualized.

### Why This Matters

- **Zero integration friction** — No SDK, no framework lock-in, no code changes. Works with any language, any LLM client library, any agent framework.
- **Session intelligence** — Not just request logging. Understands conversation arcs, detects session boundaries, tracks context window growth, and recommends when to reset.
- **Prompt cost attribution** — Breaks down what's actually eating tokens: system prompt components, workspace files, skill injections, conversation history. No other tool does this at the proxy level.
- **Operational safety** — Auto-resets runaway sessions before they burn through budgets. Acts as both observer and guardrail.
- **The Morningstar angle** — Aggregated, anonymized intelligence across the ecosystem. "Developers using Provider X for coding tasks pay 40% more than those using Provider Y for equivalent quality." No one can build this without the proxy data.

---

## Competitive Landscape

| Tool | Approach | Integration Effort | Strengths | Weakness vs. Us |
|------|----------|-------------------|-----------|-----------------|
| **Helicone** | Proxy gateway (Rust/CF Workers) | Base URL + API key header change | Mature, open source, 2B+ interactions | Still requires code change; no session intelligence; no ecosystem intelligence |
| **Portkey** | AI gateway | Base URL change + SDK optional | 200+ providers, guardrails, enterprise governance | Heavy/complex; no prompt-level cost attribution; no community benchmarking |
| **Langfuse** | SDK instrumentation | SDK integration per call site | Open source, deep tracing, self-hostable | Framework coupling; maintenance burden; no proxy-level capture |
| **LangSmith** | SDK (LangChain native) | LangChain/LangGraph integration | Deep chain tracing, evaluation | Ecosystem lock-in; useless outside LangChain |
| **Datadog LLM** | SDK instrumentation | Python SDK + Datadog agent | Integrates with existing infra monitoring | Enterprise pricing; Python-only; heavy stack |
| **Groundcover** | eBPF kernel-level | Zero (but K8s + eBPF required) | Truly zero instrumentation | K8s-only; no session awareness; infrastructure-focused |
| **Braintrust** | SDK + eval platform | SDK integration | Strong evaluation/scoring | Evaluation-first, not operations-first |
| **Morningstar** (analogy) | Data aggregation + ratings | Just visit the website | Trusted, standardized, community benchmark | Different industry — but the model is exactly what LLM APIs need |

### Our Differentiated Position

1. **Transparent proxy** — zero code changes, works in any environment (not just K8s)
2. **Session-aware intelligence** — conversation arc tracking, auto-reset, cache efficiency analysis
3. **Prompt cost decomposition** — see exactly which parts of your system prompt are costing money
4. **Operational safety rails** — budget enforcement and runaway session protection built into the proxy layer
5. **Ecosystem intelligence** — aggregated benchmarks and provider ratings built from real production data (the Morningstar moat)

---

## What Exists Today

### Current Architecture
```
Agent (Android-17) ──► :9110 ──► api.anthropic.com / api.moonshot.ai
Agent (Todd)        ──► :9111 ──► api.moonshot.ai / api.anthropic.com
                         │
                    SQLite DB (usage.db) + settings.json
                         │
                    Dashboard (:9110/ or :9111/)
                         │
                    Session Manager (systemd timer, configurable polling)
```

### Current Capabilities
- Transparent proxy for Anthropic Messages API and OpenAI-compatible Chat Completions API
- SSE streaming passthrough with zero buffering
- Per-turn logging: model, tokens (input/output/cache_read/cache_write), cost, latency, stop reason
- Request analysis: message count by role, tool count, request body size
- System prompt decomposition: workspace files, skill injections, base prompt
- Conversation history char tracking across turns
- Session boundary detection (history drop = new session)
- Session health scoring with recommendations (healthy → monitor → compact_soon → reset_recommended → cache_unstable)
- **Dashboard-editable session controls**: configurable session char limit and poll frequency via Settings panel, with live token estimates (~1 token = 4 chars)
- **Dynamic auto-reset**: kills sessions exceeding the configured char limit (default 100K chars / ~25K tokens)
- **Per-agent setting overrides**: each agent can have independent limits or inherit global defaults
- **Persistent settings**: stored in `settings.json`, editable via `/api/settings` POST endpoint or dashboard UI
- External session manager with dynamic polling (reads limits from API, timer interval adjustable from dashboard)
- Dashboard: summary cards, cost-per-turn timeline, history growth chart with dynamic threshold lines, token usage bars, cost breakdown doughnut, cumulative cost, recent turns table, session health panels with reset buttons, Settings panel
- Cost estimation with per-model pricing tables (8 Claude variants, 4 Kimi variants)
- Protocol translation (OpenAI `developer` role → `system` for Kimi compatibility)
- 9 models tracked, 9,650+ turns logged, $304+ total cost data accumulated

### Current Limitations
- Single-user, hardcoded agent names and session directories
- Two providers only (Anthropic, Moonshot), each requiring a separate handler
- SQLite with thread-local connections (single-node only)
- Dashboard is inline HTML in main.py (no component framework, no auth)
- No alerting, no budgets, no API keys for the proxy itself
- No data export, no retention policies, no multi-node deployment
- No model comparison, latency visualization, or stop reason analytics on the dashboard
- No tool name tracking (only tool count per request)

---

## Immediate Feature Scope (Pre-Phase 1)

These features build on the existing system with zero architectural changes. They use data already being collected and add dashboard views, API endpoints, and settings — all within the current single-file FastAPI + inline HTML architecture.

### Feature A: Model Comparison View

**What:** Side-by-side performance and cost comparison across all models.

**Why:** Token Spy tracks 9 models with real production data. Claude Opus 4.5 costs $157.56 across 3,807 turns at 6.1s avg latency. Kimi K2.5 costs $144.40 across 5,591 turns at 8.4s avg latency. This data is invisible on the dashboard today. A comparison view makes it obvious when one model is dramatically more expensive or slower for equivalent work.

**Scope:**
- New dashboard section: "Model Performance" (collapsible, like Settings panel)
- Horizontal bar chart: cost per turn by model
- Horizontal bar chart: average latency by model
- Summary table: model, turns, total cost, avg cost/turn, avg latency, cache read %, avg input tokens
- Uses existing hour-range selector
- New API endpoint: `/api/model-comparison?hours=24`
- No schema changes — all data exists in `usage` table

---

### Feature B: Latency / Response Time Chart

**What:** Timeline chart showing API response times with per-agent and per-model breakdown.

**Why:** `duration_ms` is logged on every turn but never visualized. A 139-second request happened during today's session — invisible without a chart. Latency spikes indicate provider issues, context size problems, or rate limiting. Critical for provider comparison.

**Scope:**
- New chart in dashboard: "Response Time" timeline (same grid slot pattern as existing charts)
- Scatter plot or line chart with per-agent color coding
- Y-axis: seconds
- Highlight outliers (>3x rolling average) with distinct markers
- Add avg latency and p95 latency to summary cards
- New API endpoint: `/api/latency-stats?hours=24`
- No schema changes — `duration_ms` already captured

---

### Feature C: Cost Alerts / Budget Cap

**What:** Configurable hourly and daily spending thresholds with dashboard warnings.

**Why:** The only cost visibility is cumulative charts and summary cards. No way to set a budget. Today's spend is $79 (Android-17) and $113 (Todd) over 24h. If an agent enters an expensive conversation loop, you'd only notice by watching the dashboard at the right moment.

**Scope:**
- New settings fields: `daily_budget_usd`, `hourly_budget_usd` (global + per-agent overrides)
- Dashboard: budget status card — "Spent $X of $Y today" with color-coded progress bar (green/yellow/red)
- Budget status included in `/api/session-status` response for programmatic monitoring
- Add to Settings panel alongside char limit and poll frequency
- Informational only — no traffic blocking (blocking breaks active conversations)
- New setting fields in `settings.json`, no schema changes to usage table

---

### Feature D: Session Timeline / Session History

**What:** Visual history of past sessions showing lifecycle from start to reset with per-session cost and turn counts.

**Why:** Auto-reset fires and sessions die, but there's no record of what they looked like. Was it a productive 30-turn session or a runaway loop? Session boundary detection already exists in `query_session_status`. Surfacing it reveals patterns: "Todd's sessions average 14 turns before reset, 17's average 27."

**Scope:**
- New API endpoint: `/api/sessions?agent=todd&hours=24` — detected session boundaries with per-session stats
- Session detection: scan usage rows chronologically, detect resets where `conversation_history_chars` drops >50%
- Per-session metrics: turn count, duration, peak history chars, total cost, models used
- Dashboard: horizontal timeline with sessions as colored blocks (width = duration, color = cost intensity)
- Click a session to filter the turns table below
- Auto-reset events marked as red indicators
- No schema changes — derived from existing `conversation_history_chars` patterns

---

### Feature E: Stop Reason Analytics

**What:** Breakdown of why each API call ended — natural stop, tool call, hit max tokens, etc.

**Why:** `stop_reason` distribution is revealing: 4,309 `tool_calls`, 3,122 `tool_use`, 1,397 `stop`, 730 `end_turn`, and 18 `length` (model got cut off mid-response). Those 18 `length` stops mean the context was too large or max_tokens too low — a direct signal for tuning.

**Scope:**
- New chart: stacked bar showing stop reason distribution per agent
- Trend view: stop reasons over time (are `length` stops increasing as context grows?)
- `length` stops highlighted in red
- Add to summary cards: "X% tool calls, Y% natural stops, Z% truncated"
- Filter by model to compare stop patterns
- No schema changes — `stop_reason` already captured

---

### Feature F: Tool Usage Tracking

**What:** Track which tools are registered and how frequently they appear in requests.

**Why:** Both agents send 23 tools on every request. If 5 are never invoked, they're dead weight consuming tokens per turn for no benefit. Currently Token Spy only logs `tool_count`, not which tools.

**Scope:**
- **Schema change required:** Add `tool_names` TEXT column to usage table (JSON array of tool name strings)
- Capture tool names from request body during proxy logging (just names, not full definitions)
- New API endpoint: `/api/tool-usage?hours=24&agent=todd`
- Dashboard: bar chart showing tool registration frequency vs actual invocation frequency
- Identify "dead tools" — registered on every call but never invoked
- Small logging change in both proxy handlers

---

## Product Roadmap

### Phase 1: Foundation (Weeks 1–6)
**Goal: Multi-user, multi-provider proxy that anyone can self-host.**

#### 1.1 Provider Plugin System
Generalize the two existing proxy handlers into a provider adapter interface.

- **Provider adapter contract**: Each provider implements `parse_request()`, `forward_streaming()`, `forward_sync()`, `extract_usage()`, `estimate_cost()`
- **Built-in adapters**: Anthropic Messages API, OpenAI Chat Completions API (covers OpenAI, Azure OpenAI, Moonshot/Kimi, Groq, Together, Fireworks, DeepSeek, any OpenAI-compatible)
- **Google Vertex/Gemini adapter**: Third priority given market share
- **Configuration-driven**: Provider endpoints, cost tables, and model mappings defined in YAML/TOML config, not code
- **Custom cost tables**: Users override per-model pricing to match their negotiated rates or fine-tuned model costs

```yaml
providers:
  anthropic:
    base_url: https://api.anthropic.com
    adapter: anthropic_messages
    models:
      claude-sonnet-4:
        input: 3.00
        output: 15.00
        cache_read: 0.30
        cache_write: 3.75

  openai:
    base_url: https://api.openai.com
    adapter: openai_chat
    models:
      gpt-4o:
        input: 2.50
        output: 10.00
```

#### 1.2 Multi-Tenancy & Auth
- **Proxy API keys**: Customers generate keys that authenticate requests to the proxy. The proxy maps keys to tenants and attaches metadata (tenant, agent, environment) to every logged request.
- **Tenant isolation**: All queries scoped by tenant. No cross-tenant data leakage.
- **Dashboard auth**: Session-based login for the web dashboard. Each tenant sees only their data.
- **Provider key management**: Customers register their own provider API keys (encrypted at rest). The proxy injects the correct key when forwarding upstream.

#### 1.3 Database Migration
- **PostgreSQL** as the primary store for transactional data (tenants, API keys, provider configs)
- **TimescaleDB extension** (or ClickHouse) for the usage time-series data — enables fast aggregation queries over large time ranges without manual rollup tables
- **Migration path**: Script to import existing SQLite data
- **Retention policies**: Configurable per-tenant (e.g., raw data for 30 days, hourly rollups for 1 year)

#### 1.4 Configuration & Deployment
- **YAML/TOML config file** replacing all hardcoded values (agent names, thresholds, upstream URLs, cost tables)
- **Docker Compose** for self-hosted deployment (proxy + postgres + dashboard)
- **Environment variable overrides** for 12-factor compatibility
- **Health check endpoints** with dependency status (upstream providers reachable, DB connected)

**Phase 1 Deliverable**: A self-hostable Docker Compose stack that any developer can deploy, create an API key, point their agents at, and immediately see usage data in an authenticated dashboard. Supports any OpenAI-compatible or Anthropic-compatible provider out of the box.

---

### Phase 2: Analytics Dashboard (Weeks 7–12)
**Goal: The Morningstar-grade analytics experience.**

#### 2.1 Dashboard Rebuild
- **Next.js + React** frontend (or SvelteKit — lighter weight, good fit for data dashboards)
- **Responsive design** preserving the current dark theme aesthetic
- **Real-time updates** via WebSocket or Server-Sent Events (watch agents work live)
- **Time range picker** with presets (1h, 6h, 24h, 7d, 30d, custom range)
- **Auto-refresh** with configurable interval

#### 2.2 Core Analytics Views

**Overview Dashboard**
- Total spend (period), trend vs. previous period
- Active agents/workflows count
- Request volume and error rate
- Top spenders (by agent, model, provider)
- Cost forecast based on current burn rate

**Agent/Workflow Explorer**
- Per-agent drill-down: cost over time, token distribution, session timeline
- Session replay: step through a session's turns, see cost accumulate, identify expensive turns
- Conversation arc visualization: history growth, cache efficiency over session lifetime
- Compare agents side-by-side (cost efficiency, token patterns, model usage)

**Model Analytics** (the Morningstar view)
- **Model scorecards** (like Morningstar fund profiles): cost per turn, latency, cache efficiency, quality indicators, "star rating" based on cost-per-quality
- Cost per model over time
- Token efficiency by model (output tokens per dollar)
- Latency distribution by model and provider
- Cache hit rates by model (which models benefit most from prompt caching?)
- Model comparison: "Switching Agent X from Opus to Sonnet would save $Y/day based on last 7 days"
- **Provider leaderboard**: Rank providers by real-world performance across multiple dimensions

**Prompt Economics**
- System prompt cost attribution: what percentage of input cost goes to system prompt vs. conversation history vs. tool definitions?
- Prompt component breakdown over time (unique to Token Spy — no competitor has this)
- "Your AGENTS.md file costs $0.003 per turn across 200 turns/day = $0.60/day. Is it worth it?"
- Workspace file size trends — detect prompt bloat early

**Cost & Budget**
- Cumulative cost by any dimension (agent, model, provider, tag, time)
- Budget configuration per agent/team/tag with alerts
- Projected monthly cost based on rolling averages
- Cost anomaly detection (sudden spend spikes)

#### 2.3 Tagging & Metadata
- **Request tags**: Arbitrary key-value metadata attached to requests via HTTP headers (e.g., `X-TokenSpy-Tags: env=prod,workflow=customer-support,team=backend`)
- **Agent auto-detection**: Infer agent identity from API key, request patterns, or explicit header
- **Environment segmentation**: dev/staging/prod cost breakdowns
- **Custom dimensions**: Let users define their own grouping dimensions

**Phase 2 Deliverable**: A polished, real-time analytics dashboard with Morningstar-quality model scorecards and provider leaderboards that turn raw telemetry into actionable intelligence about cost, efficiency, and agent behavior. The model comparison and prompt economics views are flagship differentiators.

---

### Phase 3: Intelligence & Ecosystem (Weeks 13–24)
**Goal: The proxy doesn't just observe — it advises, acts, and learns from the community.**

#### 3.1 Alerting & Budgets
- **Alert rules**: Configurable triggers on any metric (cost > $X/hour, cache hit rate < Y%, latency > Zms, error rate > N%)
- **Budget enforcement**: Hard and soft limits per agent, team, or tag. Soft = alert. Hard = reject requests with 429.
- **Notification channels**: Email, Slack webhook, PagerDuty, generic webhook
- **Anomaly alerts**: Automatic detection of unusual spending patterns without manual threshold configuration

#### 3.2 Smart Recommendations
Evolve the existing session health recommendations into a broader advisor system:

- **Model routing suggestions**: "Agent X used Opus for 47 turns where average output was <100 tokens. Haiku would handle these at 1/5 the cost." Based on actual usage patterns, not guesses.
- **Cache optimization**: "Your cache hit rate for Agent Y dropped from 95% to 60% after you updated SOUL.md. The new version breaks prefix cache alignment. Here's why."
- **Prompt trimming**: "TOOLS.md accounts for 12K chars of every request but tools are only called in 8% of turns. Consider lazy-loading tool definitions."
- **Session lifecycle**: "Agent X sessions average 45 turns before context window pressure causes quality degradation. Consider auto-compaction at turn 35."
- **Cost allocation insights**: "80% of your spend is conversation history re-transmission. Aggressive summarization or session splitting would reduce costs by ~40%."

#### 3.3 Ecosystem Intelligence (The Morningstar Moat)

This is where Token Spy becomes something no competitor can replicate. With user opt-in:

- **Aggregated provider benchmarks**: Real-world latency, uptime, error rates, and cost-per-quality across providers — built from actual production traffic, not synthetic benchmarks
- **Model ratings**: Like Morningstar star ratings but for LLMs. "Claude Opus 4.5 gets 4 stars for coding tasks (high cost, exceptional quality) and 2 stars for simple Q&A (overkill)." Ratings derived from community data: cost, latency, stop reasons, output length patterns
- **Provider status page**: Is Anthropic slow today? Is Moonshot having issues? Token Spy's user base knows before the provider acknowledges it — like Downdetector but built from proxy telemetry
- **"What are people using?" trends**: Which models are gaining/losing adoption? Which providers are gaining market share? Published as community intelligence (anonymized, aggregated)
- **Cost benchmarks**: "Developers building customer support chatbots spend a median of $0.02/conversation with Sonnet and $0.08 with Opus. Here's the quality tradeoff."
- **Provider comparison tool**: Public-facing page where anyone (even non-customers) can compare providers on real-world metrics. This is the Morningstar fund screener for LLM APIs. Drives awareness and top-of-funnel traffic.

#### 3.4 API & Integrations
- **REST API** for all dashboard data (formalize and version the existing endpoints)
- **OpenTelemetry export**: Push metrics to Datadog, Grafana, New Relic, etc.
- **Prometheus `/metrics` endpoint**: For teams with existing Prometheus/Grafana stacks
- **Webhook on events**: Fire webhooks on session reset, budget exceeded, anomaly detected, etc.
- **CSV/JSON export**: Download usage data for custom analysis

#### 3.5 Session Management (Productize)
Generalize the existing session-manager.sh and auto-reset system:

- **Session lifecycle policies**: Per-agent rules for when to compact, reset, or alert
- **Session cost tracking**: Total cost per session, not just per turn
- **Session quality scoring**: Detect degradation patterns (growing latency, cache thrashing, increasing error rate) as a session ages
- **Manual session controls**: Reset, pause, or throttle agents from the dashboard

**Phase 3 Deliverable**: An intelligent proxy that actively helps users reduce costs and improve agent performance, plus the ecosystem intelligence platform that creates the Morningstar moat — aggregated benchmarks and provider ratings that no competitor can build without the same proxy-level data access.

---

### Phase 4: Enterprise & Scale (Weeks 25–36)
**Goal: Ready for teams, organizations, and the Hugging Face community effect.**

#### 4.1 Multi-User & RBAC
- **Organizations & teams**: Hierarchical structure (org → team → agent)
- **Role-based access**: Admin (full access), Member (view + configure own agents), Viewer (read-only dashboards)
- **SSO**: SAML and OIDC for enterprise identity providers
- **Audit log**: Who changed what configuration, who triggered a session reset, etc.

#### 4.2 Scaling
- **Horizontal proxy scaling**: Stateless proxy instances behind a load balancer (state lives in Postgres/Timescale)
- **Connection pooling**: Replace per-request httpx clients with a managed pool
- **Request queuing**: Optional rate limiting and request queuing to protect upstream providers during traffic spikes
- **Multi-region**: Deploy proxy instances close to users and upstream providers to minimize latency overhead

#### 4.3 Security & Compliance
- **API key encryption**: Vault-backed secret storage for provider API keys
- **TLS everywhere**: mTLS between proxy and upstream providers
- **Request/response redaction**: Option to strip or hash sensitive content before logging (PII protection)
- **SOC 2 Type II** preparation (required for enterprise sales in this space)
- **Data residency**: Per-tenant control over where data is stored

#### 4.4 Advanced Proxy Features
- **Smart routing**: Route requests to the cheapest/fastest provider based on model, latency, and cost rules
- **Automatic fallback**: If Provider A returns 5xx, retry on Provider B transparently
- **Response caching**: Cache identical requests (configurable TTL) to save money on repeated queries
- **Request transformation**: Translate between API formats (e.g., send OpenAI-format requests to Anthropic)

#### 4.5 The Hugging Face Effect: Community & Marketplace
- **Provider adapter marketplace**: Community-contributed adapters for niche providers
- **Dashboard template sharing**: Pre-built layouts for common use cases (chatbot monitoring, agent fleet management, batch processing analytics)
- **Public model profiles**: Like Hugging Face model cards but focused on production economics — cost, latency, cache behavior, best-for-use-case ratings
- **Community benchmarks**: Users opt in to contribute anonymized metrics. Token Spy publishes the definitive "State of LLM APIs" report quarterly
- **Optimization playbooks**: Community-contributed guides — "How I cut my Opus spend 60% with prompt caching" — linked to real data
- **Open source core**: Core proxy + adapters open source; dashboard, intelligence features, and managed cloud as commercial offerings

**Phase 4 Deliverable**: Enterprise-ready platform with team management, security compliance, advanced routing — plus the community ecosystem that makes Token Spy the *place* people go to understand the LLM API landscape.

---

### Phase 5: Platform (Weeks 37+)
**Goal: The definitive LLM API intelligence platform.**

#### 5.1 Managed Cloud Offering
- **Hosted proxy endpoints**: Customers get a dedicated proxy URL (e.g., `https://yourteam.tokenspy.dev/v1/messages`)
- **Usage-based pricing**: Free tier → Pro → Enterprise (see Pricing section)
- **Global edge deployment**: Proxy instances on major cloud regions for low-latency forwarding
- **Uptime SLA**: 99.9% for Pro, 99.95% for Enterprise

#### 5.2 Optional SDK (Deeper Visibility)
For customers who want visibility beyond what a proxy can capture:

- **Lightweight tracing SDK**: Annotate specific code paths with custom spans
- **Agent framework integrations**: First-class plugins for LangChain, CrewAI, AutoGen, OpenClaw
- **Hybrid mode**: SDK traces merge with proxy telemetry into a unified timeline

#### 5.3 Evaluation & Quality
- **Output scoring**: Attach quality scores to responses (manual or automated via LLM-as-judge)
- **Regression detection**: Alert when output quality drops for a given agent/workflow
- **A/B testing**: Route traffic between model variants and compare cost vs. quality
- **Prompt playground**: Test prompt changes against historical inputs and see projected cost/quality impact

#### 5.4 The Public Intelligence Layer
The crown jewel — the reason people visit tokenspy.dev even if they don't use the proxy:

- **LLM API Directory**: Every provider, every model, live pricing, real-world performance data. The PCPartPicker / Morningstar screener of LLM APIs.
- **Provider reviews & ratings**: Community-contributed, data-backed
- **Price tracking**: Historical pricing trends. "Anthropic dropped Haiku pricing 20% in Q3. Here's how that affected adoption."
- **"Best model for X" recommendations**: Data-driven, not opinion-driven. Built from millions of real production interactions.
- **API for the intelligence**: Third parties can query Token Spy's benchmarks programmatically. Becomes infrastructure for the ecosystem.

---

## Pricing Model (Proposed)

| Tier | Price | Includes |
|------|-------|----------|
| **Free** | $0 | 10K requests/month, 1 agent, 7-day retention, community benchmarks access |
| **Pro** | $49/month | 500K requests/month, unlimited agents, 90-day retention, alerts & budgets, email support |
| **Team** | $199/month | 2M requests/month, RBAC (up to 10 seats), 1-year retention, smart recommendations, Slack/webhook alerts |
| **Enterprise** | Custom | Unlimited requests, SSO/SAML, audit logs, custom retention, SLA, dedicated support, on-prem/BYOC option |
| **Self-Hosted** | Free (open source core) | Unlimited, community support only. Commercial add-ons for intelligence features. |

**The Morningstar business model**: The public intelligence layer (model directory, provider ratings, benchmarks) is free and drives traffic. The proxy, dashboard, and operational features are the paid product. Free users contribute anonymized data that makes the intelligence layer better, which drives more free users — a flywheel.

**Why this works:**
- Free tier removes all adoption friction (competitive with Helicone's 10K free, Braintrust's 1M free)
- $49 Pro undercuts Helicone ($79) and Portkey ($49+) while including features they gate behind higher tiers
- Self-hosted option builds trust and community (Langfuse's model proves this works)
- Enterprise tier captures high-value customers who need compliance and SLAs
- The free public intelligence layer is the growth engine no competitor has

---

## Technical Architecture (Target State)

```
                    ┌──────────────────────────────┐
                    │       Load Balancer           │
                    │   (nginx / cloud ALB)         │
                    └──────────┬───────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
        ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
        │  Proxy     │   │  Proxy     │   │  Proxy     │
        │  Instance  │   │  Instance  │   │  Instance  │
        │  (FastAPI) │   │  (FastAPI) │   │  (FastAPI) │
        └─────┬──────┘   └─────┬──────┘   └─────┬──────┘
              │                │                │
              └────────────────┼────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
        ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
        │ PostgreSQL │   │ TimescaleDB│   │   Redis    │
        │ (config,   │   │ (usage     │   │ (sessions, │
        │  tenants,  │   │  metrics,  │   │  rate      │
        │  API keys) │   │  time-     │   │  limits,   │
        │            │   │  series)   │   │  cache)    │
        └────────────┘   └────────────┘   └────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                                 │
        ┌─────▼──────┐                  ┌───────▼───────┐
        │  Dashboard   │                │  Public Intel  │
        │  (Next.js /  │                │  Layer         │
        │  SvelteKit)  │                │  (tokenspy.dev)│
        └─────────────┘                 └───────────────┘
```

### Key Architectural Decisions

1. **Keep the proxy in Python/FastAPI** — Rewriting in Rust (like Helicone) would reduce latency but massively increase development time. FastAPI with httpx async is fast enough (<10ms overhead) for the initial product. Optimize later if latency becomes a measurable customer concern.

2. **TimescaleDB over ClickHouse** — TimescaleDB is PostgreSQL-compatible (one fewer technology to operate), handles the insert volume we'll see for the first 1000 customers, and supports continuous aggregates for rollup queries. ClickHouse is better at extreme scale but adds operational complexity.

3. **Stateless proxy instances** — All state in the database. Proxy instances can scale horizontally behind a load balancer. Sticky sessions not required.

4. **Provider adapters as Python modules** — Not microservices. A provider adapter is a Python class with 4-5 methods. Loaded at startup based on config. This keeps the deployment simple (one binary/container) while allowing extensibility.

5. **Public intelligence layer is separate** — The public-facing model directory and benchmarks run on their own infrastructure, consuming aggregated data from the main platform. This isolates the public traffic from customer proxy traffic.

---

## Success Metrics

### Phase 1 (Foundation)
- Self-hosted deployment works in <15 minutes (docker compose up)
- Supports 3+ providers (Anthropic, OpenAI-compatible, Google)
- <15ms proxy overhead at p99

### Phase 2 (Dashboard)
- Dashboard loads in <2 seconds
- Users can answer "how much did Agent X cost this week?" in <10 seconds
- Model scorecards provide Morningstar-quality comparison data
- Prompt economics view shows cost attribution data no other tool provides

### Phase 3 (Intelligence & Ecosystem)
- Recommendations surface actionable savings (target: median user finds 20%+ cost reduction opportunity within first week)
- Alert→resolution time under 5 minutes for budget breaches
- 3+ integration channels supported (Slack, email, webhook)
- Public provider benchmarks cited in 3+ industry publications

### Phase 4 (Enterprise & Community)
- SOC 2 Type II compliant
- Supports 100+ concurrent agents per tenant without degradation
- <5 second query time on 90-day aggregations
- 50+ community-contributed provider adapters
- tokenspy.dev becomes a top-10 result for "LLM API comparison"

### Product-Market Fit Indicators
- Free→Pro conversion rate >5%
- Net revenue retention >120% (teams expand usage over time)
- Weekly active dashboard users >60% of paying customers
- Public intelligence layer drives >50% of new signups (the Morningstar flywheel)

---

## Open Questions & Risks

1. **Build vs. contribute**: Helicone is open source. Should we build from scratch or fork/extend Helicone's proxy layer and differentiate on the intelligence/analytics layer?

2. **Python performance ceiling**: FastAPI/httpx adds ~5-10ms overhead. Helicone's Rust proxy adds ~50-80ms (but does more work at the edge). Is our Python advantage real, or will we need Rust eventually?

3. **Prompt decomposition portability**: The current system prompt analysis is tightly coupled to OpenClaw's markdown structure (AGENTS.md, SOUL.md, etc.). How do we generalize this for arbitrary agent frameworks? Possible approach: let users define their own "prompt component" patterns via regex or markers.

4. **Market timing**: The LLM observability market is crowding fast. Speed to market matters more than feature completeness. The MVP should ship the moment Phase 1 + core Phase 2 views are ready.

5. **Self-hosted vs. cloud-first**: Langfuse proved that open-source-first builds community and trust. But cloud-hosted generates revenue faster. Recommendation: open source the core proxy from day one, cloud-host the dashboard and intelligence features.

6. **~~Naming~~**: Resolved — the product name is **Token Spy**.

7. **Ecosystem data privacy**: The Morningstar/community intelligence layer requires aggregated user data. Need a clear, trust-building approach: opt-in only, fully anonymized, no request content ever shared — only metrics (cost, latency, token counts, model names, stop reasons). Transparency report published quarterly.

8. **The cold start problem**: The public intelligence layer needs critical mass of data to be valuable. Strategy: launch with internal data (two agents, 9 models, 9,650+ turns), invite beta users from the OpenClaw community, and publish the first "State of LLM APIs" report as a marketing event.
