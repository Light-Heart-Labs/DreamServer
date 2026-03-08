"""
Token Spy Audit Middleware — Automatic Request/Response Auditing

Phase 4d: FastAPI middleware for comprehensive audit logging
- Automatic logging of all API requests
- Sensitive data redaction (PII masking)
- Configurable log levels per endpoint
- Request/response timing
"""

import time
import uuid
import logging
from typing import Optional, Dict, Any, Set, Callable
from datetime import datetime

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

from .audit_logger import (
    AuditLogger, AuditAction, ResourceType, 
    get_audit_logger, redact_sensitive_dict, redact_pii
)

log = logging.getLogger("token-spy-audit-middleware")


# ── Configuration ────────────────────────────────────────────────────────────

# Endpoints that should not be audited (health checks, metrics, etc.)
SKIP_AUDIT_PATHS: Set[str] = {
    "/health",
    "/metrics",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/favicon.ico",
}

# Paths that should be audited with minimal detail (high-traffic)
MINIMAL_AUDIT_PATHS: Set[str] = {
    "/api/events/stream",  # SSE stream - don't log every heartbeat
}

# Paths that require detailed audit logging
DETAILED_AUDIT_PATHS: Set[str] = {
    "/api/provider-keys",
    "/api/tenants",
    "/api/alerts",
    "/api/audit",
}

# Action mapping based on HTTP method and path patterns
ACTION_MAPPING: Dict[str, Dict[str, AuditAction]] = {
    "POST": {
        "/api/provider-keys": AuditAction.PROVIDER_KEY_CREATED,
        "/api/tenants": AuditAction.TENANT_CREATED,
        "/api/alerts/configure": AuditAction.ALERT_RULE_CREATED,
        "/api/alerts/test": AuditAction.ALERT_TRIGGERED,
        "/api/audit/export": AuditAction.DATA_EXPORT_REQUESTED,
    },
    "PATCH": {
        "/api/provider-keys": AuditAction.PROVIDER_KEY_UPDATED,
        "/api/tenants": AuditAction.TENANT_UPDATED,
        "/api/alerts/rules": AuditAction.ALERT_RULE_UPDATED,
    },
    "DELETE": {
        "/api/provider-keys": AuditAction.PROVIDER_KEY_DELETED,
        "/api/alerts/rules": AuditAction.ALERT_RULE_DELETED,
    },
    "GET": {
        "/api/audit": AuditAction.ADMIN_ACCESS,
    },
}

# Resource type mapping based on path patterns
RESOURCE_TYPE_MAPPING: Dict[str, ResourceType] = {
    "/api/provider-keys": ResourceType.PROVIDER_KEY,
    "/api/tenants": ResourceType.TENANT,
    "/api/alerts": ResourceType.ALERT_RULE,
    "/api/audit": ResourceType.EXPORT,
    "/api/sessions": ResourceType.SESSION,
}


# ── Helper Functions ─────────────────────────────────────────────────────────

def should_skip_audit(path: str) -> bool:
    """Check if a path should skip audit logging entirely."""
    # Exact matches
    if path in SKIP_AUDIT_PATHS:
        return True
    
    # Check for static file patterns
    if path.startswith("/static/") or path.endswith((".css", ".js", ".png", ".jpg", ".ico")):
        return True
    
    return False


def should_minimal_audit(path: str) -> bool:
    """Check if a path should use minimal audit logging."""
    for skip_path in MINIMAL_AUDIT_PATHS:
        if path.startswith(skip_path):
            return True
    return False


def should_detailed_audit(path: str) -> bool:
    """Check if a path requires detailed audit logging."""
    for detail_path in DETAILED_AUDIT_PATHS:
        if path.startswith(detail_path):
            return True
    return False


def get_audit_action(method: str, path: str) -> AuditAction:
    """Determine the audit action based on HTTP method and path."""
    method_actions = ACTION_MAPPING.get(method.upper(), {})
    
    # Check for exact or prefix matches
    for action_path, action in method_actions.items():
        if path.startswith(action_path):
            return action
    
    # Default action based on method
    if method.upper() == "POST":
        return AuditAction.API_REQUEST
    elif method.upper() in ("PUT", "PATCH"):
        return AuditAction.SETTINGS_CHANGED
    elif method.upper() == "DELETE":
        return AuditAction.API_KEY_DELETED
    else:
        return AuditAction.API_REQUEST


def get_resource_type(path: str) -> ResourceType:
    """Determine the resource type based on path."""
    for resource_path, resource_type in RESOURCE_TYPE_MAPPING.items():
        if path.startswith(resource_path):
            return resource_type
    return ResourceType.REQUEST


def extract_resource_id(path: str) -> Optional[str]:
    """Extract resource ID from path if present."""
    # Pattern: /api/{resource}/{id} or /api/{resource}/{id}/{action}
    parts = path.strip("/").split("/")
    
    if len(parts) >= 3:
        # Check if third part looks like an ID (not a known action word)
        potential_id = parts[2]
        action_words = {"configure", "test", "toggle", "acknowledge", "export", "logs", "rules", "history"}
        
        if potential_id not in action_words:
            return potential_id
    
    return None


def get_client_ip(request: Request) -> str:
    """Extract client IP address from request, handling proxies."""
    # Check for forwarded headers (reverse proxy)
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # Take the first IP (client IP)
        return forwarded_for.split(",")[0].strip()
    
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip
    
    # Fall back to direct client
    if request.client:
        return request.client.host
    
    return "unknown"


def extract_request_details(request: Request, body: Optional[bytes] = None) -> Dict[str, Any]:
    """Extract relevant details from the request for audit logging."""
    details = {
        "query_params": dict(request.query_params) if request.query_params else None,
        "path_params": dict(request.path_params) if request.path_params else None,
    }
    
    # Parse request body if present and JSON
    if body:
        try:
            import json
            body_dict = json.loads(body.decode("utf-8"))
            # Redact sensitive fields
            details["body"] = redact_sensitive_dict(body_dict)
        except (json.JSONDecodeError, UnicodeDecodeError):
            # Not JSON or can't decode - note but don't include
            details["body_type"] = request.headers.get("content-type", "unknown")
    
    # Remove None values
    return {k: v for k, v in details.items() if v is not None}


# ── Audit Middleware ─────────────────────────────────────────────────────────

class AuditMiddleware(BaseHTTPMiddleware):
    """
    FastAPI middleware for automatic audit logging.
    
    Features:
    - Logs all API requests with timing information
    - Automatic PII redaction
    - Configurable per-endpoint logging levels
    - Extracts tenant/user context from request state
    """
    
    def __init__(self, app, audit_logger: Optional[AuditLogger] = None):
        super().__init__(app)
        self.audit_logger = audit_logger or get_audit_logger()
    
    async def dispatch(
        self, 
        request: Request, 
        call_next: RequestResponseEndpoint
    ) -> Response:
        """Process the request and log audit event."""
        path = request.url.path
        
        # Skip audit for certain paths
        if should_skip_audit(path):
            return await call_next(request)
        
        # Generate request ID if not present
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        
        # Record start time
        start_time = time.time()
        
        # Get client info
        client_ip = get_client_ip(request)
        user_agent = request.headers.get("User-Agent", "")
        
        # Read request body if needed for detailed audit
        request_body = None
        if should_detailed_audit(path) and request.method in ("POST", "PUT", "PATCH"):
            try:
                request_body = await request.body()
            except Exception:
                pass
        
        # Process the request
        response = None
        error_message = None
        success = True
        
        try:
            response = await call_next(request)
            success = response.status_code < 400
            if not success:
                error_message = f"HTTP {response.status_code}"
        except Exception as e:
            success = False
            error_message = str(e)
            raise
        finally:
            # Calculate latency
            latency_ms = int((time.time() - start_time) * 1000)
            
            # Get tenant context from request state (set by tenant middleware)
            tenant_id = "anonymous"
            user_id = None
            
            if hasattr(request.state, "tenant_context"):
                tenant_context = request.state.tenant_context
                tenant_id = tenant_context.tenant_id
            elif hasattr(request.state, "tenant"):
                tenant = request.state.tenant
                tenant_id = tenant.tenant_id
            
            if hasattr(request.state, "api_key"):
                api_key = request.state.api_key
                user_id = getattr(api_key, "key_id", None) or getattr(api_key, "key_prefix", None)
            
            # Skip minimal audit for high-traffic endpoints
            if should_minimal_audit(path):
                # Only log errors for these endpoints
                if not success:
                    await self._log_audit_event(
                        request=request,
                        request_id=request_id,
                        tenant_id=tenant_id,
                        user_id=user_id,
                        client_ip=client_ip,
                        user_agent=user_agent,
                        latency_ms=latency_ms,
                        response_status=response.status_code if response else 500,
                        success=success,
                        error_message=error_message,
                        request_body=None,  # Never include body for minimal
                    )
            else:
                # Full audit logging
                await self._log_audit_event(
                    request=request,
                    request_id=request_id,
                    tenant_id=tenant_id,
                    user_id=user_id,
                    client_ip=client_ip,
                    user_agent=user_agent,
                    latency_ms=latency_ms,
                    response_status=response.status_code if response else 500,
                    success=success,
                    error_message=error_message,
                    request_body=request_body if should_detailed_audit(path) else None,
                )
        
        return response
    
    async def _log_audit_event(
        self,
        request: Request,
        request_id: str,
        tenant_id: str,
        user_id: Optional[str],
        client_ip: str,
        user_agent: str,
        latency_ms: int,
        response_status: int,
        success: bool,
        error_message: Optional[str],
        request_body: Optional[bytes],
    ) -> None:
        """Log the audit event."""
        path = request.url.path
        method = request.method
        
        # Determine action and resource type
        action = get_audit_action(method, path)
        resource_type = get_resource_type(path)
        resource_id = extract_resource_id(path)
        
        # Extract request details
        details = extract_request_details(request, request_body)
        
        # Determine severity based on response status
        if response_status >= 500:
            severity = "error"
        elif response_status >= 400:
            severity = "warning"
        else:
            severity = "info"
        
        # Log the event
        try:
            await self.audit_logger.log(
                tenant_id=tenant_id,
                action=action,
                resource_type=resource_type,
                user_id=user_id,
                resource_id=resource_id,
                details=details if details else None,
                ip_address=client_ip,
                user_agent=user_agent[:500] if user_agent else None,  # Truncate long UAs
                request_id=request_id,
                request_method=method,
                request_path=path,
                response_status=response_status,
                latency_ms=latency_ms,
                severity=severity,
                success=success,
                error_message=error_message,
            )
        except Exception as e:
            # Don't let audit logging failures break the request
            log.error(f"Failed to log audit event: {e}")


# ── Factory Function ─────────────────────────────────────────────────────────

def create_audit_middleware(app, audit_logger: Optional[AuditLogger] = None):
    """
    Create and attach audit middleware to a FastAPI app.
    
    Usage:
        app = FastAPI()
        create_audit_middleware(app)
    """
    middleware = AuditMiddleware(app, audit_logger)
    return middleware
