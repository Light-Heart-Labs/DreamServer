"""
Token Spy Auth Middleware — API Key Validation & Tenant Attribution

Phase 4f: Wire auth into proxy
- API key validation (SHA-256 hash lookup)
- Rate limiting (Redis-backed)
- Tenant header injection
- Budget enforcement
"""

import hashlib
import hmac
import logging
import os
import time
from typing import Optional
from dataclasses import dataclass
from contextlib import asynccontextmanager

try:
    import redis.asyncio as redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse

from .env_loader import load_env, set_env_from_file
from .tenant_middleware import TenantContext

log = logging.getLogger("token-spy-auth")

# ── Configuration ────────────────────────────────────────────────────────────

# Load .env file on module import (if present)
set_env_from_file()

REDIS_URL = os.environ.get("TOKEN_SPY_REDIS_URL") or os.environ.get("REDIS_URL", "redis://localhost:6379/0")
RATE_LIMIT_ENABLED = os.environ.get("RATE_LIMIT_ENABLED", "true").lower() == "true"

# In-memory fallback when Redis unavailable (dev mode)
_memory_rate_limits: dict[str, dict] = {}

# ── Data Models ─────────────────────────────────────────────────────────────

@dataclass
class APIKeyContext:
    """Authenticated API key context passed through request state."""
    tenant_id: str
    key_hash: str
    key_prefix: str
    name: Optional[str] = None
    rate_limit_rpm: int = 60
    rate_limit_rpd: int = 10000
    monthly_token_limit: Optional[int] = None
    tokens_used_this_month: int = 0
    environment: str = "live"
    allowed_providers: list[str] = None
    
    def __post_init__(self):
        if self.allowed_providers is None:
            self.allowed_providers = []


# ── Redis Client ─────────────────────────────────────────────────────────────

_redis_client: Optional["redis.Redis"] = None

async def get_redis() -> Optional["redis.Redis"]:
    """Get or create Redis client."""
    global _redis_client
    if not REDIS_AVAILABLE or not RATE_LIMIT_ENABLED:
        return None
    if _redis_client is None:
        try:
            _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
            await _redis_client.ping()
            log.info("Redis connected for rate limiting")
        except Exception as e:
            log.warning(f"Redis unavailable, using in-memory rate limit: {e}")
            return None
    return _redis_client


# ── API Key Validation ───────────────────────────────────────────────────────

def hash_api_key(key: str) -> str:
    """Generate SHA-256 hash of API key for lookup."""
    return hashlib.sha256(key.encode()).hexdigest()


def extract_key_from_header(auth_header: Optional[str]) -> Optional[str]:
    """Extract API key from Authorization header.
    
    Supports:
    - Bearer tp_live_xxx (Stripe-style)
    - Bearer tp_test_xxx (Stripe-style)
    - Bearer ts_xxx (Token Spy style)
    """
    if not auth_header:
        return None
    
    parts = auth_header.split()
    if len(parts) != 2:
        return None
    
    scheme, key = parts
    if scheme.lower() != "bearer":
        return None
    
    # Validate prefix (Token Spy or Stripe-style)
    if not (key.startswith("tp_live_") or key.startswith("tp_test_") or key.startswith("ts_")):
        return None
    
    return key


async def validate_api_key(key: str, db_backend) -> Optional[APIKeyContext]:
    """Validate API key against database.
    
    Returns APIKeyContext if valid, None if invalid/revoked/expired.
    """
    key_hash = hash_api_key(key)
    
    # No hardcoded bypass - require valid API key from DB
    
    # Query database for key
    if db_backend is None:
        log.error("Database backend not available for API key validation")
        return None
    
    key_record = db_backend.get_api_key_by_hash(key_hash)
    if not key_record:
        return None
    
    # Build context from DB record
    return APIKeyContext(
        tenant_id=key_record.tenant_id,
        key_hash=key_record.key_hash,
        key_prefix=key_record.key_prefix,
        name=key_record.name,
        rate_limit_rpm=key_record.rate_limit_rpm,
        rate_limit_rpd=key_record.rate_limit_rpd,
        monthly_token_limit=key_record.monthly_token_limit,
        tokens_used_this_month=key_record.tokens_used_this_month,
        environment=key_record.environment,
        allowed_providers=key_record.allowed_providers or []
    )


# ── Rate Limiting ────────────────────────────────────────────────────────────

async def check_rate_limit(
    key_hash: str,
    context: APIKeyContext
) -> tuple[bool, dict]:
    """Check if request is within rate limits.
    
    Returns (allowed, headers) where headers contains rate limit info.
    """
    redis_client = await get_redis()
    
    now = int(time.time())
    minute_key = f"ratelimit:{key_hash}:minute:{now // 60}"
    day_key = f"ratelimit:{key_hash}:day:{now // 86400}"
    
    if redis_client:
        # Redis-backed rate limiting
        pipe = redis_client.pipeline()
        pipe.incr(minute_key)
        pipe.expire(minute_key, 120)  # 2 minute expiry
        pipe.incr(day_key)
        pipe.expire(day_key, 90000)   # 25 hour expiry
        results = await pipe.execute()
        
        minute_count = results[0]
        day_count = results[2]
    else:
        # In-memory fallback
        minute_count = _memory_rate_limits.get(minute_key, 0) + 1
        day_count = _memory_rate_limits.get(day_key, 0) + 1
        _memory_rate_limits[minute_key] = minute_count
        _memory_rate_limits[day_key] = day_count
    
    # Check limits
    allowed = (
        minute_count <= context.rate_limit_rpm and
        day_count <= context.rate_limit_rpd
    )
    
    headers = {
        "X-RateLimit-Limit": str(context.rate_limit_rpm),
        "X-RateLimit-Remaining": str(max(0, context.rate_limit_rpm - minute_count)),
        "X-RateLimit-Reset": str((now // 60 + 1) * 60),
    }
    
    return allowed, headers


# ── Budget Enforcement ───────────────────────────────────────────────────────

async def check_budget(context: APIKeyContext) -> bool:
    """Check if API key has remaining budget.
    
    Returns True if within budget, False if exceeded.
    """
    if context.monthly_token_limit is None:
        return True  # No limit set
    
    return context.tokens_used_this_month < context.monthly_token_limit


# ── Middleware ────────────────────────────────────────────────────────────────

async def auth_middleware(request: Request, call_next):
    """FastAPI middleware for API key authentication.
    
    Validates API key, checks rate limits, enforces budget,
    and injects tenant context into request state.
    """
    # Skip auth for health checks
    if request.url.path in ["/health", "/metrics", "/docs", "/openapi.json"]:
        return await call_next(request)
    
    # Extract API key from Authorization header
    auth_header = request.headers.get("Authorization")
    api_key = extract_key_from_header(auth_header)
    
    if not api_key:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"error": "Missing or invalid Authorization header"},
            headers={"WWW-Authenticate": "Bearer"}
        )
    
    # Get database backend from app state
    db_backend = request.app.state.db_backend if hasattr(request.app.state, "db_backend") else None
    
    # Validate API key
    key_context = await validate_api_key(api_key, db_backend)
    if not key_context:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"error": "Invalid or revoked API key"}
        )
    
    # Check rate limits
    allowed, rate_headers = await check_rate_limit(key_context.key_hash, key_context)
    if not allowed:
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"error": "Rate limit exceeded"},
            headers=rate_headers
        )
    
    # Check budget
    if not await check_budget(key_context):
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"error": "Monthly token budget exceeded"}
        )
    
    # Build tenant context
    request_id = f"req_{hashlib.sha256(f'{time.time()}{api_key}'.encode()).hexdigest()[:16]}"
    tenant_context = TenantContext(
        tenant_id=key_context.tenant_id,
        request_id=request_id,
        api_key=key_context
    )
    
    # Store in request state for downstream handlers
    request.state.tenant = tenant_context
    
    # Derive user context for org API (Phase 4e compatibility)
    # For dev/test keys, derive user_id from tenant_id to enable org API testing
    if key_context.environment == "test":
        request.state.user_id = f"user_{key_context.tenant_id}"
        request.state.user_email = f"user_{key_context.tenant_id}@local"
        request.state.user_name = "Test User"
    
    # Log authentication
    log.info(f"Auth success: tenant={key_context.tenant_id} key={key_context.key_prefix}... env={key_context.environment}")
    
    # Process request
    response = await call_next(request)
    
    # Inject rate limit headers
    for header, value in rate_headers.items():
        response.headers[header] = value
    
    # Inject tenant attribution headers
    response.headers["X-OpenClaw-Tenant-ID"] = tenant_context.tenant_id
    response.headers["X-OpenClaw-Request-ID"] = tenant_context.request_id
    response.headers["X-OpenClaw-Key-Hash"] = f"sha256:{key_context.key_hash[:16]}..."
    
    return response


# ── Header Injection for Upstream ────────────────────────────────────────────

def get_upstream_headers(request: Request) -> dict[str, str]:
    """Get headers to inject into upstream request.
    
    Returns tenant attribution headers for downstream services.
    """
    headers = {}
    
    if hasattr(request.state, "tenant"):
        tenant = request.state.tenant
        headers["X-OpenClaw-Tenant-ID"] = tenant.tenant_id
        headers["X-OpenClaw-Request-ID"] = tenant.request_id
        
        if tenant.api_key:
            headers["X-OpenClaw-Key-Hash"] = tenant.api_key.key_hash
            headers["X-OpenClaw-Environment"] = tenant.api_key.environment
        
        if tenant.user_id:
            headers["X-OpenClaw-User-ID"] = tenant.user_id
        if tenant.session_id:
            headers["X-OpenClaw-Session-ID"] = tenant.session_id
    
    return headers
