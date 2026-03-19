"""Compatibility shim for Token Spy database access.

Canonical database backend now lives in ``sidecar/db_backend.py``.
This module is kept as an import-forwarder so existing scripts that import
``db_backend`` continue to work during migration.
"""

from __future__ import annotations

import importlib.util
import logging
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

logger = logging.getLogger(__name__)

warnings.warn(
    "resources/products/token-spy/db_backend.py is deprecated; import from sidecar.db_backend instead.",
    DeprecationWarning,
    stacklevel=2,
)

def _load_canonical_module():
    module_path = Path(__file__).resolve().parent / "sidecar" / "db_backend.py"
    spec = importlib.util.spec_from_file_location("token_spy_sidecar_db_backend", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load canonical db backend from {module_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_canonical = _load_canonical_module()

# Re-export canonical symbols for compatibility.
DatabaseBackend = _canonical.DatabaseBackend
UsageEntry = _canonical.UsageEntry
UsageStats = _canonical.UsageStats
APIKey = _canonical.APIKey
ProviderKey = _canonical.ProviderKey
Tenant = _canonical.Tenant
User = _canonical.User
Team = _canonical.Team
TeamMembership = _canonical.TeamMembership
OrganizationSettings = _canonical.OrganizationSettings
RealDictCursor = getattr(_canonical, "RealDictCursor", None)
get_db_connection = _canonical.get_db_connection
init_pool = _canonical.init_pool
get_connection = _canonical.get_connection
put_connection = _canonical.put_connection
decrypt_provider_key = _canonical.decrypt_provider_key


def _cursor_kwargs() -> Dict[str, Any]:
    return {"cursor_factory": RealDictCursor} if RealDictCursor is not None else {}


def get_backend() -> DatabaseBackend:
    """Legacy accessor for the canonical singleton backend."""
    return _canonical.get_db()


def init_db() -> None:
    """Legacy schema initialization entrypoint."""
    get_backend().init_db()


def _to_usage_entry(entry: Dict[str, Any]) -> UsageEntry:
    request_id = entry.get("request_id") or f"legacy-{uuid4()}"
    prompt_tokens = int(entry.get("prompt_tokens", entry.get("input_tokens", 0)) or 0)
    completion_tokens = int(entry.get("completion_tokens", entry.get("output_tokens", 0)) or 0)
    total_tokens = int(entry.get("total_tokens", prompt_tokens + completion_tokens) or 0)

    return UsageEntry(
        session_id=entry.get("session_id"),
        request_id=request_id,
        provider=entry.get("provider", "legacy"),
        model=entry.get("model", "unknown"),
        api_key_prefix=entry.get("api_key_prefix"),
        tenant_id=entry.get("tenant_id"),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        total_cost=float(entry.get("total_cost", entry.get("estimated_cost_usd", 0.0)) or 0.0),
        latency_ms=entry.get("latency_ms", entry.get("duration_ms")),
        status_code=int(entry.get("status_code", 200) or 200),
        finish_reason=entry.get("finish_reason", entry.get("stop_reason")),
    )


def log_usage(entry: Dict[str, Any] | UsageEntry) -> None:
    """Legacy usage logger adapter.

    Accepts either the old dict payload shape or canonical ``UsageEntry``.
    """
    usage_entry = entry if isinstance(entry, UsageEntry) else _to_usage_entry(entry)
    get_backend().log_usage(usage_entry)


def query_usage(
    agent: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Compatibility query helper over canonical PostgreSQL tables."""
    sql = """
        SELECT
            request_id,
            timestamp,
            provider,
            model,
            prompt_tokens AS input_tokens,
            completion_tokens AS output_tokens,
            total_tokens,
            total_cost AS estimated_cost_usd,
            latency_ms AS duration_ms,
            finish_reason AS stop_reason,
            tenant_id
        FROM api_requests
        WHERE 1=1
    """
    params: List[Any] = []
    if agent:
        sql += " AND session_id = %s"
        params.append(agent)
    if start_time:
        sql += " AND timestamp >= %s"
        params.append(start_time)
    if end_time:
        sql += " AND timestamp <= %s"
        params.append(end_time)
    sql += " ORDER BY timestamp DESC LIMIT %s"
    params.append(limit)

    with get_db_connection() as conn:
        with conn.cursor(**_cursor_kwargs()) as cur:
            cur.execute(sql, tuple(params))
            return [dict(row) for row in cur.fetchall()]


def query_summary(hours: int = 24) -> Dict[str, Any]:
    """Legacy summary shape backed by canonical api_requests table."""
    with get_db_connection() as conn:
        with conn.cursor(**_cursor_kwargs()) as cur:
            cur.execute(
                """
                SELECT
                    COUNT(*) AS request_count,
                    COALESCE(SUM(prompt_tokens), 0) AS total_input_tokens,
                    COALESCE(SUM(completion_tokens), 0) AS total_output_tokens,
                    COALESCE(SUM(total_cost), 0) AS total_cost,
                    AVG(latency_ms) AS avg_duration_ms
                FROM api_requests
                WHERE timestamp >= NOW() - (%s || ' hours')::interval
                """,
                (hours,),
            )
            row = cur.fetchone()
            return dict(row) if row else {}


def query_session_status(agent: str) -> Dict[str, Any]:
    """Legacy per-session status helper.

    ``agent`` is interpreted as legacy session identifier.
    """
    with get_db_connection() as conn:
        with conn.cursor(**_cursor_kwargs()) as cur:
            cur.execute(
                """
                SELECT
                    COUNT(*) AS message_count,
                    COALESCE(SUM(total_tokens), 0) AS total_tokens,
                    MAX(timestamp) AS last_activity
                FROM api_requests
                WHERE session_id = %s
                  AND timestamp >= NOW() - INTERVAL '1 hour'
                """,
                (agent,),
            )
            row = cur.fetchone()
            if not row:
                return {"message_count": 0, "total_tokens": 0}
            return dict(row)
