-- Token Spy Database Schema Migration 003: Multi-tenancy Enhancements
-- Adds plan_tier and max_provider_keys to tenants table for Phase 4a

-- ============================================
-- Add plan_tier column to tenants
-- ============================================

-- Add plan_tier enum type
DO $$ BEGIN
    CREATE TYPE plan_tier_enum AS ENUM ('free', 'starter', 'pro', 'enterprise');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add plan_tier column if not exists
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'free';

-- Add max_provider_keys column if not exists
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS max_provider_keys INTEGER DEFAULT 3;

-- ============================================
-- Add tenant_id to tables that need isolation
-- ============================================

-- Add tenant_id to sessions table
ALTER TABLE sessions 
ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_tenant ON sessions (tenant_id, started_at DESC);

-- Add tenant_id to agents table  
ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents (tenant_id, last_seen DESC);

-- Add tenant_id to alert_rules table
ALTER TABLE alert_rules 
ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant ON alert_rules (tenant_id, enabled);

-- Add tenant_id to alerts table
ALTER TABLE alerts 
ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_alerts_tenant ON alerts (tenant_id, triggered_at DESC);

-- Add tenant_id to system_prompts table
ALTER TABLE system_prompts 
ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_system_prompts_tenant ON system_prompts (tenant_id);

-- ============================================
-- Update monthly_usage for tenant isolation
-- ============================================

-- Already has tenant_id, just ensure index exists
CREATE INDEX IF NOT EXISTS idx_monthly_usage_tenant_month ON monthly_usage (tenant_id, year_month DESC);

-- ============================================
-- Foreign key constraints (optional, add if referential integrity needed)
-- ============================================

-- Note: Not adding FK constraints here to avoid blocking on tenant creation
-- If needed, add them separately:
-- ALTER TABLE api_keys ADD CONSTRAINT fk_api_keys_tenant 
--     FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);
-- ALTER TABLE provider_keys ADD CONSTRAINT fk_provider_keys_tenant 
--     FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id);

-- ============================================
-- Update existing tenants with default tier
-- ============================================

UPDATE tenants 
SET plan_tier = 'free', max_provider_keys = 3
WHERE plan_tier IS NULL;

-- Update default tenant to enterprise for development
UPDATE tenants 
SET plan_tier = 'enterprise', 
    max_api_keys = NULL,  -- unlimited
    max_provider_keys = NULL,  -- unlimited
    max_monthly_tokens = NULL,  -- unlimited
    max_monthly_cost = NULL  -- unlimited
WHERE tenant_id = 'default';

-- ============================================
-- Add tenant-scoped views
-- ============================================

-- View for tenant usage summary (current month)
CREATE OR REPLACE VIEW tenant_monthly_summary AS
SELECT 
    t.tenant_id,
    t.name as tenant_name,
    t.plan_tier,
    t.max_monthly_tokens,
    t.max_monthly_cost,
    COALESCE(SUM(mu.total_tokens), 0) as tokens_used,
    COALESCE(SUM(mu.total_cost), 0) as cost_used,
    COALESCE(SUM(mu.request_count), 0) as request_count,
    CASE 
        WHEN t.max_monthly_tokens IS NULL THEN 1.0
        ELSE COALESCE(SUM(mu.total_tokens), 0)::float / t.max_monthly_tokens
    END as token_usage_pct,
    CASE 
        WHEN t.max_monthly_cost IS NULL THEN 1.0
        ELSE COALESCE(SUM(mu.total_cost), 0)::float / t.max_monthly_cost
    END as cost_usage_pct
FROM tenants t
LEFT JOIN monthly_usage mu ON t.tenant_id = mu.tenant_id 
    AND mu.year_month = TO_CHAR(NOW(), 'YYYY-MM')
WHERE t.is_active = TRUE
GROUP BY t.tenant_id, t.name, t.plan_tier, t.max_monthly_tokens, t.max_monthly_cost;

-- ============================================
-- Grant permissions (adjust as needed for your DB user)
-- ============================================

-- GRANT SELECT, INSERT, UPDATE ON tenants TO token_spy;
-- GRANT SELECT ON tenant_monthly_summary TO token_spy;
