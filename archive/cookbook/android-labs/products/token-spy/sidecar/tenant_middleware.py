"""
Token Spy Tenant Middleware — Multi-tenancy with Tenant Isolation

Phase 4a: Multi-tenancy middleware
- TenantContext dataclass for request-scoped tenant info
- Tenant extraction from API key
- TenantMiddleware for FastAPI
- Tenant provisioning endpoint
"""

import logging
import os
import uuid
from typing import Optional, List
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from fastapi import Request, HTTPException, status, APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

log = logging.getLogger("token-spy-tenant")

# ── Plan Tiers ───────────────────────────────────────────────────────────────

class PlanTier(str, Enum):
    """Subscription plan tiers with different limits."""
    FREE = "free"
    STARTER = "starter"
    PRO = "pro"
    ENTERPRISE = "enterprise"


# Tier limits configuration
TIER_LIMITS = {
    PlanTier.FREE: {
        "max_api_keys": 2,
        "max_provider_keys": 1,
        "max_monthly_tokens": 100_000,
        "max_monthly_cost": 5.00,
        "rate_limit_rpm": 10,
        "rate_limit_rpd": 1000,
        "features": ["basic_dashboard"],
    },
    PlanTier.STARTER: {
        "max_api_keys": 5,
        "max_provider_keys": 3,
        "max_monthly_tokens": 1_000_000,
        "max_monthly_cost": 50.00,
        "rate_limit_rpm": 60,
        "rate_limit_rpd": 10_000,
        "features": ["basic_dashboard", "alerts", "export"],
    },
    PlanTier.PRO: {
        "max_api_keys": 25,
        "max_provider_keys": 10,
        "max_monthly_tokens": 10_000_000,
        "max_monthly_cost": 500.00,
        "rate_limit_rpm": 300,
        "rate_limit_rpd": 50_000,
        "features": ["basic_dashboard", "alerts", "export", "webhooks", "api_access"],
    },
    PlanTier.ENTERPRISE: {
        "max_api_keys": None,  # Unlimited
        "max_provider_keys": None,
        "max_monthly_tokens": None,
        "max_monthly_cost": None,
        "rate_limit_rpm": 1000,
        "rate_limit_rpd": None,
        "features": ["basic_dashboard", "alerts", "export", "webhooks", "api_access", "sso", "audit_log", "dedicated_support"],
    },
}


# ── Data Models ─────────────────────────────────────────────────────────────

@dataclass
class TenantContext:
    """Request-scoped tenant context for multi-tenancy.
    
    Full version includes plan tiers, limits, features, and authentication
    attribution fields (user_id, session_id, request_id, api_key) for compatibility
    with auth_middleware.
    """
    tenant_id: str
    name: str
    plan_tier: PlanTier = PlanTier.FREE
    
    # Authentication attribution (from auth_middleware)
    user_id: Optional[str] = None
    session_id: Optional[str] = None
    request_id: str = ""
    api_key: Optional["APIKeyContext"] = None  # Forward reference to avoid circular import
    
    # Limits (derived from plan or overridden)
    max_api_keys: Optional[int] = None
    max_provider_keys: Optional[int] = None
    max_monthly_tokens: Optional[int] = None
    max_monthly_cost: Optional[float] = None
    rate_limit_rpm: int = 60
    rate_limit_rpd: int = 10_000
    
    # Current usage
    current_api_keys: int = 0
    current_provider_keys: int = 0
    tokens_used_this_month: int = 0
    cost_used_this_month: float = 0.0
    
    # Features enabled
    features: List[str] = field(default_factory=list)
    
    # Metadata
    is_active: bool = True
    created_at: Optional[datetime] = None
    metadata: Optional[dict] = None
    
    def __post_init__(self):
        """Apply tier defaults if not explicitly set."""
        tier_config = TIER_LIMITS.get(self.plan_tier, TIER_LIMITS[PlanTier.FREE])
        
        if self.max_api_keys is None:
            self.max_api_keys = tier_config["max_api_keys"]
        if self.max_provider_keys is None:
            self.max_provider_keys = tier_config["max_provider_keys"]
        if self.max_monthly_tokens is None:
            self.max_monthly_tokens = tier_config["max_monthly_tokens"]
        if self.max_monthly_cost is None:
            self.max_monthly_cost = tier_config["max_monthly_cost"]
        if not self.features:
            self.features = tier_config["features"].copy()
    
    def can_create_api_key(self) -> bool:
        """Check if tenant can create another API key."""
        if self.max_api_keys is None:
            return True
        return self.current_api_keys < self.max_api_keys
    
    def can_create_provider_key(self) -> bool:
        """Check if tenant can add another provider key."""
        if self.max_provider_keys is None:
            return True
        return self.current_provider_keys < self.max_provider_keys
    
    def within_token_budget(self, tokens_to_add: int = 0) -> bool:
        """Check if tenant is within monthly token budget."""
        if self.max_monthly_tokens is None:
            return True
        return (self.tokens_used_this_month + tokens_to_add) <= self.max_monthly_tokens
    
    def within_cost_budget(self, cost_to_add: float = 0.0) -> bool:
        """Check if tenant is within monthly cost budget."""
        if self.max_monthly_cost is None:
            return True
        return (self.cost_used_this_month + cost_to_add) <= self.max_monthly_cost
    
    def has_feature(self, feature: str) -> bool:
        """Check if tenant has access to a feature."""
        return feature in self.features


# ── Tenant Extraction ────────────────────────────────────────────────────────

def extract_tenant_from_key(api_key_context, db_backend) -> Optional[TenantContext]:
    """Extract full tenant context from an authenticated API key.
    
    Args:
        api_key_context: The validated APIKeyContext from auth middleware
        db_backend: Database backend for tenant lookup
        
    Returns:
        TenantContext if tenant found, None otherwise
    """
    if api_key_context is None:
        return None
    
    tenant_id = api_key_context.tenant_id
    
    # Dev mode fallback — only in development environment
    if os.environ.get("TOKEN_SPY_ENV") == "development" and tenant_id == "tenant_dev_001":
        return TenantContext(
            tenant_id=tenant_id,
            name="Development Tenant",
            plan_tier=PlanTier.ENTERPRISE,
            is_active=True,
        )
    
    # Query tenant from database
    if db_backend is None:
        log.warning("No database backend available for tenant lookup")
        return None
    
    tenant_data = db_backend.get_tenant(tenant_id)
    if not tenant_data:
        log.warning(f"Tenant not found: {tenant_id}")
        return None
    
    # Build context from DB record
    return TenantContext(
        tenant_id=tenant_data.tenant_id,
        name=tenant_data.name,
        plan_tier=PlanTier(tenant_data.plan_tier) if tenant_data.plan_tier else PlanTier.FREE,
        max_api_keys=tenant_data.max_api_keys,
        max_provider_keys=tenant_data.max_provider_keys,
        max_monthly_tokens=tenant_data.max_monthly_tokens,
        max_monthly_cost=float(tenant_data.max_monthly_cost) if tenant_data.max_monthly_cost else None,
        is_active=tenant_data.is_active,
        created_at=tenant_data.created_at,
        metadata=tenant_data.metadata,
    )


# ── Middleware ────────────────────────────────────────────────────────────────

class TenantMiddleware:
    """FastAPI middleware for tenant context injection and isolation.
    
    Must run AFTER auth_middleware to have access to API key context.
    
    Responsibilities:
    - Extract tenant from authenticated API key
    - Inject TenantContext into request state
    - Enforce tenant-level quotas (keys, tokens, cost)
    - Ensure tenant data isolation in queries
    """
    
    def __init__(self, app, db_backend=None):
        self.app = app
        self.db_backend = db_backend
    
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        
        # Create request object to access state
        request = Request(scope, receive)
        
        # Skip for public endpoints
        path = request.url.path
        if path in ["/health", "/metrics", "/docs", "/openapi.json", "/api/tenants"]:
            await self.app(scope, receive, send)
            return
        
        # Check if auth middleware set the API key context
        api_key_context = getattr(request.state, "api_key", None)
        if api_key_context is None:
            # No auth context, let auth middleware handle the error
            await self.app(scope, receive, send)
            return
        
        # Get db_backend from app state if not provided
        db_backend = self.db_backend
        if db_backend is None and hasattr(request.app.state, "db_backend"):
            db_backend = request.app.state.db_backend
        
        # Extract tenant context
        tenant_context = extract_tenant_from_key(api_key_context, db_backend)
        
        if tenant_context is None:
            response = JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"error": "Tenant not found or inactive"}
            )
            await response(scope, receive, send)
            return
        
        if not tenant_context.is_active:
            response = JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"error": "Tenant account is suspended"}
            )
            await response(scope, receive, send)
            return
        
        # Store tenant context in request state
        request.state.tenant_context = tenant_context
        
        log.debug(f"Tenant context: {tenant_context.tenant_id} ({tenant_context.plan_tier.value})")
        
        # Continue with request
        await self.app(scope, receive, send)


# ── Tenant Router (Provisioning API) ─────────────────────────────────────────

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


class TenantCreateRequest(BaseModel):
    """Request body for creating a new tenant."""
    name: str = Field(..., min_length=1, max_length=255)
    plan_tier: PlanTier = PlanTier.FREE
    contact_email: Optional[str] = None
    metadata: Optional[dict] = None


class TenantResponse(BaseModel):
    """Response body for tenant operations."""
    tenant_id: str
    name: str
    plan_tier: str
    is_active: bool
    max_api_keys: Optional[int]
    max_provider_keys: Optional[int]
    max_monthly_tokens: Optional[int]
    max_monthly_cost: Optional[float]
    contact_email: Optional[str]
    created_at: datetime
    updated_at: datetime


class TenantUpdateRequest(BaseModel):
    """Request body for updating a tenant."""
    name: Optional[str] = None
    plan_tier: Optional[PlanTier] = None
    is_active: Optional[bool] = None
    max_api_keys: Optional[int] = None
    max_provider_keys: Optional[int] = None
    max_monthly_tokens: Optional[int] = None
    max_monthly_cost: Optional[float] = None
    contact_email: Optional[str] = None
    metadata: Optional[dict] = None


@router.post("", response_model=TenantResponse, status_code=status.HTTP_201_CREATED)
async def create_tenant(request: Request, body: TenantCreateRequest):
    """Create a new tenant.
    
    Requires admin authentication (handled separately).
    """
    db_backend = getattr(request.app.state, "db_backend", None)
    if db_backend is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database not available"
        )
    
    # Generate tenant ID
    tenant_id = f"tenant_{uuid.uuid4().hex[:12]}"
    
    # Get tier limits
    tier_config = TIER_LIMITS.get(body.plan_tier, TIER_LIMITS[PlanTier.FREE])
    
    # Create tenant in database
    tenant_data = db_backend.create_tenant(
        tenant_id=tenant_id,
        name=body.name,
        plan_tier=body.plan_tier.value,
        max_api_keys=tier_config["max_api_keys"],
        max_provider_keys=tier_config["max_provider_keys"],
        max_monthly_tokens=tier_config["max_monthly_tokens"],
        max_monthly_cost=tier_config["max_monthly_cost"],
        contact_email=body.contact_email,
        metadata=body.metadata,
    )
    
    log.info(f"Created tenant: {tenant_id} ({body.name}) - {body.plan_tier.value}")
    
    return TenantResponse(
        tenant_id=tenant_data.tenant_id,
        name=tenant_data.name,
        plan_tier=tenant_data.plan_tier,
        is_active=tenant_data.is_active,
        max_api_keys=tenant_data.max_api_keys,
        max_provider_keys=tenant_data.max_provider_keys,
        max_monthly_tokens=tenant_data.max_monthly_tokens,
        max_monthly_cost=float(tenant_data.max_monthly_cost) if tenant_data.max_monthly_cost else None,
        contact_email=tenant_data.contact_email,
        created_at=tenant_data.created_at,
        updated_at=tenant_data.updated_at,
    )


@router.get("/{tenant_id}", response_model=TenantResponse)
async def get_tenant(request: Request, tenant_id: str):
    """Get tenant details."""
    db_backend = getattr(request.app.state, "db_backend", None)
    if db_backend is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database not available"
        )
    
    tenant_data = db_backend.get_tenant(tenant_id)
    if not tenant_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tenant not found: {tenant_id}"
        )
    
    return TenantResponse(
        tenant_id=tenant_data.tenant_id,
        name=tenant_data.name,
        plan_tier=tenant_data.plan_tier or "free",
        is_active=tenant_data.is_active,
        max_api_keys=tenant_data.max_api_keys,
        max_provider_keys=tenant_data.max_provider_keys,
        max_monthly_tokens=tenant_data.max_monthly_tokens,
        max_monthly_cost=float(tenant_data.max_monthly_cost) if tenant_data.max_monthly_cost else None,
        contact_email=tenant_data.contact_email,
        created_at=tenant_data.created_at,
        updated_at=tenant_data.updated_at,
    )


@router.patch("/{tenant_id}", response_model=TenantResponse)
async def update_tenant(request: Request, tenant_id: str, body: TenantUpdateRequest):
    """Update tenant settings."""
    db_backend = getattr(request.app.state, "db_backend", None)
    if db_backend is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database not available"
        )
    
    # Build update dict from non-None fields
    updates = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.plan_tier is not None:
        updates["plan_tier"] = body.plan_tier.value
        # Also update limits if changing tier (unless explicitly overridden)
        tier_config = TIER_LIMITS[body.plan_tier]
        if body.max_api_keys is None:
            updates["max_api_keys"] = tier_config["max_api_keys"]
        if body.max_provider_keys is None:
            updates["max_provider_keys"] = tier_config["max_provider_keys"]
        if body.max_monthly_tokens is None:
            updates["max_monthly_tokens"] = tier_config["max_monthly_tokens"]
        if body.max_monthly_cost is None:
            updates["max_monthly_cost"] = tier_config["max_monthly_cost"]
    if body.is_active is not None:
        updates["is_active"] = body.is_active
    if body.max_api_keys is not None:
        updates["max_api_keys"] = body.max_api_keys
    if body.max_provider_keys is not None:
        updates["max_provider_keys"] = body.max_provider_keys
    if body.max_monthly_tokens is not None:
        updates["max_monthly_tokens"] = body.max_monthly_tokens
    if body.max_monthly_cost is not None:
        updates["max_monthly_cost"] = body.max_monthly_cost
    if body.contact_email is not None:
        updates["contact_email"] = body.contact_email
    if body.metadata is not None:
        updates["metadata"] = body.metadata
    
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update"
        )
    
    tenant_data = db_backend.update_tenant(tenant_id, updates)
    if not tenant_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Tenant not found: {tenant_id}"
        )
    
    log.info(f"Updated tenant: {tenant_id} - {list(updates.keys())}")
    
    return TenantResponse(
        tenant_id=tenant_data.tenant_id,
        name=tenant_data.name,
        plan_tier=tenant_data.plan_tier or "free",
        is_active=tenant_data.is_active,
        max_api_keys=tenant_data.max_api_keys,
        max_provider_keys=tenant_data.max_provider_keys,
        max_monthly_tokens=tenant_data.max_monthly_tokens,
        max_monthly_cost=float(tenant_data.max_monthly_cost) if tenant_data.max_monthly_cost else None,
        contact_email=tenant_data.contact_email,
        created_at=tenant_data.created_at,
        updated_at=tenant_data.updated_at,
    )


@router.get("", response_model=List[TenantResponse])
async def list_tenants(
    request: Request,
    is_active: Optional[bool] = None,
    plan_tier: Optional[PlanTier] = None,
    limit: int = 50,
    offset: int = 0,
):
    """List all tenants (admin only)."""
    db_backend = getattr(request.app.state, "db_backend", None)
    if db_backend is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database not available"
        )
    
    tenants = db_backend.list_tenants(
        is_active=is_active,
        plan_tier=plan_tier.value if plan_tier else None,
        limit=limit,
        offset=offset,
    )
    
    return [
        TenantResponse(
            tenant_id=t.tenant_id,
            name=t.name,
            plan_tier=t.plan_tier or "free",
            is_active=t.is_active,
            max_api_keys=t.max_api_keys,
            max_provider_keys=t.max_provider_keys,
            max_monthly_tokens=t.max_monthly_tokens,
            max_monthly_cost=float(t.max_monthly_cost) if t.max_monthly_cost else None,
            contact_email=t.contact_email,
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in tenants
    ]


# ── Helper Functions ─────────────────────────────────────────────────────────

def get_tenant_context(request: Request) -> TenantContext:
    """Get tenant context from request state.
    
    Raises HTTPException if not available.
    """
    tenant_context = getattr(request.state, "tenant_context", None)
    if tenant_context is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tenant context not available"
        )
    return tenant_context


def require_feature(request: Request, feature: str) -> TenantContext:
    """Require a specific feature for the current tenant.
    
    Raises HTTPException if tenant doesn't have the feature.
    """
    tenant_context = get_tenant_context(request)
    if not tenant_context.has_feature(feature):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Feature not available on {tenant_context.plan_tier.value} plan: {feature}"
        )
    return tenant_context
