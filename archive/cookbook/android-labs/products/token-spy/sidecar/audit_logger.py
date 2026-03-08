"""
Token Spy Audit Logger — Comprehensive Audit Logging System

Phase 4d: Audit logging for compliance and security
- AuditEvent dataclass for structured audit records
- AuditLogger class with async logging to PostgreSQL
- Retention policies by tier (30/90/365 days)
- PII masking and sensitive data redaction
"""

import logging
import json
import hashlib
import re
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from enum import Enum
from contextlib import asynccontextmanager

from .db_backend import get_db_connection

try:
    from psycopg2.extras import RealDictCursor, Json
    POSTGRES_AVAILABLE = True
except ImportError:
    POSTGRES_AVAILABLE = False
    RealDictCursor = None
    Json = None

log = logging.getLogger("token-spy-audit")


# ── Audit Event Types ────────────────────────────────────────────────────────

class AuditAction(str, Enum):
    """Types of auditable actions."""
    # Authentication
    AUTH_LOGIN = "auth.login"
    AUTH_LOGOUT = "auth.logout"
    AUTH_FAILED = "auth.failed"
    AUTH_TOKEN_CREATED = "auth.token_created"
    AUTH_TOKEN_REVOKED = "auth.token_revoked"
    
    # API Key Management
    API_KEY_CREATED = "api_key.created"
    API_KEY_UPDATED = "api_key.updated"
    API_KEY_REVOKED = "api_key.revoked"
    API_KEY_DELETED = "api_key.deleted"
    
    # Provider Key Management
    PROVIDER_KEY_CREATED = "provider_key.created"
    PROVIDER_KEY_UPDATED = "provider_key.updated"
    PROVIDER_KEY_DELETED = "provider_key.deleted"
    PROVIDER_KEY_ACCESSED = "provider_key.accessed"
    
    # Tenant Management
    TENANT_CREATED = "tenant.created"
    TENANT_UPDATED = "tenant.updated"
    TENANT_SUSPENDED = "tenant.suspended"
    TENANT_REACTIVATED = "tenant.reactivated"
    
    # API Requests
    API_REQUEST = "api.request"
    API_PROXY_REQUEST = "api.proxy_request"
    
    # Alert Management
    ALERT_RULE_CREATED = "alert.rule_created"
    ALERT_RULE_UPDATED = "alert.rule_updated"
    ALERT_RULE_DELETED = "alert.rule_deleted"
    ALERT_TRIGGERED = "alert.triggered"
    ALERT_ACKNOWLEDGED = "alert.acknowledged"
    
    # Data Export
    DATA_EXPORT_REQUESTED = "data.export_requested"
    DATA_EXPORT_COMPLETED = "data.export_completed"
    
    # Rate Limiting
    RATE_LIMIT_EXCEEDED = "rate_limit.exceeded"
    RATE_LIMIT_WARNING = "rate_limit.warning"
    
    # Admin Actions
    ADMIN_ACCESS = "admin.access"
    ADMIN_IMPERSONATION = "admin.impersonation"
    SETTINGS_CHANGED = "settings.changed"


class ResourceType(str, Enum):
    """Types of resources that can be audited."""
    TENANT = "tenant"
    USER = "user"
    API_KEY = "api_key"
    PROVIDER_KEY = "provider_key"
    ALERT_RULE = "alert_rule"
    ALERT_EVENT = "alert_event"
    SESSION = "session"
    SETTINGS = "settings"
    EXPORT = "export"
    REQUEST = "request"


# ── Retention Policies ───────────────────────────────────────────────────────

RETENTION_DAYS_BY_TIER = {
    "free": 30,
    "starter": 90,
    "pro": 180,
    "enterprise": 365,
}


# ── PII Patterns for Redaction ───────────────────────────────────────────────

PII_PATTERNS = [
    # Email addresses
    (re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'), '[EMAIL_REDACTED]'),
    # Phone numbers (various formats)
    (re.compile(r'\b(?:\+?1[-.]?)?\(?[0-9]{3}\)?[-.]?[0-9]{3}[-.]?[0-9]{4}\b'), '[PHONE_REDACTED]'),
    # Credit card numbers
    (re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b'), '[CARD_REDACTED]'),
    # SSN
    (re.compile(r'\b\d{3}[-]?\d{2}[-]?\d{4}\b'), '[SSN_REDACTED]'),
    # API keys (common patterns)
    (re.compile(r'\b(sk|pk|api|key|token)[-_][a-zA-Z0-9]{20,}\b', re.IGNORECASE), '[API_KEY_REDACTED]'),
    # Bearer tokens
    (re.compile(r'Bearer\s+[a-zA-Z0-9_-]+\.?[a-zA-Z0-9_-]*\.?[a-zA-Z0-9_-]*', re.IGNORECASE), 'Bearer [TOKEN_REDACTED]'),
]

# Sensitive field names to redact entirely
SENSITIVE_FIELDS = {
    'password', 'secret', 'api_key', 'apikey', 'access_token', 'refresh_token',
    'authorization', 'auth', 'credential', 'private_key', 'secret_key',
    'x-api-key', 'x-auth-token', 'bearer', 'ssn', 'social_security',
}


# ── Data Classes ─────────────────────────────────────────────────────────────

@dataclass
class AuditEvent:
    """Structured audit log entry."""
    timestamp: datetime
    tenant_id: str
    action: AuditAction
    resource_type: ResourceType
    
    # Optional fields
    user_id: Optional[str] = None
    resource_id: Optional[str] = None
    details: Optional[Dict[str, Any]] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    
    # Request context
    request_id: Optional[str] = None
    request_method: Optional[str] = None
    request_path: Optional[str] = None
    response_status: Optional[int] = None
    latency_ms: Optional[int] = None
    
    # Metadata
    severity: str = "info"  # info, warning, error, critical
    success: bool = True
    error_message: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        result = {
            "timestamp": self.timestamp.isoformat(),
            "tenant_id": self.tenant_id,
            "action": self.action.value if isinstance(self.action, AuditAction) else self.action,
            "resource_type": self.resource_type.value if isinstance(self.resource_type, ResourceType) else self.resource_type,
        }
        
        # Add optional fields if present
        optional_fields = [
            'user_id', 'resource_id', 'details', 'ip_address', 'user_agent',
            'request_id', 'request_method', 'request_path', 'response_status',
            'latency_ms', 'severity', 'success', 'error_message', 'metadata'
        ]
        
        for field_name in optional_fields:
            value = getattr(self, field_name, None)
            if value is not None:
                result[field_name] = value
        
        return result


# ── PII Redaction Functions ──────────────────────────────────────────────────

def redact_pii(text: str) -> str:
    """Redact PII patterns from text."""
    if not text or not isinstance(text, str):
        return text
    
    result = text
    for pattern, replacement in PII_PATTERNS:
        result = pattern.sub(replacement, result)
    
    return result


def redact_sensitive_dict(data: Dict[str, Any], depth: int = 0, max_depth: int = 10) -> Dict[str, Any]:
    """Recursively redact sensitive fields from a dictionary."""
    if depth > max_depth:
        return {"_truncated": "max depth exceeded"}
    
    if not isinstance(data, dict):
        return data
    
    result = {}
    for key, value in data.items():
        key_lower = key.lower()
        
        # Check if key is sensitive
        if any(sensitive in key_lower for sensitive in SENSITIVE_FIELDS):
            if isinstance(value, str) and len(value) > 0:
                # Keep prefix for identification
                result[key] = f"{value[:4]}...[REDACTED]" if len(value) > 4 else "[REDACTED]"
            else:
                result[key] = "[REDACTED]"
        elif isinstance(value, dict):
            result[key] = redact_sensitive_dict(value, depth + 1, max_depth)
        elif isinstance(value, list):
            result[key] = [
                redact_sensitive_dict(item, depth + 1, max_depth) if isinstance(item, dict) 
                else redact_pii(item) if isinstance(item, str) else item
                for item in value
            ]
        elif isinstance(value, str):
            result[key] = redact_pii(value)
        else:
            result[key] = value
    
    return result


def hash_sensitive_id(value: str) -> str:
    """Create a one-way hash of a sensitive ID for correlation without exposure."""
    if not value:
        return ""
    return hashlib.sha256(value.encode()).hexdigest()[:16]


# ── Audit Logger ─────────────────────────────────────────────────────────────

class AuditLogger:
    """
    Async audit logger with PostgreSQL storage.
    
    Features:
    - Async batch logging for performance
    - Automatic PII redaction
    - Retention policy enforcement
    - Query interface with filters
    """
    
    def __init__(self, batch_size: int = 100, flush_interval_seconds: float = 5.0):
        self.batch_size = batch_size
        self.flush_interval = flush_interval_seconds
        self._buffer: List[AuditEvent] = []
        self._last_flush = datetime.now()
    
    async def log(
        self,
        tenant_id: str,
        action: AuditAction,
        resource_type: ResourceType,
        user_id: Optional[str] = None,
        resource_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None,
        request_method: Optional[str] = None,
        request_path: Optional[str] = None,
        response_status: Optional[int] = None,
        latency_ms: Optional[int] = None,
        severity: str = "info",
        success: bool = True,
        error_message: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        redact: bool = True,
    ) -> None:
        """
        Log an audit event.
        
        Args:
            tenant_id: Tenant ID
            action: The action being audited
            resource_type: Type of resource involved
            user_id: Optional user ID performing the action
            resource_id: Optional ID of the affected resource
            details: Additional context (will be redacted if redact=True)
            ip_address: Client IP address
            user_agent: Client user agent
            request_id: Unique request ID for correlation
            request_method: HTTP method
            request_path: Request path
            response_status: HTTP response status
            latency_ms: Request latency
            severity: Log severity (info, warning, error, critical)
            success: Whether the action succeeded
            error_message: Error message if action failed
            metadata: Additional metadata
            redact: Whether to redact PII from details
        """
        # Redact sensitive data if enabled
        if redact and details:
            details = redact_sensitive_dict(details)
        if redact and metadata:
            metadata = redact_sensitive_dict(metadata)
        if redact and error_message:
            error_message = redact_pii(error_message)
        
        event = AuditEvent(
            timestamp=datetime.now(),
            tenant_id=tenant_id,
            action=action,
            resource_type=resource_type,
            user_id=user_id,
            resource_id=resource_id,
            details=details,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
            request_method=request_method,
            request_path=request_path,
            response_status=response_status,
            latency_ms=latency_ms,
            severity=severity,
            success=success,
            error_message=error_message,
            metadata=metadata or {},
        )
        
        self._buffer.append(event)
        
        # Check if we should flush
        should_flush = (
            len(self._buffer) >= self.batch_size or
            (datetime.now() - self._last_flush).total_seconds() >= self.flush_interval
        )
        
        if should_flush:
            await self.flush()
    
    async def flush(self) -> int:
        """
        Flush buffered events to the database.
        
        Returns the number of events flushed.
        """
        if not self._buffer:
            return 0
        
        events_to_flush = self._buffer[:]
        self._buffer = []
        self._last_flush = datetime.now()
        
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    for event in events_to_flush:
                        cur.execute("""
                            INSERT INTO audit_logs (
                                timestamp, tenant_id, user_id, action, 
                                resource_type, resource_id, details,
                                ip_address, user_agent, request_id,
                                request_method, request_path, response_status,
                                latency_ms, severity, success, error_message, metadata
                            ) VALUES (
                                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                            )
                        """, (
                            event.timestamp,
                            event.tenant_id,
                            event.user_id,
                            event.action.value if isinstance(event.action, AuditAction) else event.action,
                            event.resource_type.value if isinstance(event.resource_type, ResourceType) else event.resource_type,
                            event.resource_id,
                            Json(event.details) if event.details else None,
                            event.ip_address,
                            event.user_agent,
                            event.request_id,
                            event.request_method,
                            event.request_path,
                            event.response_status,
                            event.latency_ms,
                            event.severity,
                            event.success,
                            event.error_message,
                            Json(event.metadata) if event.metadata else None,
                        ))
                    conn.commit()
            
            log.debug(f"Flushed {len(events_to_flush)} audit events")
            return len(events_to_flush)
            
        except Exception as e:
            log.error(f"Failed to flush audit events: {e}")
            # Put events back in buffer for retry
            self._buffer = events_to_flush + self._buffer
            raise
    
    async def query(
        self,
        tenant_id: str,
        action: Optional[str] = None,
        resource_type: Optional[str] = None,
        user_id: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        severity: Optional[str] = None,
        success: Optional[bool] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """
        Query audit logs with filters.
        
        Returns list of audit events matching the criteria.
        """
        conditions = ["tenant_id = %s"]
        params: List[Any] = [tenant_id]
        
        if action:
            conditions.append("action = %s")
            params.append(action)
        
        if resource_type:
            conditions.append("resource_type = %s")
            params.append(resource_type)
        
        if user_id:
            conditions.append("user_id = %s")
            params.append(user_id)
        
        if start_time:
            conditions.append("timestamp >= %s")
            params.append(start_time)
        
        if end_time:
            conditions.append("timestamp <= %s")
            params.append(end_time)
        
        if severity:
            conditions.append("severity = %s")
            params.append(severity)
        
        if success is not None:
            conditions.append("success = %s")
            params.append(success)
        
        where_clause = " AND ".join(conditions)
        params.extend([limit, offset])
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(f"""
                    SELECT 
                        id, timestamp, tenant_id, user_id, action,
                        resource_type, resource_id, details,
                        ip_address, user_agent, request_id,
                        request_method, request_path, response_status,
                        latency_ms, severity, success, error_message, metadata
                    FROM audit_logs
                    WHERE {where_clause}
                    ORDER BY timestamp DESC
                    LIMIT %s OFFSET %s
                """, params)
                
                rows = cur.fetchall()
                return [dict(row) for row in rows]
    
    async def count(
        self,
        tenant_id: str,
        action: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ) -> int:
        """Count audit logs matching criteria."""
        conditions = ["tenant_id = %s"]
        params: List[Any] = [tenant_id]
        
        if action:
            conditions.append("action = %s")
            params.append(action)
        
        if start_time:
            conditions.append("timestamp >= %s")
            params.append(start_time)
        
        if end_time:
            conditions.append("timestamp <= %s")
            params.append(end_time)
        
        where_clause = " AND ".join(conditions)
        
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(f"""
                    SELECT COUNT(*) FROM audit_logs WHERE {where_clause}
                """, params)
                return cur.fetchone()[0]
    
    async def apply_retention_policy(self, tenant_id: str, tier: str) -> int:
        """
        Apply retention policy for a tenant based on their tier.
        
        Returns the number of records deleted.
        """
        retention_days = RETENTION_DAYS_BY_TIER.get(tier.lower(), 30)
        cutoff_date = datetime.now() - timedelta(days=retention_days)
        
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    DELETE FROM audit_logs
                    WHERE tenant_id = %s AND timestamp < %s
                """, (tenant_id, cutoff_date))
                deleted_count = cur.rowcount
                conn.commit()
        
        if deleted_count > 0:
            log.info(f"Retention policy applied for {tenant_id}: deleted {deleted_count} records older than {retention_days} days")
        
        return deleted_count
    
    async def apply_all_retention_policies(self) -> Dict[str, int]:
        """Apply retention policies for all tenants. Returns counts by tenant."""
        results = {}
        
        with get_db_connection() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Get all tenants with their tiers
                cur.execute("""
                    SELECT tenant_id, COALESCE(plan_tier, 'free') as tier
                    FROM tenants WHERE is_active = TRUE
                """)
                tenants = cur.fetchall()
        
        for tenant in tenants:
            tenant_id = tenant['tenant_id']
            tier = tenant['tier']
            deleted = await self.apply_retention_policy(tenant_id, tier)
            if deleted > 0:
                results[tenant_id] = deleted
        
        return results


# ── Singleton Instance ───────────────────────────────────────────────────────

_audit_logger: Optional[AuditLogger] = None


def get_audit_logger() -> AuditLogger:
    """Get the singleton audit logger instance."""
    global _audit_logger
    if _audit_logger is None:
        _audit_logger = AuditLogger()
    return _audit_logger


# ── Convenience Functions ────────────────────────────────────────────────────

async def audit_log(
    tenant_id: str,
    action: AuditAction,
    resource_type: ResourceType,
    **kwargs
) -> None:
    """Convenience function to log an audit event."""
    logger = get_audit_logger()
    await logger.log(tenant_id, action, resource_type, **kwargs)


async def flush_audit_logs() -> int:
    """Flush any buffered audit logs."""
    logger = get_audit_logger()
    return await logger.flush()
