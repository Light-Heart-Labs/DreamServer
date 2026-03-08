-- Token Spy — Development Seed Data
-- ============================================
-- ⚠️  DO NOT RUN IN PRODUCTION
-- This creates a well-known test API key for local development.
--
-- To apply: psql -U token_spy -d token_spy -f dev-seed.sql
-- ============================================

-- Development API key (key: tp_test_dev_key_12345)
-- Use this key for local testing. Anyone with this file knows the key.
INSERT INTO api_keys (
    key_id, key_hash, key_prefix, tenant_id, name, environment,
    rate_limit_rpm, rate_limit_rpd, is_active
)
VALUES (
    'tp_test_dev_key_12345',
    'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3',
    'tp_test',
    'default',
    'Development Key (INSECURE)',
    'test',
    1000,
    100000,
    TRUE
)
ON CONFLICT (key_id) DO UPDATE SET
    name = 'Development Key (INSECURE)',
    environment = 'test';
