#!/usr/bin/env python3
"""
Memory Shepherd — agent memory lifecycle manager for Dream Server.

Manages the four memory layers documented in docs/MEMORY-SHEPHERD.md:
  Layer 2 — Session records    (data/openclaw/sessions/*.json)
  Layer 3 — Agent memory files (data/openclaw/memory/*.md)
  Layer 4 — Qdrant collections (connected via QDRANT_URL)

Endpoints:
  GET  /health    — liveness probe
  GET  /status    — entry counts, disk usage, namespaces, retention config
  POST /flush     — delete memory entries (all or one agent namespace)
  GET  /sessions  — list recent session records
  POST /prune     — apply retention policy immediately
"""

import asyncio
import json
import logging
import os
import re
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import aiohttp
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Config ────────────────────────────────────────────────────────────────────

PORT               = int(os.environ.get("MEMORY_SHEPHERD_PORT", "7891"))
SESSION_TTL_DAYS   = int(os.environ.get("MEMORY_SESSION_TTL_DAYS", "30"))
MAX_ENTRIES        = int(os.environ.get("MEMORY_MAX_ENTRIES", "500"))
PRUNE_THRESHOLD    = float(os.environ.get("MEMORY_PRUNE_THRESHOLD", "0.3"))
QDRANT_URL         = os.environ.get("QDRANT_URL", "http://qdrant:6333")
QDRANT_API_KEY     = os.environ.get("QDRANT_API_KEY", "")

MEMORY_DIR   = Path(os.environ.get("MEMORY_DIR",   "/data/memory"))
SESSIONS_DIR = Path(os.environ.get("SESSIONS_DIR", "/data/sessions"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("memory-shepherd")

# ── Helpers ───────────────────────────────────────────────────────────────────

_FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
_IMPORTANCE_RE  = re.compile(r"^importance:\s*([0-9.]+)", re.MULTILINE)


def _parse_importance(text: str) -> float:
    """Extract importance score from a memory entry's YAML frontmatter."""
    m = _IMPORTANCE_RE.search(text)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    return 1.0  # default: keep if unparseable


def _namespace_of(path: Path) -> str:
    """Return the namespace for a memory file (parent dir or 'default')."""
    rel = path.relative_to(MEMORY_DIR)
    if len(rel.parts) > 1:
        return rel.parts[0]
    return "default"


def _disk_bytes(directory: Path) -> int:
    if not directory.exists():
        return 0
    return sum(f.stat().st_size for f in directory.rglob("*") if f.is_file())


def _memory_files() -> list[Path]:
    if not MEMORY_DIR.exists():
        return []
    return list(MEMORY_DIR.rglob("*.md"))


def _session_files() -> list[Path]:
    if not SESSIONS_DIR.exists():
        return []
    return list(SESSIONS_DIR.glob("*.json"))


def _qdrant_headers() -> dict:
    if QDRANT_API_KEY:
        return {"api-key": QDRANT_API_KEY}
    return {}


# ── Qdrant helpers ─────────────────────────────────────────────────────────────

async def _qdrant_collections() -> list[dict]:
    """Return the list of Qdrant collections, or [] on failure."""
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as http:
            async with http.get(
                f"{QDRANT_URL}/collections",
                headers=_qdrant_headers(),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    return data.get("result", {}).get("collections", [])
    except (aiohttp.ClientError, asyncio.TimeoutError):
        pass
    return []


async def _qdrant_delete_collection(name: str) -> bool:
    """Delete a Qdrant collection. Returns True on success."""
    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as http:
            async with http.delete(
                f"{QDRANT_URL}/collections/{name}",
                headers=_qdrant_headers(),
            ) as resp:
                return resp.status in (200, 204)
    except (aiohttp.ClientError, asyncio.TimeoutError):
        return False


# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Memory Shepherd",
    version="1.0.0",
    description="Agent memory lifecycle manager for Dream Server",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:3000",
                   "http://127.0.0.1:3001", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


# ── Models ─────────────────────────────────────────────────────────────────────

class FlushRequest(BaseModel):
    agent_id: Optional[str] = None
    include_qdrant_collection: bool = False


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/status")
async def status():
    """Return memory entry counts, disk usage, namespaces, and retention config."""
    mem_files   = _memory_files()
    sess_files  = _session_files()

    # Session stats
    sess_oldest: Optional[str] = None
    if sess_files:
        oldest_mtime = min(f.stat().st_mtime for f in sess_files)
        sess_oldest = datetime.fromtimestamp(oldest_mtime, tz=timezone.utc).isoformat()

    # Memory entry stats
    importances: list[float] = []
    namespaces: set[str] = set()
    for mf in mem_files:
        try:
            text = mf.read_text(encoding="utf-8")
            importances.append(_parse_importance(text))
            namespaces.add(_namespace_of(mf))
        except OSError:
            pass

    avg_importance = round(sum(importances) / len(importances), 3) if importances else 0.0

    # Qdrant collections (non-blocking; degrade gracefully)
    qdrant_collections = await _qdrant_collections()

    return {
        "sessions": {
            "total":       len(sess_files),
            "oldest_iso":  sess_oldest,
            "size_bytes":  _disk_bytes(SESSIONS_DIR),
        },
        "memory": {
            "total":          len(mem_files),
            "namespaces":     sorted(namespaces),
            "avg_importance": avg_importance,
            "size_bytes":     _disk_bytes(MEMORY_DIR),
        },
        "qdrant": {
            "url":         QDRANT_URL,
            "collections": [c.get("name") for c in qdrant_collections],
            "reachable":   len(qdrant_collections) >= 0,  # True even if 0 collections
        },
        "config": {
            "session_ttl_days":  SESSION_TTL_DAYS,
            "max_entries":       MAX_ENTRIES,
            "prune_threshold":   PRUNE_THRESHOLD,
        },
    }


@app.post("/flush")
async def flush(req: FlushRequest):
    """
    Delete agent memory entries.

    - Without agent_id: deletes all .md files in MEMORY_DIR.
    - With agent_id: deletes only entries in the matching namespace subdirectory.
    - With include_qdrant_collection=True: also deletes the matching Qdrant
      collection (agent_id required).
    """
    flushed_entries  = 0
    flushed_sessions = 0
    flushed_qdrant   = False

    if req.agent_id:
        # Flush a single namespace
        ns_dir = MEMORY_DIR / req.agent_id
        if ns_dir.exists() and ns_dir.is_dir():
            for mf in list(ns_dir.rglob("*.md")):
                try:
                    mf.unlink()
                    flushed_entries += 1
                except OSError as exc:
                    logger.warning("Failed to delete %s: %s", mf, exc)
        else:
            # Also check flat files with the agent_id prefix in the root dir
            for mf in MEMORY_DIR.glob(f"{req.agent_id}*.md"):
                try:
                    mf.unlink()
                    flushed_entries += 1
                except OSError as exc:
                    logger.warning("Failed to delete %s: %s", mf, exc)

        if req.include_qdrant_collection:
            flushed_qdrant = await _qdrant_delete_collection(req.agent_id)
            if not flushed_qdrant:
                logger.warning("Qdrant collection '%s' could not be deleted (may not exist)", req.agent_id)
    else:
        # Flush all memory entries across all namespaces
        for mf in _memory_files():
            try:
                mf.unlink()
                flushed_entries += 1
            except OSError as exc:
                logger.warning("Failed to delete %s: %s", mf, exc)

    logger.info("Flush complete: %d entries, %d sessions, qdrant=%s",
                flushed_entries, flushed_sessions, flushed_qdrant)

    return {
        "flushed_entries":           flushed_entries,
        "flushed_sessions":          flushed_sessions,
        "flushed_qdrant_collection": flushed_qdrant,
        "agent_id":                  req.agent_id,
    }


@app.get("/sessions")
async def sessions(limit: int = 50):
    """Return the most recent session records (newest first)."""
    sess_files = _session_files()

    # Sort newest-first by mtime
    sess_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    sess_files = sess_files[:limit]

    records = []
    for sf in sess_files:
        try:
            data = json.loads(sf.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
        records.append({
            "id":      data.get("id", sf.stem),
            "started": data.get("started") or data.get("start"),
            "ended":   data.get("ended")   or data.get("end"),
            "goal":    data.get("goal")    or data.get("task") or "",
            "tools":   len(data.get("tool_calls", [])),
            "summary": data.get("summary", ""),
        })

    return {"sessions": records, "total": len(_session_files())}


@app.post("/prune")
async def prune():
    """
    Apply the retention policy immediately.

    - Removes session files older than SESSION_TTL_DAYS.
    - Removes the lowest-importance memory entries when the count exceeds
      MAX_ENTRIES, keeping entries with importance >= PRUNE_THRESHOLD.
    """
    pruned_sessions = 0
    pruned_entries  = 0

    # ── Prune sessions by age ──────────────────────────────────────────────────
    if SESSION_TTL_DAYS > 0:
        cutoff = time.time() - SESSION_TTL_DAYS * 86400
        for sf in _session_files():
            try:
                if sf.stat().st_mtime < cutoff:
                    sf.unlink()
                    pruned_sessions += 1
            except OSError as exc:
                logger.warning("Failed to prune session %s: %s", sf, exc)

    # ── Prune memory entries by importance ─────────────────────────────────────
    mem_files = _memory_files()
    if len(mem_files) > MAX_ENTRIES:
        # Score all entries; delete the lowest-importance ones first
        scored: list[tuple[float, Path]] = []
        for mf in mem_files:
            try:
                text = mf.read_text(encoding="utf-8")
                scored.append((_parse_importance(text), mf))
            except OSError:
                scored.append((0.0, mf))

        # Sort ascending by importance (lowest first)
        scored.sort(key=lambda t: t[0])
        excess = len(mem_files) - MAX_ENTRIES

        for importance, mf in scored[:excess]:
            if importance < PRUNE_THRESHOLD:
                try:
                    mf.unlink()
                    pruned_entries += 1
                except OSError as exc:
                    logger.warning("Failed to prune %s: %s", mf, exc)

    logger.info("Prune complete: %d sessions, %d memory entries removed",
                pruned_sessions, pruned_entries)

    return {
        "pruned_sessions": pruned_sessions,
        "pruned_entries":  pruned_entries,
        "config": {
            "session_ttl_days": SESSION_TTL_DAYS,
            "max_entries":      MAX_ENTRIES,
            "prune_threshold":  PRUNE_THRESHOLD,
        },
    }


# ── Entrypoint ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
