"""
Token Spy Organizations — Data Models and Database Queries

Phase 4e: Team/Organization Support (RBAC system)
- Organization data models
- Team management
- Organization membership with roles
"""

import logging
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from .db_backend import get_db_connection, DatabaseBackend

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    POSTGRES_AVAILABLE = True
except ImportError:
    POSTGRES_AVAILABLE = False

log = logging.getLogger("token-spy-orgs")

# ── Enums ────────────────────────────────────────────────────────────────────

class OrganizationRole(str, Enum):
    """Organization-level roles (stored in users.tenant_role)."""
    OWNER = "owner"      # Full access, can delete org
    ADMIN = "admin"      # Admin access, manage users/settings
    MEMBER = "member"    # Standard member, create resources
    VIEWER = "viewer"    # Read-only access


class TeamRole(str, Enum):
    """Team-level roles (stored in team_memberships.team_role)."""
    LEAD = "lead"        # Team lead, manage team membership
    MEMBER = "member"    # Standard team member
    VIEWER = "viewer"    # View-only team access


class OrganizationPlanTier(str, Enum):
    """Organization plan tiers."""
    FREE = "free"
    STARTER = "starter"
    PRO = "pro"
    TEAM = "team"         # $199/mo tier
    ENTERPRISE = "enterprise"


# ── Data Models ─────────────────────────────────────────────────────────────

@dataclass
class Organization:
    """Organization data model (wraps tenant with org-specific fields)."""
    id: str                      # Same as tenant_id
    name: str
    slug: str                    # URL-friendly identifier
    plan_tier: OrganizationPlanTier
    
    # Limits
    max_api_keys: Optional[int] = None
    max_provider_keys: Optional[int] = None
    max_monthly_tokens: Optional[int] = None
    max_monthly_cost: Optional[float] = None
    max_users: Optional[int] = None      # Team/Enterprise only
    max_teams: Optional[int] = None      # Team/Enterprise only
    
    # Status
    is_active: bool = True
    
    # Metadata
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    metadata: Optional[Dict[str, Any]] = None
    
    # Organization settings (loaded separately)
    settings: Optional['OrganizationSettings'] = None


@dataclass
class OrganizationSettings:
    """Organization-level settings."""
    organization_id: str         # Same as tenant_id
    organization_name: Optional[str] = None
    logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    primary_color: str = "#10b981"
    
    # Authentication
    saml_enabled: bool = False
    enforce_sso: bool = False
    require_2fa: bool = False
    session_timeout_minutes: int = 480
    
    # Features
    allow_public_sharing: bool = False
    allow_api_key_creation: bool = True
    allow_webhook_configuration: bool = True
    
    # Contact
    admin_email: Optional[str] = None
    security_alert_email: Optional[str] = None
    billing_email: Optional[str] = None
    
    updated_at: Optional[datetime] = None
    updated_by: Optional[str] = None


@dataclass
class OrganizationMember:
    """Organization member with their role."""
    user_id: str
    organization_id: str         # Same as tenant_id
    email: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    role: OrganizationRole = OrganizationRole.MEMBER
    
    # Status
    is_active: bool = True
    email_verified: bool = False
    
    # Invitation tracking
    invited_at: Optional[datetime] = None
    joined_at: Optional[datetime] = None
    invited_by: Optional[str] = None
    
    # SSO
    sso_provider: Optional[str] = None
    sso_external_id: Optional[str] = None
    
    # Metadata
    last_login_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    preferences: Optional[Dict[str, Any]] = None


@dataclass
class Team:
    """Team within an organization."""
    id: str
    organization_id: str         # Same as tenant_id
    name: str
    slug: str
    description: Optional[str] = None
    is_default: bool = False     # Auto-join for new users
    
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[str] = None


@dataclass
class TeamMember:
    """Team membership with role."""
    membership_id: str
    team_id: str
    user_id: str
    team_role: TeamRole = TeamRole.MEMBER
    joined_at: Optional[datetime] = None
    invited_by: Optional[str] = None
    
    # Joined user details
    email: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None


@dataclass
class Invitation:
    """Pending invitation to join an organization."""
    id: str
    organization_id: str
    email: str
    invited_by: str
    
    # Pre-configured settings
    role: OrganizationRole = OrganizationRole.MEMBER
    team_ids: List[str] = field(default_factory=list)
    
    # Token for acceptance link
    token: str = ""
    expires_at: Optional[datetime] = None
    
    # Status
    accepted_at: Optional[datetime] = None
    accepted_by: Optional[str] = None
    
    created_at: Optional[datetime] = None


# ── Organization Queries ─────────────────────────────────────────────────────

class OrganizationQueries:
    """Database queries for organizations."""
    
    def __init__(self, db_backend: Optional[DatabaseBackend] = None):
        self.db = db_backend
    
    # ── Organization CRUD ───────────────────────────────────────────────────
    
    def create_organization(
        self,
        name: str,
        slug: str,
        plan_tier: OrganizationPlanTier = OrganizationPlanTier.FREE,
        metadata: Optional[Dict] = None,
    ) -> Organization:
        """Create a new organization (creates tenant + org settings)."""
        import uuid
        
        org_id = f"org_{uuid.uuid4().hex[:12]}"
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Create tenant using actual schema (id, plan not plan_tier)
                cur.execute("""
                    INSERT INTO tenants (
                        id, name, plan, metadata, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, NOW(), NOW())
                """, (
                    org_id, name, plan_tier.value,
                    psycopg2.extras.Json(metadata) if metadata else None
                ))
                
                conn.commit()
        
        log.info(f"Created organization: {org_id} ({name})")
        
        return Organization(
            id=org_id,
            name=name,
            slug=slug,
            plan_tier=plan_tier,
            created_at=datetime.now(),
            metadata=metadata,
        )
    
    def get_organization(self, org_id: str) -> Optional[Organization]:
        """Get organization by ID."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        t.id,
                        t.name,
                        t.plan as plan_tier,
                        t.max_api_keys,
                        t.max_provider_keys,
                        t.max_monthly_tokens,
                        t.max_monthly_cost,
                        t.is_active,
                        t.created_at,
                        t.updated_at,
                        t.metadata
                    FROM tenants t
                    WHERE t.id = %s
                """, (org_id,))
                row = cur.fetchone()
                
                if not row:
                    return None
                
                return Organization(
                    id=row['id'],
                    name=row['name'],
                    slug=self._generate_slug(row['name']),
                    plan_tier=OrganizationPlanTier(row['plan_tier']) if row['plan_tier'] else OrganizationPlanTier.FREE,
                    max_api_keys=row['max_api_keys'],
                    max_provider_keys=row['max_provider_keys'],
                    max_monthly_tokens=row['max_monthly_tokens'],
                    max_monthly_cost=float(row['max_monthly_cost']) if row['max_monthly_cost'] else None,
                    is_active=row['is_active'] if row['is_active'] is not None else True,
                    created_at=row['created_at'],
                    updated_at=row['updated_at'],
                    metadata=row['metadata'],
                )
    
    def update_organization(
        self,
        org_id: str,
        updates: Dict[str, Any],
        settings_updates: Optional[Dict[str, Any]] = None,
    ) -> Optional[Organization]:
        """Update organization fields and/or settings."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                # Update tenant fields (use 'plan' not 'plan_tier' in DB)
                tenant_fields = {
                    'name', 'plan', 'is_active',
                    'max_api_keys', 'max_provider_keys',
                    'max_monthly_tokens', 'max_monthly_cost', 'metadata'
                }
                # Map plan_tier to plan for DB
                db_updates = {}
                for k, v in updates.items():
                    if k == 'plan_tier':
                        db_updates['plan'] = v.value if hasattr(v, 'value') else v
                    elif k in tenant_fields:
                        db_updates[k] = v
                
                if db_updates:
                    set_parts = []
                    params = []
                    for key, value in db_updates.items():
                        if key == 'metadata':
                            set_parts.append(f"{key} = %s")
                            params.append(psycopg2.extras.Json(value) if value else None)
                        else:
                            set_parts.append(f"{key} = %s")
                            params.append(value)
                    set_parts.append("updated_at = NOW()")
                    params.append(org_id)
                    
                    cur.execute(f"""
                        UPDATE tenants
                        SET {', '.join(set_parts)}
                        WHERE id = %s
                    """, params)
                
                conn.commit()
        
        return self.get_organization(org_id)
    
    def list_user_organizations(self, user_id: str) -> List[Organization]:
        """List all organizations a user is a member of."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Quick fix for dev: derive tenant from user_id pattern
                # In production, this should JOIN with users table
                tenant_id = user_id.replace("user_", "")
                cur.execute("""
                    SELECT 
                        t.id as id,
                        t.name,
                        t.plan as plan_tier,
                        TRUE as is_active,
                        t.created_at,
                        t.updated_at
                    FROM tenants t
                    WHERE t.slug = %s OR t.name ILIKE %s
                    ORDER BY t.created_at DESC
                """, (tenant_id, f'%{tenant_id}%'))
                
                orgs = []
                for row in cur.fetchall():
                    orgs.append(Organization(
                        id=row['id'],
                        name=row['name'],
                        slug=self._generate_slug(row['name']),
                        plan_tier=OrganizationPlanTier(row['plan_tier']) if row['plan_tier'] else OrganizationPlanTier.FREE,
                        is_active=row['is_active'],
                        created_at=row['created_at'],
                        updated_at=row['updated_at'],
                    ))
                return orgs
    
    def delete_organization(self, org_id: str) -> bool:
        """Delete an organization (cascades to all related data)."""
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM tenants WHERE id = %s", (org_id,))
                deleted = cur.rowcount > 0
                conn.commit()
                return deleted
    
    # ── Organization Members ────────────────────────────────────────────────
    
    def get_organization_member(
        self,
        org_id: str,
        user_id: str,
    ) -> Optional[OrganizationMember]:
        """Get a specific member of an organization.
        
        Queries the users table for member information.
        """
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        user_id::text as user_id,
                        tenant_id as organization_id,
                        email,
                        display_name,
                        tenant_role,
                        is_active,
                        email_verified,
                        created_at,
                        updated_at,
                        last_login_at
                    FROM users
                    WHERE tenant_id = %s AND user_id::text = %s
                    LIMIT 1
                """, (org_id, user_id))
                row = cur.fetchone()
                
                if not row:
                    return None
                
                return OrganizationMember(
                    user_id=row['user_id'],
                    organization_id=row['organization_id'],
                    email=row['email'],
                    display_name=row['display_name'],
                    role=OrganizationRole(row['tenant_role']) if row['tenant_role'] else OrganizationRole.MEMBER,
                    is_active=row['is_active'] if row['is_active'] is not None else True,
                    email_verified=row['email_verified'] if row['email_verified'] is not None else False,
                    joined_at=row['created_at'],
                    created_at=row['created_at'],
                    last_login_at=row['last_login_at'],
                )
    
    def list_organization_members(
        self,
        org_id: str,
        role: Optional[OrganizationRole] = None,
        is_active: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[OrganizationMember]:
        """List all members of an organization.
        
        Queries the users table for member information.
        """
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                conditions = ["tenant_id = %s"]
                params = [org_id]
                
                if role is not None:
                    conditions.append("tenant_role = %s")
                    params.append(role.value)
                
                if is_active is not None:
                    conditions.append("is_active = %s")
                    params.append(is_active)
                
                where_clause = "WHERE " + " AND ".join(conditions)
                params.extend([limit, offset])
                
                cur.execute(f"""
                    SELECT 
                        user_id::text as user_id,
                        tenant_id as organization_id,
                        email,
                        display_name,
                        tenant_role,
                        is_active,
                        email_verified,
                        created_at,
                        updated_at,
                        last_login_at
                    FROM users
                    {where_clause}
                    ORDER BY created_at DESC
                    LIMIT %s OFFSET %s
                """, params)
                
                members = []
                for row in cur.fetchall():
                    members.append(OrganizationMember(
                        user_id=row['user_id'],
                        organization_id=row['organization_id'],
                        email=row['email'],
                        display_name=row['display_name'],
                        role=OrganizationRole(row['tenant_role']) if row['tenant_role'] else OrganizationRole.MEMBER,
                        is_active=row['is_active'] if row['is_active'] is not None else True,
                        email_verified=row['email_verified'] if row['email_verified'] is not None else False,
                        joined_at=row['created_at'],
                        created_at=row['created_at'],
                        last_login_at=row['last_login_at'],
                    ))
                return members
    
    def add_organization_member(
        self,
        org_id: str,
        email: str,
        role: OrganizationRole = OrganizationRole.MEMBER,
        display_name: Optional[str] = None,
        invited_by: Optional[str] = None,
        password_hash: Optional[str] = None,
        sso_provider: Optional[str] = None,
        sso_external_id: Optional[str] = None,
    ) -> OrganizationMember:
        """Add a new member to an organization.
        
        Inserts into the users table and returns the created member.
        """
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO users (
                        tenant_id, email, display_name, tenant_role,
                        password_hash, sso_provider, sso_external_id,
                        is_active, email_verified, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE, FALSE, NOW(), NOW())
                    RETURNING user_id, tenant_id, email, display_name, tenant_role,
                              is_active, email_verified, created_at, updated_at
                """, (
                    org_id, email, display_name or email.split('@')[0], role.value,
                    password_hash, sso_provider, sso_external_id
                ))
                row = cur.fetchone()
                conn.commit()
                
                log.info(f"Added member {row['user_id']} to organization {org_id}")
                
                return OrganizationMember(
                    user_id=str(row['user_id']),
                    organization_id=row['tenant_id'],
                    email=row['email'],
                    display_name=row['display_name'],
                    role=OrganizationRole(row['tenant_role']),
                    is_active=row['is_active'],
                    email_verified=row['email_verified'],
                    invited_by=invited_by,
                    joined_at=row['created_at'],
                    created_at=row['created_at'],
                )
    
    def update_member_role(
        self,
        org_id: str,
        user_id: str,
        new_role: OrganizationRole,
    ) -> Optional[OrganizationMember]:
        """Update a member's role in the organization.
        
        Updates the tenant_role in the users table.
        """
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    UPDATE users
                    SET tenant_role = %s, updated_at = NOW()
                    WHERE user_id = %s AND tenant_id = %s
                    RETURNING user_id, tenant_id, email, display_name, tenant_role,
                              is_active, email_verified, created_at, updated_at
                """, (new_role.value, user_id, org_id))
                row = cur.fetchone()
                
                if not row:
                    return None
                
                conn.commit()
                log.info(f"Updated role for user {user_id} in org {org_id} to {new_role.value}")
                
                return OrganizationMember(
                    user_id=str(row['user_id']),
                    organization_id=row['tenant_id'],
                    email=row['email'],
                    display_name=row['display_name'],
                    role=OrganizationRole(row['tenant_role']),
                    is_active=row['is_active'],
                    email_verified=row['email_verified'],
                    joined_at=row['created_at'],
                    created_at=row['created_at'],
                )
    
    def remove_organization_member(self, org_id: str, user_id: str) -> bool:
        """Remove a member from the organization (soft delete).
        
        Sets is_active=FALSE in the users table.
        """
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE users
                    SET is_active = FALSE, updated_at = NOW()
                    WHERE user_id = %s AND tenant_id = %s
                    RETURNING user_id
                """, (user_id, org_id))
                row = cur.fetchone()
                
                if not row:
                    return False
                
                conn.commit()
                log.info(f"Removed member {user_id} from organization {org_id}")
                return True
    
    def count_organization_members(self, org_id: str, is_active: bool = True) -> int:
        """Count members in an organization.
        
        Queries the users table for member count.
        """
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT COUNT(*) FROM users
                    WHERE tenant_id = %s AND is_active = %s
                """, (org_id, is_active))
                return cur.fetchone()[0]
    
    # ── Invitations ──────────────────────────────────────────────────────────
    
    def create_invitation(
        self,
        org_id: str,
        email: str,
        invited_by: str,
        role: OrganizationRole = OrganizationRole.MEMBER,
        team_ids: Optional[List[str]] = None,
        expires_days: int = 7,
    ) -> Invitation:
        """Create an invitation to join an organization."""
        import secrets
        
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now() + __import__('datetime').timedelta(days=expires_days)
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    INSERT INTO invitations (
                        tenant_id, email, invited_by, role_id, team_ids, token, expires_at
                    ) VALUES (
                        %s, %s, %s,
                        (SELECT role_id FROM roles WHERE tenant_id = %s AND name = %s LIMIT 1),
                        %s, %s, %s
                    )
                    RETURNING 
                        invitation_id::text as id,
                        tenant_id as organization_id,
                        email,
                        invited_by::text,
                        token,
                        expires_at,
                        created_at
                """, (
                    org_id, email, invited_by, org_id, role.value,
                    team_ids or [], token, expires_at
                ))
                row = cur.fetchone()
                conn.commit()
                
                return Invitation(
                    id=row['id'],
                    organization_id=row['organization_id'],
                    email=row['email'],
                    invited_by=row['invited_by'],
                    role=role,
                    team_ids=team_ids or [],
                    token=row['token'],
                    expires_at=row['expires_at'],
                    created_at=row['created_at'],
                )
    
    def get_invitation_by_token(self, token: str) -> Optional[Invitation]:
        """Get invitation by token."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        invitation_id::text as id,
                        tenant_id as organization_id,
                        email,
                        invited_by::text,
                        role_id,
                        team_ids,
                        token,
                        expires_at,
                        accepted_at,
                        accepted_by::text,
                        created_at
                    FROM invitations
                    WHERE token = %s AND expires_at > NOW() AND accepted_at IS NULL
                """, (token,))
                row = cur.fetchone()
                
                if not row:
                    return None
                
                return Invitation(
                    id=row['id'],
                    organization_id=row['organization_id'],
                    email=row['email'],
                    invited_by=row['invited_by'],
                    team_ids=row['team_ids'] or [],
                    token=row['token'],
                    expires_at=row['expires_at'],
                    accepted_at=row['accepted_at'],
                    accepted_by=row['accepted_by'],
                    created_at=row['created_at'],
                )
    
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
    
    def list_pending_invitations(self, org_id: str) -> List[Invitation]:
        """List pending invitations for an organization."""
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("""
                    SELECT 
                        invitation_id::text as id,
                        tenant_id as organization_id,
                        email,
                        invited_by::text,
                        team_ids,
                        token,
                        expires_at,
                        created_at
                    FROM invitations
                    WHERE tenant_id = %s AND accepted_at IS NULL AND expires_at > NOW()
                    ORDER BY created_at DESC
                """, (org_id,))
                
                invitations = []
                for row in cur.fetchall():
                    invitations.append(Invitation(
                        id=row['id'],
                        organization_id=row['organization_id'],
                        email=row['email'],
                        invited_by=row['invited_by'],
                        team_ids=row['team_ids'] or [],
                        token=row['token'],
                        expires_at=row['expires_at'],
                        created_at=row['created_at'],
                    ))
                return invitations
    
    # ── Helper Methods ──────────────────────────────────────────────────────
    
    def _generate_slug(self, name: str) -> str:
        """Generate a URL-friendly slug from a name."""
        import re
        slug = re.sub(r'[^\w\s-]', '', name.lower())
        slug = re.sub(r'[-\s]+', '-', slug)
        return slug[:50]


# ── Singleton ───────────────────────────────────────────────────────────────

_org_queries: Optional[OrganizationQueries] = None


def get_org_queries(db_backend: Optional[DatabaseBackend] = None) -> OrganizationQueries:
    """Get the singleton organization queries instance."""
    global _org_queries
    if _org_queries is None:
        _org_queries = OrganizationQueries(db_backend)
    return _org_queries
