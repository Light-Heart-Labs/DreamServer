"""
Token Spy Database Backend

PostgreSQL interface for:
- Provider key storage/retrieval (encrypted)
- API key management (hashed)
- Usage logging to TimescaleDB
- Tenant-scoped queries
"""

import os
import logging
from typing import Optional, Dict, Any, List, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from contextlib import contextmanager

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    from psycopg2.pool import ThreadedConnectionPool
    POSTGRES_AVAILABLE = True
except ImportError:
    POSTGRES_AVAILABLE = False

log = logging.getLogger("token-spy-db")

# ── Configuration ────────────────────────────────────────────────────────────

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    log.warning(
        "DATABASE_URL is not set. Database connections will fail until it is configured."
    )

# Encryption key for provider keys (must match dashboard)
PROVIDER_KEY_SECRET = os.environ.get("PROVIDER_KEY_SECRET")
if not PROVIDER_KEY_SECRET:
    log.warning(
        "PROVIDER_KEY_SECRET not set — provider key encryption disabled. "
        "Set this in production to enable secure key storage."
    )

# Connection pool
_pool: Optional["ThreadedConnectionPool"] = None

# ── Data Models ─────────────────────────────────────────────────────────────

@dataclass
class ProviderKey:
    """Encrypted provider API key."""
    id: int
    tenant_id: str
    provider: str  # 'anthropic', 'openai', 'google', 'local'
    name: str
    key_prefix: str  # First 8 chars for display
    encrypted_key: str
    iv: str  # Initialization vector for decryption
    is_active: bool
    is_default: bool
    created_at: datetime
    updated_at: datetime
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    use_count: int = 0
    metadata: Optional[Dict] = None


@dataclass
class APIKey:
    """API key for tenant authentication."""
    key_id: str
    key_hash: str
    key_prefix: str
    tenant_id: str
    name: str
    environment: str  # 'live' or 'test'
    is_active: bool
    rate_limit_rpm: int
    rate_limit_rpd: int
    monthly_token_limit: Optional[int]
    tokens_used_this_month: int
    monthly_cost_limit: Optional[float]
    cost_used_this_month: float
    created_at: datetime
    updated_at: datetime
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    use_count: int = 0
    allowed_providers: Optional[List[str]] = None
    metadata: Optional[Dict] = None


@dataclass
class UsageEntry:
    """Token usage log entry."""
    session_id: Optional[str]
    request_id: str
    provider: str
    model: str
    api_key_prefix: Optional[str]
    tenant_id: Optional[str]
    
    # Token counts
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    
    # Costs (in USD)
    prompt_cost: float = 0.0
    completion_cost: float = 0.0
    total_cost: float = 0.0
    
    # Performance
    latency_ms: Optional[int] = None
    time_to_first_token_ms: Optional[int] = None
    
    # Response metadata
    status_code: int = 200
    finish_reason: Optional[str] = None
    
    # System prompt
    system_prompt_hash: Optional[str] = None
    system_prompt_length: Optional[int] = None
    
    # Raw data (optional)
    request_body: Optional[Dict] = None
    response_body: Optional[Dict] = None


@dataclass
class UsageStats:
    """Aggregated usage statistics."""
    total_requests: int
    total_tokens: int
    total_prompt_tokens: int
    total_completion_tokens: int
    total_cost: float
    avg_latency_ms: Optional[float]
    avg_tokens_per_request: Optional[float]
    period_start: datetime
    period_end: datetime


@dataclass
class Tenant:
    """Tenant record for multi-tenancy."""
    tenant_id: str
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime
    plan_tier: Optional[str] = None  # 'free', 'starter', 'pro', 'enterprise'
    max_api_keys: Optional[int] = None
    max_provider_keys: Optional[int] = None
    max_monthly_tokens: Optional[int] = None
    max_monthly_cost: Optional[float] = None
    contact_email: Optional[str] = None
    notification_webhook_url: Optional[str] = None
    metadata: Optional[Dict] = None


@dataclass
class User:
    """User account within a tenant."""
    user_id: str
    tenant_id: str
    email: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    tenant_role: str = "member"  # 'owner', 'admin', 'member', 'viewer'
    is_active: bool = True
    email_verified: bool = False
    last_login_at: Optional[datetime] = None
    sso_provider: Optional[str] = None
    sso_external_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    preferences: Optional[Dict] = None
    metadata: Optional[Dict] = None


@dataclass
class Team:
    """Team within an organization."""
    team_id: str
    tenant_id: str
    name: str
    slug: str
    description: Optional[str] = None
    is_default: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None


@dataclass
class TeamMembership:
    """Team membership with role."""
    membership_id: str
    team_id: str
    user_id: str
    team_role: str = "member"  # 'lead', 'member', 'viewer'
    joined_at: Optional[datetime] = None
    invited_by: Optional[str] = None


@dataclass
class OrganizationSettings:
    """Organization-level settings."""
    tenant_id: str
    organization_name: Optional[str] = None
    logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    primary_color: str = "#10b981"
    saml_enabled: bool = False
    enforce_sso: bool = False
    require_2fa: bool = False
    session_timeout_minutes: int = 480
    allow_public_sharing: bool = False
    admin_email: Optional[str] = None
    updated_at: Optional[datetime] = None


# ── Connection Pool Management ───────────────────────────────────────────────

def init_pool(database_url: Optional[str] = None, min_conn: int = 10, max_conn: int = 500):
    """Initialize the connection pool."""
    global _pool
    if not POSTGRES_AVAILABLE:
        raise RuntimeError("psycopg2 not installed")
    
    if _pool is None:
        url = database_url or DATABASE_URL
        if not url:
            raise RuntimeError(
                "DATABASE_URL environment variable is required. "
                "Example: postgresql://token_spy:yourpassword@localhost:5432/token_spy"
            )
        _pool = ThreadedConnectionPool(min_conn, max_conn, url)
        log.info(f"Database pool initialized (min={min_conn}, max={max_conn})")
    return _pool


def get_connection():
    """Get a connection from the pool."""
    if _pool is None:
        init_pool()
    return _pool.getconn()


def put_connection(conn):
    """Return a connection to the pool."""
    if _pool:
        _pool.putconn(conn)


@contextmanager
def get_db_connection():
    """Context manager for database connections."""
    conn = None
    try:
        conn = get_connection()
        yield conn
    finally:
        if conn:
            put_connection(conn)


# ── Database Backend ─────────────────────────────────────────────────────────

class DatabaseBackend:
    """PostgreSQL backend for Token Spy."""
    
    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or DATABASE_URL
        self._init_pool()
        
    def _init_pool(self):
        """Initialize connection pool if not already done."""
        if not POSTGRES_AVAILABLE:
            raise RuntimeError("psycopg2 not installed")
        init_pool(self.database_url)
    
    def init_db(self):
        """Initialize database tables. Called on startup."""
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
            log.info("Database connected successfully")
        except Exception as e:
            log.error(f"Database connection failed: {e}")
            raise
    
    # ── API Keys ────────────────────────────────────────────────────────────
    
    def get_api_key_by_hash(self, key_hash: str) -> Optional[APIKey]:
        """Get API key by its SHA-256 hash."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        key_id, key_hash, key_prefix, tenant_id, name,
                        environment, is_active, rate_limit_rpm, rate_limit_rpd,
                        monthly_token_limit, tokens_used_this_month,
                        monthly_cost_limit, cost_used_this_month,
                        created_at, updated_at, expires_at, last_used_at, use_count,
                        allowed_providers, metadata
                    FROM api_keys
                    WHERE key_hash = %s AND is_active = TRUE
                      AND (expires_at IS NULL OR expires_at > NOW())
                      AND revoked_at IS NULL
                """, (key_hash,))
                row = cur.fetchone()
                
                if row:
                    return APIKey(**dict(row))
                return None
    
    def update_api_key_usage(self, key_id: str, tokens_used: int, cost: float) -> None:
        """Update API key usage counters."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE api_keys
                    SET tokens_used_this_month = tokens_used_this_month + %s,
                        cost_used_this_month = cost_used_this_month + %s,
                        use_count = use_count + 1,
                        last_used_at = NOW()
                    WHERE key_id = %s
                """, (tokens_used, cost, key_id))
                conn.commit()
    
    # ── Provider Keys ───────────────────────────────────────────────────────
    
    def get_active_provider_key(
        self,
        tenant_id: str,
        provider: str
    ) -> Optional[ProviderKey]:
        """Get the active provider key for a tenant.
        
        Returns the default key first, then the most recently used active key.
        """
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # First try to get the default key
                cur.execute("""
                    SELECT 
                        id, tenant_id, provider, name, key_prefix,
                        encrypted_key, iv, is_active, is_default,
                        created_at, updated_at, expires_at, last_used_at, use_count, metadata
                    FROM provider_keys
                    WHERE tenant_id = %s 
                      AND provider = %s 
                      AND is_active = TRUE
                      AND is_default = TRUE
                      AND (expires_at IS NULL OR expires_at > NOW())
                """, (tenant_id, provider))
                row = cur.fetchone()
                
                if row:
                    return ProviderKey(**dict(row))
                
                # Fallback to most recently used active key
                cur.execute("""
                    SELECT 
                        id, tenant_id, provider, name, key_prefix,
                        encrypted_key, iv, is_active, is_default,
                        created_at, updated_at, expires_at, last_used_at, use_count, metadata
                    FROM provider_keys
                    WHERE tenant_id = %s 
                      AND provider = %s 
                      AND is_active = TRUE
                      AND (expires_at IS NULL OR expires_at > NOW())
                    ORDER BY last_used_at DESC NULLS LAST, created_at DESC
                    LIMIT 1
                """, (tenant_id, provider))
                row = cur.fetchone()
                
                if row:
                    return ProviderKey(**dict(row))
                return None
    
    def get_provider_keys(self, tenant_id: str, provider: Optional[str] = None) -> List[ProviderKey]:
        """Get all provider keys for a tenant."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if provider:
                    cur.execute("""
                        SELECT 
                            id, tenant_id, provider, name, key_prefix,
                            encrypted_key, iv, is_active, is_default,
                            created_at, updated_at, expires_at, last_used_at, use_count, metadata
                        FROM provider_keys
                        WHERE tenant_id = %s AND provider = %s
                        ORDER BY is_default DESC, created_at DESC
                    """, (tenant_id, provider))
                else:
                    cur.execute("""
                        SELECT 
                            id, tenant_id, provider, name, key_prefix,
                            encrypted_key, iv, is_active, is_default,
                            created_at, updated_at, expires_at, last_used_at, use_count, metadata
                        FROM provider_keys
                        WHERE tenant_id = %s
                        ORDER BY provider, is_default DESC, created_at DESC
                    """, (tenant_id,))
                
                rows = cur.fetchall()
                return [ProviderKey(**dict(row)) for row in rows]
    
    def store_provider_key(self, key: ProviderKey) -> None:
        """Store a new provider key."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO provider_keys (
                        tenant_id, provider, name, key_prefix,
                        encrypted_key, iv, is_active, is_default, metadata
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                """, (
                    key.tenant_id, key.provider, key.name, key.key_prefix,
                    key.encrypted_key, key.iv, key.is_active, key.is_default,
                    psycopg2.extras.Json(key.metadata) if key.metadata else None
                ))
                result = cur.fetchone()
                conn.commit()
                key.id = result[0]
    
    def update_provider_key_usage(self, key_id: int) -> None:
        """Update provider key last_used_at and use_count."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE provider_keys
                    SET use_count = use_count + 1,
                        last_used_at = NOW()
                    WHERE id = %s
                """, (key_id,))
                conn.commit()
    
    # ── Usage Logging ────────────────────────────────────────────────────────
    
    def log_usage(self, entry: UsageEntry) -> None:
        """Log a usage entry to the database."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO api_requests (
                        timestamp, session_id, request_id, provider, model,
                        api_key_prefix, tenant_id, prompt_tokens, completion_tokens,
                        total_tokens, prompt_cost, completion_cost, total_cost,
                        latency_ms, time_to_first_token_ms, status_code, finish_reason,
                        system_prompt_hash, system_prompt_length
                    ) VALUES (NOW(), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    entry.session_id, entry.request_id, entry.provider, entry.model,
                    entry.api_key_prefix, entry.tenant_id, entry.prompt_tokens,
                    entry.completion_tokens, entry.total_tokens, entry.prompt_cost,
                    entry.completion_cost, entry.total_cost, entry.latency_ms,
                    entry.time_to_first_token_ms, entry.status_code, entry.finish_reason,
                    entry.system_prompt_hash, entry.system_prompt_length
                ))
                conn.commit()
        
        log.debug(f"Logged usage: {entry.request_id} ({entry.total_tokens} tokens)")
    
    # ── Usage Statistics ─────────────────────────────────────────────────────
    
    def get_usage_stats(
        self,
        tenant_id: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None
    ) -> UsageStats:
        """Get aggregated usage statistics."""
        # Default time range: last 24 hours
        if end_time is None:
            end_time = datetime.now()
        if start_time is None:
            start_time = end_time - timedelta(hours=24)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Build dynamic query
                conditions = ["timestamp >= %s", "timestamp <= %s"]
                params = [start_time, end_time]
                
                if tenant_id:
                    conditions.append("tenant_id = %s")
                    params.append(tenant_id)
                if provider:
                    conditions.append("provider = %s")
                    params.append(provider)
                if model:
                    conditions.append("model = %s")
                    params.append(model)
                
                where_clause = " AND ".join(conditions)
                
                cur.execute(f"""
                    SELECT 
                        COUNT(*) as total_requests,
                        COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
                        COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
                        COALESCE(SUM(total_tokens), 0) as total_tokens,
                        COALESCE(SUM(total_cost), 0) as total_cost,
                        AVG(latency_ms) as avg_latency_ms
                    FROM api_requests
                    WHERE {where_clause}
                """, params)
                
                row = cur.fetchone()
                
                return UsageStats(
                    total_requests=row['total_requests'],
                    total_tokens=row['total_tokens'],
                    total_prompt_tokens=row['total_prompt_tokens'],
                    total_completion_tokens=row['total_completion_tokens'],
                    total_cost=float(row['total_cost']),
                    avg_latency_ms=float(row['avg_latency_ms']) if row['avg_latency_ms'] else None,
                    avg_tokens_per_request=row['total_tokens'] / max(row['total_requests'], 1),
                    period_start=start_time,
                    period_end=end_time
                )
    
    def get_hourly_usage(
        self,
        tenant_id: Optional[str] = None,
        hours: int = 24
    ) -> List[Dict[str, Any]]:
        """Get hourly usage breakdown."""
        start_time = datetime.now() - timedelta(hours=hours)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if tenant_id:
                    cur.execute("""
                        SELECT 
                            time_bucket('1 hour', timestamp) as hour,
                            provider,
                            model,
                            COUNT(*) as request_count,
                            SUM(total_tokens) as total_tokens,
                            SUM(total_cost) as total_cost,
                            AVG(latency_ms) as avg_latency_ms
                        FROM api_requests
                        WHERE timestamp >= %s AND tenant_id = %s
                        GROUP BY hour, provider, model
                        ORDER BY hour DESC
                    """, (start_time, tenant_id))
                else:
                    cur.execute("""
                        SELECT 
                            time_bucket('1 hour', timestamp) as hour,
                            provider,
                            model,
                            COUNT(*) as request_count,
                            SUM(total_tokens) as total_tokens,
                            SUM(total_cost) as total_cost,
                            AVG(latency_ms) as avg_latency_ms
                        FROM api_requests
                        WHERE timestamp >= %s
                        GROUP BY hour, provider, model
                        ORDER BY hour DESC
                    """, (start_time,))
                
                return [dict(row) for row in cur.fetchall()]
    
    def get_top_models(
        self,
        tenant_id: Optional[str] = None,
        days: int = 7,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get top models by usage."""
        start_time = datetime.now() - timedelta(days=days)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                if tenant_id:
                    cur.execute("""
                        SELECT 
                            provider,
                            model,
                            COUNT(*) as request_count,
                            SUM(total_tokens) as total_tokens,
                            SUM(total_cost) as total_cost,
                            AVG(latency_ms) as avg_latency_ms
                        FROM api_requests
                        WHERE timestamp >= %s AND tenant_id = %s
                        GROUP BY provider, model
                        ORDER BY total_cost DESC
                        LIMIT %s
                    """, (start_time, tenant_id, limit))
                else:
                    cur.execute("""
                        SELECT 
                            provider,
                            model,
                            COUNT(*) as request_count,
                            SUM(total_tokens) as total_tokens,
                            SUM(total_cost) as total_cost,
                            AVG(latency_ms) as avg_latency_ms
                        FROM api_requests
                        WHERE timestamp >= %s
                        GROUP BY provider, model
                        ORDER BY total_cost DESC
                        LIMIT %s
                    """, (start_time, limit))
                
                return [dict(row) for row in cur.fetchall()]
    
    def get_top_agents(
        self,
        tenant_id: Optional[str] = None,
        days: int = 7,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """Get top agents by usage (using agent_name from sessions)."""
        start_time = datetime.now() - timedelta(days=days)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Join with sessions to get agent names
                cur.execute("""
                    SELECT 
                        s.agent_name as agent_id,
                        COUNT(*) as request_count,
                        SUM(r.total_tokens) as total_tokens,
                        SUM(r.total_cost) as total_cost,
                        AVG(r.latency_ms) as avg_latency_ms,
                        SUM(CASE WHEN r.status_code >= 400 THEN 1 ELSE 0 END) as error_count,
                        AVG(CASE WHEN r.status_code < 400 THEN 1 ELSE 0 END) * 100 as success_rate
                    FROM api_requests r
                    LEFT JOIN sessions s ON r.session_id = s.session_id
                    WHERE r.timestamp >= %s
                    GROUP BY s.agent_name
                    ORDER BY total_cost DESC
                    LIMIT %s
                """, (start_time, limit))
                
                return [dict(row) for row in cur.fetchall()]
    
    def get_active_sessions(
        self,
        tenant_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Get active sessions."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Get sessions sorted by most recent first, filter by active (no ended_at)
                if tenant_id:
                    if status and status == "active":
                        # Active sessions have ended_at IS NULL
                        cur.execute("""
                            SELECT 
                                session_id,
                                agent_name as agent_id,
                                'default' as tenant_id,
                                started_at,
                                started_at as last_activity,
                                'active' as status,
                                total_requests as message_count,
                                total_tokens as tokens_used,
                                total_cost
                            FROM sessions
                            WHERE ended_at IS NULL
                            ORDER BY started_at DESC
                            LIMIT %s
                        """, (limit,))
                    else:
                        cur.execute("""
                            SELECT 
                                session_id,
                                agent_name as agent_id,
                                'default' as tenant_id,
                                started_at,
                                started_at as last_activity,
                                'active' as status,
                                total_requests as message_count,
                                total_tokens as tokens_used,
                                total_cost
                            FROM sessions
                            ORDER BY started_at DESC
                            LIMIT %s
                        """, (limit,))
                else:
                    if status and status == "active":
                        cur.execute("""
                            SELECT 
                                session_id,
                                agent_name as agent_id,
                                'default' as tenant_id,
                                started_at,
                                started_at as last_activity,
                                'active' as status,
                                total_requests as message_count,
                                total_tokens as tokens_used,
                                total_cost
                            FROM sessions
                            WHERE ended_at IS NULL
                            ORDER BY started_at DESC
                            LIMIT %s
                        """, (limit,))
                    else:
                        cur.execute("""
                            SELECT 
                                session_id,
                                agent_name as agent_id,
                                'default' as tenant_id,
                                started_at,
                                started_at as last_activity,
                                'active' as status,
                                total_requests as message_count,
                                total_tokens as tokens_used,
                                total_cost
                            FROM sessions
                            ORDER BY started_at DESC
                            LIMIT %s
                        """, (limit,))
                
                return [dict(row) for row in cur.fetchall()]
    
    def terminate_session(
        self,
        session_id: str,
        tenant_id: Optional[str] = None
    ) -> bool:
        """Mark a session as terminated by setting ended_at."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    UPDATE sessions
                    SET ended_at = NOW()
                    WHERE session_id = %s AND ended_at IS NULL
                    RETURNING session_id
                """, (session_id,))
                
                return bool(cur.fetchone())
    
    # ── Tenant Management ────────────────────────────────────────────────────
    
    def get_tenant(self, tenant_id: str) -> Optional[Tenant]:
        """Get tenant by ID."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        tenant_id, name, is_active, created_at, updated_at,
                        plan_tier, max_api_keys, max_provider_keys,
                        max_monthly_tokens, max_monthly_cost,
                        contact_email, notification_webhook_url, metadata
                    FROM tenants
                    WHERE tenant_id = %s
                """, (tenant_id,))
                row = cur.fetchone()
                
                if row:
                    return Tenant(**dict(row))
                return None
    
    def create_tenant(
        self,
        tenant_id: str,
        name: str,
        plan_tier: str = "free",
        max_api_keys: Optional[int] = None,
        max_provider_keys: Optional[int] = None,
        max_monthly_tokens: Optional[int] = None,
        max_monthly_cost: Optional[float] = None,
        contact_email: Optional[str] = None,
        metadata: Optional[Dict] = None,
    ) -> Tenant:
        """Create a new tenant."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO tenants (
                        tenant_id, name, plan_tier, max_api_keys, max_provider_keys,
                        max_monthly_tokens, max_monthly_cost, contact_email, metadata
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING 
                        tenant_id, name, is_active, created_at, updated_at,
                        plan_tier, max_api_keys, max_provider_keys,
                        max_monthly_tokens, max_monthly_cost,
                        contact_email, notification_webhook_url, metadata
                """, (
                    tenant_id, name, plan_tier, max_api_keys, max_provider_keys,
                    max_monthly_tokens, max_monthly_cost, contact_email,
                    psycopg2.extras.Json(metadata) if metadata else None
                ))
                row = cur.fetchone()
                conn.commit()
                
                return Tenant(**dict(row))
    
    def update_tenant(self, tenant_id: str, updates: Dict[str, Any]) -> Optional[Tenant]:
        """Update tenant fields."""
        if not updates:
            return self.get_tenant(tenant_id)
        
        # Build SET clause dynamically
        set_parts = []
        params = []
        for key, value in updates.items():
            if key == "metadata":
                set_parts.append(f"{key} = %s")
                params.append(psycopg2.extras.Json(value) if value else None)
            else:
                set_parts.append(f"{key} = %s")
                params.append(value)
        
        params.append(tenant_id)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    UPDATE tenants
                    SET {', '.join(set_parts)}, updated_at = NOW()
                    WHERE tenant_id = %s
                    RETURNING 
                        tenant_id, name, is_active, created_at, updated_at,
                        plan_tier, max_api_keys, max_provider_keys,
                        max_monthly_tokens, max_monthly_cost,
                        contact_email, notification_webhook_url, metadata
                """, params)
                row = cur.fetchone()
                conn.commit()
                
                if row:
                    return Tenant(**dict(row))
                return None
    
    def list_tenants(
        self,
        is_active: Optional[bool] = None,
        plan_tier: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Tenant]:
        """List tenants with optional filters."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                conditions = []
                params = []
                
                if is_active is not None:
                    conditions.append("is_active = %s")
                    params.append(is_active)
                if plan_tier is not None:
                    conditions.append("plan_tier = %s")
                    params.append(plan_tier)
                
                where_clause = ""
                if conditions:
                    where_clause = "WHERE " + " AND ".join(conditions)
                
                params.extend([limit, offset])
                
                cur.execute(f"""
                    SELECT 
                        tenant_id, name, is_active, created_at, updated_at,
                        plan_tier, max_api_keys, max_provider_keys,
                        max_monthly_tokens, max_monthly_cost,
                        contact_email, notification_webhook_url, metadata
                    FROM tenants
                    {where_clause}
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                """, params)
                
                rows = cur.fetchall()
                return [Tenant(**dict(row)) for row in rows]
    
    def get_tenant_usage_counts(self, tenant_id: str) -> Dict[str, int]:
        """Get current resource counts for a tenant."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Count API keys
                cur.execute("""
                    SELECT COUNT(*) as count
                    FROM api_keys
                    WHERE tenant_id = %s AND is_active = TRUE AND revoked_at IS NULL
                """, (tenant_id,))
                api_keys_count = cur.fetchone()['count']
                
                # Count provider keys
                cur.execute("""
                    SELECT COUNT(*) as count
                    FROM provider_keys
                    WHERE tenant_id = %s AND is_active = TRUE
                """, (tenant_id,))
                provider_keys_count = cur.fetchone()['count']
                
                return {
                    "api_keys": api_keys_count,
                    "provider_keys": provider_keys_count,
                }

    # ── User Management ──────────────────────────────────────────────────────

    def get_user(self, user_id: str) -> Optional[User]:
        """Get user by ID."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        user_id::text, tenant_id, email, display_name, avatar_url,
                        tenant_role, is_active, email_verified, last_login_at,
                        sso_provider, sso_external_id, created_at, updated_at,
                        preferences, metadata
                    FROM users
                    WHERE user_id = %s
                """, (user_id,))
                row = cur.fetchone()
                if row:
                    return User(**dict(row))
                return None

    def get_user_by_email(self, tenant_id: str, email: str) -> Optional[User]:
        """Get user by email within a tenant."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        user_id::text, tenant_id, email, display_name, avatar_url,
                        tenant_role, is_active, email_verified, last_login_at,
                        sso_provider, sso_external_id, created_at, updated_at,
                        preferences, metadata
                    FROM users
                    WHERE tenant_id = %s AND email = %s
                """, (tenant_id, email))
                row = cur.fetchone()
                if row:
                    return User(**dict(row))
                return None

    def create_user(
        self,
        tenant_id: str,
        email: str,
        display_name: Optional[str] = None,
        tenant_role: str = "member",
        password_hash: Optional[str] = None,
        sso_provider: Optional[str] = None,
        sso_external_id: Optional[str] = None,
        metadata: Optional[Dict] = None,
    ) -> User:
        """Create a new user."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO users (
                        tenant_id, email, display_name, tenant_role,
                        password_hash, sso_provider, sso_external_id, metadata
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING 
                        user_id::text, tenant_id, email, display_name, avatar_url,
                        tenant_role, is_active, email_verified, last_login_at,
                        sso_provider, sso_external_id, created_at, updated_at,
                        preferences, metadata
                """, (
                    tenant_id, email, display_name, tenant_role,
                    password_hash, sso_provider, sso_external_id,
                    psycopg2.extras.Json(metadata) if metadata else None
                ))
                row = cur.fetchone()
                conn.commit()
                return User(**dict(row))

    def list_users(
        self,
        tenant_id: str,
        is_active: Optional[bool] = None,
        tenant_role: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[User]:
        """List users in a tenant."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                conditions = ["tenant_id = %s"]
                params = [tenant_id]
                
                if is_active is not None:
                    conditions.append("is_active = %s")
                    params.append(is_active)
                if tenant_role is not None:
                    conditions.append("tenant_role = %s")
                    params.append(tenant_role)
                
                where_clause = "WHERE " + " AND ".join(conditions)
                params.extend([limit, offset])
                
                cur.execute(f"""
                    SELECT 
                        user_id::text, tenant_id, email, display_name, avatar_url,
                        tenant_role, is_active, email_verified, last_login_at,
                        sso_provider, sso_external_id, created_at, updated_at,
                        preferences, metadata
                    FROM users
                    {where_clause}
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                """, params)
                
                rows = cur.fetchall()
                return [User(**dict(row)) for row in rows]

    def update_user(
        self,
        user_id: str,
        updates: Dict[str, Any],
    ) -> Optional[User]:
        """Update user fields."""
        if not updates:
            return self.get_user(user_id)
        
        set_parts = []
        params = []
        for key, value in updates.items():
            if key in ["metadata", "preferences"]:
                set_parts.append(f"{key} = %s")
                params.append(psycopg2.extras.Json(value) if value else None)
            else:
                set_parts.append(f"{key} = %s")
                params.append(value)
        
        params.append(user_id)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    UPDATE users
                    SET {', '.join(set_parts)}, updated_at = NOW()
                    WHERE user_id = %s
                    RETURNING 
                        user_id::text, tenant_id, email, display_name, avatar_url,
                        tenant_role, is_active, email_verified, last_login_at,
                        sso_provider, sso_external_id, created_at, updated_at,
                        preferences, metadata
                """, params)
                row = cur.fetchone()
                conn.commit()
                if row:
                    return User(**dict(row))
                return None

    def record_user_login(self, user_id: str) -> None:
        """Update last_login_at timestamp."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE users SET last_login_at = NOW() WHERE user_id = %s
                """, (user_id,))
                conn.commit()

    # ── Team Management ──────────────────────────────────────────────────────

    def get_team(self, team_id: str) -> Optional[Team]:
        """Get team by ID."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        team_id::text, tenant_id, name, slug, description,
                        is_default, created_at, updated_at, created_by::text
                    FROM teams
                    WHERE team_id = %s
                """, (team_id,))
                row = cur.fetchone()
                if row:
                    return Team(**dict(row))
                return None

    def create_team(
        self,
        tenant_id: str,
        name: str,
        slug: str,
        description: Optional[str] = None,
        is_default: bool = False,
        created_by: Optional[str] = None,
    ) -> Team:
        """Create a new team."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO teams (tenant_id, name, slug, description, is_default, created_by)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING 
                        team_id::text, tenant_id, name, slug, description,
                        is_default, created_at, updated_at, created_by::text
                """, (tenant_id, name, slug, description, is_default, created_by))
                row = cur.fetchone()
                conn.commit()
                return Team(**dict(row))

    def list_teams(
        self,
        tenant_id: str,
        include_default: bool = True,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Team]:
        """List teams in a tenant."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                conditions = ["tenant_id = %s"]
                params = [tenant_id]
                
                if not include_default:
                    conditions.append("is_default = FALSE")
                
                where_clause = "WHERE " + " AND ".join(conditions)
                params.extend([limit, offset])
                
                cur.execute(f"""
                    SELECT 
                        team_id::text, tenant_id, name, slug, description,
                        is_default, created_at, updated_at, created_by::text
                    FROM teams
                    {where_clause}
                    ORDER BY is_default DESC, created_at DESC
                    LIMIT %s OFFSET %s
                """, params)
                
                rows = cur.fetchall()
                return [Team(**dict(row)) for row in rows]

    def update_team(
        self,
        team_id: str,
        updates: Dict[str, Any],
    ) -> Optional[Team]:
        """Update team fields."""
        if not updates:
            return self.get_team(team_id)
        
        allowed = {"name", "slug", "description", "is_default"}
        set_parts = []
        params = []
        for key, value in updates.items():
            if key in allowed:
                set_parts.append(f"{key} = %s")
                params.append(value)
        
        if not set_parts:
            return self.get_team(team_id)
        
        params.append(team_id)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    UPDATE teams
                    SET {', '.join(set_parts)}, updated_at = NOW()
                    WHERE team_id = %s
                    RETURNING 
                        team_id::text, tenant_id, name, slug, description,
                        is_default, created_at, updated_at, created_by::text
                """, params)
                row = cur.fetchone()
                conn.commit()
                if row:
                    return Team(**dict(row))
                return None

    def delete_team(self, team_id: str) -> bool:
        """Delete a team and all its memberships."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM teams WHERE team_id = %s", (team_id,))
                deleted = cur.rowcount > 0
                conn.commit()
                return deleted

    # ── Team Memberships ─────────────────────────────────────────────────────

    def add_team_member(
        self,
        team_id: str,
        user_id: str,
        team_role: str = "member",
        invited_by: Optional[str] = None,
    ) -> TeamMembership:
        """Add a user to a team."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO team_memberships (team_id, user_id, team_role, invited_by)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (team_id, user_id) DO UPDATE SET
                        team_role = EXCLUDED.team_role,
                        joined_at = NOW()
                    RETURNING 
                        membership_id::text, team_id::text, user_id::text,
                        team_role, joined_at, invited_by::text
                """, (team_id, user_id, team_role, invited_by))
                row = cur.fetchone()
                conn.commit()
                return TeamMembership(**dict(row))

    def remove_team_member(self, team_id: str, user_id: str) -> bool:
        """Remove a user from a team."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM team_memberships WHERE team_id = %s AND user_id = %s",
                    (team_id, user_id)
                )
                deleted = cur.rowcount > 0
                conn.commit()
                return deleted

    def get_team_members(self, team_id: str) -> List[Dict[str, Any]]:
        """Get all members of a team with user details."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        tm.membership_id::text,
                        tm.team_id::text,
                        tm.user_id::text,
                        tm.team_role,
                        tm.joined_at,
                        tm.invited_by::text,
                        u.email,
                        u.display_name,
                        u.avatar_url,
                        u.tenant_role as user_tenant_role,
                        u.is_active
                    FROM team_memberships tm
                    JOIN users u ON tm.user_id = u.user_id
                    WHERE tm.team_id = %s
                    ORDER BY tm.joined_at ASC
                """, (team_id,))
                return [dict(row) for row in cur.fetchall()]

    def get_user_teams(self, user_id: str) -> List[Dict[str, Any]]:
        """Get all teams a user belongs to."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        t.team_id::text,
                        t.tenant_id,
                        t.name,
                        t.slug,
                        t.description,
                        t.is_default,
                        tm.team_role,
                        tm.joined_at
                    FROM teams t
                    JOIN team_memberships tm ON t.team_id = tm.team_id
                    WHERE tm.user_id = %s AND t.is_active = TRUE
                    ORDER BY t.is_default DESC, t.name ASC
                """, (user_id,))
                return [dict(row) for row in cur.fetchall()]

    def update_team_member_role(
        self,
        team_id: str,
        user_id: str,
        team_role: str,
    ) -> Optional[TeamMembership]:
        """Update a member's role in a team."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    UPDATE team_memberships
                    SET team_role = %s
                    WHERE team_id = %s AND user_id = %s
                    RETURNING 
                        membership_id::text, team_id::text, user_id::text,
                        team_role, joined_at, invited_by::text
                """, (team_role, team_id, user_id))
                row = cur.fetchone()
                conn.commit()
                if row:
                    return TeamMembership(**dict(row))
                return None

    # ── Organization Settings ────────────────────────────────────────────────

    def get_organization_settings(self, tenant_id: str) -> Optional[OrganizationSettings]:
        """Get organization settings."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        tenant_id, organization_name, logo_url, favicon_url,
                        primary_color, saml_enabled, enforce_sso, require_2fa,
                        session_timeout_minutes, allow_public_sharing,
                        admin_email, updated_at
                    FROM organization_settings
                    WHERE tenant_id = %s
                """, (tenant_id,))
                row = cur.fetchone()
                if row:
                    return OrganizationSettings(**dict(row))
                return None

    def update_organization_settings(
        self,
        tenant_id: str,
        updates: Dict[str, Any],
        updated_by: Optional[str] = None,
    ) -> Optional[OrganizationSettings]:
        """Update organization settings."""
        if not updates:
            return self.get_organization_settings(tenant_id)
        
        allowed = {
            "organization_name", "logo_url", "favicon_url", "primary_color",
            "saml_enabled", "saml_metadata_url", "saml_entity_id", "saml_sso_url",
            "enforce_sso", "require_2fa", "session_timeout_minutes",
            "password_min_length", "password_require_uppercase",
            "password_require_numbers", "password_require_symbols",
            "allow_public_sharing", "allow_api_key_creation",
            "allow_webhook_configuration", "admin_email", "security_alert_email", "billing_email"
        }
        
        set_parts = []
        params = []
        for key, value in updates.items():
            if key in allowed:
                set_parts.append(f"{key} = %s")
                params.append(value)
        
        if not set_parts:
            return self.get_organization_settings(tenant_id)
        
        set_parts.append("updated_at = NOW()")
        if updated_by:
            set_parts.append("updated_by = %s")
            params.append(updated_by)
        
        params.append(tenant_id)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    UPDATE organization_settings
                    SET {', '.join(set_parts)}
                    WHERE tenant_id = %s
                    RETURNING 
                        tenant_id, organization_name, logo_url, favicon_url,
                        primary_color, saml_enabled, enforce_sso, require_2fa,
                        session_timeout_minutes, allow_public_sharing,
                        admin_email, updated_at
                """, params)
                row = cur.fetchone()
                conn.commit()
                if row:
                    return OrganizationSettings(**dict(row))
                return None

    # ── RBAC Permissions ─────────────────────────────────────────────────────

    def get_user_permissions(self, user_id: str) -> List[str]:
        """Get all permissions for a user (through roles)."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT DISTINCT rp.permission_id
                    FROM user_roles ur
                    JOIN role_permissions rp ON ur.role_id = rp.role_id
                    WHERE ur.user_id = %s
                """, (user_id,))
                return [row[0] for row in cur.fetchall()]

    def user_has_permission(self, user_id: str, permission_id: str) -> bool:
        """Check if user has a specific permission."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT 1
                    FROM user_roles ur
                    JOIN role_permissions rp ON ur.role_id = rp.role_id
                    WHERE ur.user_id = %s AND rp.permission_id = %s
                    LIMIT 1
                """, (user_id, permission_id))
                return cur.fetchone() is not None

    # ── Invitation Management ────────────────────────────────────────────────

    def create_invitation(
        self,
        tenant_id: str,
        email: str,
        invited_by: str,
        role: str = "member",
        team_ids: Optional[List[str]] = None,
        expires_days: int = 7,
    ) -> Dict[str, Any]:
        """Create an invitation to join a tenant."""
        import secrets
        
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now() + timedelta(days=expires_days)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Get role_id from roles table (if exists), otherwise store role name directly
                cur.execute("""
                    SELECT role_id FROM roles WHERE tenant_id = %s AND name = %s LIMIT 1
                """, (tenant_id, role))
                role_row = cur.fetchone()
                role_id = role_row['role_id'] if role_row else None
                
                cur.execute("""
                    INSERT INTO invitations (
                        tenant_id, email, invited_by, role_id, team_ids, token, expires_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING 
                        invitation_id::text as id,
                        tenant_id,
                        email,
                        invited_by::text,
                        role_id::text,
                        team_ids,
                        token,
                        expires_at,
                        created_at
                """, (
                    tenant_id, email, invited_by, role_id,
                    team_ids or [], token, expires_at
                ))
                row = cur.fetchone()
                conn.commit()
                
                return {
                    "invitation_id": row['id'],
                    "tenant_id": row['tenant_id'],
                    "email": row['email'],
                    "invited_by": row['invited_by'],
                    "role": role,
                    "team_ids": row['team_ids'] or [],
                    "token": row['token'],
                    "expires_at": row['expires_at'],
                    "created_at": row['created_at'],
                }

    def get_invitation_by_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Get invitation by token (only if not expired and not accepted)."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        i.invitation_id::text as id,
                        i.tenant_id,
                        i.email,
                        i.invited_by::text,
                        i.role_id::text,
                        r.name as role_name,
                        i.team_ids,
                        i.token,
                        i.expires_at,
                        i.accepted_at,
                        i.accepted_by::text,
                        i.created_at,
                        t.name as tenant_name
                    FROM invitations i
                    LEFT JOIN roles r ON i.role_id = r.role_id
                    LEFT JOIN tenants t ON i.tenant_id = t.tenant_id
                    WHERE i.token = %s AND i.expires_at > NOW() AND i.accepted_at IS NULL
                """, (token,))
                row = cur.fetchone()
                
                if not row:
                    return None
                
                return {
                    "invitation_id": row['id'],
                    "tenant_id": row['tenant_id'],
                    "tenant_name": row['tenant_name'],
                    "email": row['email'],
                    "invited_by": row['invited_by'],
                    "role": row['role_name'] or "member",
                    "team_ids": row['team_ids'] or [],
                    "token": row['token'],
                    "expires_at": row['expires_at'],
                    "accepted_at": row['accepted_at'],
                    "accepted_by": row['accepted_by'],
                    "created_at": row['created_at'],
                }

    def accept_invitation(self, token: str, user_id: str) -> bool:
        """Mark an invitation as accepted."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE invitations
                    SET accepted_at = NOW(), accepted_by = %s
                    WHERE token = %s AND expires_at > NOW() AND accepted_at IS NULL
                """, (user_id, token))
                conn.commit()
                return cur.rowcount > 0

    def list_pending_invitations(
        self,
        tenant_id: str,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List pending invitations for a tenant."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        i.invitation_id::text as id,
                        i.tenant_id,
                        i.email,
                        i.invited_by::text,
                        u.email as invited_by_email,
                        u.display_name as invited_by_name,
                        i.role_id::text,
                        r.name as role_name,
                        i.team_ids,
                        i.expires_at,
                        i.created_at
                    FROM invitations i
                    LEFT JOIN roles r ON i.role_id = r.role_id
                    LEFT JOIN users u ON i.invited_by = u.user_id
                    WHERE i.tenant_id = %s AND i.accepted_at IS NULL AND i.expires_at > NOW()
                    ORDER BY i.created_at DESC
                    LIMIT %s OFFSET %s
                """, (tenant_id, limit, offset))
                
                invitations = []
                for row in cur.fetchall():
                    invitations.append({
                        "invitation_id": row['id'],
                        "tenant_id": row['tenant_id'],
                        "email": row['email'],
                        "invited_by": row['invited_by'],
                        "invited_by_email": row['invited_by_email'],
                        "invited_by_name": row['invited_by_name'],
                        "role": row['role_name'] or "member",
                        "team_ids": row['team_ids'] or [],
                        "expires_at": row['expires_at'],
                        "created_at": row['created_at'],
                    })
                return invitations

    def revoke_invitation(self, invitation_id: str) -> bool:
        """Revoke (delete) a pending invitation."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    DELETE FROM invitations
                    WHERE invitation_id = %s AND accepted_at IS NULL
                """, (invitation_id,))
                conn.commit()
                return cur.rowcount > 0


# ── Singleton Instance ───────────────────────────────────────────────────────

_db_instance: Optional[DatabaseBackend] = None


def get_db() -> DatabaseBackend:
    """Get the singleton database instance."""
    global _db_instance
    if _db_instance is None:
        _db_instance = DatabaseBackend()
    return _db_instance


def decrypt_provider_key(encrypted_key: str, iv: str) -> str:
    """Decrypt a provider API key.
    
    Must match the encryption used in the dashboard.
    """
    try:
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.hazmat.backends import default_backend
        import base64
        
        if not PROVIDER_KEY_SECRET:
            raise RuntimeError("PROVIDER_KEY_SECRET not set")
        
        # Derive 32-byte key from secret
        import hashlib
        key = hashlib.sha256(PROVIDER_KEY_SECRET.encode()).digest()
        
        # Decode base64
        encrypted_bytes = base64.b64decode(encrypted_key)
        iv_bytes = base64.b64decode(iv)
        
        # Decrypt
        cipher = Cipher(algorithms.AES(key), modes.CBC(iv_bytes), backend=default_backend())
        decryptor = cipher.decryptor()
        decrypted = decryptor.update(encrypted_bytes) + decryptor.finalize()
        
        # Remove PKCS7 padding
        padding_len = decrypted[-1]
        return decrypted[:-padding_len].decode('utf-8')
        
    except ImportError:
        log.error("cryptography library not installed. Run: pip install cryptography")
        raise
    except Exception as e:
        log.error(f"Failed to decrypt provider key: {e}")
        raise
