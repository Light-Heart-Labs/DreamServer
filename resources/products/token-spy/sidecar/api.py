"""
Token Spy Phase 3 — Backend API

FastAPI endpoints for dashboard data:
- Overview stats
- Agent explorer
- Model analytics
- Usage time-series
- Session management
- Server-Sent Events for real-time updates
"""

import os
import json
import asyncio
import logging
import bcrypt
from typing import Optional, List, Dict, Any, Set
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
from dataclasses import dataclass, field, asdict
from enum import Enum

from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Import from sibling modules (relative imports for package compatibility)
from .db_backend import DatabaseBackend, get_db, UsageStats, APIKey, get_db_connection
from .alerts import (
    AlertRule, AlertEvent, ThresholdType, NotificationChannel,
    AlertSeverity, AlertStatus, NotificationConfig,
    check_budget_alerts, init_alert_tables, ALERT_TABLES_SQL
)
try:
    from psycopg2.extras import RealDictCursor
except ImportError:
    RealDictCursor = None
from .auth_middleware import (
    auth_middleware, APIKeyContext, TenantContext,
    extract_key_from_header, hash_api_key
)
from .rate_limit_middleware import (
    RateLimitMiddleware, get_rate_limit_info, get_rate_limit_status
)
from .rate_limiter import get_rate_limiter
from .audit_logger import (
    AuditLogger, AuditAction, ResourceType,
    get_audit_logger, flush_audit_logs, RETENTION_DAYS_BY_TIER
)
from .audit_middleware import AuditMiddleware
from .org_api import router as org_router
from .metrics import normalize_cost_and_speed_metrics

log = logging.getLogger("token-spy-api")

ACTIVE_SESSION_WINDOW_MINUTES = 10


def get_active_session_count(window_minutes: int = ACTIVE_SESSION_WINDOW_MINUTES) -> int:
    """Count active sessions with activity in a recent time window."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*)
                FROM sessions
                WHERE ended_at IS NULL
                  AND started_at >= NOW() - (%s * INTERVAL '1 minute')
                """,
                (window_minutes,),
            )
            row = cur.fetchone()
            return int(row[0]) if row and row[0] is not None else 0


# ── SSE Event Types ─────────────────────────────────────────────────────────

class EventType(str, Enum):
    """SSE event types for real-time dashboard updates."""
    SESSION_STARTED = "session.started"
    SESSION_UPDATED = "session.updated"
    USAGE_TICK = "usage.tick"
    ALERT_TRIGGERED = "alert.triggered"


@dataclass
class SSEEvent:
    """Server-Sent Event payload."""
    type: EventType
    data: Dict[str, Any]
    timestamp: float = field(default_factory=lambda: datetime.now().timestamp())
    
    def to_sse(self) -> str:
        """Format as SSE message."""
        payload = {
            "type": self.type.value,
            "data": self.data,
            "timestamp": self.timestamp
        }
        return f"event: {self.type.value}\ndata: {json.dumps(payload)}\n\n"


class EventBroadcaster:
    """
    Manages SSE client connections and broadcasts events.
    
    Thread-safe event broadcasting to multiple connected clients.
    Each client gets their own asyncio.Queue for message delivery.
    """
    
    def __init__(self):
        self._clients: Dict[str, asyncio.Queue] = {}
        self._lock = asyncio.Lock()
    
    async def connect(self, client_id: str) -> asyncio.Queue:
        """Register a new client and return their message queue."""
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._clients[client_id] = queue
        log.info(f"SSE client connected: {client_id} (total: {len(self._clients)})")
        return queue
    
    async def disconnect(self, client_id: str) -> None:
        """Remove a client connection."""
        async with self._lock:
            self._clients.pop(client_id, None)
        log.info(f"SSE client disconnected: {client_id} (total: {len(self._clients)})")
    
    async def broadcast(self, event: SSEEvent, tenant_id: Optional[str] = None) -> None:
        """
        Broadcast an event to all connected clients.
        
        If tenant_id is provided, only broadcast to clients with matching tenant.
        For now, broadcasts to all clients (tenant filtering TBD).
        """
        async with self._lock:
            client_ids = list(self._clients.keys())
        
        for client_id in client_ids:
            try:
                # Extract tenant from client_id if needed (format: tenant_id:uuid)
                if tenant_id and ":" in client_id:
                    client_tenant = client_id.split(":")[0]
                    if client_tenant != tenant_id:
                        continue
                
                queue = self._clients.get(client_id)
                if queue:
                    try:
                        queue.put_nowait(event)
                    except asyncio.QueueFull:
                        log.warning(f"SSE queue full for client {client_id}, dropping event")
            except Exception as e:
                log.error(f"Error broadcasting to {client_id}: {e}")
    
    @property
    def client_count(self) -> int:
        """Number of connected clients."""
        return len(self._clients)


# Global event broadcaster instance
event_broadcaster = EventBroadcaster()


async def emit_event(event_type: EventType, data: Dict[str, Any], tenant_id: Optional[str] = None) -> None:
    """Helper to emit an SSE event to all connected clients."""
    event = SSEEvent(type=event_type, data=data)
    await event_broadcaster.broadcast(event, tenant_id)


# ── Pydantic Models ─────────────────────────────────────────────────────────

class OverviewResponse(BaseModel):
    """Dashboard overview statistics."""
    total_requests_24h: int
    total_tokens_24h: int
    total_cost_24h: float
    active_sessions: int
    avg_latency_ms: Optional[float]
    top_model: Optional[str]
    budget_used_percent: Optional[float]


class AgentMetrics(BaseModel):
    """Per-agent metrics."""
    agent_id: str
    name: Optional[str] = None  # Display name (defaults to agent_id)
    total_requests: int = 0
    total_tokens: int = 0
    total_cost: float = 0.0
    avg_latency_ms: Optional[float] = None
    last_active: Optional[datetime] = None  # Not currently tracked
    health_score: float = 100.0  # 0-100, derived from success_rate


class ModelMetrics(BaseModel):
    """Per-model metrics."""
    provider: str
    model: str
    request_count: int
    total_tokens: int
    total_cost: float
    avg_latency_ms: Optional[float]
    tokens_per_second: Optional[float]
    cost_per_1k_tokens: Optional[float]


class HourlyUsage(BaseModel):
    """Hourly usage bucket."""
    hour: datetime
    provider: str
    model: str
    request_count: int
    total_tokens: int
    total_cost: float
    avg_latency_ms: Optional[float]


class SessionInfo(BaseModel):
    """Session information."""
    session_id: str
    agent_id: Optional[str] = None
    model: Optional[str] = None  # Not always available from DB
    total_requests: int = 0
    total_tokens: int = 0
    total_cost: float = 0.0
    created_at: Optional[datetime] = None  # Maps from started_at
    last_activity: Optional[datetime] = None
    health_score: float = 100.0
    status: str = "active"  # active, idle, error


# ── Alert Models ────────────────────────────────────────────────────────────

class NotificationChannelConfig(BaseModel):
    """Notification channel configuration."""
    channel: str  # webhook, slack, discord, email
    enabled: bool = True
    url: Optional[str] = None
    email: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class AlertRuleCreate(BaseModel):
    """Create alert rule request."""
    name: str
    description: Optional[str] = None
    threshold_type: str = "budget_percent"  # budget_percent, cost_absolute, token_count
    threshold_value: float = 80.0
    notification_channels: List[NotificationChannelConfig] = Field(default_factory=list)
    cooldown_minutes: int = 60


class AlertRuleResponse(BaseModel):
    """Alert rule response."""
    id: int
    tenant_id: str
    name: str
    description: Optional[str]
    threshold_type: str
    threshold_value: float
    notification_channels: List[NotificationChannelConfig]
    is_active: bool
    cooldown_minutes: int
    last_triggered_at: Optional[datetime]
    trigger_count: int
    created_at: datetime
    updated_at: datetime


class AlertEventResponse(BaseModel):
    """Alert event response."""
    id: int
    rule_id: Optional[int]
    tenant_id: str
    severity: str
    title: str
    message: Optional[str]
    threshold_type: str
    threshold_value: float
    current_value: float
    status: str
    delivered_channels: List[str]
    failed_channels: List[str]
    triggered_at: datetime
    acknowledged_at: Optional[datetime]


# ── FastAPI App ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown events."""
    # Startup
    db = get_db()
    db.init_db()
    app.state.db_backend = db
    
    # Initialize alert tables
    try:
        with get_db_connection() as conn:
            init_alert_tables(conn)
        log.info("Alert tables initialized")
    except Exception as e:
        log.warning(f"Could not initialize alert tables: {e}")
    
    log.info("Token Spy API started")
    yield
    # Shutdown
    log.info("Token Spy API shutting down")


app = FastAPI(
    title="Token Spy API",
    description="Backend API for Token Spy analytics dashboard",
    version="0.3.0",
    lifespan=lifespan
)

# CORS for dashboard
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auth middleware
@app.middleware("http")
async def authentication_middleware(request, call_next):
    return await auth_middleware(request, call_next)

# Rate limit middleware (runs after auth/tenant middleware)
# Note: Middleware is applied in reverse order, so this runs AFTER auth
app.add_middleware(RateLimitMiddleware)

# Audit middleware (runs after auth/tenant to have context)
app.add_middleware(AuditMiddleware)

# Include organization management router (Phase 4e)
app.include_router(org_router)


# ── Dependencies ────────────────────────────────────────────────────────────

def get_db_backend() -> DatabaseBackend:
    """Get database backend from app state."""
    return app.state.db_backend


def get_current_tenant(request) -> TenantContext:
    """Get current tenant from request state."""
    if hasattr(request.state, "tenant"):
        return request.state.tenant
    raise HTTPException(status_code=401, detail="Not authenticated")


# ── API Endpoints ───────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Health check endpoint (no auth required)."""
    rate_limiter = get_rate_limiter()
    return {
        "status": "healthy",
        "version": "0.3.0",
        "sse_clients": event_broadcaster.client_count,
        "rate_limiter": rate_limiter.backend_type
    }


# ── SSE Endpoint ────────────────────────────────────────────────────────────

@app.get("/api/events/stream")
async def sse_stream(request: Request):
    """
    Server-Sent Events stream for real-time dashboard updates.
    
    Event types:
    - session.started: New session created
    - session.updated: Session metrics updated (tokens, cost, status)
    - usage.tick: Periodic usage stats update
    - alert.triggered: Budget/rate limit alert
    
    Connection uses exponential backoff on client-side reconnect.
    """
    import uuid
    
    # Get tenant from request state (set by auth middleware)
    tenant_id = "default"
    if hasattr(request.state, "tenant") and request.state.tenant:
        tenant_id = request.state.tenant.tenant_id
    
    client_id = f"{tenant_id}:{uuid.uuid4().hex[:8]}"
    
    async def event_generator():
        """Generate SSE events for client."""
        queue = await event_broadcaster.connect(client_id)
        
        try:
            # Send initial connection event
            connect_event = SSEEvent(
                type=EventType.SESSION_STARTED,
                data={"connected": True, "client_id": client_id}
            )
            yield connect_event.to_sse()
            
            # Keep-alive and event loop
            while True:
                try:
                    # Wait for events with timeout for keep-alive
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield event.to_sse()
                except asyncio.TimeoutError:
                    # Send keep-alive comment
                    yield ": keep-alive\n\n"
                except asyncio.CancelledError:
                    break
        except Exception as e:
            log.error(f"SSE stream error for {client_id}: {e}")
        finally:
            await event_broadcaster.disconnect(client_id)
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        }
    )


@app.get("/api/rate-limit")
async def get_rate_limit_endpoint(
    request: Request,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Get current rate limit status for the authenticated tenant."""
    return get_rate_limit_info(tenant)


@app.get("/api/overview", response_model=OverviewResponse)
async def get_overview(
    db: DatabaseBackend = Depends(get_db_backend),
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Get dashboard overview statistics."""
    # Get 24h stats for tenant
    stats = db.get_usage_stats(
        tenant_id=tenant.tenant_id,
        start_time=datetime.now() - timedelta(hours=24)
    )
    
    # Get top model
    top_models = db.get_top_models(
        tenant_id=tenant.tenant_id,
        days=1,
        limit=1
    )
    top_model = f"{top_models[0]['provider']}/{top_models[0]['model']}" if top_models else None
    
    # Calculate budget used
    budget_percent = None
    if tenant.api_key and tenant.api_key.monthly_token_limit:
        budget_percent = (
            tenant.api_key.tokens_used_this_month / tenant.api_key.monthly_token_limit * 100
        )
    
    return OverviewResponse(
        total_requests_24h=stats.total_requests,
        total_tokens_24h=stats.total_tokens,
        total_cost_24h=stats.total_cost,
        active_sessions=get_active_session_count(ACTIVE_SESSION_WINDOW_MINUTES),
        avg_latency_ms=stats.avg_latency_ms,
        top_model=top_model,
        budget_used_percent=budget_percent
    )


@app.get("/api/agents", response_model=List[AgentMetrics])
async def get_agents(
    db: DatabaseBackend = Depends(get_db_backend),
    tenant: TenantContext = Depends(get_current_tenant),
    days: int = Query(7, ge=1, le=30)
):
    """Get agent list with performance metrics."""
    # Return agents that have made requests in the last N days
    top_agents = db.get_top_agents(
        tenant_id=tenant.tenant_id,
        days=days,
        limit=50
    )
    
    return [
        AgentMetrics(
            agent_id=a["agent_id"],
            name=a["agent_id"] if a["agent_id"] else "unknown",
            total_requests=a["request_count"],
            total_tokens=a["total_tokens"],
            total_cost=float(a["total_cost"]),
            avg_latency_ms=float(a["avg_latency_ms"]) if a["avg_latency_ms"] else None,
            last_active=None,  # Not in query result
            health_score=100.0 if a["success_rate"] and a["success_rate"] > 0.95 else 75.0  # Derive from success_rate
        )
        for a in top_agents
    ]


@app.get("/api/models", response_model=List[ModelMetrics])
async def get_models(
    db: DatabaseBackend = Depends(get_db_backend),
    tenant: TenantContext = Depends(get_current_tenant),
    days: int = Query(7, ge=1, le=30)
):
    """Get model analytics."""
    top_models = db.get_top_models(
        tenant_id=tenant.tenant_id,
        days=days,
        limit=50
    )
    
    model_metrics: List[ModelMetrics] = []
    for m in top_models:
        avg_latency_ms = float(m["avg_latency_ms"]) if m["avg_latency_ms"] else None
        normalized = normalize_cost_and_speed_metrics(
            total_tokens=m["total_tokens"],
            total_cost=float(m["total_cost"]),
            avg_latency_ms=avg_latency_ms,
        )
        model_metrics.append(
            ModelMetrics(
                provider=m["provider"],
                model=m["model"],
                request_count=m["request_count"],
                total_tokens=m["total_tokens"],
                total_cost=float(m["total_cost"]),
                avg_latency_ms=avg_latency_ms,
                tokens_per_second=normalized["tokens_per_second"],
                cost_per_1k_tokens=normalized["cost_per_1k_tokens"],
            )
        )

    return model_metrics


@app.get("/api/usage/hourly", response_model=List[HourlyUsage])
async def get_hourly_usage(
    db: DatabaseBackend = Depends(get_db_backend),
    tenant: TenantContext = Depends(get_current_tenant),
    hours: int = Query(24, ge=1, le=168)
):
    """Get hourly usage breakdown."""
    hourly = db.get_hourly_usage(
        tenant_id=tenant.tenant_id,
        hours=hours
    )
    
    return [
        HourlyUsage(
            hour=row["hour"],
            provider=row["provider"],
            model=row["model"],
            request_count=row["request_count"],
            total_tokens=row["total_tokens"],
            total_cost=float(row["total_cost"]),
            avg_latency_ms=float(row["avg_latency_ms"]) if row["avg_latency_ms"] else None
        )
        for row in hourly
    ]


@app.get("/api/sessions", response_model=List[SessionInfo])
async def get_sessions(
    db: DatabaseBackend = Depends(get_db_backend),
    tenant: TenantContext = Depends(get_current_tenant),
    status: Optional[str] = Query(None, enum=["active", "idle", "error"]),
    limit: int = Query(50, ge=1, le=200)
):
    """Get session list with filters."""
    # Return active sessions from the database
    sessions = db.get_active_sessions(
        tenant_id=tenant.tenant_id,
        status=status,
        limit=limit
    )
    
    return [
        SessionInfo(
            session_id=s["session_id"],
            agent_id=s.get("agent_id", "unknown"),
            model=s.get("model", "unknown"),  # Required field
            total_requests=s.get("message_count", 0),  # Map message_count to total_requests
            total_tokens=s.get("tokens_used", 0),  # Map tokens_used to total_tokens
            total_cost=float(s["total_cost"]),
            created_at=s["started_at"],  # Map started_at to created_at
            last_activity=s.get("last_activity", s["started_at"]),
            health_score=100.0 if s["status"] == "active" else 50.0,
            status=s["status"]
        )
        for s in sessions
    ]


@app.post("/api/sessions/{session_id}/terminate")
async def terminate_session(
    session_id: str,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Terminate an active session."""
    # Mark session as terminated in database
    success = db.terminate_session(session_id=session_id, tenant_id=tenant.tenant_id)
    
    if not success:
        raise HTTPException(status_code=404, detail=f"Session {session_id} not found or already terminated")
    
    return {"status": "terminated", "session_id": session_id}


# ── Alert Endpoints ─────────────────────────────────────────────────────────

@app.post("/api/alerts/configure", response_model=AlertRuleResponse)
async def create_alert_rule(
    rule: AlertRuleCreate,
    db: DatabaseBackend = Depends(get_db_backend),
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Create or update an alert rule."""
    import json
    
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Check if rule with same name exists
            cur.execute("""
                SELECT id FROM alert_rules
                WHERE tenant_id = %s AND name = %s
            """, (tenant.tenant_id, rule.name))
            existing = cur.fetchone()
            
            channels_json = json.dumps([ch.model_dump() for ch in rule.notification_channels])
            
            if existing:
                # Update existing rule
                cur.execute("""
                    UPDATE alert_rules
                    SET description = %s,
                        threshold_type = %s,
                        threshold_value = %s,
                        notification_channels = %s,
                        cooldown_minutes = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    RETURNING *
                """, (
                    rule.description,
                    rule.threshold_type,
                    rule.threshold_value,
                    channels_json,
                    rule.cooldown_minutes,
                    existing['id']
                ))
            else:
                # Create new rule
                cur.execute("""
                    INSERT INTO alert_rules (
                        tenant_id, name, description, threshold_type,
                        threshold_value, notification_channels, cooldown_minutes
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING *
                """, (
                    tenant.tenant_id,
                    rule.name,
                    rule.description,
                    rule.threshold_type,
                    rule.threshold_value,
                    channels_json,
                    rule.cooldown_minutes
                ))
            
            row = cur.fetchone()
            conn.commit()
            
            # Parse notification channels back
            channels = json.loads(row['notification_channels']) if row['notification_channels'] else []
            
            return AlertRuleResponse(
                id=row['id'],
                tenant_id=row['tenant_id'],
                name=row['name'],
                description=row['description'],
                threshold_type=row['threshold_type'],
                threshold_value=float(row['threshold_value']),
                notification_channels=[NotificationChannelConfig(**ch) for ch in channels],
                is_active=row['is_active'],
                cooldown_minutes=row['cooldown_minutes'],
                last_triggered_at=row['last_triggered_at'],
                trigger_count=row['trigger_count'],
                created_at=row['created_at'],
                updated_at=row['updated_at']
            )


@app.get("/api/alerts/rules", response_model=List[AlertRuleResponse])
async def list_alert_rules(
    db: DatabaseBackend = Depends(get_db_backend),
    tenant: TenantContext = Depends(get_current_tenant)
):
    """List all alert rules for tenant."""
    import json
    
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT * FROM alert_rules
                WHERE tenant_id = %s
                ORDER BY created_at DESC
            """, (tenant.tenant_id,))
            rows = cur.fetchall()
            
            results = []
            for row in rows:
                channels = json.loads(row['notification_channels']) if row['notification_channels'] else []
                results.append(AlertRuleResponse(
                    id=row['id'],
                    tenant_id=row['tenant_id'],
                    name=row['name'],
                    description=row['description'],
                    threshold_type=row['threshold_type'],
                    threshold_value=float(row['threshold_value']),
                    notification_channels=[NotificationChannelConfig(**ch) for ch in channels],
                    is_active=row['is_active'],
                    cooldown_minutes=row['cooldown_minutes'],
                    last_triggered_at=row['last_triggered_at'],
                    trigger_count=row['trigger_count'],
                    created_at=row['created_at'],
                    updated_at=row['updated_at']
                ))
            
            return results


@app.delete("/api/alerts/rules/{rule_id}")
async def delete_alert_rule(
    rule_id: int,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Delete an alert rule."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM alert_rules
                WHERE id = %s AND tenant_id = %s
            """, (rule_id, tenant.tenant_id))
            conn.commit()
            
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Alert rule not found")
            
            return {"status": "deleted", "rule_id": rule_id}


@app.patch("/api/alerts/rules/{rule_id}/toggle")
async def toggle_alert_rule(
    rule_id: int,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Toggle alert rule active status."""
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                UPDATE alert_rules
                SET is_active = NOT is_active, updated_at = NOW()
                WHERE id = %s AND tenant_id = %s
                RETURNING id, is_active
            """, (rule_id, tenant.tenant_id))
            row = cur.fetchone()
            conn.commit()
            
            if not row:
                raise HTTPException(status_code=404, detail="Alert rule not found")
            
            return {"rule_id": row['id'], "is_active": row['is_active']}


@app.get("/api/alerts/history", response_model=List[AlertEventResponse])
async def get_alert_history(
    db: DatabaseBackend = Depends(get_db_backend),
    tenant: TenantContext = Depends(get_current_tenant),
    limit: int = Query(50, ge=1, le=500),
    status: Optional[str] = Query(None)
):
    """Get alert history for tenant."""
    import json
    
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if status:
                cur.execute("""
                    SELECT * FROM alert_history
                    WHERE tenant_id = %s AND status = %s
                    ORDER BY triggered_at DESC
                    LIMIT %s
                """, (tenant.tenant_id, status, limit))
            else:
                cur.execute("""
                    SELECT * FROM alert_history
                    WHERE tenant_id = %s
                    ORDER BY triggered_at DESC
                    LIMIT %s
                """, (tenant.tenant_id, limit))
            
            rows = cur.fetchall()
            
            return [
                AlertEventResponse(
                    id=row['id'],
                    rule_id=row['rule_id'],
                    tenant_id=row['tenant_id'],
                    severity=row['severity'],
                    title=row['title'],
                    message=row['message'],
                    threshold_type=row['threshold_type'],
                    threshold_value=float(row['threshold_value']),
                    current_value=float(row['current_value']),
                    status=row['status'],
                    delivered_channels=json.loads(row['delivered_channels']) if row['delivered_channels'] else [],
                    failed_channels=json.loads(row['failed_channels']) if row['failed_channels'] else [],
                    triggered_at=row['triggered_at'],
                    acknowledged_at=row['acknowledged_at']
                )
                for row in rows
            ]


@app.post("/api/alerts/history/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: int,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Acknowledge an alert."""
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                UPDATE alert_history
                SET status = 'acknowledged',
                    acknowledged_at = NOW(),
                    acknowledged_by = %s
                WHERE id = %s AND tenant_id = %s
                RETURNING id, status, acknowledged_at
            """, (tenant.tenant_id, alert_id, tenant.tenant_id))
            row = cur.fetchone()
            conn.commit()
            
            if not row:
                raise HTTPException(status_code=404, detail="Alert not found")
            
            return {
                "alert_id": row['id'],
                "status": row['status'],
                "acknowledged_at": row['acknowledged_at']
            }


@app.post("/api/alerts/test")
async def test_alert(
    channels: List[NotificationChannelConfig],
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Send a test alert to verify notification channels."""
    from .alerts import dispatch_alert, AlertEvent, AlertSeverity, ThresholdType, NotificationConfig, NotificationChannel
    
    test_alert = AlertEvent(
        rule_id=0,
        tenant_id=tenant.tenant_id,
        severity=AlertSeverity.INFO,
        title="Test Alert from Token Spy",
        message="This is a test alert to verify your notification channel configuration.",
        threshold_type=ThresholdType.BUDGET_PERCENT,
        threshold_value=80.0,
        current_value=75.0,
        triggered_at=datetime.now()
    )
    
    # Convert to NotificationConfig objects
    configs = [
        NotificationConfig(
            channel=NotificationChannel(ch.channel),
            enabled=ch.enabled,
            url=ch.url,
            email=ch.email,
            metadata=ch.metadata
        )
        for ch in channels
    ]
    
    result = await dispatch_alert(test_alert, configs)
    
    return {
        "status": "sent" if result.delivered_channels else "failed",
        "delivered_channels": result.delivered_channels,
        "failed_channels": result.failed_channels,
        "errors": result.delivery_errors
    }


# ── Provider Key Management ─────────────────────────────────────────────────

class ProviderKeyResponse(BaseModel):
    """Provider key data (safe to return — key itself is encrypted)."""
    id: int
    provider: str
    name: str
    key_prefix: str
    is_active: bool
    is_default: bool
    created_at: datetime
    updated_at: datetime
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    use_count: int
    metadata: Optional[Dict] = None


class ProviderKeyCreateRequest(BaseModel):
    """Create a new provider key."""
    provider: str = Field(..., description="Provider name: openai, anthropic, google, moonshot, local")
    name: str = Field(..., min_length=1, max_length=100)
    api_key: str = Field(..., min_length=10, description="The actual API key (will be encrypted)")
    is_default: bool = False
    expires_at: Optional[datetime] = None
    metadata: Optional[Dict] = None


class ProviderKeyUpdateRequest(BaseModel):
    """Update an existing provider key."""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    is_active: Optional[bool] = None
    is_default: Optional[bool] = None
    expires_at: Optional[datetime] = None
    metadata: Optional[Dict] = None


@app.get("/api/provider-keys", response_model=List[ProviderKeyResponse])
async def list_provider_keys(
    provider: Optional[str] = None,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """List all provider keys for the tenant."""
    db = get_db()
    keys = db.get_provider_keys(tenant.tenant_id, provider)
    
    return [
        ProviderKeyResponse(
            id=k.id,
            provider=k.provider,
            name=k.name,
            key_prefix=k.key_prefix,
            is_active=k.is_active,
            is_default=k.is_default,
            created_at=k.created_at,
            updated_at=k.updated_at,
            expires_at=k.expires_at,
            last_used_at=k.last_used_at,
            use_count=k.use_count,
            metadata=k.metadata
        )
        for k in keys
    ]


@app.post("/api/provider-keys", response_model=ProviderKeyResponse)
async def create_provider_key(
    request: ProviderKeyCreateRequest,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Create a new encrypted provider key."""
    from .db_backend import ProviderKey
    from .auth_middleware import encrypt_value
    
    db = get_db()
    
    # Check provider key limits for tenant's plan
    stats = db.get_tenant_stats(tenant.tenant_id)
    if stats.max_provider_keys and stats.provider_keys_count >= stats.max_provider_keys:
        raise HTTPException(
            status_code=403,
            detail=f"Provider key limit reached ({stats.max_provider_keys}). Upgrade your plan."
        )
    
    # Encrypt the API key
    encrypted, iv = encrypt_value(request.api_key)
    
    # If setting as default, unset any existing default for this provider
    if request.is_default:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE provider_keys
                    SET is_default = false
                    WHERE tenant_id = %s AND provider = %s
                """, (tenant.tenant_id, request.provider))
                conn.commit()
    
    # Create the provider key record
    key = ProviderKey(
        id=0,  # Will be set by DB
        tenant_id=tenant.tenant_id,
        provider=request.provider,
        name=request.name,
        key_prefix=request.api_key[:8],
        encrypted_key=encrypted,
        iv=iv,
        is_active=True,
        is_default=request.is_default,
        created_at=datetime.now(),
        updated_at=datetime.now(),
        expires_at=request.expires_at,
        last_used_at=None,
        use_count=0,
        metadata=request.metadata
    )
    
    db.store_provider_key(key)
    
    # Re-fetch to get the assigned ID
    keys = db.get_provider_keys(tenant.tenant_id, request.provider)
    new_key = next((k for k in keys if k.key_prefix == key.key_prefix), None)
    
    if not new_key:
        raise HTTPException(status_code=500, detail="Failed to create provider key")
    
    return ProviderKeyResponse(
        id=new_key.id,
        provider=new_key.provider,
        name=new_key.name,
        key_prefix=new_key.key_prefix,
        is_active=new_key.is_active,
        is_default=new_key.is_default,
        created_at=new_key.created_at,
        updated_at=new_key.updated_at,
        expires_at=new_key.expires_at,
        last_used_at=new_key.last_used_at,
        use_count=new_key.use_count,
        metadata=new_key.metadata
    )


@app.get("/api/provider-keys/{key_id}", response_model=ProviderKeyResponse)
async def get_provider_key(
    key_id: int,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Get a specific provider key."""
    db = get_db()
    keys = db.get_provider_keys(tenant.tenant_id)
    key = next((k for k in keys if k.id == key_id), None)
    
    if not key:
        raise HTTPException(status_code=404, detail="Provider key not found")
    
    return ProviderKeyResponse(
        id=key.id,
        provider=key.provider,
        name=key.name,
        key_prefix=key.key_prefix,
        is_active=key.is_active,
        is_default=key.is_default,
        created_at=key.created_at,
        updated_at=key.updated_at,
        expires_at=key.expires_at,
        last_used_at=key.last_used_at,
        use_count=key.use_count,
        metadata=key.metadata
    )


@app.patch("/api/provider-keys/{key_id}", response_model=ProviderKeyResponse)
async def update_provider_key(
    key_id: int,
    request: ProviderKeyUpdateRequest,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Update a provider key (name, active status, default status)."""
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Verify key exists and belongs to tenant
            cur.execute("""
                SELECT * FROM provider_keys
                WHERE id = %s AND tenant_id = %s
            """, (key_id, tenant.tenant_id))
            key = cur.fetchone()
            
            if not key:
                raise HTTPException(status_code=404, detail="Provider key not found")
            
            # Build update query dynamically
            updates = []
            params = []
            
            if request.name is not None:
                updates.append("name = %s")
                params.append(request.name)
            
            if request.is_active is not None:
                updates.append("is_active = %s")
                params.append(request.is_active)
            
            if request.is_default is not None:
                # If setting as default, unset others for this provider
                if request.is_default:
                    cur.execute("""
                        UPDATE provider_keys
                        SET is_default = false
                        WHERE tenant_id = %s AND provider = %s AND id != %s
                    """, (tenant.tenant_id, key['provider'], key_id))
                updates.append("is_default = %s")
                params.append(request.is_default)
            
            if request.expires_at is not None:
                updates.append("expires_at = %s")
                params.append(request.expires_at)
            
            if request.metadata is not None:
                updates.append("metadata = %s")
                params.append(json.dumps(request.metadata))
            
            if not updates:
                raise HTTPException(status_code=400, detail="No fields to update")
            
            updates.append("updated_at = NOW()")
            params.append(key_id)
            params.append(tenant.tenant_id)
            
            cur.execute(f"""
                UPDATE provider_keys
                SET {', '.join(updates)}
                WHERE id = %s AND tenant_id = %s
                RETURNING *
            """, tuple(params))
            
            row = cur.fetchone()
            conn.commit()
            
            return ProviderKeyResponse(
                id=row['id'],
                provider=row['provider'],
                name=row['name'],
                key_prefix=row['key_prefix'],
                is_active=row['is_active'],
                is_default=row['is_default'],
                created_at=row['created_at'],
                updated_at=row['updated_at'],
                expires_at=row['expires_at'],
                last_used_at=row['last_used_at'],
                use_count=row['use_count'],
                metadata=row['metadata']
            )


@app.delete("/api/provider-keys/{key_id}")
async def delete_provider_key(
    key_id: int,
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Delete a provider key."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify key exists and belongs to tenant
            cur.execute("""
                SELECT provider FROM provider_keys
                WHERE id = %s AND tenant_id = %s
            """, (key_id, tenant.tenant_id))
            row = cur.fetchone()
            
            if not row:
                raise HTTPException(status_code=404, detail="Provider key not found")
            
            # Delete the key
            cur.execute("""
                DELETE FROM provider_keys
                WHERE id = %s AND tenant_id = %s
            """, (key_id, tenant.tenant_id))
            conn.commit()
            
            return {"status": "deleted", "key_id": key_id}


@app.get("/api/provider-keys/limits")
async def get_provider_key_limits(
    tenant: TenantContext = Depends(get_current_tenant)
):
    """Get provider key usage and limits for the tenant."""
    db = get_db()
    stats = db.get_tenant_stats(tenant.tenant_id)
    
    return {
        "current_count": stats.provider_keys_count,
        "max_allowed": stats.max_provider_keys,
        "remaining": stats.max_provider_keys - stats.provider_keys_count if stats.max_provider_keys else None,
        "can_create": stats.max_provider_keys is None or stats.provider_keys_count < stats.max_provider_keys
    }


# ── Audit Log Endpoints ─────────────────────────────────────────────────────

class AuditLogResponse(BaseModel):
    """Audit log entry response."""
    id: int
    timestamp: datetime
    tenant_id: str
    user_id: Optional[str]
    action: str
    resource_type: str
    resource_id: Optional[str]
    details: Optional[Dict[str, Any]]
    ip_address: Optional[str]
    user_agent: Optional[str]
    request_id: Optional[str]
    request_method: Optional[str]
    request_path: Optional[str]
    response_status: Optional[int]
    latency_ms: Optional[int]
    severity: str
    success: bool
    error_message: Optional[str]
    metadata: Optional[Dict[str, Any]]


class AuditLogQueryParams(BaseModel):
    """Query parameters for audit log search."""
    action: Optional[str] = None
    resource_type: Optional[str] = None
    user_id: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    severity: Optional[str] = None
    success: Optional[bool] = None
    limit: int = Field(100, ge=1, le=1000)
    offset: int = Field(0, ge=0)


class AuditExportResponse(BaseModel):
    """Response for audit log export."""
    format: str
    record_count: int
    data: Any  # List[Dict] for JSON, str for CSV


@app.get("/api/audit/logs", response_model=List[AuditLogResponse])
async def get_audit_logs(
    tenant: TenantContext = Depends(get_current_tenant),
    action: Optional[str] = Query(None, description="Filter by action type"),
    resource_type: Optional[str] = Query(None, description="Filter by resource type"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    start_time: Optional[datetime] = Query(None, description="Start of time range"),
    end_time: Optional[datetime] = Query(None, description="End of time range"),
    severity: Optional[str] = Query(None, description="Filter by severity (info, warning, error, critical)"),
    success: Optional[bool] = Query(None, description="Filter by success status"),
    limit: int = Query(100, ge=1, le=1000, description="Max records to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
):
    """
    Query audit logs for the tenant with optional filters.
    
    Requires 'audit_log' feature (Enterprise tier).
    
    Filters:
    - action: Filter by action type (e.g., 'auth.login', 'api_key.created')
    - resource_type: Filter by resource type (e.g., 'api_key', 'provider_key')
    - user_id: Filter by user/API key ID
    - start_time/end_time: Time range filter
    - severity: Filter by log severity
    - success: Filter by success/failure
    """
    # Check feature access (audit_log is Enterprise-only feature)
    # For now, allow all authenticated tenants to view their own logs
    
    audit_logger = get_audit_logger()
    
    logs = await audit_logger.query(
        tenant_id=tenant.tenant_id,
        action=action,
        resource_type=resource_type,
        user_id=user_id,
        start_time=start_time,
        end_time=end_time,
        severity=severity,
        success=success,
        limit=limit,
        offset=offset,
    )
    
    return [
        AuditLogResponse(
            id=log_entry.get('id', 0),
            timestamp=log_entry['timestamp'],
            tenant_id=log_entry['tenant_id'],
            user_id=log_entry.get('user_id'),
            action=log_entry['action'],
            resource_type=log_entry['resource_type'],
            resource_id=log_entry.get('resource_id'),
            details=log_entry.get('details'),
            ip_address=log_entry.get('ip_address'),
            user_agent=log_entry.get('user_agent'),
            request_id=log_entry.get('request_id'),
            request_method=log_entry.get('request_method'),
            request_path=log_entry.get('request_path'),
            response_status=log_entry.get('response_status'),
            latency_ms=log_entry.get('latency_ms'),
            severity=log_entry.get('severity', 'info'),
            success=log_entry.get('success', True),
            error_message=log_entry.get('error_message'),
            metadata=log_entry.get('metadata'),
        )
        for log_entry in logs
    ]


@app.get("/api/audit/export")
async def export_audit_logs(
    tenant: TenantContext = Depends(get_current_tenant),
    format: str = Query("json", enum=["json", "csv"], description="Export format"),
    action: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    start_time: Optional[datetime] = Query(None),
    end_time: Optional[datetime] = Query(None),
    limit: int = Query(10000, ge=1, le=100000, description="Max records to export"),
):
    """
    Export audit logs in JSON or CSV format.
    
    Returns audit logs matching the filters in the requested format.
    Limited to 100,000 records per export.
    """
    import csv
    import io
    
    audit_logger = get_audit_logger()
    
    # Log the export request itself
    await audit_logger.log(
        tenant_id=tenant.tenant_id,
        action=AuditAction.DATA_EXPORT_REQUESTED,
        resource_type=ResourceType.EXPORT,
        details={
            "format": format,
            "filters": {
                "action": action,
                "resource_type": resource_type,
                "start_time": start_time.isoformat() if start_time else None,
                "end_time": end_time.isoformat() if end_time else None,
            },
            "limit": limit,
        },
    )
    
    # Query the logs
    logs = await audit_logger.query(
        tenant_id=tenant.tenant_id,
        action=action,
        resource_type=resource_type,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
        offset=0,
    )
    
    if format == "csv":
        # Convert to CSV
        output = io.StringIO()
        if logs:
            fieldnames = [
                'id', 'timestamp', 'tenant_id', 'user_id', 'action',
                'resource_type', 'resource_id', 'ip_address', 'request_method',
                'request_path', 'response_status', 'latency_ms', 'severity',
                'success', 'error_message'
            ]
            writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction='ignore')
            writer.writeheader()
            
            for log_entry in logs:
                # Convert datetime to string
                row = dict(log_entry)
                if 'timestamp' in row and row['timestamp']:
                    row['timestamp'] = row['timestamp'].isoformat() if hasattr(row['timestamp'], 'isoformat') else str(row['timestamp'])
                writer.writerow(row)
        
        csv_content = output.getvalue()
        
        # Log export completion
        await audit_logger.log(
            tenant_id=tenant.tenant_id,
            action=AuditAction.DATA_EXPORT_COMPLETED,
            resource_type=ResourceType.EXPORT,
            details={"format": "csv", "record_count": len(logs)},
        )
        
        return StreamingResponse(
            io.BytesIO(csv_content.encode('utf-8')),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=audit_logs_{tenant.tenant_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            }
        )
    else:
        # JSON format
        # Log export completion
        await audit_logger.log(
            tenant_id=tenant.tenant_id,
            action=AuditAction.DATA_EXPORT_COMPLETED,
            resource_type=ResourceType.EXPORT,
            details={"format": "json", "record_count": len(logs)},
        )
        
        # Serialize datetime objects
        serialized_logs = []
        for log_entry in logs:
            entry = dict(log_entry)
            if 'timestamp' in entry and entry['timestamp']:
                entry['timestamp'] = entry['timestamp'].isoformat() if hasattr(entry['timestamp'], 'isoformat') else str(entry['timestamp'])
            serialized_logs.append(entry)
        
        return {
            "format": "json",
            "record_count": len(serialized_logs),
            "tenant_id": tenant.tenant_id,
            "exported_at": datetime.now().isoformat(),
            "data": serialized_logs,
        }


@app.get("/api/audit/stats")
async def get_audit_stats(
    tenant: TenantContext = Depends(get_current_tenant),
    days: int = Query(7, ge=1, le=90, description="Number of days to analyze"),
):
    """
    Get audit log statistics for the tenant.
    
    Returns counts by action type, severity, and success rate.
    """
    audit_logger = get_audit_logger()
    start_time = datetime.now() - timedelta(days=days)
    
    # Get total count
    total_count = await audit_logger.count(
        tenant_id=tenant.tenant_id,
        start_time=start_time,
    )
    
    # Get counts by action (query with limit and aggregate)
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Action breakdown
            cur.execute("""
                SELECT action, COUNT(*) as count
                FROM audit_logs
                WHERE tenant_id = %s AND timestamp >= %s
                GROUP BY action
                ORDER BY count DESC
                LIMIT 20
            """, (tenant.tenant_id, start_time))
            action_counts = {row['action']: row['count'] for row in cur.fetchall()}
            
            # Severity breakdown
            cur.execute("""
                SELECT severity, COUNT(*) as count
                FROM audit_logs
                WHERE tenant_id = %s AND timestamp >= %s
                GROUP BY severity
            """, (tenant.tenant_id, start_time))
            severity_counts = {row['severity']: row['count'] for row in cur.fetchall()}
            
            # Success/failure
            cur.execute("""
                SELECT success, COUNT(*) as count
                FROM audit_logs
                WHERE tenant_id = %s AND timestamp >= %s
                GROUP BY success
            """, (tenant.tenant_id, start_time))
            success_counts = {str(row['success']): row['count'] for row in cur.fetchall()}
            
            # Daily counts
            cur.execute("""
                SELECT DATE(timestamp) as date, COUNT(*) as count
                FROM audit_logs
                WHERE tenant_id = %s AND timestamp >= %s
                GROUP BY DATE(timestamp)
                ORDER BY date DESC
            """, (tenant.tenant_id, start_time))
            daily_counts = [
                {"date": row['date'].isoformat(), "count": row['count']}
                for row in cur.fetchall()
            ]
    
    return {
        "tenant_id": tenant.tenant_id,
        "period_days": days,
        "total_events": total_count,
        "by_action": action_counts,
        "by_severity": severity_counts,
        "success_rate": (
            float(success_counts.get('True', 0)) / total_count * 100
            if total_count > 0 else 100.0
        ),
        "daily_counts": daily_counts,
    }


@app.get("/api/audit/retention")
async def get_audit_retention(
    tenant: TenantContext = Depends(get_current_tenant),
):
    """
    Get audit log retention policy for the tenant.
    
    Returns retention days based on plan tier.
    """
    # Get tenant's plan tier
    tier = "free"  # Default
    if hasattr(tenant, "plan_tier"):
        tier = tenant.plan_tier
    elif hasattr(tenant, "api_key") and tenant.api_key:
        # Try to get tier from tenant lookup
        db = get_db()
        tenant_data = db.get_tenant(tenant.tenant_id)
        if tenant_data and tenant_data.plan_tier:
            tier = tenant_data.plan_tier
    
    retention_days = RETENTION_DAYS_BY_TIER.get(tier.lower(), 30)
    
    return {
        "tenant_id": tenant.tenant_id,
        "plan_tier": tier,
        "retention_days": retention_days,
        "retention_policy": f"Audit logs are retained for {retention_days} days",
        "tier_retention": RETENTION_DAYS_BY_TIER,
    }


# ── Team & Organization Endpoints (Phase 4e) ───────────────────────────────

class CreateUserRequest(BaseModel):
    email: str
    display_name: Optional[str] = None
    tenant_role: str = "member"  # 'owner', 'admin', 'member', 'viewer'
    password: Optional[str] = None  # If not provided, SSO-only


class UpdateUserRequest(BaseModel):
    display_name: Optional[str] = None
    tenant_role: Optional[str] = None
    is_active: Optional[bool] = None


class CreateTeamRequest(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    is_default: bool = False


class UpdateTeamRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_default: Optional[bool] = None


class AddTeamMemberRequest(BaseModel):
    user_id: str
    team_role: str = "member"  # 'lead', 'member', 'viewer'


class UpdateTeamMemberRequest(BaseModel):
    team_role: str


class UpdateOrgSettingsRequest(BaseModel):
    organization_name: Optional[str] = None
    logo_url: Optional[str] = None
    favicon_url: Optional[str] = None
    primary_color: Optional[str] = None
    admin_email: Optional[str] = None
    security_alert_email: Optional[str] = None
    billing_email: Optional[str] = None
    allow_public_sharing: Optional[bool] = None
    require_2fa: Optional[bool] = None
    session_timeout_minutes: Optional[int] = None


class CreateInvitationRequest(BaseModel):
    """Create invitation request."""
    email: str
    role: str = "member"  # 'owner', 'admin', 'member', 'viewer'
    team_ids: Optional[List[str]] = None


class AcceptInvitationRequest(BaseModel):
    """Accept invitation request."""
    token: str
    password: Optional[str] = None  # If not provided, SSO-only
    display_name: Optional[str] = None


# ── User Management Endpoints ──────────────────────────────────────────────

@app.get("/api/users")
async def list_users(
    is_active: Optional[bool] = None,
    tenant_role: Optional[str] = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    tenant: TenantContext = Depends(get_current_tenant),
):
    """
    List users in the organization.
    
    Requires 'user:read' permission.
    """
    db = get_db()
    users = db.list_users(
        tenant_id=tenant.tenant_id,
        is_active=is_active,
        tenant_role=tenant_role,
        limit=limit,
        offset=offset,
    )
    return {
        "users": [asdict(u) for u in users],
        "total": len(users),
        "limit": limit,
        "offset": offset,
    }


@app.post("/api/users")
async def create_user(
    request: CreateUserRequest,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """
    Create a new user in the organization.
    
    Requires 'user:create' permission.
    """
    db = get_db()
    
    # Check if user already exists
    existing = db.get_user_by_email(tenant.tenant_id, request.email)
    if existing:
        raise HTTPException(status_code=409, detail="User with this email already exists")
    
    # Hash password if provided (using bcrypt for secure hashing)
    password_hash = None
    if request.password:
        # bcrypt generates a salt and hashes the password in one step
        password_hash = bcrypt.hashpw(
            request.password.encode('utf-8'),
            bcrypt.gensalt(rounds=12)  # Cost factor 12 is a good balance
        ).decode('utf-8')
    
    user = db.create_user(
        tenant_id=tenant.tenant_id,
        email=request.email,
        display_name=request.display_name,
        tenant_role=request.tenant_role,
        password_hash=password_hash,
    )
    
    return {
        "user_id": user.user_id,
        "email": user.email,
        "display_name": user.display_name,
        "tenant_role": user.tenant_role,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@app.get("/api/users/{user_id}")
async def get_user(
    user_id: str,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """Get a specific user's details."""
    db = get_db()
    user = db.get_user(user_id)
    
    if not user or user.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get user's teams
    teams = db.get_user_teams(user_id)
    
    return {
        "user": asdict(user),
        "teams": teams,
    }


@app.patch("/api/users/{user_id}")
async def update_user(
    user_id: str,
    request: UpdateUserRequest,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """Update a user's details."""
    db = get_db()
    user = db.get_user(user_id)
    
    if not user or user.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    
    updates = request.dict(exclude_unset=True)
    updated = db.update_user(user_id, updates)
    
    return asdict(updated)


@app.delete("/api/users/{user_id}")
async def deactivate_user(
    user_id: str,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """
    Deactivate a user (soft delete).
    
    Users are deactivated, not deleted, to preserve audit history.
    """
    db = get_db()
    user = db.get_user(user_id)
    
    if not user or user.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Don't allow deactivating the last owner
    if user.tenant_role == "owner":
        owners = db.list_users(
            tenant_id=tenant.tenant_id,
            tenant_role="owner",
            is_active=True,
        )
        if len(owners) <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot deactivate the last owner. Transfer ownership first."
            )
    
    updated = db.update_user(user_id, {"is_active": False})
    return {"success": True, "user_id": user_id, "is_active": updated.is_active}


# ── Team Management Endpoints ──────────────────────────────────────────────

@app.get("/api/teams")
async def list_teams(
    include_default: bool = True,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    tenant: TenantContext = Depends(get_current_tenant),
):
    """List teams in the organization."""
    db = get_db()
    teams = db.list_teams(
        tenant_id=tenant.tenant_id,
        include_default=include_default,
        limit=limit,
        offset=offset,
    )
    return {
        "teams": [asdict(t) for t in teams],
        "total": len(teams),
        "limit": limit,
        "offset": offset,
    }


@app.post("/api/teams")
async def create_team(
    request: CreateTeamRequest,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """Create a new team."""
    db = get_db()
    
    # Check for duplicate slug
    teams = db.list_teams(tenant.tenant_id, limit=1000)
    if any(t.slug == request.slug for t in teams):
        raise HTTPException(status_code=409, detail="Team with this slug already exists")
    
    # TODO: Get current user ID from auth context
    # For now, teams are created without created_by
    
    team = db.create_team(
        tenant_id=tenant.tenant_id,
        name=request.name,
        slug=request.slug,
        description=request.description,
        is_default=request.is_default,
    )
    
    return asdict(team)


@app.get("/api/teams/{team_id}")
async def get_team(
    team_id: str,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """Get team details with members."""
    db = get_db()
    team = db.get_team(team_id)
    
    if not team or team.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Team not found")
    
    members = db.get_team_members(team_id)
    
    return {
        "team": asdict(team),
        "members": members,
        "member_count": len(members),
    }


@app.patch("/api/teams/{team_id}")
async def update_team(
    team_id: str,
    request: UpdateTeamRequest,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """Update team details."""
    db = get_db()
    team = db.get_team(team_id)
    
    if not team or team.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Team not found")
    
    updates = request.dict(exclude_unset=True)
    updated = db.update_team(team_id, updates)
    
    return asdict(updated)


@app.delete("/api/teams/{team_id}")
async def delete_team(
    team_id: str,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """Delete a team and all its memberships."""
    db = get_db()
    team = db.get_team(team_id)
    
    if not team or team.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Team not found")
    
    # Don't delete the default team
    if team.is_default:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the default team. Designate a new default first."
        )
    
    success = db.delete_team(team_id)
    return {"success": success, "team_id": team_id}


# ── Team Membership Endpoints ──────────────────────────────────────────────

@app.post("/api/teams/{team_id}/members")
async def add_team_member(
    team_id: str,
    request: AddTeamMemberRequest,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """Add a user to a team."""
    db = get_db()
    
    # Verify team exists and belongs to tenant
    team = db.get_team(team_id)
    if not team or team.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Team not found")
    
    # Verify user exists and belongs to tenant
    user = db.get_user(request.user_id)
    if not user or user.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="User not found")
    
    membership = db.add_team_member(
        team_id=team_id,
        user_id=request.user_id,
        team_role=request.team_role,
    )
    
    return {
        "success": True,
        "membership": asdict(membership),
        "user": {
            "user_id": user.user_id,
            "email": user.email,
            "display_name": user.display_name,
        },
    }


@app.patch("/api/teams/{team_id}/members/{user_id}")
async def update_team_member(
    team_id: str,
    user_id: str,
    request: UpdateTeamMemberRequest,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """Update a team member's role."""
    db = get_db()
    
    team = db.get_team(team_id)
    if not team or team.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Team not found")
    
    updated = db.update_team_member_role(team_id, user_id, request.team_role)
    if not updated:
        raise HTTPException(status_code=404, detail="Team membership not found")
    
    return asdict(updated)


@app.delete("/api/teams/{team_id}/members/{user_id}")
async def remove_team_member(
    team_id: str,
    user_id: str,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """Remove a user from a team."""
    db = get_db()
    
    team = db.get_team(team_id)
    if not team or team.tenant_id != tenant.tenant_id:
        raise HTTPException(status_code=404, detail="Team not found")
    
    success = db.remove_team_member(team_id, user_id)
    return {"success": success, "team_id": team_id, "user_id": user_id}


# ── Invitation Management Endpoints ────────────────────────────────────────

@app.post("/api/invitations")
async def create_invitation(
    request: CreateInvitationRequest,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """
    Create an invitation to join the organization.
    
    Sends an invitation email to the specified address. The invitation
    expires in 7 days by default.
    
    Requires 'user:invite' permission.
    """
    db = get_db()
    
    # Check if user already exists in this tenant
    existing = db.get_user_by_email(tenant.tenant_id, request.email)
    if existing:
        raise HTTPException(
            status_code=409,
            detail="A user with this email already exists in the organization"
        )
    
    # Check for existing pending invitation
    pending = db.list_pending_invitations(tenant.tenant_id, limit=1000)
    if any(inv['email'].lower() == request.email.lower() for inv in pending):
        raise HTTPException(
            status_code=409,
            detail="An invitation has already been sent to this email"
        )
    
    # Get the inviting user ID from the API key context
    invited_by = tenant.tenant_id  # Default to tenant if no user context
    if hasattr(tenant, 'api_key') and tenant.api_key:
        invited_by = tenant.api_key.key_id
    
    invitation = db.create_invitation(
        tenant_id=tenant.tenant_id,
        email=request.email,
        invited_by=invited_by,
        role=request.role,
        team_ids=request.team_ids,
        expires_days=7,
    )
    
    # TODO: Send invitation email with link containing token
    # For now, return the token directly (useful for testing)
    
    return {
        "invitation_id": invitation['invitation_id'],
        "email": invitation['email'],
        "role": invitation['role'],
        "team_ids": invitation['team_ids'],
        "expires_at": invitation['expires_at'].isoformat() if invitation['expires_at'] else None,
        "created_at": invitation['created_at'].isoformat() if invitation['created_at'] else None,
        # Include token for API-based flows (remove in production email-only flow)
        "token": invitation['token'],
    }


@app.get("/api/invitations")
async def list_invitations(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    tenant: TenantContext = Depends(get_current_tenant),
):
    """
    List pending invitations for the organization.
    
    Only shows invitations that have not been accepted and have not expired.
    """
    db = get_db()
    invitations = db.list_pending_invitations(
        tenant_id=tenant.tenant_id,
        limit=limit,
        offset=offset,
    )
    
    return {
        "invitations": [
            {
                "invitation_id": inv['invitation_id'],
                "email": inv['email'],
                "role": inv['role'],
                "team_ids": inv['team_ids'],
                "invited_by": inv['invited_by'],
                "invited_by_email": inv['invited_by_email'],
                "invited_by_name": inv['invited_by_name'],
                "expires_at": inv['expires_at'].isoformat() if inv['expires_at'] else None,
                "created_at": inv['created_at'].isoformat() if inv['created_at'] else None,
            }
            for inv in invitations
        ],
        "total": len(invitations),
        "limit": limit,
        "offset": offset,
    }


@app.delete("/api/invitations/{invitation_id}")
async def revoke_invitation(
    invitation_id: str,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """
    Revoke a pending invitation.
    
    The invitation must belong to the authenticated tenant and must not
    have been accepted yet.
    """
    db = get_db()
    
    # Verify the invitation belongs to this tenant
    pending = db.list_pending_invitations(tenant.tenant_id, limit=1000)
    if not any(inv['invitation_id'] == invitation_id for inv in pending):
        raise HTTPException(status_code=404, detail="Invitation not found")
    
    success = db.revoke_invitation(invitation_id)
    if not success:
        raise HTTPException(status_code=404, detail="Invitation not found or already accepted")
    
    return {"success": True, "invitation_id": invitation_id}


@app.post("/api/invitations/accept")
async def accept_invitation(
    request: AcceptInvitationRequest,
):
    """
    Accept an invitation and create a user account.
    
    This is a public endpoint - no authentication required.
    The invitation token serves as authentication.
    """
    db = get_db()
    
    # Get the invitation
    invitation = db.get_invitation_by_token(request.token)
    if not invitation:
        raise HTTPException(
            status_code=404,
            detail="Invalid or expired invitation token"
        )
    
    # Check if user already exists
    existing = db.get_user_by_email(invitation['tenant_id'], invitation['email'])
    if existing:
        raise HTTPException(
            status_code=409,
            detail="A user with this email already exists"
        )
    
    # Hash password if provided (using bcrypt for secure hashing)
    password_hash = None
    if request.password:
        # bcrypt generates a salt and hashes the password in one step
        password_hash = bcrypt.hashpw(
            request.password.encode('utf-8'),
            bcrypt.gensalt(rounds=12)  # Cost factor 12 is a good balance
        ).decode('utf-8')
    
    # Create the user
    user = db.create_user(
        tenant_id=invitation['tenant_id'],
        email=invitation['email'],
        display_name=request.display_name,
        tenant_role=invitation['role'],
        password_hash=password_hash,
    )
    
    # Mark invitation as accepted
    db.accept_invitation(request.token, user.user_id)
    
    # Add user to specified teams
    if invitation['team_ids']:
        for team_id in invitation['team_ids']:
            try:
                db.add_team_member(
                    team_id=team_id,
                    user_id=user.user_id,
                    team_role="member",
                    invited_by=invitation['invited_by'],
                )
            except Exception as e:
                log.warning(f"Failed to add user {user.user_id} to team {team_id}: {e}")
    
    return {
        "success": True,
        "user_id": user.user_id,
        "email": user.email,
        "tenant_id": invitation['tenant_id'],
        "tenant_name": invitation['tenant_name'],
        "role": invitation['role'],
        "teams_joined": invitation['team_ids'] or [],
    }


# ── Organization Settings Endpoints ────────────────────────────────────────

@app.get("/api/organization/settings")
async def get_organization_settings(
    tenant: TenantContext = Depends(get_current_tenant),
):
    """Get organization settings."""
    db = get_db()
    settings = db.get_organization_settings(tenant.tenant_id)
    
    if not settings:
        # Return defaults
        return {
            "tenant_id": tenant.tenant_id,
            "organization_name": tenant.tenant_id,
            "primary_color": "#10b981",
            "saml_enabled": False,
            "enforce_sso": False,
            "require_2fa": False,
            "session_timeout_minutes": 480,
            "allow_public_sharing": False,
        }
    
    return asdict(settings)


@app.patch("/api/organization/settings")
async def update_organization_settings(
    request: UpdateOrgSettingsRequest,
    tenant: TenantContext = Depends(get_current_tenant),
):
    """Update organization settings."""
    db = get_db()
    
    updates = request.dict(exclude_unset=True)
    
    # Ensure settings record exists
    existing = db.get_organization_settings(tenant.tenant_id)
    if not existing:
        # Create default settings first
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO organization_settings (tenant_id, organization_name)
                    VALUES (%s, %s)
                """, (tenant.tenant_id, tenant.tenant_id))
                conn.commit()
    
    updated = db.update_organization_settings(
        tenant_id=tenant.tenant_id,
        updates=updates,
    )
    
    return asdict(updated)


@app.get("/api/organization")
async def get_organization(
    tenant: TenantContext = Depends(get_current_tenant),
):
    """
    Get full organization details including settings, stats, and user counts.
    """
    db = get_db()
    
    # Get tenant details
    tenant_data = db.get_tenant(tenant.tenant_id)
    
    # Get settings
    settings = db.get_organization_settings(tenant.tenant_id)
    
    # Get user counts
    all_users = db.list_users(tenant.tenant_id, limit=1000)
    active_users = [u for u in all_users if u.is_active]
    
    # Get team count
    teams = db.list_teams(tenant.tenant_id, limit=1000)
    
    return {
        "tenant_id": tenant.tenant_id,
        "name": tenant_data.name if tenant_data else tenant.tenant_id,
        "plan_tier": tenant_data.plan_tier if tenant_data else "free",
        "is_active": tenant_data.is_active if tenant_data else True,
        "settings": asdict(settings) if settings else None,
        "stats": {
            "total_users": len(all_users),
            "active_users": len(active_users),
            "team_count": len(teams),
            "max_api_keys": tenant_data.max_api_keys if tenant_data else None,
            "max_provider_keys": tenant_data.max_provider_keys if tenant_data else None,
        },
    }


# ── Entry Point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("TOKEN_SPY_API_PORT", "8080"))
    uvicorn.run(app, host="0.0.0.0", port=port)
