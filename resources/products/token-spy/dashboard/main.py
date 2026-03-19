"""
Token Spy Dashboard — FastAPI Backend
=====================================

Provides REST API endpoints for the Token Spy analytics dashboard.
Connects to TimescaleDB for time-series token usage metrics.

Endpoints:
- GET /health - Health check
- GET /api/dashboard/usage - Usage data with time aggregation
- GET /api/dashboard/sessions - Session list
- GET /api/dashboard/costs - Cost analytics
- GET /api/dashboard/agents - Agent leaderboard
- GET /api/usage - Live usage data (for frontend hooks)
- GET /api/cost-summary - Cost summary (for frontend hooks)
- GET /api/agents - Agent list (for frontend hooks)
"""

import os
import asyncio
import logging
import json
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Optional, List, Dict, Any, Literal
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI, Query, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
import secrets

# ============================================
# Configuration
# ============================================

class Settings(BaseSettings):
    # Required settings - no defaults for security
    database_url: str = Field(..., description="PostgreSQL connection URL (required)")
    
    # Optional settings with safe defaults
    dashboard_port: int = 3001
    dashboard_host: str = "0.0.0.0"
    log_level: str = "INFO"
    enable_sse: bool = True
    sse_update_interval: int = 5
    dashboard_auth_enabled: bool = False
    dashboard_username: str = "admin"
    dashboard_password: Optional[str] = Field(default=None, description="Dashboard password (required when auth enabled)")
    dashboard_allowed_origins: str = ""
    dashboard_cors_allow_credentials: bool = True
    
    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()

# ============================================
# Authentication
# ============================================

security = HTTPBasic()

def verify_auth(credentials: HTTPBasicCredentials = Depends(security)):
    """Verify dashboard authentication if enabled."""
    if not settings.dashboard_auth_enabled:
        return None
    
    # Validate that password is configured when auth is enabled
    if not settings.dashboard_password:
        raise HTTPException(
            status_code=500,
            detail="Authentication enabled but DASHBOARD_PASSWORD not set"
        )
    
    is_user = secrets.compare_digest(credentials.username, settings.dashboard_username)
    is_pass = secrets.compare_digest(credentials.password, settings.dashboard_password)
    
    if not (is_user and is_pass):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"}
        )
    return credentials.username

# ============================================
# Logging
# ============================================

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("token-spy-dashboard")


def parse_allowed_origins(raw_origins: str) -> List[str]:
    """Parse CORS origins from CSV or JSON array."""
    value = (raw_origins or "").strip()
    if not value:
        return []

    if value.startswith("{"):
        raise ValueError(
            "DASHBOARD_ALLOWED_ORIGINS JSON format must be an array, not an object"
        )

    if value.startswith("["):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError as exc:
            raise ValueError(
                "DASHBOARD_ALLOWED_ORIGINS must be valid CSV or JSON array"
            ) from exc

        if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
            raise ValueError("DASHBOARD_ALLOWED_ORIGINS JSON format must be an array of strings")
        return [origin.strip() for origin in parsed if origin.strip()]

    return [origin.strip() for origin in value.split(",") if origin.strip()]


def get_cors_settings() -> Dict[str, Any]:
    """Return validated CORS settings from environment configuration."""
    allow_origins = parse_allowed_origins(settings.dashboard_allowed_origins)
    allow_credentials = settings.dashboard_cors_allow_credentials
    has_wildcard = "*" in allow_origins

    if allow_credentials and has_wildcard:
        logger.error(
            "Invalid CORS config: DASHBOARD_CORS_ALLOW_CREDENTIALS=true cannot be combined "
            "with wildcard origin '*' in DASHBOARD_ALLOWED_ORIGINS."
        )
        raise ValueError(
            "Refusing to start with insecure CORS config: credentials + wildcard origin"
        )

    if has_wildcard:
        logger.warning(
            "CORS is configured with wildcard origin '*'. This should only be used in controlled local development."
        )
    elif not allow_origins:
        logger.info(
            "CORS allowlist is empty; cross-origin browser requests are disabled. "
            "Set DASHBOARD_ALLOWED_ORIGINS for explicit trusted origins."
        )

    return {
        "allow_origins": allow_origins,
        "allow_credentials": allow_credentials,
    }


def normalize_cost_and_speed_metrics(
    total_tokens: Optional[int],
    total_cost: Optional[float],
    avg_latency_ms: Optional[float],
    avg_ttft_ms: Optional[float] = None,
) -> Dict[str, Optional[float]]:
    """Mirror sidecar normalization logic for cost/speed model metrics."""
    tokens_value = int(total_tokens) if total_tokens is not None else 0
    cost_value = float(total_cost) if total_cost is not None else 0.0

    cost_per_1k_tokens = (
        (cost_value / tokens_value) * 1000 if tokens_value > 0 else None
    )

    total_time_ms = 0.0
    if avg_ttft_ms is not None and avg_ttft_ms > 0:
        total_time_ms += float(avg_ttft_ms)
    if avg_latency_ms is not None and avg_latency_ms > 0:
        total_time_ms += float(avg_latency_ms)

    tokens_per_second = (
        (tokens_value * 1000 / total_time_ms)
        if tokens_value > 0 and total_time_ms > 0
        else None
    )

    return {
        "cost_per_1k_tokens": cost_per_1k_tokens,
        "tokens_per_second": tokens_per_second,
    }

# ============================================
# Database Connection Pool
# ============================================

db_pool: Optional[asyncpg.Pool] = None

async def get_db_pool() -> asyncpg.Pool:
    global db_pool
    if db_pool is None:
        raise HTTPException(status_code=503, detail="Database not connected")
    return db_pool

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage database connection pool lifecycle."""
    global db_pool
    
    # Parse database URL for asyncpg
    db_url = settings.database_url
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgres://", 1)
    
    try:
        logger.info(f"Connecting to database...")
        db_pool = await asyncpg.create_pool(
            db_url,
            min_size=2,
            max_size=10,
            command_timeout=60
        )
        logger.info("Database connection pool established")
        yield
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        yield
    finally:
        if db_pool:
            await db_pool.close()
            logger.info("Database connection pool closed")

# ============================================
# FastAPI App
# ============================================

app = FastAPI(
    title="Token Spy Dashboard API",
    description="Analytics dashboard for LLM token usage monitoring",
    version="1.0.0",
    lifespan=lifespan
)

# CORS for React frontend
cors_settings = get_cors_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_settings["allow_origins"],
    allow_credentials=cors_settings["allow_credentials"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================
# Response Models
# ============================================

class HealthResponse(BaseModel):
    status: str
    database: str
    timestamp: str

class UsageDataPoint(BaseModel):
    timestamp: str
    total_tokens: int
    prompt_tokens: int
    completion_tokens: int
    request_count: int
    total_cost: float
    avg_latency_ms: Optional[float]

class UsageResponse(BaseModel):
    period: str
    agent_id: Optional[str]
    data: List[UsageDataPoint]
    summary: Dict[str, Any]

class SessionItem(BaseModel):
    session_id: str
    agent_name: Optional[str]
    started_at: str
    ended_at: Optional[str]
    total_requests: int
    total_tokens: int
    total_cost: float
    health_score: Optional[float]
    status: str

class SessionsResponse(BaseModel):
    sessions: List[SessionItem]
    total_count: int
    limit: int
    offset: int

class CostDataPoint(BaseModel):
    dimension_value: str
    total_cost: float
    request_count: int
    total_tokens: int
    percentage: Optional[float]

class CostTimePoint(BaseModel):
    timestamp: str
    total_cost: float

class CostsResponse(BaseModel):
    period: str
    dimension: str
    data: List[Dict[str, Any]]
    total_cost: float

class AgentStats(BaseModel):
    agent_id: str
    agent_name: str
    total_requests: int
    total_tokens: int
    total_cost: float
    avg_cost_per_request: float
    last_seen: str
    rank: int

class AgentsResponse(BaseModel):
    period: str
    agents: List[AgentStats]

# ============================================
# Utility Functions
# ============================================

def parse_period(period: str) -> timedelta:
    """Convert period string to timedelta."""
    period_map = {
        "1h": timedelta(hours=1),
        "6h": timedelta(hours=6),
        "12h": timedelta(hours=12),
        "24h": timedelta(days=1),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
        "90d": timedelta(days=90),
    }
    return period_map.get(period, timedelta(days=1))

def get_time_bucket(period: str) -> str:
    """Get appropriate time bucket for aggregation based on period."""
    bucket_map = {
        "1h": "1 minute",
        "6h": "5 minutes",
        "12h": "10 minutes",
        "24h": "30 minutes",
        "7d": "1 hour",
        "30d": "6 hours",
        "90d": "1 day",
    }
    return bucket_map.get(period, "1 hour")

def serialize_decimal(value: Any) -> Any:
    """Convert Decimal to float for JSON serialization."""
    if isinstance(value, Decimal):
        return float(value)
    return value

# ============================================
# Health Endpoint
# ============================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint for container orchestration."""
    db_status = "disconnected"
    
    if db_pool:
        try:
            async with db_pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            db_status = "connected"
        except Exception as e:
            logger.warning(f"Database health check failed: {e}")
            db_status = f"error: {str(e)[:50]}"
    
    return HealthResponse(
        status="healthy" if db_status == "connected" else "degraded",
        database=db_status,
        timestamp=datetime.utcnow().isoformat()
    )

# ============================================
# Dashboard API Endpoints
# ============================================

@app.get("/api/dashboard/usage", response_model=UsageResponse)
async def get_usage(
    period: str = Query(default="24h", description="Time period (1h, 6h, 12h, 24h, 7d, 30d)"),
    agent_id: Optional[str] = Query(default=None, description="Filter by agent ID"),
    auth_user: Optional[str] = Depends(verify_auth)
):
    """
    Get token usage data aggregated over time.
    
    Returns time-series data suitable for charts showing token consumption
    and cost over the specified period.
    """
    pool = await get_db_pool()
    
    time_delta = parse_period(period)
    time_bucket = get_time_bucket(period)
    start_time = datetime.utcnow() - time_delta
    
    try:
        async with pool.acquire() as conn:
            # Build query with optional agent filter
            agent_filter = ""
            params = [start_time]
            
            if agent_id:
                # Need to join with sessions table to filter by agent
                agent_filter = """
                    AND session_id IN (
                        SELECT session_id FROM sessions 
                        WHERE agent_name = $2
                    )
                """
                params.append(agent_id)
            
            # Main aggregation query using TimescaleDB time_bucket
            query = f"""
                SELECT 
                    time_bucket('{time_bucket}', timestamp) AS bucket,
                    SUM(total_tokens) AS total_tokens,
                    SUM(prompt_tokens) AS prompt_tokens,
                    SUM(completion_tokens) AS completion_tokens,
                    COUNT(*) AS request_count,
                    SUM(total_cost) AS total_cost,
                    AVG(latency_ms) AS avg_latency_ms
                FROM api_requests
                WHERE timestamp >= $1
                {agent_filter}
                GROUP BY bucket
                ORDER BY bucket ASC
            """
            
            rows = await conn.fetch(query, *params)
            
            # Build response data
            data = []
            for row in rows:
                data.append(UsageDataPoint(
                    timestamp=row["bucket"].isoformat(),
                    total_tokens=row["total_tokens"] or 0,
                    prompt_tokens=row["prompt_tokens"] or 0,
                    completion_tokens=row["completion_tokens"] or 0,
                    request_count=row["request_count"] or 0,
                    total_cost=float(row["total_cost"] or 0),
                    avg_latency_ms=float(row["avg_latency_ms"]) if row["avg_latency_ms"] else None
                ))
            
            # Get summary stats
            summary_query = f"""
                SELECT 
                    SUM(total_tokens) AS total_tokens,
                    SUM(prompt_tokens) AS total_prompt_tokens,
                    SUM(completion_tokens) AS total_completion_tokens,
                    COUNT(*) AS total_requests,
                    SUM(total_cost) AS total_cost,
                    AVG(latency_ms) AS avg_latency_ms
                FROM api_requests
                WHERE timestamp >= $1
                {agent_filter}
            """
            
            summary_row = await conn.fetchrow(summary_query, *params)
            
            summary = {
                "total_tokens": summary_row["total_tokens"] or 0,
                "total_prompt_tokens": summary_row["total_prompt_tokens"] or 0,
                "total_completion_tokens": summary_row["total_completion_tokens"] or 0,
                "total_requests": summary_row["total_requests"] or 0,
                "total_cost": float(summary_row["total_cost"] or 0),
                "avg_latency_ms": float(summary_row["avg_latency_ms"]) if summary_row["avg_latency_ms"] else None
            }
            
            return UsageResponse(
                period=period,
                agent_id=agent_id,
                data=data,
                summary=summary
            )
            
    except Exception as e:
        logger.error(f"Failed to get usage data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dashboard/sessions", response_model=SessionsResponse)
async def get_sessions(
    limit: int = Query(default=20, ge=1, le=100, description="Number of sessions to return"),
    offset: int = Query(default=0, ge=0, description="Offset for pagination"),
    status: Optional[str] = Query(default=None, description="Filter by status (active, completed)"),
    auth_user: Optional[str] = Depends(verify_auth)
):
    """
    Get list of sessions with their stats.
    
    Returns paginated session list with token usage and cost information.
    """
    pool = await get_db_pool()
    
    try:
        async with pool.acquire() as conn:
            # Build status filter
            status_filter = ""
            if status == "active":
                status_filter = "AND ended_at IS NULL"
            elif status == "completed":
                status_filter = "AND ended_at IS NOT NULL"
            
            # Count total sessions
            count_query = f"""
                SELECT COUNT(*) FROM sessions
                WHERE 1=1 {status_filter}
            """
            total_count = await conn.fetchval(count_query)
            
            # Get sessions
            query = f"""
                SELECT 
                    session_id,
                    agent_name,
                    started_at,
                    ended_at,
                    total_requests,
                    total_tokens,
                    total_cost,
                    health_score
                FROM sessions
                WHERE 1=1 {status_filter}
                ORDER BY started_at DESC
                LIMIT $1 OFFSET $2
            """
            
            rows = await conn.fetch(query, limit, offset)
            
            sessions = []
            for row in rows:
                session_status = "active" if row["ended_at"] is None else "completed"
                sessions.append(SessionItem(
                    session_id=row["session_id"],
                    agent_name=row["agent_name"],
                    started_at=row["started_at"].isoformat() if row["started_at"] else None,
                    ended_at=row["ended_at"].isoformat() if row["ended_at"] else None,
                    total_requests=row["total_requests"] or 0,
                    total_tokens=row["total_tokens"] or 0,
                    total_cost=float(row["total_cost"] or 0),
                    health_score=float(row["health_score"]) if row["health_score"] else None,
                    status=session_status
                ))
            
            return SessionsResponse(
                sessions=sessions,
                total_count=total_count,
                limit=limit,
                offset=offset
            )
            
    except Exception as e:
        logger.error(f"Failed to get sessions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dashboard/costs", response_model=CostsResponse)
async def get_costs(
    period: str = Query(default="30d", description="Time period (1h, 6h, 12h, 24h, 7d, 30d)"),
    dimension: Literal["time", "agent", "model", "provider"] = Query(
        default="time", 
        description="Aggregation dimension"
    ),
    auth_user: Optional[str] = Depends(verify_auth)
):
    """
    Get cost analytics data aggregated by dimension.
    
    Supports aggregation by:
    - time: Time-series cost data
    - agent: Cost breakdown by agent
    - model: Cost breakdown by model
    - provider: Cost breakdown by provider
    """
    pool = await get_db_pool()
    
    time_delta = parse_period(period)
    start_time = datetime.utcnow() - time_delta
    
    try:
        async with pool.acquire() as conn:
            data = []
            
            if dimension == "time":
                time_bucket = get_time_bucket(period)
                query = f"""
                    SELECT 
                        time_bucket('{time_bucket}', timestamp) AS bucket,
                        SUM(total_cost) AS total_cost,
                        COUNT(*) AS request_count,
                        SUM(total_tokens) AS total_tokens
                    FROM api_requests
                    WHERE timestamp >= $1
                    GROUP BY bucket
                    ORDER BY bucket ASC
                """
                rows = await conn.fetch(query, start_time)
                
                for row in rows:
                    data.append({
                        "timestamp": row["bucket"].isoformat(),
                        "total_cost": float(row["total_cost"] or 0),
                        "request_count": row["request_count"] or 0,
                        "total_tokens": row["total_tokens"] or 0
                    })
                    
            elif dimension == "provider":
                query = """
                    SELECT 
                        provider AS dimension_value,
                        SUM(total_cost) AS total_cost,
                        COUNT(*) AS request_count,
                        SUM(total_tokens) AS total_tokens
                    FROM api_requests
                    WHERE timestamp >= $1
                    GROUP BY provider
                    ORDER BY total_cost DESC
                """
                rows = await conn.fetch(query, start_time)
                
                total = sum(float(r["total_cost"] or 0) for r in rows)
                for row in rows:
                    cost = float(row["total_cost"] or 0)
                    data.append({
                        "dimension_value": row["dimension_value"],
                        "total_cost": cost,
                        "request_count": row["request_count"] or 0,
                        "total_tokens": row["total_tokens"] or 0,
                        "percentage": (cost / total * 100) if total > 0 else 0
                    })
                    
            elif dimension == "model":
                query = """
                    SELECT 
                        model AS dimension_value,
                        SUM(total_cost) AS total_cost,
                        COUNT(*) AS request_count,
                        SUM(total_tokens) AS total_tokens
                    FROM api_requests
                    WHERE timestamp >= $1
                    GROUP BY model
                    ORDER BY total_cost DESC
                """
                rows = await conn.fetch(query, start_time)
                
                total = sum(float(r["total_cost"] or 0) for r in rows)
                for row in rows:
                    cost = float(row["total_cost"] or 0)
                    data.append({
                        "dimension_value": row["dimension_value"],
                        "total_cost": cost,
                        "request_count": row["request_count"] or 0,
                        "total_tokens": row["total_tokens"] or 0,
                        "percentage": (cost / total * 100) if total > 0 else 0
                    })
                    
            elif dimension == "agent":
                # Join with sessions to get agent info
                query = """
                    SELECT 
                        COALESCE(s.agent_name, 'Unknown') AS dimension_value,
                        SUM(r.total_cost) AS total_cost,
                        COUNT(*) AS request_count,
                        SUM(r.total_tokens) AS total_tokens
                    FROM api_requests r
                    LEFT JOIN sessions s ON r.session_id = s.session_id
                    WHERE r.timestamp >= $1
                    GROUP BY s.agent_name
                    ORDER BY total_cost DESC
                """
                rows = await conn.fetch(query, start_time)
                
                total = sum(float(r["total_cost"] or 0) for r in rows)
                for row in rows:
                    cost = float(row["total_cost"] or 0)
                    data.append({
                        "dimension_value": row["dimension_value"],
                        "total_cost": cost,
                        "request_count": row["request_count"] or 0,
                        "total_tokens": row["total_tokens"] or 0,
                        "percentage": (cost / total * 100) if total > 0 else 0
                    })
            
            # Calculate total cost for the period
            total_query = """
                SELECT SUM(total_cost) AS total_cost
                FROM api_requests
                WHERE timestamp >= $1
            """
            total_cost = await conn.fetchval(total_query, start_time) or 0
            
            return CostsResponse(
                period=period,
                dimension=dimension,
                data=data,
                total_cost=float(total_cost)
            )
            
    except Exception as e:
        logger.error(f"Failed to get cost data: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dashboard/agents", response_model=AgentsResponse)
async def get_agents(
    period: str = Query(default="30d", description="Time period for stats"),
    limit: int = Query(default=10, ge=1, le=100, description="Number of agents to return"),
    auth_user: Optional[str] = Depends(verify_auth)
):
    """
    Get agent leaderboard with usage statistics.
    
    Returns top agents ranked by token usage within the specified period.
    """
    pool = await get_db_pool()
    
    time_delta = parse_period(period)
    start_time = datetime.utcnow() - time_delta
    
    try:
        async with pool.acquire() as conn:
            query = """
                SELECT 
                    a.agent_id,
                    a.agent_name,
                    COALESCE(stats.request_count, 0) AS total_requests,
                    COALESCE(stats.total_tokens, 0) AS total_tokens,
                    COALESCE(stats.total_cost, 0) AS total_cost,
                    a.last_seen
                FROM agents a
                LEFT JOIN (
                    SELECT 
                        s.agent_name,
                        COUNT(*) AS request_count,
                        SUM(r.total_tokens) AS total_tokens,
                        SUM(r.total_cost) AS total_cost
                    FROM api_requests r
                    JOIN sessions s ON r.session_id = s.session_id
                    WHERE r.timestamp >= $1
                    GROUP BY s.agent_name
                ) stats ON a.agent_name = stats.agent_name
                ORDER BY COALESCE(stats.total_tokens, 0) DESC
                LIMIT $2
            """
            
            rows = await conn.fetch(query, start_time, limit)
            
            agents = []
            for i, row in enumerate(rows, 1):
                total_requests = row["total_requests"]
                total_cost = float(row["total_cost"])
                avg_cost = total_cost / total_requests if total_requests > 0 else 0
                
                agents.append(AgentStats(
                    agent_id=row["agent_id"],
                    agent_name=row["agent_name"],
                    total_requests=total_requests,
                    total_tokens=row["total_tokens"],
                    total_cost=total_cost,
                    avg_cost_per_request=avg_cost,
                    last_seen=row["last_seen"].isoformat() if row["last_seen"] else None,
                    rank=i
                ))
            
            return AgentsResponse(
                period=period,
                agents=agents
            )
            
    except Exception as e:
        logger.error(f"Failed to get agents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Frontend Hook Endpoints (matching useApi.ts)
# ============================================

@app.get("/api/usage")
async def get_usage_simple(
    range: str = Query(default="24h", alias="range", description="Time range"),
    auth_user: Optional[str] = Depends(verify_auth)
):
    """Simple usage endpoint matching frontend useTokenUsage hook."""
    pool = await get_db_pool()
    
    time_delta = parse_period(range)
    start_time = datetime.utcnow() - time_delta
    
    try:
        async with pool.acquire() as conn:
            query = """
                SELECT 
                    SUM(total_tokens) AS total_tokens,
                    SUM(prompt_tokens) AS prompt_tokens,
                    SUM(completion_tokens) AS completion_tokens,
                    COUNT(*) AS request_count,
                    SUM(total_cost) AS total_cost,
                    AVG(latency_ms) AS avg_latency
                FROM api_requests
                WHERE timestamp >= $1
            """
            row = await conn.fetchrow(query, start_time)
            
            return {
                "totalTokens": row["total_tokens"] or 0,
                "promptTokens": row["prompt_tokens"] or 0,
                "completionTokens": row["completion_tokens"] or 0,
                "requestCount": row["request_count"] or 0,
                "totalCost": float(row["total_cost"] or 0),
                "avgLatency": float(row["avg_latency"]) if row["avg_latency"] else 0,
                "range": range
            }
            
    except Exception as e:
        logger.error(f"Failed to get simple usage: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/cost-summary")
async def get_cost_summary(
    range: str = Query(default="24h", alias="range", description="Time range"),
    auth_user: Optional[str] = Depends(verify_auth)
):
    """Cost summary endpoint matching frontend useCostSummary hook."""
    pool = await get_db_pool()
    
    time_delta = parse_period(range)
    start_time = datetime.utcnow() - time_delta
    
    try:
        async with pool.acquire() as conn:
            # Overall cost
            total_query = """
                SELECT SUM(total_cost) AS total_cost
                FROM api_requests
                WHERE timestamp >= $1
            """
            total_cost = await conn.fetchval(total_query, start_time) or 0
            
            # By provider
            provider_query = """
                SELECT 
                    provider,
                    SUM(total_cost) AS cost,
                    SUM(total_tokens) AS tokens
                FROM api_requests
                WHERE timestamp >= $1
                GROUP BY provider
                ORDER BY cost DESC
            """
            provider_rows = await conn.fetch(provider_query, start_time)
            
            by_provider = []
            for row in provider_rows:
                cost = float(row["cost"] or 0)
                by_provider.append({
                    "provider": row["provider"],
                    "cost": cost,
                    "tokenCount": row["tokens"] or 0,
                    "percentage": (cost / float(total_cost) * 100) if total_cost > 0 else 0
                })
            
            # By model
            model_query = """
                SELECT 
                    model,
                    provider,
                    SUM(total_cost) AS cost,
                    SUM(total_tokens) AS tokens
                FROM api_requests
                WHERE timestamp >= $1
                GROUP BY model, provider
                ORDER BY cost DESC
                LIMIT 10
            """
            model_rows = await conn.fetch(model_query, start_time)
            
            by_model = []
            for row in model_rows:
                cost = float(row["cost"] or 0)
                tokens = row["tokens"] or 1
                by_model.append({
                    "model": row["model"],
                    "provider": row["provider"],
                    "cost": cost,
                    "avgCostPer1K": (cost / tokens * 1000) if tokens > 0 else 0
                })
            
            return {
                "totalCost": float(total_cost),
                "byProvider": by_provider,
                "byModel": by_model,
                "range": range
            }
            
    except Exception as e:
        logger.error(f"Failed to get cost summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/agents")
async def get_agents_simple(
    auth_user: Optional[str] = Depends(verify_auth)
):
    """Simple agents endpoint matching frontend useAgents hook."""
    pool = await get_db_pool()
    
    try:
        async with pool.acquire() as conn:
            query = """
                SELECT 
                    agent_id,
                    agent_name,
                    total_requests,
                    total_tokens,
                    total_cost,
                    last_seen
                FROM agents
                ORDER BY total_tokens DESC
                LIMIT 50
            """
            rows = await conn.fetch(query)
            
            agents = []
            for row in rows:
                agents.append({
                    "agentId": row["agent_id"],
                    "agentName": row["agent_name"],
                    "totalRequests": row["total_requests"] or 0,
                    "totalTokens": row["total_tokens"] or 0,
                    "totalCost": float(row["total_cost"] or 0),
                    "lastSeen": row["last_seen"].isoformat() if row["last_seen"] else None
                })
            
            return {"agents": agents}
            
    except Exception as e:
        logger.error(f"Failed to get agents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Organization API (Phase 4e)
# ============================================

class OrganizationCreate(BaseModel):
    name: str
    slug: Optional[str] = None

class OrganizationResponse(BaseModel):
    id: str
    name: str
    slug: str
    plan: str
    created_at: str
    updated_at: str

@app.get("/api/organizations")
async def list_organizations(
    auth_user: Optional[str] = Depends(verify_auth)
):
    """List organizations (tenants) for the authenticated user."""
    pool = await get_db_pool()
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch("SELECT tenant_id as id, name, 'free' as plan, created_at FROM tenants WHERE is_active = TRUE")
            organizations = [dict(r) for r in rows]
            return {
                "organizations": organizations,
                "total": len(organizations),
                "limit": 100,
                "offset": 0
            }
    except Exception as e:
        logger.error(f"Failed to list organizations: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/organizations")
async def create_organization(
    req: OrganizationCreate,
    auth_user: Optional[str] = Depends(verify_auth)
):
    """Create a new tenant (organization)."""
    import uuid
    from datetime import datetime as dt
    
    pool = await get_db_pool()
    try:
        async with pool.acquire() as conn:
            tenant_id = str(uuid.uuid4())
            slug = req.slug or req.name.lower().replace(" ", "-")
            created_at = dt.utcnow()
            
            await conn.execute("""
                INSERT INTO tenants (tenant_id, name, contact_email, is_active)
                VALUES ($1, $2, $3, $4)
            """, tenant_id, req.name, f"admin@{tenant_id[:8]}.local", True)
            
            return {
                "id": tenant_id,
                "name": req.name,
                "slug": slug,
                "plan": "free",
                "created_at": created_at.isoformat(),
                "updated_at": created_at.isoformat()
            }
    except Exception as e:
        logger.error(f"Failed to create organization: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# Sidecar-Compatible API Endpoints (for Frontend)
# ============================================

class OverviewResponse(BaseModel):
    total_requests_24h: int
    total_tokens_24h: int
    total_cost_24h: float
    active_sessions: int
    avg_latency_ms: Optional[float]
    top_model: Optional[str]
    budget_used_percent: Optional[float]

class AgentMetrics(BaseModel):
    agent_id: str
    name: Optional[str]
    total_requests: int
    total_tokens: int
    total_cost: float
    avg_latency_ms: Optional[float]
    last_active: Optional[str]
    health_score: int

class ModelMetrics(BaseModel):
    provider: str
    model: str
    request_count: int
    total_tokens: int
    total_cost: float
    avg_latency_ms: Optional[float]
    tokens_per_second: Optional[float]
    cost_per_1k_tokens: Optional[float]

class HourlyUsage(BaseModel):
    hour: str
    provider: str
    model: str
    request_count: int
    total_tokens: int
    total_cost: float
    avg_latency_ms: Optional[float]

class SessionInfo(BaseModel):
    session_id: str
    agent_id: Optional[str]
    model: str
    total_requests: int
    total_tokens: int
    total_cost: float
    created_at: str
    last_activity: str
    health_score: int
    status: str

@app.get("/api/overview", response_model=OverviewResponse)
async def get_overview(auth_user: Optional[str] = Depends(verify_auth)):
    """Get overview stats for the dashboard (matches sidecar API)."""
    pool = await get_db_pool()
    try:
        async with pool.acquire() as conn:
            # 24h stats
            query_24h = """
                SELECT 
                    COUNT(*) AS requests,
                    SUM(total_tokens) AS tokens,
                    SUM(total_cost) AS cost,
                    AVG(latency_ms) AS latency
                FROM api_requests
                WHERE timestamp >= NOW() - INTERVAL '24 hours'
            """
            row_24h = await conn.fetchrow(query_24h)
            
            # Active sessions
            active_query = """
                SELECT COUNT(*) FROM sessions
                WHERE ended_at IS NULL AND started_at >= NOW() - INTERVAL '1 hour'
            """
            active_sessions = await conn.fetchval(active_query) or 0
            
            # Top model
            top_model_query = """
                SELECT model FROM api_requests
                WHERE timestamp >= NOW() - INTERVAL '24 hours'
                GROUP BY model
                ORDER BY COUNT(*) DESC
                LIMIT 1
            """
            top_model = await conn.fetchval(top_model_query)
            
            budget_row = await conn.fetchrow("""
                SELECT
                    SUM(tokens_used_this_month) AS tokens_used,
                    SUM(monthly_token_limit) AS token_limit
                FROM api_keys
                WHERE is_active = TRUE
                  AND monthly_token_limit IS NOT NULL
                  AND monthly_token_limit > 0
            """)
            budget_used_percent = None
            if budget_row and budget_row["token_limit"]:
                budget_used_percent = (
                    float(budget_row["tokens_used"] or 0)
                    / float(budget_row["token_limit"])
                    * 100
                )

            return OverviewResponse(
                total_requests_24h=row_24h["requests"] or 0,
                total_tokens_24h=row_24h["tokens"] or 0,
                total_cost_24h=float(row_24h["cost"] or 0),
                active_sessions=active_sessions,
                avg_latency_ms=float(row_24h["latency"]) if row_24h["latency"] else None,
                top_model=top_model,
                budget_used_percent=budget_used_percent
            )
    except Exception as e:
        logger.error(f"Failed to get overview: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/agents", response_model=List[AgentMetrics])
async def get_agents_list(
    days: int = Query(default=7, ge=1, le=90),
    auth_user: Optional[str] = Depends(verify_auth)
):
    """Get agent metrics list (matches sidecar API)."""
    pool = await get_db_pool()
    try:
        async with pool.acquire() as conn:
            query = """
                SELECT 
                    a.agent_id,
                    a.agent_name AS name,
                    COALESCE(s.request_count, 0) AS total_requests,
                    COALESCE(s.total_tokens, 0) AS total_tokens,
                    COALESCE(s.total_cost, 0) AS total_cost,
                    s.avg_latency_ms,
                    a.last_seen AS last_active,
                    COALESCE(a.health_score, 100) AS health_score
                FROM agents a
                LEFT JOIN (
                    SELECT 
                        ag.agent_id,
                        COUNT(*) AS request_count,
                        SUM(r.total_tokens) AS total_tokens,
                        SUM(r.total_cost) AS total_cost,
                        AVG(r.latency_ms) AS avg_latency_ms
                    FROM api_requests r
                    JOIN sessions sess ON r.session_id = sess.session_id
                    JOIN agents ag ON sess.agent_name = ag.agent_name
                    WHERE r.timestamp >= NOW() - INTERVAL '%s days'
                    GROUP BY ag.agent_id
                ) s ON a.agent_id = s.agent_id
                ORDER BY COALESCE(s.total_tokens, 0) DESC
                LIMIT 100
            """ % days
            
            rows = await conn.fetch(query)
            return [
                AgentMetrics(
                    agent_id=row["agent_id"],
                    name=row["name"],
                    total_requests=row["total_requests"],
                    total_tokens=row["total_tokens"],
                    total_cost=float(row["total_cost"]),
                    avg_latency_ms=float(row["avg_latency_ms"]) if row["avg_latency_ms"] else None,
                    last_active=row["last_active"].isoformat() if row["last_active"] else None,
                    health_score=row["health_score"]
                )
                for row in rows
            ]
    except Exception as e:
        logger.error(f"Failed to get agents: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/models", response_model=List[ModelMetrics])
async def get_models_list(
    days: int = Query(default=7, ge=1, le=90),
    auth_user: Optional[str] = Depends(verify_auth)
):
    """Get model metrics list (matches sidecar API)."""
    pool = await get_db_pool()
    try:
        async with pool.acquire() as conn:
            query = """
                SELECT 
                    provider,
                    model,
                    COUNT(*) AS request_count,
                    SUM(total_tokens) AS total_tokens,
                    SUM(total_cost) AS total_cost,
                    AVG(latency_ms) AS avg_latency_ms
                FROM api_requests
                WHERE timestamp >= NOW() - INTERVAL '%s days'
                GROUP BY provider, model
                ORDER BY total_tokens DESC
                LIMIT 100
            """ % days
            
            rows = await conn.fetch(query)
            model_metrics: List[ModelMetrics] = []
            for row in rows:
                avg_latency_ms = float(row["avg_latency_ms"]) if row["avg_latency_ms"] else None
                normalized = normalize_cost_and_speed_metrics(
                    total_tokens=row["total_tokens"],
                    total_cost=float(row["total_cost"]),
                    avg_latency_ms=avg_latency_ms,
                )
                model_metrics.append(
                    ModelMetrics(
                        provider=row["provider"],
                        model=row["model"],
                        request_count=row["request_count"],
                        total_tokens=row["total_tokens"],
                        total_cost=float(row["total_cost"]),
                        avg_latency_ms=avg_latency_ms,
                        tokens_per_second=normalized["tokens_per_second"],
                        cost_per_1k_tokens=normalized["cost_per_1k_tokens"],
                    )
                )

            return model_metrics
    except Exception as e:
        logger.error(f"Failed to get models: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/usage/hourly", response_model=List[HourlyUsage])
async def get_hourly_usage(
    hours: int = Query(default=24, ge=1, le=168),
    auth_user: Optional[str] = Depends(verify_auth)
):
    """Get hourly usage breakdown (matches sidecar API)."""
    pool = await get_db_pool()
    try:
        async with pool.acquire() as conn:
            query = """
                SELECT 
                    date_trunc('hour', timestamp) AS hour,
                    provider,
                    model,
                    COUNT(*) AS request_count,
                    SUM(total_tokens) AS total_tokens,
                    SUM(total_cost) AS total_cost,
                    AVG(latency_ms) AS avg_latency_ms
                FROM api_requests
                WHERE timestamp >= NOW() - INTERVAL '%s hours'
                GROUP BY date_trunc('hour', timestamp), provider, model
                ORDER BY hour DESC
            """ % hours
            
            rows = await conn.fetch(query)
            return [
                HourlyUsage(
                    hour=row["hour"].isoformat(),
                    provider=row["provider"],
                    model=row["model"],
                    request_count=row["request_count"],
                    total_tokens=row["total_tokens"],
                    total_cost=float(row["total_cost"]),
                    avg_latency_ms=float(row["avg_latency_ms"]) if row["avg_latency_ms"] else None
                )
                for row in rows
            ]
    except Exception as e:
        logger.error(f"Failed to get hourly usage: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/sessions", response_model=List[SessionInfo])
async def get_sessions_list(
    status: Optional[str] = Query(default=None, description="Filter by status (active, idle, error)"),
    limit: int = Query(default=50, ge=1, le=100),
    auth_user: Optional[str] = Depends(verify_auth)
):
    """Get sessions list (matches sidecar API)."""
    pool = await get_db_pool()
    try:
        async with pool.acquire() as conn:
            status_filter = ""
            if status == "active":
                status_filter = "AND ended_at IS NULL"
            elif status == "completed":
                status_filter = "AND ended_at IS NOT NULL"
            
            query = f"""
                SELECT 
                    s.session_id,
                    a.agent_id,
                    s.model,
                    s.total_requests,
                    s.total_tokens,
                    s.total_cost,
                    s.started_at AS created_at,
                    COALESCE(s.ended_at, s.last_activity) AS last_activity,
                    COALESCE(s.health_score, 100) AS health_score,
                    CASE 
                        WHEN s.ended_at IS NULL AND s.last_activity >= NOW() - INTERVAL '5 minutes' THEN 'active'
                        WHEN s.ended_at IS NULL THEN 'idle'
                        ELSE 'completed'
                    END AS status
                FROM sessions s
                LEFT JOIN agents a ON s.agent_name = a.agent_name
                WHERE 1=1 {status_filter}
                ORDER BY s.last_activity DESC
                LIMIT $1
            """
            
            rows = await conn.fetch(query, limit)
            return [
                SessionInfo(
                    session_id=row["session_id"],
                    agent_id=row["agent_id"],
                    model=row["model"] or "unknown",
                    total_requests=row["total_requests"] or 0,
                    total_tokens=row["total_tokens"] or 0,
                    total_cost=float(row["total_cost"] or 0),
                    created_at=row["created_at"].isoformat() if row["created_at"] else "",
                    last_activity=row["last_activity"].isoformat() if row["last_activity"] else "",
                    health_score=row["health_score"],
                    status=row["status"]
                )
                for row in rows
            ]
    except Exception as e:
        logger.error(f"Failed to get sessions: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/sessions/{{session_id}}/terminate")
async def terminate_session(
    session_id: str,
    auth_user: Optional[str] = Depends(verify_auth)
):
    """Terminate a session (matches sidecar API)."""
    pool = await get_db_pool()
    try:
        async with pool.acquire() as conn:
            # Mark session as ended
            await conn.execute("""
                UPDATE sessions 
                SET ended_at = NOW(), 
                    health_score = 0,
                    last_activity = NOW()
                WHERE session_id = $1
            """, session_id)
            return {"status": "terminated", "session_id": session_id}
    except Exception as e:
        logger.error(f"Failed to terminate session: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# Static Files & SPA Fallback
# ============================================

# Mount static files directory for React build output
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")
    
    @app.get("/")
    async def serve_spa():
        """Serve the React SPA index.html"""
        index_path = os.path.join(static_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        return JSONResponse(
            content={"message": "Dashboard frontend not built. Run 'npm run build' first."},
            status_code=200
        )
    
    # Catch-all for SPA routing
    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        """Fallback for SPA client-side routing."""
        # Check if it's an API route
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API endpoint not found")
        
        # Check for static file
        static_file = os.path.join(static_dir, path)
        if os.path.exists(static_file) and os.path.isfile(static_file):
            return FileResponse(static_file)
        
        # Fallback to index.html for SPA routing
        index_path = os.path.join(static_dir, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path)
        
        return JSONResponse(
            content={"message": "Dashboard frontend not built"},
            status_code=200
        )


# ============================================
# Main Entry Point
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.dashboard_host,
        port=settings.dashboard_port,
        reload=False,
        proxy_headers=True,
        forwarded_allow_ips="*"
    )
