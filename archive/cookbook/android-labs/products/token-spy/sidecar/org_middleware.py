"""
Token Spy Organization Middleware — RBAC Permission Checking

Phase 4e: Team/Organization Support (RBAC system)
- Organization membership verification
- Role-based permission checks
- Middleware for FastAPI integration
"""

import logging
from typing import Optional, List, Callable
from dataclasses import dataclass
from functools import wraps

from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse

from .organizations import (
    OrganizationQueries, get_org_queries,
    OrganizationRole, OrganizationMember,
    Organization, OrganizationPlanTier
)
from .tenant_middleware import TenantContext, get_tenant_context

log = logging.getLogger("token-spy-org-middleware")

# ── Permission Definitions ──────────────────────────────────────────────────

# Map of organization roles to their permissions
ORG_ROLE_PERMISSIONS = {
    OrganizationRole.OWNER: [
        # Full access to everything
        "org:read", "org:update", "org:delete",
        "member:read", "member:create", "member:update", "member:delete",
        "team:read", "team:create", "team:update", "team:delete",
        "api_key:read", "api_key:create", "api_key:update", "api_key:delete",
        "provider_key:read", "provider_key:create", "provider_key:update", "provider_key:delete",
        "alert:read", "alert:create", "alert:update", "alert:delete",
        "settings:read", "settings:update",
        "billing:read", "billing:update",
        "audit:read", "audit:export",
        "invite:create", "invite:revoke",
    ],
    OrganizationRole.ADMIN: [
        # Almost full access except deleting org
        "org:read", "org:update",
        "member:read", "member:create", "member:update", "member:delete",
        "team:read", "team:create", "team:update", "team:delete",
        "api_key:read", "api_key:create", "api_key:update", "api_key:delete",
        "provider_key:read", "provider_key:create", "provider_key:update", "provider_key:delete",
        "alert:read", "alert:create", "alert:update", "alert:delete",
        "settings:read", "settings:update",
        "billing:read",
        "audit:read", "audit:export",
        "invite:create", "invite:revoke",
    ],
    OrganizationRole.MEMBER: [
        # Standard member - can create resources, view most things
        "org:read",
        "member:read",
        "team:read",
        "api_key:read", "api_key:create", "api_key:update", "api_key:delete",  # Own keys only
        "provider_key:read",  # View only
        "alert:read", "alert:create", "alert:update", "alert:delete",  # Own alerts
        "settings:read",
    ],
    OrganizationRole.VIEWER: [
        # Read-only access
        "org:read",
        "member:read",
        "team:read",
        "api_key:read",
        "provider_key:read",
        "alert:read",
        "settings:read",
    ],
}


# ── Data Models ─────────────────────────────────────────────────────────────

@dataclass
class OrganizationContext:
    """Extended context with organization membership info."""
    organization: Organization
    member: OrganizationMember
    permissions: List[str]
    
    @property
    def org_id(self) -> str:
        return self.organization.id
    
    @property
    def user_id(self) -> str:
        return self.member.user_id
    
    @property
    def role(self) -> OrganizationRole:
        return self.member.role
    
    def has_permission(self, permission: str) -> bool:
        """Check if user has a specific permission."""
        return permission in self.permissions
    
    def is_owner_or_admin(self) -> bool:
        """Check if user is owner or admin."""
        return self.role in (OrganizationRole.OWNER, OrganizationRole.ADMIN)
    
    def can_manage_members(self) -> bool:
        """Check if user can invite/update/remove members."""
        return self.has_permission("member:create")
    
    def can_manage_teams(self) -> bool:
        """Check if user can create/update/delete teams."""
        return self.has_permission("team:create")
    
    def can_manage_billing(self) -> bool:
        """Check if user can view/update billing."""
        return self.has_permission("billing:update")
    
    def can_delete_organization(self) -> bool:
        """Only owners can delete organizations."""
        return self.role == OrganizationRole.OWNER


# ── Permission Helpers ──────────────────────────────────────────────────────

def get_permissions_for_role(role: OrganizationRole) -> List[str]:
    """Get the list of permissions for a given role."""
    return ORG_ROLE_PERMISSIONS.get(role, [])


def require_permission(permission: str):
    """Decorator to require a specific permission for an endpoint.
    
    Usage:
        @router.post("/api/organizations/{org_id}/members")
        @require_permission("member:create")
        async def add_member(...):
            ...
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Get request from kwargs or args
            request = kwargs.get('request')
            if not request and args:
                from fastapi import Request
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break
            
            if not request:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Request object not found"
                )
            
            # Get organization context
            org_context = getattr(request.state, "organization_context", None)
            if not org_context:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Organization context not available"
                )
            
            # Check permission
            if not org_context.has_permission(permission):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Permission denied: {permission}"
                )
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator


def require_role(*roles: OrganizationRole):
    """Decorator to require one of the specified roles.
    
    Usage:
        @router.delete("/api/organizations/{org_id}")
        @require_role(OrganizationRole.OWNER)
        async def delete_organization(...):
            ...
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Get request from kwargs or args
            request = kwargs.get('request')
            if not request and args:
                from fastapi import Request
                for arg in args:
                    if isinstance(arg, Request):
                        request = arg
                        break
            
            if not request:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Request object not found"
                )
            
            # Get organization context
            org_context = getattr(request.state, "organization_context", None)
            if not org_context:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Organization context not available"
                )
            
            # Check role
            if org_context.role not in roles:
                role_names = ", ".join(r.value for r in roles)
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"This action requires one of these roles: {role_names}"
                )
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator


# ── Middleware ──────────────────────────────────────────────────────────────

class OrganizationMiddleware:
    """FastAPI middleware for organization membership and RBAC.
    
    Must run AFTER auth_middleware and tenant_middleware to have access to:
    - request.state.tenant_context (from tenant_middleware)
    - request.state.user (from auth_middleware, if available)
    
    Responsibilities:
    - Verify user is a member of the organization
    - Load organization context with permissions
    - Inject OrganizationContext into request state
    """
    
    def __init__(self, app, db_backend=None):
        self.app = app
        self.db_backend = db_backend
    
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        
        # Create request object to access state
        from fastapi import Request
        request = Request(scope, receive)
        
        # Skip for public endpoints
        path = request.url.path
        public_paths = [
            "/health", "/metrics", "/docs", "/openapi.json",
            "/api/auth/login", "/api/auth/register", "/api/auth/callback",
            "/api/invitations/accept",
        ]
        if any(path.startswith(p) for p in public_paths):
            await self.app(scope, receive, send)
            return
        
        # Only process organization-scoped endpoints
        # Organization endpoints start with /api/organizations
        if not path.startswith("/api/organizations"):
            await self.app(scope, receive, send)
            return
        
        # Extract organization ID from path
        # Format: /api/organizations/{org_id}/...
        org_id = self._extract_org_id(path)
        if not org_id:
            await self.app(scope, receive, send)
            return
        
        # Get tenant context (from tenant_middleware)
        tenant_context = getattr(request.state, "tenant_context", None)
        if tenant_context is None:
            response = JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"error": "Authentication required"}
            )
            await response(scope, receive, send)
            return
        
        # Get user ID from tenant context or user state
        user_id = getattr(request.state, "user_id", None)
        if not user_id and hasattr(request.state, "user"):
            user = request.state.user
            user_id = getattr(user, "user_id", None)
        
        # If no user_id, derive from tenant_id (test mode fallback)
        # This enables org API testing with API key auth
        if not user_id and hasattr(request.state, "tenant"):
            tenant = request.state.tenant
            if hasattr(tenant, "tenant_id"):
                user_id = f"user_{tenant.tenant_id}"
                request.state.user_id = user_id
                request.state.user_email = f"{user_id}@local"
                request.state.user_name = "Test User"
        
        # If still no user_id, require authentication
        if not user_id:
            response = JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"error": "User authentication required for organization access"}
            )
            await response(scope, receive, send)
            return
        
        # Verify organization exists and user is a member
        org_queries = get_org_queries()
        
        # Get organization
        organization = org_queries.get_organization(org_id)
        if not organization:
            response = JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"error": f"Organization not found: {org_id}"}
            )
            await response(scope, receive, send)
            return
        
        if not organization.is_active:
            response = JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"error": "Organization is suspended"}
            )
            await response(scope, receive, send)
            return
        
        # Get member record
        member = org_queries.get_organization_member(org_id, user_id)
        if not member or not member.is_active:
            response = JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"error": "You are not a member of this organization"}
            )
            await response(scope, receive, send)
            return
        
        # Build permissions list from role
        permissions = get_permissions_for_role(member.role)
        
        # Create organization context
        org_context = OrganizationContext(
            organization=organization,
            member=member,
            permissions=permissions,
        )
        
        # Store in request state
        request.state.organization_context = org_context
        
        log.debug(f"Org context: {org_id} user={user_id} role={member.role.value}")
        
        # Continue with request
        await self.app(scope, receive, send)
    
    def _extract_org_id(self, path: str) -> Optional[str]:
        """Extract organization ID from URL path.
        
        Pattern: /api/organizations/{org_id}/...
        """
        parts = path.strip("/").split("/")
        # parts = ['api', 'organizations', '{org_id}', ...]
        if len(parts) >= 3 and parts[0] == "api" and parts[1] == "organizations":
            org_id = parts[2]
            # Basic validation - org IDs start with 'org_' or 'tenant_'
            if org_id.startswith(("org_", "tenant_")):
                return org_id
        return None


# ── Dependency Functions ────────────────────────────────────────────────────

def get_organization_context(request: Request) -> OrganizationContext:
    """Get organization context from request state.
    
    Use as FastAPI dependency:
        from fastapi import Depends
        
        @router.get("/api/organizations/{org_id}")
        async def get_org(
            org_context: OrganizationContext = Depends(get_organization_context)
        ):
            return {"org_id": org_context.org_id}
    """
    org_context = getattr(request.state, "organization_context", None)
    if org_context is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Organization context not available"
        )
    return org_context


def require_org_permission(permission: str):
    """FastAPI dependency factory for permission checking.
    
    Usage:
        @router.post("/api/organizations/{org_id}/members")
        async def add_member(
            org_context: OrganizationContext = Depends(require_org_permission("member:create"))
        ):
            ...
    """
    def checker(request: Request) -> OrganizationContext:
        org_context = get_organization_context(request)
        if not org_context.has_permission(permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {permission}"
            )
        return org_context
    return checker


def require_org_role(*roles: OrganizationRole):
    """FastAPI dependency factory for role checking.
    
    Usage:
        @router.delete("/api/organizations/{org_id}")
        async def delete_org(
            org_context: OrganizationContext = Depends(require_org_role(OrganizationRole.OWNER))
        ):
            ...
    """
    def checker(request: Request) -> OrganizationContext:
        org_context = get_organization_context(request)
        if org_context.role not in roles:
            role_names = ", ".join(r.value for r in roles)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"This action requires one of these roles: {role_names}"
            )
        return org_context
    return checker


# ── Helper Functions ────────────────────────────────────────────────────────

async def check_organization_membership(
    user_id: str,
    org_id: str,
    required_role: Optional[OrganizationRole] = None,
) -> bool:
    """Check if a user is a member of an organization with optional role check.
    
    Can be used outside of middleware for background tasks, etc.
    """
    org_queries = get_org_queries()
    
    # Check organization exists and is active
    organization = org_queries.get_organization(org_id)
    if not organization or not organization.is_active:
        return False
    
    # Check membership
    member = org_queries.get_organization_member(org_id, user_id)
    if not member or not member.is_active:
        return False
    
    # Check role if required
    if required_role:
        # Owner can do everything
        if member.role == OrganizationRole.OWNER:
            return True
        # Check if member's role has sufficient privileges
        role_hierarchy = {
            OrganizationRole.OWNER: 4,
            OrganizationRole.ADMIN: 3,
            OrganizationRole.MEMBER: 2,
            OrganizationRole.VIEWER: 1,
        }
        member_level = role_hierarchy.get(member.role, 0)
        required_level = role_hierarchy.get(required_role, 0)
        return member_level >= required_level
    
    return True


def can_access_resource(
    org_context: OrganizationContext,
    resource_type: str,
    action: str,  # 'read', 'create', 'update', 'delete'
    resource_owner_id: Optional[str] = None,
) -> bool:
    """Check if user can access a specific resource.
    
    Args:
        org_context: The organization context
        resource_type: Type of resource (api_key, alert, etc.)
        action: The action being performed
        resource_owner_id: If set, allows owners to access their own resources
    """
    # Build permission string
    permission = f"{resource_type}:{action}"
    
    # Check general permission
    if org_context.has_permission(permission):
        return True
    
    # Members can access their own resources even without general permission
    if resource_owner_id and org_context.user_id == resource_owner_id:
        # Members can read/update/delete their own resources
        if action in ("read", "update", "delete"):
            return True
    
    return False
