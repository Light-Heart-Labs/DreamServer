#!/usr/bin/env python3
"""
APE — Agent Policy Engine
Dream Server extension: policy gateway for autonomous agent tool calls.

This is a lightweight Python reimplementation of the APE formal policy engine.
The full engine — including Rocq/Coq formal proofs of conscience predicates G1-G6,
trust algebra, and neurosymbolic runtime — is open-source under AGPL v3:
  https://github.com/latentcollapse/HLX_research_language

Provides:
  POST /verify        — evaluate an action against the active policy
  GET  /audit         — tail the audit log
  GET  /policy        — return the active policy (redacted)
  GET  /health        — liveness probe
  GET  /metrics       — decision counters

Intent classes:
  ReadFile            — read/cat/head/tail operations
  WriteFile           — write/append/create operations
  ExecuteCommand      — shell exec, python3, node, etc.
  NetworkFetch        — curl, wget, web_fetch
  SpawnAgent          — sub-agent creation
  Other               — anything else

Default policy (policy.yaml):
  - ExecuteCommand: allowlist of safe commands; deny everything else
  - WriteFile: deny writes outside /home/node/.openclaw/workspace
  - Rate limit: 60 requests/minute per session
  - All decisions logged to audit.jsonl (append-only)
"""

import asyncio
import json
import logging
import os
import re
import secrets
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import yaml
from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ── Config ──────────────────────────────────────────────────────────────────

POLICY_FILE = Path(os.environ.get("APE_POLICY_FILE", "/config/policy.yaml"))
AUDIT_LOG   = Path(os.environ.get("APE_AUDIT_LOG",   "/data/ape/audit.jsonl"))
RATE_LIMIT  = int(os.environ.get("APE_RATE_LIMIT_RPM", "60"))
STRICT_MODE = os.environ.get("APE_STRICT_MODE", "false").lower() == "true"
_API_KEY = os.environ.get("APE_API_KEY", "")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("ape")

API_KEY = _API_KEY or secrets.token_hex(32)

if not _API_KEY:
    logger.warning(f"APE_API_KEY not set - auto-generated key: {API_KEY[:16]}... (set APE_API_KEY env var to use a fixed key)")

if not STRICT_MODE:
    logger.warning("WARNING: APE is running in advisory mode. Tool calls are logged but NOT blocked. Set APE_STRICT_MODE=true to enforce policies.")

# ── Policy ───────────────────────────────────────────────────────────────────

DEFAULT_POLICY = {
    "version": 1,
    "intents": {
        "ExecuteCommand": {
            "mode": "allowlist",
            "allowed": ["ls", "cat", "grep", "find", "head", "tail", "wc",
                        "echo", "pwd", "env", "which"],
            "deny_patterns": [
                r"rm\s+-rf",      # recursive delete
                r">\s*/dev/sd",   # disk writes
                r"curl.*\|.*sh",  # curl pipe to shell
                r"wget.*\|.*sh",  # wget pipe to shell
                r"chmod\s+[0-7]*7[0-7]*\s+/",  # chmod 777 /...
            ],
        },
        "WriteFile": {
            "mode": "path_guard",
            "allowed_paths": [
                "/home/node/.openclaw/workspace",
                "/tmp",
            ],
        },
        "ReadFile":     {"mode": "allow"},
        "NetworkFetch": {"mode": "allow"},
        "SpawnAgent":   {"mode": "allow"},
        "Other":        {"mode": "allow"},
    },
    "rate_limit": {"requests_per_minute": RATE_LIMIT},
}

_policy: dict = DEFAULT_POLICY
_policy_mtime: float = 0.0


def load_policy() -> dict:
    global _policy, _policy_mtime
    if not POLICY_FILE.exists():
        return DEFAULT_POLICY
    try:
        mtime = POLICY_FILE.stat().st_mtime
        if mtime == _policy_mtime:
            return _policy
        with open(POLICY_FILE) as f:
            loaded = yaml.safe_load(f)
        if isinstance(loaded, dict):
            _policy = loaded
            _policy_mtime = mtime
            logger.info("Policy reloaded from %s", POLICY_FILE)
    except Exception as e:
        logger.warning("Failed to reload policy: %s", e)
    return _policy


# ── Rate limiting ─────────────────────────────────────────────────────────────

_session_request_times: dict[str, deque] = {}


def check_rate_limit(policy: dict, session_id: Optional[str]) -> bool:
    """Return True if the request is within rate limits (per session)."""
    limit = policy.get("rate_limit", {}).get("requests_per_minute", RATE_LIMIT)
    key = session_id or "_global"
    if key not in _session_request_times:
        _session_request_times[key] = deque()
    times = _session_request_times[key]
    now = time.monotonic()
    cutoff = now - 60.0
    while times and times[0] < cutoff:
        times.popleft()
    if len(times) >= limit:
        return False
    times.append(now)
    return True


# ── Intent classification ─────────────────────────────────────────────────────

_EXEC_VERBS = {"exec", "run", "execute", "shell", "bash", "sh", "cmd"}
_READ_VERBS  = {"read", "cat", "head", "tail", "get_file", "read_file", "view"}
_WRITE_VERBS = {"write", "create", "append", "write_file", "save", "put"}
_NET_VERBS   = {"fetch", "curl", "wget", "web_fetch", "http_get", "request"}
_SPAWN_VERBS = {"spawn", "agent", "sub_agent", "subagent", "delegate"}


def classify_intent(tool_name: str, args: dict) -> str:
    tokens = set(re.split(r"[^a-z0-9]", tool_name.lower()))
    if tokens & _EXEC_VERBS:
        return "ExecuteCommand"
    if tokens & _READ_VERBS:
        return "ReadFile"
    if tokens & _WRITE_VERBS:
        return "WriteFile"
    if tokens & _NET_VERBS:
        return "NetworkFetch"
    if tokens & _SPAWN_VERBS:
        return "SpawnAgent"
    # Infer from args
    if "command" in args or "cmd" in args:
        return "ExecuteCommand"
    if "path" in args or "file" in args:
        return "ReadFile" if args.get("mode", "r") == "r" else "WriteFile"
    if "url" in args:
        return "NetworkFetch"
    return "Other"


# ── Policy evaluation ─────────────────────────────────────────────────────────

def evaluate(intent: str, tool_name: str, args: dict, policy: dict) -> tuple[bool, str]:
    """Return (allowed, reason)."""
    intent_policy = policy.get("intents", {}).get(intent, {"mode": "allow"})
    mode = intent_policy.get("mode", "allow")

    if mode == "allow":
        return True, "allowed by policy"

    if mode == "deny":
        return False, f"{intent} is denied by policy"

    if mode == "allowlist":
        command = args.get("command", args.get("cmd", ""))
        if not command:
            return False, "empty command denied"
        # Check command base name
        base = command.strip().split()[0] if command.strip() else ""
        allowed = intent_policy.get("allowed", [])
        if base not in allowed:
            return False, f"command '{base}' not in allowlist"
        # Check deny patterns
        for pattern in intent_policy.get("deny_patterns", []):
            if re.search(pattern, command):
                return False, f"command matches deny pattern: {pattern}"
        return True, f"command '{base}' is in allowlist"

    if mode == "path_guard":
        path = str(args.get("path", args.get("file", args.get("filename", ""))))
        if not path:
            return True, "no path specified"
        real = os.path.realpath(path)
        allowed_paths = intent_policy.get("allowed_paths", [])
        if any(real == p or real.startswith(p.rstrip("/") + "/") for p in allowed_paths):
            return True, "path is within allowed zone"
        return False, f"write to '{real}' is outside allowed paths"

    return True, f"unknown mode '{mode}', defaulting to allow"


# ── Audit log ─────────────────────────────────────────────────────────────────

def write_audit(entry: dict) -> None:
    try:
        AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)
        with open(AUDIT_LOG, "a") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception as e:
        logger.warning("Audit write failed: %s", e)


_decision_counts = {"allowed": 0, "denied": 0, "rate_limited": 0}


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="APE — Agent Policy Engine",
    version="1.0.0",
    description="Policy gateway for Dream Server autonomous agents",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:3000",
                   "http://127.0.0.1:3001", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-API-Key"],
)


async def verify_api_key(x_api_key: Optional[str] = Header(None)):
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return True


class VerifyRequest(BaseModel):
    tool_name: str
    args: dict[str, Any] = {}
    session_id: Optional[str] = None
    agent_id: Optional[str] = None


class VerifyResponse(BaseModel):
    allowed: bool
    reason: str
    intent: str
    decision_id: str


@app.get("/health")
async def health():
    return {"status": "ok", "strict_mode": STRICT_MODE,
            "timestamp": datetime.now(timezone.utc).isoformat()}


@app.post("/verify", response_model=VerifyResponse)
async def verify(req: VerifyRequest, request: Request):
    await verify_api_key(request)
    policy = load_policy()
    decision_id = f"{int(time.time() * 1000)}-{secrets.token_hex(8)}"

    # Rate limit check
    if not check_rate_limit(policy, req.session_id):
        _decision_counts["rate_limited"] += 1
        entry = {
            "id": decision_id,
            "ts": datetime.now(timezone.utc).isoformat(),
            "tool": req.tool_name,
            "intent": "unknown",
            "allowed": False,
            "reason": "rate limit exceeded",
            "session": req.session_id,
            "agent": req.agent_id,
            "client": request.client.host if request.client else None,
        }
        write_audit(entry)
        if STRICT_MODE:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
        return VerifyResponse(allowed=False, reason="rate limit exceeded",
                              intent="unknown", decision_id=decision_id)

    intent = classify_intent(req.tool_name, req.args)
    allowed, reason = evaluate(intent, req.tool_name, req.args, policy)

    _decision_counts["allowed" if allowed else "denied"] += 1

    entry = {
        "id": decision_id,
        "ts": datetime.now(timezone.utc).isoformat(),
        "tool": req.tool_name,
        "intent": intent,
        "allowed": allowed,
        "reason": reason,
        "args_keys": list(req.args.keys()),
        "session": req.session_id,
        "agent": req.agent_id,
        "client": request.client.host if request.client else None,
    }
    write_audit(entry)
    logger.info("%s tool=%s intent=%s allowed=%s reason=%s",
                decision_id, req.tool_name, intent, allowed, reason)

    if not allowed and STRICT_MODE:
        raise HTTPException(status_code=403, detail=reason)

    return VerifyResponse(allowed=allowed, reason=reason,
                          intent=intent, decision_id=decision_id)


@app.get("/audit")
async def audit(last_n: int = 50, x_api_key: Optional[str] = Header(None)):
    """Return the last N audit log entries."""
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")
    if not AUDIT_LOG.exists():
        return {"entries": []}
    try:
        entries = []
        total_lines = 0
        with open(AUDIT_LOG, "rb") as f:
            f.seek(0, 2)
            file_size = f.tell()
            if file_size == 0:
                return {"entries": [], "total": 0}
            chunk_size = 8192
            position = file_size
            lines_found = 0
            while position > 0 and lines_found < last_n + 1:
                chunk_start = max(0, position - chunk_size)
                f.seek(chunk_start)
                chunk = f.read(position - chunk_start)
                lines_found += chunk.count(b'\n')
                position = chunk_start
            f.seek(position)
            for line in f:
                total_lines += 1
                if line.strip():
                    if len(entries) >= last_n:
                        entries.pop(0)
                    entries.append(json.loads(line))
        return {"entries": entries, "total": total_lines}
    except Exception as e:
        return {"entries": [], "error": str(e)}


@app.get("/policy")
async def policy():
    """Return the active policy (args not shown for security)."""
    p = load_policy()
    return {"version": p.get("version", 1),
            "intents": list(p.get("intents", {}).keys()),
            "rate_limit": p.get("rate_limit", {}),
            "strict_mode": STRICT_MODE}


@app.get("/metrics")
async def metrics():
    return {"decisions": _decision_counts,
            "total": sum(_decision_counts.values())}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("APE_PORT", "7890"))
    uvicorn.run(app, host="127.0.0.1", port=port)
