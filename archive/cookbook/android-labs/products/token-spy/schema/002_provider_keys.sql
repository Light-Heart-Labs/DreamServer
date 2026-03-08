-- Token Spy Database Schema Migration 002: Provider Keys & API Key Management
-- Adds tables for multi-tenancy and API key management (Phase 4f)

-- ============================================
-- API Keys table (for tenant authentication)
-- ============================================

CREATE TABLE IF NOT EXISTS api_keys (
    key_id TEXT PRIMARY KEY,  -- tp_live_xxx or tp_test_xxx format
    key_hash TEXT UNIQUE NOT NULL,  -- SHA-256 hash for lookup
    key_prefix TEXT NOT NULL,  -- First 8 chars for display
    
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    
    -- Key type
    environment TEXT NOT NULL DEFAULT 'live',  -- 'live' or 'test'
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    expires_at TIMESTAMPTZ,
    
    -- Rate limiting
    rate_limit_rpm INTEGER DEFAULT 60,  -- Requests per minute
    rate_limit_rpd INTEGER DEFAULT 10000,  -- Requests per day
    
    -- Budget
    monthly_token_limit INTEGER,  -- Null = unlimited
    tokens_used_this_month INTEGER DEFAULT 0,
    monthly_cost_limit DECIMAL(12, 4),  -- In USD
    cost_used_this_month DECIMAL(12, 4) DEFAULT 0,
    
    -- Tracking
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    use_count INTEGER DEFAULT 0,
    
    -- Allowed providers (JSON array: ['anthropic', 'openai', 'vllm'])
    allowed_providers JSONB DEFAULT '["*"]',
    
    -- Metadata
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys (tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys (is_active, expires_at) WHERE is_active = TRUE;

-- ============================================
-- Provider Keys table (encrypted upstream API keys)
-- ============================================

CREATE TABLE IF NOT EXISTS provider_keys (
    id SERIAL PRIMARY KEY,
    
    tenant_id TEXT NOT NULL,
    provider TEXT NOT NULL,  -- 'anthropic', 'openai', 'google', 'vllm'
    
    name TEXT NOT NULL,  -- Human-readable name
    
    -- Encrypted key storage
    key_prefix TEXT NOT NULL,  -- First 8 chars for display
    encrypted_key TEXT NOT NULL,  -- AES-256 encrypted
    iv TEXT NOT NULL,  -- Initialization vector
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,  -- Use this key if multiple exist
    
    -- Rotation tracking
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    use_count INTEGER DEFAULT 0,
    
    -- Metadata
    metadata JSONB,
    
    -- Ensure only one default per tenant/provider
    CONSTRAINT unique_default_per_tenant_provider 
        UNIQUE (tenant_id, provider, is_default)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS idx_provider_keys_tenant ON provider_keys (tenant_id, provider, is_active);
CREATE INDEX IF NOT EXISTS idx_provider_keys_active ON provider_keys (tenant_id, provider, is_active) WHERE is_active = TRUE;

-- Trigger to ensure only one default key per tenant/provider
CREATE OR REPLACE FUNCTION enforce_single_default_provider_key()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_default = TRUE THEN
        UPDATE provider_keys 
        SET is_default = FALSE 
        WHERE tenant_id = NEW.tenant_id 
          AND provider = NEW.provider 
          AND is_default = TRUE 
          AND id != NEW.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_single_default_provider_key ON provider_keys;
CREATE TRIGGER trigger_single_default_provider_key
    AFTER INSERT OR UPDATE ON provider_keys
    FOR EACH ROW
    EXECUTE FUNCTION enforce_single_default_provider_key();

-- ============================================
-- Tenants table (for multi-tenancy)
-- ============================================

CREATE TABLE IF NOT EXISTS tenants (
    tenant_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Quotas
    max_api_keys INTEGER DEFAULT 10,
    max_monthly_tokens INTEGER,  -- Across all keys
    max_monthly_cost DECIMAL(12, 4),  -- Across all keys
    
    -- Contact
    contact_email TEXT,
    notification_webhook_url TEXT,
    
    -- Metadata
    metadata JSONB
);

-- ============================================
-- Budget usage tracking (monthly rollup)
-- ============================================

CREATE TABLE IF NOT EXISTS monthly_usage (
    id BIGSERIAL,
    year_month TEXT NOT NULL,  -- '2024-02'
    tenant_id TEXT NOT NULL,
    api_key_id TEXT,
    
    -- Usage totals
    request_count INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_cost DECIMAL(12, 8) DEFAULT 0,
    
    -- Updated at
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    PRIMARY KEY (year_month, tenant_id, api_key_id)
);

CREATE INDEX IF NOT EXISTS idx_monthly_usage_tenant ON monthly_usage (tenant_id, year_month);

-- ============================================
-- Update timestamps trigger
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DROP TRIGGER IF EXISTS trigger_api_keys_updated_at ON api_keys;
CREATE TRIGGER trigger_api_keys_updated_at
    BEFORE UPDATE ON api_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_provider_keys_updated_at ON provider_keys;
CREATE TRIGGER trigger_provider_keys_updated_at
    BEFORE UPDATE ON provider_keys
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_tenants_updated_at ON tenants;
CREATE TRIGGER trigger_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Default data
-- ============================================

-- Insert default tenant (required for single-tenant mode)
INSERT INTO tenants (tenant_id, name, contact_email)
VALUES ('default', 'Default Tenant', 'admin@localhost')
ON CONFLICT (tenant_id) DO NOTHING;

-- NOTE: Development API keys are in dev-seed.sql (not applied in production)
