"""
Token Spy Rate Limit Middleware — FastAPI Rate Limiting

Phase 4c: Rate limiting middleware for multi-tenant API
- Per-tenant rate limit enforcement
- HTTP 429 responses with Retry-After headers
- Integration with TenantContext from tenant_middleware
"""

import os
import logging
from typing import Optional, Set

from fastapi import Request, status
from fastapi.responses import JSONResponse

from .rate_limiter import get_rate_limiter, RateLimitResult
from .tenant_middleware import TenantContext, TIER_LIMITS, PlanTier

log = logging.getLogger("token-spy-rate-limit")

# ── Configuration ───────────────────────────────────────────────────────────

# Paths exempt from rate limiting
RATE_LIMIT_EXEMPT_PATHS: Set[str] = {
    "/health",
    "/metrics",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/api/events/stream",  # SSE stream has its own flow control
}

# Allow override via environment
RATE_LIMIT_ENABLED = os.environ.get("TOKEN_SPY_RATE_LIMIT_ENABLED", "true").lower() == "true"


# ── Middleware ──────────────────────────────────────────────────────────────

class RateLimitMiddleware:
    """FastAPI middleware for per-tenant rate limiting.
    
    Must run AFTER TenantMiddleware to have access to TenantContext.
    
    Rate limits are derived from:
    1. TenantContext.rate_limit_rpm (requests per minute)
    2. TenantContext.rate_limit_rpd (requests per day)
    
    These values come from the tenant's plan tier (see TIER_LIMITS).
    
    On rate limit exceeded:
    - Returns HTTP 429 Too Many Requests
    - Includes Retry-After header
    - Includes X-RateLimit-* headers
    """
    
    def __init__(
        self,
        app,
        exempt_paths: Optional[Set[str]] = None,
        enabled: bool = RATE_LIMIT_ENABLED
    ):
        self.app = app
        self.exempt_paths = exempt_paths or RATE_LIMIT_EXEMPT_PATHS
        self.enabled = enabled
        self._rate_limiter = None
    
    @property
    def rate_limiter(self):
        """Lazy-initialize rate limiter."""
        if self._rate_limiter is None:
            self._rate_limiter = get_rate_limiter()
        return self._rate_limiter
    
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        
        # Skip if rate limiting is disabled
        if not self.enabled:
            await self.app(scope, receive, send)
            return
        
        request = Request(scope, receive)
        path = request.url.path
        
        # Skip exempt paths
        if path in self.exempt_paths:
            await self.app(scope, receive, send)
            return
        
        # Skip if path starts with exempt prefix
        for exempt_path in self.exempt_paths:
            if exempt_path.endswith("*") and path.startswith(exempt_path[:-1]):
                await self.app(scope, receive, send)
                return
        
        # Get tenant context (set by TenantMiddleware)
        tenant_context: Optional[TenantContext] = getattr(request.state, "tenant_context", None)
        
        if tenant_context is None:
            # No tenant context - let request through (auth middleware will handle)
            await self.app(scope, receive, send)
            return
        
        # Get rate limits from tenant context
        rpm_limit = tenant_context.rate_limit_rpm
        rpd_limit = tenant_context.rate_limit_rpd
        
        # Check rate limits
        result = self.rate_limiter.check_rate_limit(
            tenant_id=tenant_context.tenant_id,
            rpm_limit=rpm_limit,
            rpd_limit=rpd_limit
        )
        
        if not result.allowed:
            # Rate limited - return 429
            log.warning(
                f"Rate limit exceeded for tenant {tenant_context.tenant_id} "
                f"(plan: {tenant_context.plan_tier.value}, rpm: {rpm_limit}, rpd: {rpd_limit})"
            )
            
            response = JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "error": "Rate limit exceeded",
                    "message": f"Too many requests. Please retry after {result.retry_after} seconds.",
                    "retry_after": result.retry_after,
                    "limit": result.limit,
                    "remaining": result.remaining,
                },
                headers=result.headers
            )
            await response(scope, receive, send)
            return
        
        # Inject rate limit info into request state for downstream use
        request.state.rate_limit_result = result
        
        # Continue with request, adding rate limit headers to response
        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                # Add rate limit headers to response
                headers = list(message.get("headers", []))
                for key, value in result.headers.items():
                    headers.append((key.lower().encode(), value.encode()))
                message["headers"] = headers
            await send(message)
        
        await self.app(scope, receive, send_wrapper)


# ── Helper Functions ────────────────────────────────────────────────────────

def get_rate_limit_status(request: Request) -> Optional[RateLimitResult]:
    """Get rate limit status from request state.
    
    Available after RateLimitMiddleware processes the request.
    """
    return getattr(request.state, "rate_limit_result", None)


def get_tier_rate_limits(plan_tier: PlanTier) -> tuple[int, Optional[int]]:
    """Get RPM and RPD limits for a plan tier.
    
    Returns:
        Tuple of (rpm_limit, rpd_limit). RPD may be None for unlimited.
    """
    tier_config = TIER_LIMITS.get(plan_tier, TIER_LIMITS[PlanTier.FREE])
    return (
        tier_config["rate_limit_rpm"],
        tier_config["rate_limit_rpd"]
    )


# ── Rate Limit Info Endpoint Helper ─────────────────────────────────────────

def get_rate_limit_info(tenant_context: TenantContext) -> dict:
    """Get detailed rate limit info for a tenant.
    
    Useful for API endpoint that shows current rate limit status.
    """
    rate_limiter = get_rate_limiter()
    
    status = rate_limiter.get_status(
        tenant_id=tenant_context.tenant_id,
        rpm_limit=tenant_context.rate_limit_rpm,
        rpd_limit=tenant_context.rate_limit_rpd
    )
    
    result = {
        "tenant_id": tenant_context.tenant_id,
        "plan_tier": tenant_context.plan_tier.value,
        "backend": rate_limiter.backend_type,
        "limits": {
            "rpm": tenant_context.rate_limit_rpm,
            "rpd": tenant_context.rate_limit_rpd,
        },
        "current": {}
    }
    
    if "rpm" in status:
        result["current"]["rpm"] = {
            "remaining": status["rpm"].remaining,
            "limit": status["rpm"].limit,
            "reset_at": status["rpm"].reset_at,
        }
    
    if "rpd" in status:
        result["current"]["rpd"] = {
            "remaining": status["rpd"].remaining,
            "limit": status["rpd"].limit,
            "reset_at": status["rpd"].reset_at,
        }
    
    return result
