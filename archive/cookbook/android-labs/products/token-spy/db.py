"""SQLite storage for token usage metrics."""

import sqlite3
import os
import threading

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(__file__), "data", "usage.db"))

_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _local.conn = sqlite3.connect(DB_PATH)
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA busy_timeout=5000")
    return _local.conn


def init_db():
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            agent TEXT NOT NULL,
            model TEXT,

            -- Request metrics
            request_body_bytes INTEGER DEFAULT 0,
            message_count INTEGER DEFAULT 0,
            user_message_count INTEGER DEFAULT 0,
            assistant_message_count INTEGER DEFAULT 0,
            tool_count INTEGER DEFAULT 0,

            -- System prompt breakdown (chars)
            system_prompt_total_chars INTEGER DEFAULT 0,
            workspace_agents_chars INTEGER DEFAULT 0,
            workspace_soul_chars INTEGER DEFAULT 0,
            workspace_tools_chars INTEGER DEFAULT 0,
            workspace_identity_chars INTEGER DEFAULT 0,
            workspace_user_chars INTEGER DEFAULT 0,
            workspace_heartbeat_chars INTEGER DEFAULT 0,
            workspace_bootstrap_chars INTEGER DEFAULT 0,
            workspace_memory_chars INTEGER DEFAULT 0,
            skill_injection_chars INTEGER DEFAULT 0,
            base_prompt_chars INTEGER DEFAULT 0,

            -- Conversation history (chars)
            conversation_history_chars INTEGER DEFAULT 0,

            -- Response token usage from Anthropic
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cache_read_tokens INTEGER DEFAULT 0,
            cache_write_tokens INTEGER DEFAULT 0,

            -- Derived
            estimated_cost_usd REAL DEFAULT 0,
            duration_ms INTEGER DEFAULT 0,
            stop_reason TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage(timestamp);
        CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage(agent);
    """)
    conn.commit()


def log_usage(entry: dict):
    conn = _get_conn()
    cols = [
        "agent", "model",
        "request_body_bytes", "message_count", "user_message_count",
        "assistant_message_count", "tool_count",
        "system_prompt_total_chars",
        "workspace_agents_chars", "workspace_soul_chars", "workspace_tools_chars",
        "workspace_identity_chars", "workspace_user_chars", "workspace_heartbeat_chars",
        "workspace_bootstrap_chars",
        "skill_injection_chars", "base_prompt_chars",
        "conversation_history_chars",
        "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
        "estimated_cost_usd", "duration_ms", "stop_reason",
    ]
    values = [entry.get(c) for c in cols]
    placeholders = ", ".join(["?"] * len(cols))
    col_names = ", ".join(cols)
    conn.execute(f"INSERT INTO usage ({col_names}) VALUES ({placeholders})", values)
    conn.commit()


def query_usage(agent: str | None = None, hours: int = 24, limit: int = 200) -> list[dict]:
    conn = _get_conn()
    conn.row_factory = sqlite3.Row
    sql = "SELECT * FROM usage WHERE timestamp > datetime('now', ?)"
    params: list = [f"-{hours} hours"]
    if agent:
        sql += " AND agent = ?"
        params.append(agent)
    sql += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def query_summary(hours: int = 24) -> list[dict]:
    conn = _get_conn()
    conn.row_factory = sqlite3.Row
    rows = conn.execute("""
        SELECT
            agent,
            COUNT(*) as turns,
            SUM(input_tokens) as total_input_tokens,
            SUM(output_tokens) as total_output_tokens,
            SUM(cache_read_tokens) as total_cache_read,
            SUM(cache_write_tokens) as total_cache_write,
            SUM(estimated_cost_usd) as total_cost,
            AVG(input_tokens) as avg_input_tokens,
            MAX(input_tokens) as max_input_tokens,
            AVG(system_prompt_total_chars) as avg_system_chars,
            AVG(conversation_history_chars) as avg_history_chars,
            AVG(skill_injection_chars) as avg_skill_chars,
            AVG(base_prompt_chars) as avg_base_prompt_chars
        FROM usage
        WHERE timestamp > datetime('now', ?)
        GROUP BY agent
    """, [f"-{hours} hours"]).fetchall()
    return [dict(r) for r in rows]


def query_session_status(agent: str, char_limit: int = 200_000) -> dict:
    """Get current session health metrics for an agent.

    Detects session boundaries by looking for sudden drops in conversation_history_chars
    (indicating a session reset). Returns metrics for the current session.
    char_limit controls the threshold levels for recommendations.
    """
    conn = _get_conn()
    conn.row_factory = sqlite3.Row

    # Get all recent turns for this agent, ordered chronologically
    rows = conn.execute("""
        SELECT conversation_history_chars, cache_read_tokens, cache_write_tokens,
               estimated_cost_usd, timestamp
        FROM usage
        WHERE agent = ? AND timestamp > datetime('now', '-24 hours')
        ORDER BY timestamp ASC
    """, [agent]).fetchall()

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
    last_cost = session_rows[-1]["estimated_cost_usd"] or 0
    total_cost = sum(r["estimated_cost_usd"] or 0 for r in session_rows)

    # Last 5 turns for rolling averages
    last_5 = session_rows[-5:]
    avg_cost_5 = sum(r["estimated_cost_usd"] or 0 for r in last_5) / max(len(last_5), 1)
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
