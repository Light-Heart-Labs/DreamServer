"""PostgreSQL/TimescaleDB storage for token usage metrics.

Drop-in replacement for db.py (SQLite) when using PostgreSQL backend.
Set DB_BACKEND=postgres to use this module.
"""

import os
import logging
from decimal import Decimal
from typing import Optional
from uuid import UUID, uuid4

from psycopg2.extras import RealDictCursor, register_uuid
from psycopg2 import pool

# Register UUID type adapter
register_uuid()

logger = logging.getLogger(__name__)

# Connection pool settings
DB_HOST = os.environ.get("DB_HOST", "localhost")
DB_PORT = int(os.environ.get("DB_PORT", "5434"))
DB_NAME = os.environ.get("DB_NAME", "tokenspy")
DB_USER = os.environ.get("DB_USER", "tokenspy")
DB_PASSWORD = os.environ.get("DB_PASSWORD", "")

# Single-tenant mode: bypass multi-tenancy for personal deployments
# Set to a specific tenant slug or leave empty for full multi-tenant
SINGLE_TENANT_SLUG = os.environ.get("SINGLE_TENANT_SLUG", "default")

# Connection pool
_pool: Optional[pool.ThreadedConnectionPool] = None
_tenant_id: Optional[UUID] = None
_agent_cache: dict[str, UUID] = {}


def _get_pool() -> pool.ThreadedConnectionPool:
    """Get or create the connection pool."""
    global _pool
    if _pool is None:
        _pool = pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=10,
            host=DB_HOST,
            port=DB_PORT,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
        )
    return _pool


def _get_conn():
    """Get a connection from the pool."""
    return _get_pool().getconn()


def _put_conn(conn):
    """Return a connection to the pool."""
    _get_pool().putconn(conn)


def init_db():
    """Initialize database (ensure tenant exists for single-tenant mode)."""
    global _tenant_id

    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Check if tenant exists
            cur.execute(
                "SELECT id FROM tenants WHERE slug = %s AND deleted_at IS NULL",
                (SINGLE_TENANT_SLUG,)
            )
            row = cur.fetchone()

            if row:
                _tenant_id = row["id"]
                logger.info(f"Using existing tenant: {SINGLE_TENANT_SLUG} ({_tenant_id})")
            else:
                # Create the default tenant
                cur.execute(
                    """
                    INSERT INTO tenants (name, slug, plan)
                    VALUES (%s, %s, 'free')
                    RETURNING id
                    """,
                    (SINGLE_TENANT_SLUG.replace("-", " ").title(), SINGLE_TENANT_SLUG)
                )
                _tenant_id = cur.fetchone()["id"]
                logger.info(f"Created tenant: {SINGLE_TENANT_SLUG} ({_tenant_id})")

            conn.commit()
    finally:
        _put_conn(conn)


def _get_or_create_agent(agent_name: str) -> UUID:
    """Get or create an agent by name (within the current tenant)."""
    global _agent_cache

    if agent_name in _agent_cache:
        return _agent_cache[agent_name]

    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # Bypass RLS for this query
            cur.execute("SET LOCAL app.current_tenant = %s", (str(_tenant_id),))

            slug = agent_name.lower().replace(" ", "-")
            cur.execute(
                "SELECT id FROM agents WHERE tenant_id = %s AND slug = %s",
                (_tenant_id, slug)
            )
            row = cur.fetchone()

            if row:
                agent_id = row["id"]
            else:
                cur.execute(
                    """
                    INSERT INTO agents (tenant_id, name, slug)
                    VALUES (%s, %s, %s)
                    RETURNING id
                    """,
                    (_tenant_id, agent_name, slug)
                )
                agent_id = cur.fetchone()["id"]
                logger.info(f"Created agent: {agent_name} ({agent_id})")

            conn.commit()
            _agent_cache[agent_name] = agent_id
            return agent_id
    except Exception:
        conn.rollback()
        raise
    finally:
        _put_conn(conn)


def log_usage(entry: dict):
    """Log a single request's usage metrics."""
    if _tenant_id is None:
        init_db()

    agent_name = entry.get("agent", "unknown")
    agent_id = _get_or_create_agent(agent_name)

    # Map SQLite entry format to PostgreSQL schema
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL app.current_tenant = %s", (str(_tenant_id),))

            cur.execute(
                """
                INSERT INTO requests (
                    id, tenant_id, agent_id, provider, model,
                    request_body_bytes, message_count, user_message_count,
                    assistant_message_count, tool_count,
                    system_prompt_total_chars,
                    workspace_agents_chars, workspace_soul_chars, workspace_tools_chars,
                    workspace_identity_chars, workspace_user_chars, workspace_heartbeat_chars,
                    workspace_bootstrap_chars, workspace_memory_chars,
                    skill_injection_chars, base_prompt_chars,
                    conversation_history_chars,
                    input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
                    estimated_cost_usd, duration_ms, stop_reason
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    uuid4(), _tenant_id, agent_id,
                    _detect_provider(entry.get("model", "")),
                    entry.get("model", "unknown"),
                    entry.get("request_body_bytes", 0),
                    entry.get("message_count", 0),
                    entry.get("user_message_count", 0),
                    entry.get("assistant_message_count", 0),
                    entry.get("tool_count", 0),
                    entry.get("system_prompt_total_chars", 0),
                    entry.get("workspace_agents_chars", 0),
                    entry.get("workspace_soul_chars", 0),
                    entry.get("workspace_tools_chars", 0),
                    entry.get("workspace_identity_chars", 0),
                    entry.get("workspace_user_chars", 0),
                    entry.get("workspace_heartbeat_chars", 0),
                    entry.get("workspace_bootstrap_chars", 0),
                    entry.get("workspace_memory_chars", 0),
                    entry.get("skill_injection_chars", 0),
                    entry.get("base_prompt_chars", 0),
                    entry.get("conversation_history_chars", 0),
                    entry.get("input_tokens", 0),
                    entry.get("output_tokens", 0),
                    entry.get("cache_read_tokens", 0),
                    entry.get("cache_write_tokens", 0),
                    entry.get("estimated_cost_usd", 0),
                    entry.get("duration_ms", 0),
                    entry.get("stop_reason"),
                )
            )
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _put_conn(conn)


def _detect_provider(model: str) -> str:
    """Detect provider from model name."""
    model_lower = model.lower()
    if "claude" in model_lower:
        return "anthropic"
    elif "kimi" in model_lower:
        return "moonshot"
    elif "gpt" in model_lower or "o1" in model_lower:
        return "openai"
    elif "gemini" in model_lower:
        return "google"
    elif "qwen" in model_lower:
        return "alibaba"
    return "unknown"


def query_usage(agent: str | None = None, hours: int = 24, limit: int = 200) -> list[dict]:
    """Query recent usage records."""
    if _tenant_id is None:
        init_db()

    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SET LOCAL app.current_tenant = %s", (str(_tenant_id),))

            sql = """
                SELECT
                    r.id, r.timestamp, a.name as agent, r.model,
                    r.request_body_bytes, r.message_count, r.user_message_count,
                    r.assistant_message_count, r.tool_count,
                    r.system_prompt_total_chars,
                    r.workspace_agents_chars, r.workspace_soul_chars, r.workspace_tools_chars,
                    r.workspace_identity_chars, r.workspace_user_chars, r.workspace_heartbeat_chars,
                    r.workspace_bootstrap_chars, r.workspace_memory_chars,
                    r.skill_injection_chars, r.base_prompt_chars,
                    r.conversation_history_chars,
                    r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens,
                    r.estimated_cost_usd, r.duration_ms, r.stop_reason
                FROM requests r
                LEFT JOIN agents a ON r.agent_id = a.id
                WHERE r.tenant_id = %s
                AND r.timestamp > NOW() - INTERVAL '%s hours'
            """
            params = [_tenant_id, hours]

            if agent:
                sql += " AND a.name = %s"
                params.append(agent)

            sql += " ORDER BY r.timestamp DESC LIMIT %s"
            params.append(limit)

            cur.execute(sql, params)
            rows = cur.fetchall()

            # Convert timestamps to ISO format strings for compatibility
            result = []
            for row in rows:
                d = dict(row)
                if d.get("timestamp"):
                    d["timestamp"] = d["timestamp"].isoformat()
                if d.get("estimated_cost_usd"):
                    d["estimated_cost_usd"] = float(d["estimated_cost_usd"])
                result.append(d)
            return result
    finally:
        _put_conn(conn)


def query_summary(hours: int = 24) -> list[dict]:
    """Get summary metrics grouped by agent."""
    if _tenant_id is None:
        init_db()

    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SET LOCAL app.current_tenant = %s", (str(_tenant_id),))

            cur.execute(
                """
                SELECT
                    a.name as agent,
                    COUNT(*) as turns,
                    SUM(r.input_tokens) as total_input_tokens,
                    SUM(r.output_tokens) as total_output_tokens,
                    SUM(r.cache_read_tokens) as total_cache_read,
                    SUM(r.cache_write_tokens) as total_cache_write,
                    SUM(r.estimated_cost_usd) as total_cost,
                    AVG(r.input_tokens) as avg_input_tokens,
                    MAX(r.input_tokens) as max_input_tokens,
                    AVG(r.system_prompt_total_chars) as avg_system_chars,
                    AVG(r.conversation_history_chars) as avg_history_chars,
                    AVG(r.skill_injection_chars) as avg_skill_chars,
                    AVG(r.base_prompt_chars) as avg_base_prompt_chars
                FROM requests r
                LEFT JOIN agents a ON r.agent_id = a.id
                WHERE r.tenant_id = %s
                AND r.timestamp > NOW() - INTERVAL '%s hours'
                GROUP BY a.name
                """,
                (_tenant_id, hours)
            )
            rows = cur.fetchall()

            # Convert Decimals to floats for JSON compatibility
            result = []
            for row in rows:
                d = dict(row)
                for k, v in d.items():
                    if isinstance(v, Decimal):
                        d[k] = float(v)
                result.append(d)
            return result
    finally:
        _put_conn(conn)


def query_session_status(agent: str, char_limit: int = 200_000) -> dict:
    """Get current session health metrics for an agent.

    Detects session boundaries by looking for sudden drops in conversation_history_chars
    (indicating a session reset). Returns metrics for the current session.
    """
    if _tenant_id is None:
        init_db()

    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SET LOCAL app.current_tenant = %s", (str(_tenant_id),))

            # Get all recent turns for this agent, ordered chronologically
            cur.execute(
                """
                SELECT
                    r.conversation_history_chars,
                    r.cache_read_tokens,
                    r.cache_write_tokens,
                    r.estimated_cost_usd,
                    r.timestamp
                FROM requests r
                LEFT JOIN agents a ON r.agent_id = a.id
                WHERE r.tenant_id = %s
                AND a.name = %s
                AND r.timestamp > NOW() - INTERVAL '24 hours'
                ORDER BY r.timestamp ASC
                """,
                (_tenant_id, agent)
            )
            rows = cur.fetchall()

            if not rows:
                return {
                    "agent": agent,
                    "current_session_turns": 0,
                    "current_history_chars": 0,
                    "last_turn_cost": 0,
                    "avg_cost_last_5": 0,
                    "cache_write_pct_last_5": 0,
                    "cost_since_last_reset": 0,
                    "turns_since_last_reset": 0,
                    "recommendation": "no_data",
                }

            rows = [dict(r) for r in rows]

            # Find last session reset: a turn where history drops by >50%
            last_reset_idx = 0
            for i in range(1, len(rows)):
                prev = rows[i - 1]["conversation_history_chars"] or 0
                curr = rows[i]["conversation_history_chars"] or 0
                if prev > 1000 and curr < prev * 0.5:
                    last_reset_idx = i

            session_rows = rows[last_reset_idx:]
            current_history = session_rows[-1]["conversation_history_chars"] or 0
            last_cost = float(session_rows[-1]["estimated_cost_usd"] or 0)
            total_cost = sum(float(r["estimated_cost_usd"] or 0) for r in session_rows)

            # Last 5 turns for rolling averages
            last_5 = session_rows[-5:]
            avg_cost_5 = sum(float(r["estimated_cost_usd"] or 0) for r in last_5) / max(len(last_5), 1)
            total_cache_5 = sum((r["cache_read_tokens"] or 0) + (r["cache_write_tokens"] or 0) for r in last_5)
            total_write_5 = sum(r["cache_write_tokens"] or 0 for r in last_5)
            cache_write_pct = total_write_5 / max(total_cache_5, 1)

            # Recommendation logic (thresholds scale with configurable char_limit)
            if current_history > char_limit * 2.5:
                rec = "reset_recommended"
            elif current_history > char_limit * 2:
                rec = "compact_soon"
            elif current_history > char_limit:
                rec = "monitor"
            elif cache_write_pct > 0.20 and len(last_5) >= 3:
                rec = "cache_unstable"
            else:
                rec = "healthy"

            return {
                "agent": agent,
                "current_session_turns": len(session_rows),
                "current_history_chars": current_history,
                "last_turn_cost": round(last_cost, 6),
                "avg_cost_last_5": round(avg_cost_5, 6),
                "cache_write_pct_last_5": round(cache_write_pct, 4),
                "cost_since_last_reset": round(total_cost, 6),
                "turns_since_last_reset": len(session_rows),
                "recommendation": rec,
            }
    finally:
        _put_conn(conn)


def query_recent_events(limit: int = 100, after_id: Optional[UUID] = None):
    """Query recent token usage events for SSE streaming."""
    conn = _get_conn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            if after_id:
                cur.execute(
                    """
                    SELECT
                        r.id,
                        r.request_id as session_id,
                        r.model,
                        r.provider,
                        r.input_tokens,
                        r.output_tokens,
                        (r.input_tokens + r.output_tokens) as total_tokens,
                        r.estimated_cost_usd as cost_usd,
                        r.timestamp,
                        a.name as agent_name
                    FROM requests r
                    LEFT JOIN agents a ON r.agent_id = a.id
                    WHERE r.tenant_id = %s
                    AND r.id > %s
                    ORDER BY r.timestamp DESC
                    LIMIT %s
                    """,
                    (_tenant_id, after_id, limit)
                )
            else:
                cur.execute(
                    """
                    SELECT
                        r.id,
                        r.request_id as session_id,
                        r.model,
                        r.provider,
                        r.input_tokens,
                        r.output_tokens,
                        (r.input_tokens + r.output_tokens) as total_tokens,
                        r.estimated_cost_usd as cost_usd,
                        r.timestamp,
                        a.name as agent_name
                    FROM requests r
                    LEFT JOIN agents a ON r.agent_id = a.id
                    WHERE r.tenant_id = %s
                    ORDER BY r.timestamp DESC
                    LIMIT %s
                    """,
                    (_tenant_id, limit)
                )
            rows = cur.fetchall()
            # Convert datetime objects to ISO format strings for JSON serialization
            result = []
            for row in rows:
                d = dict(row)
                if d.get("timestamp"):
                    d["timestamp"] = d["timestamp"].isoformat()
                if d.get("cost_usd"):
                    d["cost_usd"] = float(d["cost_usd"])
                result.append(d)
            return result
    finally:
        _put_conn(conn)
