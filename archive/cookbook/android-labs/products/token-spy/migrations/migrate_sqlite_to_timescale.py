"""
SQLite to TimescaleDB Migration Script

Migrates existing Token Spy data from SQLite to PostgreSQL/TimescaleDB.
Run this after setting up the new TimescaleDB instance.

Usage:
    python migrate_sqlite_to_timescale.py --sqlite-path ./data/usage.db \
                                          --postgres-url postgres://user:pass@localhost/token_spy
"""

import argparse
import json
import sqlite3
import sys
from datetime import datetime
from typing import Any, Dict, Iterator, List, Optional
from urllib.parse import urlparse

import psycopg2
from psycopg2.extras import execute_batch


def parse_args():
    parser = argparse.ArgumentParser(
        description="Migrate Token Spy data from SQLite to TimescaleDB"
    )
    parser.add_argument(
        "--sqlite-path",
        default="./data/usage.db",
        help="Path to SQLite database (default: ./data/usage.db)",
    )
    parser.add_argument(
        "--postgres-url",
        required=True,
        help="PostgreSQL connection URL (e.g., postgres://user:pass@localhost/token_spy)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=1000,
        help="Number of rows to insert per batch (default: 1000)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be migrated without writing to PostgreSQL",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip rows that already exist in TimescaleDB (based on timestamp + agent)",
    )
    return parser.parse_args()


def connect_sqlite(db_path: str) -> sqlite3.Connection:
    """Connect to SQLite database."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def connect_postgres(url: str):
    """Connect to PostgreSQL database."""
    parsed = urlparse(url)
    return psycopg2.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        database=parsed.path.lstrip("/"),
        user=parsed.username,
        password=parsed.password,
    )


def get_sqlite_stats(conn: sqlite3.Connection) -> Dict[str, Any]:
    """Get statistics about the SQLite database."""
    cursor = conn.cursor()
    
    # Total rows
    cursor.execute("SELECT COUNT(*) FROM usage")
    total_rows = cursor.fetchone()[0]
    
    # Date range
    cursor.execute("SELECT MIN(timestamp), MAX(timestamp) FROM usage")
    min_date, max_date = cursor.fetchone()
    
    # Agent counts
    cursor.execute("SELECT agent, COUNT(*) as count FROM usage GROUP BY agent")
    agents = {row[0]: row[1] for row in cursor.fetchall()}
    
    # Provider counts (if provider column exists)
    try:
        cursor.execute("SELECT provider, COUNT(*) as count FROM usage GROUP BY provider")
        providers = {row[0] or "unknown": row[1] for row in cursor.fetchall()}
    except sqlite3.OperationalError:
        providers = {"unknown": total_rows}
    
    return {
        "total_rows": total_rows,
        "date_range": (min_date, max_date),
        "agents": agents,
        "providers": providers,
    }


def iter_sqlite_rows(
    conn: sqlite3.Connection, batch_size: int = 1000
) -> Iterator[List[Dict[str, Any]]]:
    """Iterate over SQLite rows in batches."""
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM usage ORDER BY timestamp")
    
    batch = []
    for row in cursor:
        batch.append(dict(row))
        if len(batch) >= batch_size:
            yield batch
            batch = []
    
    if batch:
        yield batch


def transform_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """Transform SQLite row to TimescaleDB format."""
    # Map SQLite schema to TimescaleDB schema
    return {
        "timestamp": row["timestamp"],
        "session_id": None,  # SQLite doesn't have session_id
        "request_id": None,  # Generate or leave null
        "provider": row.get("provider", "unknown"),
        "model": row.get("model", "unknown"),
        "api_key_prefix": row.get("api_key_prefix", "legacy"),
        "prompt_tokens": row.get("input_tokens", 0),
        "completion_tokens": row.get("output_tokens", 0),
        "total_tokens": (
            row.get("input_tokens", 0) + 
            row.get("output_tokens", 0) + 
            row.get("cache_read_tokens", 0) + 
            row.get("cache_write_tokens", 0)
        ),
        "prompt_cost": 0,  # Will be calculated from cost tables
        "completion_cost": row.get("estimated_cost_usd", 0),
        "total_cost": row.get("estimated_cost_usd", 0),
        "latency_ms": row.get("duration_ms", 0),
        "time_to_first_token_ms": None,
        "status_code": 200,  # Assuming success for historical data
        "finish_reason": row.get("stop_reason"),
        "system_prompt_hash": None,
        "system_prompt_length": row.get("system_prompt_total_chars", 0),
        "tenant_id": row.get("tenant_id", "default"),
    }


def insert_batch(
    conn, rows: List[Dict[str, Any]], dry_run: bool = False
) -> int:
    """Insert a batch of rows into TimescaleDB."""
    if dry_run:
        return len(rows)
    
    cursor = conn.cursor()
    
    # Use INSERT ... ON CONFLICT for idempotency
    query = """
        INSERT INTO api_requests (
            timestamp, session_id, request_id, provider, model, api_key_prefix,
            prompt_tokens, completion_tokens, total_tokens,
            prompt_cost, completion_cost, total_cost,
            latency_ms, time_to_first_token_ms, status_code, finish_reason,
            system_prompt_hash, system_prompt_length, tenant_id
        ) VALUES (
            %(timestamp)s, %(session_id)s, %(request_id)s, %(provider)s, %(model)s, %(api_key_prefix)s,
            %(prompt_tokens)s, %(completion_tokens)s, %(total_tokens)s,
            %(prompt_cost)s, %(completion_cost)s, %(total_cost)s,
            %(latency_ms)s, %(time_to_first_token_ms)s, %(status_code)s, %(finish_reason)s,
            %(system_prompt_hash)s, %(system_prompt_length)s, %(tenant_id)s
        )
        ON CONFLICT DO NOTHING
    """
    
    execute_batch(cursor, query, rows)
    conn.commit()
    return len(rows)


def verify_migration(
    sqlite_conn: sqlite3.Connection, pg_conn, args
) -> Dict[str, Any]:
    """Verify the migration by comparing counts."""
    # SQLite count
    sqlite_cursor = sqlite_conn.cursor()
    sqlite_cursor.execute("SELECT COUNT(*) FROM usage")
    sqlite_count = sqlite_cursor.fetchone()[0]
    
    # PostgreSQL count
    pg_cursor = pg_conn.cursor()
    pg_cursor.execute("SELECT COUNT(*) FROM api_requests")
    pg_count = pg_cursor.fetchone()[0]
    
    # Per-agent counts
    sqlite_cursor.execute("SELECT agent, COUNT(*) FROM usage GROUP BY agent")
    sqlite_agents = {row[0]: row[1] for row in sqlite_cursor.fetchall()}
    
    pg_cursor.execute(
        """
        SELECT a.agent_name, COUNT(r.id) 
        FROM api_requests r
        JOIN agents a ON r.request_id = a.agent_id
        GROUP BY a.agent_name
        """
    )
    pg_agents = {row[0]: row[1] for row in pg_cursor.fetchall()}
    
    return {
        "sqlite_total": sqlite_count,
        "postgres_total": pg_count,
        "match": sqlite_count == pg_count,
        "sqlite_agents": sqlite_agents,
        "postgres_agents": pg_agents,
    }


def main():
    args = parse_args()
    
    print("=" * 60)
    print("Token Spy: SQLite to TimescaleDB Migration")
    print("=" * 60)
    
    # Connect to databases
    print(f"\nConnecting to SQLite: {args.sqlite_path}")
    try:
        sqlite_conn = connect_sqlite(args.sqlite_path)
    except sqlite3.Error as e:
        print(f"ERROR: Could not connect to SQLite: {e}")
        sys.exit(1)
    
    print(f"Connecting to PostgreSQL: {args.postgres_url.replace('://', '://***:***@')}")
    try:
        pg_conn = connect_postgres(args.postgres_url)
    except psycopg2.Error as e:
        print(f"ERROR: Could not connect to PostgreSQL: {e}")
        sys.exit(1)
    
    # Get source statistics
    print("\n--- Source Database Statistics ---")
    stats = get_sqlite_stats(sqlite_conn)
    print(f"Total rows: {stats['total_rows']:,}")
    print(f"Date range: {stats['date_range'][0]} to {stats['date_range'][1]}")
    print(f"Agents: {stats['agents']}")
    print(f"Providers: {stats['providers']}")
    
    if args.dry_run:
        print("\n*** DRY RUN MODE - No data will be written ***")
        return
    
    # Confirm migration
    if not args.dry_run:
        confirm = input("\nProceed with migration? [y/N]: ")
        if confirm.lower() != "y":
            print("Migration cancelled.")
            sys.exit(0)
    
    # Perform migration
    print("\n--- Migrating Data ---")
    total_inserted = 0
    batch_num = 0
    
    for batch in iter_sqlite_rows(sqlite_conn, args.batch_size):
        batch_num += 1
        transformed = [transform_row(row) for row in batch]
        inserted = insert_batch(pg_conn, transformed, args.dry_run)
        total_inserted += inserted
        
        if batch_num % 10 == 0:
            print(f"  Batch {batch_num}: {total_inserted:,} rows migrated...")
    
    print(f"\nMigration complete: {total_inserted:,} rows inserted")
    
    # Verify
    print("\n--- Verification ---")
    verification = verify_migration(sqlite_conn, pg_conn, args)
    print(f"SQLite rows: {verification['sqlite_total']:,}")
    print(f"PostgreSQL rows: {verification['postgres_total']:,}")
    print(f"Match: {'✓ YES' if verification['match'] else '✗ NO'}")
    
    # Cleanup
    sqlite_conn.close()
    pg_conn.close()
    
    print("\n" + "=" * 60)
    print("Migration complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
