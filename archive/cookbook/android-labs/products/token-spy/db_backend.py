"""Database abstraction layer for Token Spy.

Supports both SQLite (development/single-tenant) and PostgreSQL with TimescaleDB
(production/multi-tenant) backends.
"""

import os
import logging
from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Database backend selection
DB_BACKEND = os.environ.get("DB_BACKEND", "sqlite").lower()
DB_PATH = os.environ.get("DB_PATH", "data/usage.db")

# PostgreSQL configuration
PG_HOST = os.environ.get("PG_HOST", "localhost")
PG_PORT = int(os.environ.get("PG_PORT", "5432"))
PG_DB = os.environ.get("PG_DB", "token_spy")
PG_USER = os.environ.get("PG_USER", "token_spy")
PG_PASSWORD = os.environ.get("PG_PASSWORD", "")
PG_POOL_SIZE = int(os.environ.get("PG_POOL_SIZE", "10"))


class DatabaseBackend(ABC):
    """Abstract base class for database backends."""
    
    @abstractmethod
    def init_db(self) -> None:
        """Initialize database schema."""
        pass
    
    @abstractmethod
    def log_usage(self, entry: Dict[str, Any]) -> None:
        """Log a usage entry."""
        pass
    
    @abstractmethod
    def query_usage(self, agent: Optional[str] = None, 
                   start_time: Optional[str] = None,
                   end_time: Optional[str] = None,
                   limit: int = 100) -> List[Dict[str, Any]]:
        """Query usage records."""
        pass
    
    @abstractmethod
    def query_summary(self, hours: int = 24) -> Dict[str, Any]:
        """Get usage summary for time period."""
        pass
    
    @abstractmethod
    def query_session_status(self, agent: str) -> Dict[str, Any]:
        """Get session status for an agent."""
        pass


class SQLiteBackend(DatabaseBackend):
    """SQLite backend for single-tenant deployments."""
    
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._local = threading.local()
    
    def _get_conn(self):
        import sqlite3
        if not hasattr(self._local, "conn") or self._local.conn is None:
            os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
            self._local.conn = sqlite3.connect(self.db_path)
            self._local.conn.execute("PRAGMA journal_mode=WAL")
            self._local.conn.execute("PRAGMA busy_timeout=5000")
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn
    
    def init_db(self) -> None:
        """Initialize SQLite schema (legacy single-tenant)."""
        conn = self._get_conn()
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
                agent TEXT NOT NULL,
                model TEXT,
                request_body_bytes INTEGER DEFAULT 0,
                message_count INTEGER DEFAULT 0,
                user_message_count INTEGER DEFAULT 0,
                assistant_message_count INTEGER DEFAULT 0,
                tool_count INTEGER DEFAULT 0,
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
                conversation_history_chars INTEGER DEFAULT 0,
                input_tokens INTEGER DEFAULT 0,
                output_tokens INTEGER DEFAULT 0,
                cache_read_tokens INTEGER DEFAULT 0,
                cache_write_tokens INTEGER DEFAULT 0,
                estimated_cost_usd REAL DEFAULT 0,
                duration_ms INTEGER DEFAULT 0,
                stop_reason TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage(timestamp);
            CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage(agent);
        """)
        conn.commit()
        logger.info(f"SQLite database initialized at {self.db_path}")
    
    def log_usage(self, entry: Dict[str, Any]) -> None:
        """Log usage to SQLite."""
        conn = self._get_conn()
        cols = [
            "agent", "model",
            "request_body_bytes", "message_count", "user_message_count",
            "assistant_message_count", "tool_count",
            "system_prompt_total_chars",
            "workspace_agents_chars", "workspace_soul_chars", "workspace_tools_chars",
            "workspace_identity_chars", "workspace_user_chars", "workspace_heartbeat_chars",
            "workspace_bootstrap_chars", "workspace_memory_chars",
            "skill_injection_chars", "base_prompt_chars",
            "conversation_history_chars",
            "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
            "estimated_cost_usd", "duration_ms", "stop_reason"
        ]
        placeholders = ", ".join(["?"] * len(cols))
        sql = f"INSERT INTO usage ({', '.join(cols)}) VALUES ({placeholders})"
        values = [entry.get(c, 0) if c != "agent" and c != "model" and c != "stop_reason" else entry.get(c, "") for c in cols]
        conn.execute(sql, values)
        conn.commit()
    
    def query_usage(self, agent: Optional[str] = None,
                   start_time: Optional[str] = None,
                   end_time: Optional[str] = None,
                   limit: int = 100) -> List[Dict[str, Any]]:
        """Query usage from SQLite."""
        conn = self._get_conn()
        sql = "SELECT * FROM usage WHERE 1=1"
        params = []
        if agent:
            sql += " AND agent = ?"
            params.append(agent)
        if start_time:
            sql += " AND timestamp >= ?"
            params.append(start_time)
        if end_time:
            sql += " AND timestamp <= ?"
            params.append(end_time)
        sql += " ORDER BY timestamp DESC LIMIT ?"
        params.append(limit)
        
        cursor = conn.execute(sql, params)
        return [dict(row) for row in cursor.fetchall()]
    
    def query_summary(self, hours: int = 24) -> Dict[str, Any]:
        """Get usage summary from SQLite."""
        conn = self._get_conn()
        cursor = conn.execute("""
            SELECT 
                COUNT(*) as request_count,
                SUM(input_tokens) as total_input_tokens,
                SUM(output_tokens) as total_output_tokens,
                SUM(estimated_cost_usd) as total_cost,
                AVG(duration_ms) as avg_duration_ms
            FROM usage 
            WHERE timestamp >= datetime('now', '-{} hours')
        """.format(hours))
        row = cursor.fetchone()
        return dict(row) if row else {}
    
    def query_session_status(self, agent: str) -> Dict[str, Any]:
        """Get session status from SQLite."""
        conn = self._get_conn()
        cursor = conn.execute("""
            SELECT 
                COUNT(*) as message_count,
                SUM(input_tokens + output_tokens) as total_tokens,
                SUM(conversation_history_chars) as conversation_chars,
                MAX(timestamp) as last_activity
            FROM usage 
            WHERE agent = ?
            AND timestamp >= datetime('now', '-1 hour')
        """, (agent,))
        row = cursor.fetchone()
        if not row:
            return {"message_count": 0, "total_tokens": 0, "conversation_chars": 0}
        return dict(row)


class PostgreSQLBackend(DatabaseBackend):
    """PostgreSQL with TimescaleDB backend for multi-tenant deployments."""
    
    def __init__(self, host: str = PG_HOST, port: int = PG_PORT,
                 db: str = PG_DB, user: str = PG_USER, 
                 password: str = PG_PASSWORD):
        self.dsn = f"postgresql://{user}:{password}@{host}:{port}/{db}"
        self._pool = None
    
    def _get_pool(self):
        """Get or create connection pool."""
        if self._pool is None:
            try:
                import asyncpg
                import asyncio
                # Note: asyncpg requires async context, use sync wrapper
                self._pool = None  # Will use psycopg2 for sync
            except ImportError:
                pass
        return self._pool
    
    def init_db(self) -> None:
        """Initialize PostgreSQL schema with TimescaleDB."""
        try:
            import psycopg2
            conn = psycopg2.connect(self.dsn)
            conn.autocommit = True
            cursor = conn.cursor()
            
            # Check if TimescaleDB extension is available
            cursor.execute("SELECT 1 FROM pg_extension WHERE extname = 'timescaledb'")
            has_timescale = cursor.fetchone() is not None
            
            if not has_timescale:
                logger.warning("TimescaleDB extension not found. Creating without hypertable.")
            
            # Create schema (simplified - full schema in sql files)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS requests (
                    id BIGSERIAL PRIMARY KEY,
                    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    tenant_id UUID NOT NULL,
                    api_key_id UUID,
                    agent_id TEXT,
                    model TEXT,
                    input_tokens BIGINT DEFAULT 0,
                    output_tokens BIGINT DEFAULT 0,
                    cache_read_tokens BIGINT DEFAULT 0,
                    cache_write_tokens BIGINT DEFAULT 0,
                    cost_usd NUMERIC(12,8) DEFAULT 0,
                    duration_ms INTEGER DEFAULT 0,
                    stop_reason TEXT
                );
            """)
            
            if has_timescale:
                # Convert to hypertable for time-series optimization
                cursor.execute("""
                    SELECT create_hypertable('requests', 'timestamp', 
                        chunk_time_interval => INTERVAL '1 day',
                        if_not_exists => TRUE
                    );
                """)
            
            # Create indexes
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_requests_tenant ON requests(tenant_id);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_requests_agent ON requests(agent_id);")
            
            conn.commit()
            cursor.close()
            conn.close()
            logger.info("PostgreSQL database initialized with TimescaleDB support")
            
        except ImportError:
            logger.error("psycopg2 not installed. Run: pip install psycopg2-binary")
            raise
        except Exception as e:
            logger.error(f"Failed to initialize PostgreSQL: {e}")
            raise
    
    def log_usage(self, entry: Dict[str, Any]) -> None:
        """Log usage to PostgreSQL."""
        import psycopg2
        conn = psycopg2.connect(self.dsn)
        cursor = conn.cursor()
        
        # Map entry fields to PostgreSQL schema
        cursor.execute("""
            INSERT INTO requests 
            (tenant_id, agent_id, model, input_tokens, output_tokens,
             cache_read_tokens, cache_write_tokens, cost_usd, duration_ms, stop_reason)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            entry.get("tenant_id", "00000000-0000-0000-0000-000000000000"),
            entry.get("agent"),
            entry.get("model"),
            entry.get("input_tokens", 0),
            entry.get("output_tokens", 0),
            entry.get("cache_read_tokens", 0),
            entry.get("cache_write_tokens", 0),
            entry.get("estimated_cost_usd", 0),
            entry.get("duration_ms", 0),
            entry.get("stop_reason")
        ))
        
        conn.commit()
        cursor.close()
        conn.close()
    
    def query_usage(self, agent: Optional[str] = None,
                   start_time: Optional[str] = None,
                   end_time: Optional[str] = None,
                   limit: int = 100) -> List[Dict[str, Any]]:
        """Query usage from PostgreSQL."""
        import psycopg2
        conn = psycopg2.connect(self.dsn)
        cursor = conn.cursor()
        
        sql = "SELECT * FROM requests WHERE 1=1"
        params = []
        
        if agent:
            sql += " AND agent_id = %s"
            params.append(agent)
        if start_time:
            sql += " AND timestamp >= %s"
            params.append(start_time)
        if end_time:
            sql += " AND timestamp <= %s"
            params.append(end_time)
        
        sql += " ORDER BY timestamp DESC LIMIT %s"
        params.append(limit)
        
        cursor.execute(sql, params)
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        
        cursor.close()
        conn.close()
        
        return [dict(zip(columns, row)) for row in rows]
    
    def query_summary(self, hours: int = 24) -> Dict[str, Any]:
        """Get usage summary from PostgreSQL."""
        import psycopg2
        conn = psycopg2.connect(self.dsn)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT 
                COUNT(*) as request_count,
                SUM(input_tokens) as total_input_tokens,
                SUM(output_tokens) as total_output_tokens,
                SUM(cost_usd) as total_cost,
                AVG(duration_ms) as avg_duration_ms
            FROM requests 
            WHERE timestamp >= NOW() - INTERVAL '%s hours'
        """, (hours,))
        
        columns = [desc[0] for desc in cursor.description]
        row = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        return dict(zip(columns, row)) if row else {}
    
    def query_session_status(self, agent: str) -> Dict[str, Any]:
        """Get session status from PostgreSQL."""
        import psycopg2
        conn = psycopg2.connect(self.dsn)
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT 
                COUNT(*) as message_count,
                SUM(input_tokens + output_tokens) as total_tokens,
                MAX(timestamp) as last_activity
            FROM requests 
            WHERE agent_id = %s
            AND timestamp >= NOW() - INTERVAL '1 hour'
        """, (agent,))
        
        columns = [desc[0] for desc in cursor.description]
        row = cursor.fetchone()
        
        cursor.close()
        conn.close()
        
        return dict(zip(columns, row)) if row else {"message_count": 0, "total_tokens": 0}


# Global backend instance
_backend: Optional[DatabaseBackend] = None


def get_backend() -> DatabaseBackend:
    """Get the configured database backend."""
    global _backend
    if _backend is None:
        if DB_BACKEND == "postgresql":
            _backend = PostgreSQLBackend()
        else:
            _backend = SQLiteBackend()
    return _backend


def init_db():
    """Initialize the database."""
    backend = get_backend()
    backend.init_db()


def log_usage(entry: Dict[str, Any]):
    """Log usage entry."""
    backend = get_backend()
    backend.log_usage(entry)


def query_usage(agent: Optional[str] = None,
               start_time: Optional[str] = None,
               end_time: Optional[str] = None,
               limit: int = 100) -> List[Dict[str, Any]]:
    """Query usage records."""
    backend = get_backend()
    return backend.query_usage(agent, start_time, end_time, limit)


def query_summary(hours: int = 24) -> Dict[str, Any]:
    """Get usage summary."""
    backend = get_backend()
    return backend.query_summary(hours)


def query_session_status(agent: str) -> Dict[str, Any]:
    """Get session status."""
    backend = get_backend()
    return backend.query_session_status(agent)
