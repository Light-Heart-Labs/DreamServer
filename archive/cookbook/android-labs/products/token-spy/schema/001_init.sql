-- Token Spy Database Schema
-- PostgreSQL + TimescaleDB Initialization
-- Run automatically on container first start

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================
-- Core Tables
-- ============================================

-- API requests log (main time-series data)
CREATE TABLE IF NOT EXISTS api_requests (
    id BIGSERIAL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id TEXT,
    request_id TEXT UNIQUE,
    
    -- Request metadata
    provider TEXT NOT NULL,  -- 'anthropic', 'openai', 'google', 'local'
    model TEXT NOT NULL,
    api_key_prefix TEXT,  -- First 8 chars for grouping
    
    -- Token counts
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    
    -- Cost (in USD, calculated at request time)
    prompt_cost DECIMAL(12, 8) DEFAULT 0,
    completion_cost DECIMAL(12, 8) DEFAULT 0,
    total_cost DECIMAL(12, 8) DEFAULT 0,
    
    -- Performance metrics
    latency_ms INTEGER,  -- Total request latency
    time_to_first_token_ms INTEGER,  -- For streaming
    
    -- Response metadata
    status_code INTEGER DEFAULT 200,
    finish_reason TEXT,  -- 'stop', 'length', 'error', etc.
    
    -- System prompt info (for decomposition analysis)
    system_prompt_hash TEXT,  -- Hash of system prompt
    system_prompt_length INTEGER,
    
    -- Tenant attribution (Phase 4 multi-tenancy)
    tenant_id TEXT,  -- From X-OpenClaw-Tenant-ID header
    
    -- Raw request/response (optional, for debugging)
    -- request_body JSONB,
    -- response_body JSONB,
    
    PRIMARY KEY (id, timestamp)
);

-- Convert to hypertable for time-series optimization
SELECT create_hypertable('api_requests', 'timestamp', 
    chunk_time_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_api_requests_session ON api_requests (session_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_requests_provider ON api_requests (provider, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_requests_model ON api_requests (model, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_requests_api_key ON api_requests (api_key_prefix, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_requests_tenant ON api_requests (tenant_id, timestamp DESC);

-- ============================================
-- Session tracking
-- ============================================

CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    agent_name TEXT,
    total_requests INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost DECIMAL(12, 8) DEFAULT 0,
    health_score DECIMAL(3, 2),  -- 0.00 to 1.00
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions (agent_name, started_at DESC);

-- ============================================
-- Agents registry
-- ============================================

CREATE TABLE IF NOT EXISTS agents (
    agent_id TEXT PRIMARY KEY,
    agent_name TEXT NOT NULL,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_requests INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost DECIMAL(12, 8) DEFAULT 0,
    api_key_prefix TEXT,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents (last_seen DESC);

-- ============================================
-- System prompt analysis (for decomposition insights)
-- ============================================

CREATE TABLE IF NOT EXISTS system_prompts (
    prompt_hash TEXT PRIMARY KEY,
    prompt_text TEXT NOT NULL,  -- Truncated if too long
    token_count INTEGER,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    usage_count INTEGER DEFAULT 1
);

-- ============================================
-- Alerts configuration
-- ============================================

CREATE TABLE IF NOT EXISTS alert_rules (
    rule_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL,  -- 'cost', 'token', 'latency', 'error_rate'
    threshold DECIMAL(12, 4) NOT NULL,
    window_minutes INTEGER DEFAULT 60,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata JSONB
);

CREATE TABLE IF NOT EXISTS alerts (
    alert_id BIGSERIAL PRIMARY KEY,
    rule_id INTEGER REFERENCES alert_rules(rule_id),
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    severity TEXT NOT NULL,  -- 'info', 'warning', 'critical'
    message TEXT NOT NULL,
    value DECIMAL(12, 4),
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON alerts (triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_acknowledged ON alerts (acknowledged_at) WHERE acknowledged_at IS NULL;

-- ============================================
-- Continuous aggregates for fast dashboards
-- ============================================

-- Hourly token/cost summary
CREATE MATERIALIZED VIEW IF NOT EXISTS hourly_summary
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', timestamp) AS bucket,
    provider,
    model,
    COUNT(*) as request_count,
    SUM(prompt_tokens) as total_prompt_tokens,
    SUM(completion_tokens) as total_completion_tokens,
    SUM(total_tokens) as total_tokens,
    SUM(total_cost) as total_cost,
    AVG(latency_ms) as avg_latency_ms
FROM api_requests
GROUP BY bucket, provider, model
WITH NO DATA;

-- Add policy to refresh continuously
SELECT add_continuous_aggregate_policy('hourly_summary',
    start_offset => INTERVAL '1 month',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '5 minutes',
    if_not_exists => TRUE
);

-- ============================================
-- Default data
-- ============================================

-- Insert default alert rules
INSERT INTO alert_rules (name, rule_type, threshold, window_minutes)
VALUES
    ('High Hourly Cost', 'cost', 10.00, 60),  -- $10/hour
    ('High Token Usage', 'token', 1000000, 60),  -- 1M tokens/hour
    ('High Error Rate', 'error_rate', 0.10, 15),  -- 10% errors in 15 min
    ('High Latency', 'latency', 10000, 15)  -- 10s avg latency in 15 min
ON CONFLICT DO NOTHING;
