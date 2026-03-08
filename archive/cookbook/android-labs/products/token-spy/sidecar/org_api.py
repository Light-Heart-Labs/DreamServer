"""
Token Spy Organization API — REST Endpoints for Organization Management

Phase 4e: Team/Organization Support (RBAC system)

API Endpoints:
- POST   /api/organizations              - Create org
- GET    /api/organizations              - List my orgs
- GET    /api/organizations/:id          - Get org details
- PATCH  /api/organizations/:id          - Update org
- POST   /api/organizations/:id/invite   - Invite member
- POST   /api/organizations/:id/members/:user_id/role - Change role
- DELETE /api/organizations/:id/members/:user_id      - Remove member

Additional endpoints:
- GET    /api/organizations/:id/members  - List members
- GET    /api/organizations/:id/invitations - List pending invitations
- POST   /api/invitations/:token/accept  - Accept invitation
"""

import logging
from typing import Optional, List
from datetime import datetime
from enum import Enum

from fastapi import APIRouter, Request, HTTPException, status, Depends, Query
from pydantic import BaseModel, Field, EmailStr

from .organizations import (
    OrganizationQueries, get_org_queries,
    Organization, OrganizationMember, OrganizationRole,
    Invitation, Team, TeamRole,
    OrganizationSettings, OrganizationPlanTier
)
from .org_middleware import (
    OrganizationContext, get_organization_context,
    require_org_permission, require_org_role,
    require_permission, require_role
)
from .db_backend import get_db_connection

try:
    from psycopg2.extras import RealDictCursor
    POSTGRES_AVAILABLE = True
except ImportError:
    POSTGRES_AVAILABLE = False

log = logging.getLogger("token-spy-org-api")

# ── Router ───────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api/organizations", tags=["organizations"])

# ── Pydantic Models ──────────────────────────────────────────────────────────

class OrganizationCreateRequest(BaseModel):
    """Request to create a new organization."""
    name: str = Field(..., min_length=1, max_length=100, description="Organization name")
    slug: Optional[str] = Field(None, max_length=50, description="URL-friendly identifier (auto-generated if not provided)")
    plan_tier: OrganizationPlanTier = Field(OrganizationPlanTier.FREE, description="Subscription tier")


class OrganizationUpdateRequest(BaseModel):
    """Request to update organization."""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    plan_tier: Optional[OrganizationPlanTier] = None
    
    class Config:
        use_enum_values = True


class OrganizationSettingsUpdateRequest(BaseModel):
    """Request to update organization settings."""
    organization_name: Optional[str] = Field(None, max_length=100)
    logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    primary_color: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    
    # Authentication
    saml_enabled: Optional[bool] = None
    enforce_sso: Optional[bool] = None
    require_2fa: Optional[bool] = None
    session_timeout_minutes: Optional[int] = Field(None, ge=15, le=1440)
    
    # Features
    allow_public_sharing: Optional[bool] = None
    allow_api_key_creation: Optional[bool] = None
    allow_webhook_configuration: Optional[bool] = None
    
    # Contact
    admin_email: Optional[EmailStr] = None
    security_alert_email: Optional[EmailStr] = None
    billing_email: Optional[EmailStr] = None


class OrganizationResponse(BaseModel):
    """Organization response."""
    id: str
    name: str
    slug: str
    plan_tier: str
    is_active: bool
    
    # Limits
    max_api_keys: Optional[int]
    max_provider_keys: Optional[int]
    max_monthly_tokens: Optional[int]
    max_monthly_cost: Optional[float]
    max_users: Optional[int]
    max_teams: Optional[int]
    
    # Member count
    member_count: int = 0
    
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class OrganizationDetailResponse(OrganizationResponse):
    """Detailed organization response with settings."""
    settings: Optional[dict] = None


class MemberResponse(BaseModel):
    """Organization member response."""
    user_id: str
    email: str
    display_name: Optional[str]
    avatar_url: Optional[str]
    role: str
    is_active: bool
    email_verified: bool
    joined_at: Optional[datetime]
    last_login_at: Optional[datetime]


class MemberInviteRequest(BaseModel):
    """Request to invite a new member."""
    email: EmailStr
    role: OrganizationRole = OrganizationRole.MEMBER
    team_ids: Optional[List[str]] = Field(None, description="Team IDs to auto-add member to")
    
    class Config:
        use_enum_values = True


class MemberRoleUpdateRequest(BaseModel):
    """Request to update member role."""
    role: OrganizationRole
    
    class Config:
        use_enum_values = True


class InvitationResponse(BaseModel):
    """Pending invitation response."""
    id: str
    email: str
    role: str
    team_ids: List[str]
    expires_at: datetime
    created_at: datetime


class AcceptInvitationRequest(BaseModel):
    """Request to accept an invitation."""
    token: str


# ── Helper Functions ─────────────────────────────────────────────────────────

def _generate_slug(name: str) -> str:
    """Generate URL-friendly slug from name."""
    import re
    slug = re.sub(r'[^\w\s-]', '', name.lower())
    slug = re.sub(r'[-\s]+', '-', slug)
    return slug[:50]


def _to_org_response(org: Organization, member_count: int = 0) -> OrganizationResponse:
    """Convert Organization to response model."""
    return OrganizationResponse(
        id=org.id,
        name=org.name,
        slug=org.slug,
        plan_tier=org.plan_tier.value,
        is_active=org.is_active,
        max_api_keys=org.max_api_keys,
        max_provider_keys=org.max_provider_keys,
        max_monthly_tokens=org.max_monthly_tokens,
        max_monthly_cost=org.max_monthly_cost,
        max_users=org.max_users,
        max_teams=org.max_teams,
        member_count=member_count,
        created_at=org.created_at,
        updated_at=org.updated_at,
    )


def _to_member_response(member: OrganizationMember) -> MemberResponse:
    """Convert OrganizationMember to response model."""
    return MemberResponse(
        user_id=member.user_id,
        email=member.email,
        display_name=member.display_name,
        avatar_url=member.avatar_url,
        role=member.role.value,
        is_active=member.is_active,
        email_verified=member.email_verified,
        joined_at=member.joined_at,
        last_login_at=member.last_login_at,
    )


# ── API Endpoints ────────────────────────────────────────────────────────────

@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_organization(
    request: Request,
    body: OrganizationCreateRequest,
):
    """Create a new organization.
    
    The authenticated user becomes the owner of the new organization.
    """
    # Get current user ID from request state
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User authentication required"
        )
    
    org_queries = get_org_queries()
    
    # Generate slug if not provided
    slug = body.slug or _generate_slug(body.name)
    
    # Create organization
    org = org_queries.create_organization(
        name=body.name,
        slug=slug,
        plan_tier=body.plan_tier,
    )
    
    # Add creator as owner
    # Note: This would typically come from user profile
    user_email = getattr(request.state, "user_email", f"user_{user_id}@local")
    member = org_queries.add_organization_member(
        org_id=org.id,
        email=user_email,
        role=OrganizationRole.OWNER,
        display_name=getattr(request.state, "user_name", None),
    )
    
    log.info(f"Created organization {org.id} by user {user_id}")
    
    return _to_org_response(org, member_count=1)


@router.get("", response_model=List[OrganizationResponse])
async def list_my_organizations(
    request: Request,
):
    """List all organizations the current user is a member of."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User authentication required"
        )
    
    org_queries = get_org_queries()
    orgs = org_queries.list_user_organizations(user_id)
    
    # Get member counts
    results = []
    for org in orgs:
        member_count = org_queries.count_organization_members(org.id)
        results.append(_to_org_response(org, member_count))
    
    return results


@router.get("/{org_id}", response_model=OrganizationDetailResponse)
async def get_organization(
    org_id: str,
    org_context: OrganizationContext = Depends(get_organization_context),
):
    """Get organization details.
    
    Requires membership in the organization.
    """
    org_queries = get_org_queries()
    member_count = org_queries.count_organization_members(org_context.org_id)
    
    settings = None
    if org_context.organization.settings:
        s = org_context.organization.settings
        settings = {
            "organization_name": s.organization_name,
            "logo_url": s.logo_url,
            "favicon_url": s.favicon_url,
            "primary_color": s.primary_color,
            "saml_enabled": s.saml_enabled,
            "enforce_sso": s.enforce_sso,
            "require_2fa": s.require_2fa,
            "session_timeout_minutes": s.session_timeout_minutes,
            "allow_public_sharing": s.allow_public_sharing,
            "allow_api_key_creation": s.allow_api_key_creation,
            "allow_webhook_configuration": s.allow_webhook_configuration,
            "admin_email": s.admin_email,
            "security_alert_email": s.security_alert_email,
            "billing_email": s.billing_email,
        }
    
    return OrganizationDetailResponse(
        **_to_org_response(org_context.organization, member_count).dict(),
        settings=settings,
    )


@router.patch("/{org_id}", response_model=OrganizationResponse)
async def update_organization(
    org_id: str,
    body: OrganizationUpdateRequest,
    org_context: OrganizationContext = Depends(require_org_permission("org:update")),
):
    """Update organization details.
    
    Requires 'org:update' permission (Admin or Owner).
    """
    org_queries = get_org_queries()
    
    # Build updates
    updates = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.plan_tier is not None:
        updates["plan_tier"] = body.plan_tier.value
    
    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update"
        )
    
    updated = org_queries.update_organization(org_context.org_id, updates)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )
    
    member_count = org_queries.count_organization_members(org_context.org_id)
    return _to_org_response(updated, member_count)


@router.patch("/{org_id}/settings", response_model=dict)
async def update_organization_settings(
    org_id: str,
    body: OrganizationSettingsUpdateRequest,
    org_context: OrganizationContext = Depends(require_org_permission("settings:update")),
):
    """Update organization settings.
    
    Requires 'settings:update' permission (Admin or Owner).
    """
    org_queries = get_org_queries()
    
    # Build settings updates
    settings_updates = {}
    for field in body.__fields__:
        value = getattr(body, field)
        if value is not None:
            settings_updates[field] = value
    
    if not settings_updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields to update"
        )
    
    updated = org_queries.update_organization(
        org_context.org_id,
        {},  # No tenant updates
        settings_updates
    )
    
    if not updated or not updated.settings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization settings not found"
        )
    
    log.info(f"Updated settings for org {org_context.org_id}")
    return {"status": "updated", "updated_fields": list(settings_updates.keys())}


# ── Member Management Endpoints ──────────────────────────────────────────────

@router.get("/{org_id}/members", response_model=List[MemberResponse])
async def list_organization_members(
    org_id: str,
    org_context: OrganizationContext = Depends(get_organization_context),
    role: Optional[OrganizationRole] = Query(None),
    is_active: Optional[bool] = Query(True),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """List organization members.
    
    Requires membership in the organization.
    """
    org_queries = get_org_queries()
    members = org_queries.list_organization_members(
        org_id=org_context.org_id,
        role=role,
        is_active=is_active,
        limit=limit,
        offset=offset,
    )
    
    return [_to_member_response(m) for m in members]


@router.post("/{org_id}/invite", response_model=InvitationResponse)
async def invite_member(
    org_id: str,
    body: MemberInviteRequest,
    org_context: OrganizationContext = Depends(require_org_permission("invite:create")),
):
    """Invite a new member to the organization.
    
    Requires 'invite:create' permission (Admin or Owner).
    Only Owners can invite other Owners or Admins.
    """
    # Check if trying to invite owner/admin without being owner
    if body.role in (OrganizationRole.OWNER, OrganizationRole.ADMIN):
        if org_context.role != OrganizationRole.OWNER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only owners can invite owners or admins"
            )
    
    # Check user limit for plan tier
    org_queries = get_org_queries()
    current_count = org_queries.count_organization_members(org_context.org_id)
    max_users = org_context.organization.max_users
    
    if max_users and current_count >= max_users:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Member limit reached ({max_users}). Upgrade your plan to add more members."
        )
    
    # Create invitation
    invitation = org_queries.create_invitation(
        org_id=org_context.org_id,
        email=body.email,
        invited_by=org_context.user_id,
        role=body.role,
        team_ids=body.team_ids,
    )
    
    log.info(f"Invited {body.email} to org {org_context.org_id} by {org_context.user_id}")
    
    return InvitationResponse(
        id=invitation.id,
        email=invitation.email,
        role=body.role.value,
        team_ids=invitation.team_ids or [],
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
    )


@router.post("/{org_id}/members/{user_id}/role", response_model=MemberResponse)
async def update_member_role(
    org_id: str,
    user_id: str,
    body: MemberRoleUpdateRequest,
    org_context: OrganizationContext = Depends(require_org_permission("member:update")),
):
    """Update a member's role.
    
    Requires 'member:update' permission (Admin or Owner).
    Owners can change any role. Admins cannot change owner roles.
    """
    org_queries = get_org_queries()
    
    # Get target member
    target_member = org_queries.get_organization_member(org_context.org_id, user_id)
    if not target_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found"
        )
    
    # Check permissions for role changes
    if target_member.role == OrganizationRole.OWNER:
        # Only owners can change owner roles
        if org_context.role != OrganizationRole.OWNER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only owners can modify owner roles"
            )
    
    if body.role == OrganizationRole.OWNER:
        # Only owners can promote to owner
        if org_context.role != OrganizationRole.OWNER:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only owners can promote to owner"
            )
    
    # Cannot demote yourself if you're the last owner
    if user_id == org_context.user_id and body.role != OrganizationRole.OWNER:
        # Check if there are other owners
        owners = org_queries.list_organization_members(
            org_id=org_context.org_id,
            role=OrganizationRole.OWNER,
            is_active=True,
        )
        if len(owners) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot demote yourself - you are the last owner"
            )
    
    # Update role
    updated = org_queries.update_member_role(
        org_id=org_context.org_id,
        user_id=user_id,
        new_role=body.role,
    )
    
    log.info(f"Updated role for user {user_id} to {body.role.value} in org {org_context.org_id}")
    
    return _to_member_response(updated)


@router.delete("/{org_id}/members/{user_id}")
async def remove_member(
    org_id: str,
    user_id: str,
    org_context: OrganizationContext = Depends(require_org_permission("member:delete")),
):
    """Remove a member from the organization.
    
    Requires 'member:delete' permission (Admin or Owner).
    Owners can remove anyone. Admins cannot remove owners.
    Users can remove themselves.
    """
    org_queries = get_org_queries()
    
    # Get target member
    target_member = org_queries.get_organization_member(org_context.org_id, user_id)
    if not target_member:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Member not found"
        )
    
    # Check permissions
    if user_id != org_context.user_id:  # Not self-removal
        if target_member.role == OrganizationRole.OWNER:
            # Only owners can remove owners
            if org_context.role != OrganizationRole.OWNER:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only owners can remove owners"
                )
        
        if target_member.role == OrganizationRole.ADMIN:
            # Only owners can remove admins
            if org_context.role != OrganizationRole.OWNER:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only owners can remove admins"
                )
    
    # Cannot remove yourself if you're the last owner
    if user_id == org_context.user_id and target_member.role == OrganizationRole.OWNER:
        owners = org_queries.list_organization_members(
            org_id=org_context.org_id,
            role=OrganizationRole.OWNER,
            is_active=True,
        )
        if len(owners) <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove yourself - you are the last owner"
            )
    
    # Remove member
    success = org_queries.remove_organization_member(org_context.org_id, user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to remove member"
        )
    
    log.info(f"Removed user {user_id} from org {org_context.org_id}")
    
    return {"status": "removed", "user_id": user_id}


# ── Invitation Endpoints ─────────────────────────────────────────────────────

@router.get("/{org_id}/invitations", response_model=List[InvitationResponse])
async def list_pending_invitations(
    org_id: str,
    org_context: OrganizationContext = Depends(require_org_permission("member:read")),
):
    """List pending invitations for the organization.
    
    Requires 'member:read' permission.
    """
    org_queries = get_org_queries()
    invitations = org_queries.list_pending_invitations(org_context.org_id)
    
    return [
        InvitationResponse(
            id=inv.id,
            email=inv.email,
            role=OrganizationRole.MEMBER.value,  # Would come from role lookup
            team_ids=inv.team_ids or [],
            expires_at=inv.expires_at,
            created_at=inv.created_at,
        )
        for inv in invitations
    ]


# ── Standalone Invitation Endpoints ──────────────────────────────────────────

invitation_router = APIRouter(prefix="/api/invitations", tags=["invitations"])


@invitation_router.post("/{token}/accept")
async def accept_invitation(
    token: str,
    request: Request,
):
    """Accept an invitation to join an organization.
    
    User must be authenticated. Creates user record and adds to organization.
    """
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User authentication required"
        )
    
    org_queries = get_org_queries()
    
    # Get invitation
    invitation = org_queries.get_invitation_by_token(token)
    if not invitation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation not found or expired"
        )
    
    # Mark as accepted
    success = org_queries.accept_invitation(token, user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to accept invitation"
        )
    
    log.info(f"User {user_id} accepted invitation to org {invitation.organization_id}")
    
    return {
        "status": "accepted",
        "organization_id": invitation.organization_id,
        "email": invitation.email,
    }


# ── Export Routers ───────────────────────────────────────────────────────────

__all__ = [
    "router",
    "invitation_router",
    "OrganizationCreateRequest",
    "OrganizationUpdateRequest",
    "MemberInviteRequest",
    "MemberRoleUpdateRequest",
]