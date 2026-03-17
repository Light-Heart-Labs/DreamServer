#!/usr/bin/env python3
"""
M3: API Privacy Shield - HTTP Proxy (Dream Server Integration)
FastAPI-based proxy with connection pooling and PII caching.
"""

import os
import time
import httpx
import secrets
import hashlib
from fastapi import FastAPI, Request, Response, Depends, HTTPException, Security
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from functools import lru_cache
import uvicorn
from cachetools import TTLCache

from pii_scrubber import PrivacyShield
from key_management import resolve_shield_api_key

# Security: API Key Authentication
DEFAULT_KEY_PATH = os.environ.get("SHIELD_API_KEY_PATH", "/data/shield_api_key")
SHIELD_API_KEY = resolve_shield_api_key(os.environ.get("SHIELD_API_KEY"), DEFAULT_KEY_PATH)

security_scheme = HTTPBearer()

async def verify_api_key(credentials: HTTPAuthorizationCredentials = Security(security_scheme)):
    """Verify API key for protected endpoints."""
    if not secrets.compare_digest(credentials.credentials, SHIELD_API_KEY):
        raise HTTPException(status_code=403, detail="Invalid API key.")
    return credentials.credentials


app = FastAPI(title="API Privacy Shield", version="0.2.0")

# Configuration from environment
TARGET_API_BASE = os.getenv("TARGET_API_URL", "http://llama-server:8080/v1")
TARGET_API_KEY = os.getenv("TARGET_API_KEY", "not-needed")
PORT = int(os.getenv("SHIELD_PORT", "8085"))
CACHE_ENABLED = os.getenv("PII_CACHE_ENABLED", "true").lower() == "true"
CACHE_SIZE = int(os.getenv("PII_CACHE_SIZE", "1000"))
CACHE_TTL = int(os.getenv("PII_CACHE_TTL", "300"))

# Connection pool for better performance
http_client = httpx.AsyncClient(
    limits=httpx.Limits(max_keepalive_connections=100, max_connections=200),
    timeout=httpx.Timeout(60.0, connect=5.0)
)

# Session store (TTL cache with auto-eviction to prevent unbounded growth)
# maxsize=10000 sessions, ttl=3600 seconds (1 hour)
SESSION_MAXSIZE = int(os.getenv("SHIELD_SESSION_MAXSIZE", "10000"))
SESSION_TTL = int(os.getenv("SHIELD_SESSION_TTL", "3600"))
sessions = TTLCache(maxsize=SESSION_MAXSIZE, ttl=SESSION_TTL)


class CachedPrivacyShield(PrivacyShield):
    """PrivacyShield with LRU cache for PII patterns."""

    def __init__(self, backend_client=None):
        super().__init__(backend_client)
        if CACHE_ENABLED:
            self._scrub_cached = lru_cache(maxsize=CACHE_SIZE)(self._scrub_impl)

    def _scrub_impl(self, text: str) -> str:
        """Internal scrub implementation."""
        return self.detector.scrub(text)

    def scrub(self, text: str) -> str:
        """Scrub with optional caching."""
        if CACHE_ENABLED and len(text) < 1000:  # Only cache small texts
            return self._scrub_cached(text)
        return self._scrub_impl(text)


def get_session(request: Request) -> CachedPrivacyShield:
    """Get or create session-specific PrivacyShield."""
    # Use Authorization header or IP as session key
    auth = request.headers.get("Authorization", "")
    # Use SHA256 for deterministic, stable session keying (hash() is not deterministic across restarts)
    if auth:
        session_key = hashlib.sha256(auth.encode()).hexdigest()
    else:
        client_info = str(request.client.host if request.client else "default")
        session_key = hashlib.sha256(client_info.encode()).hexdigest()

    if session_key not in sessions:
        sessions[session_key] = CachedPrivacyShield()

    return sessions[session_key]


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "service": "api-privacy-shield",
        "version": "0.2.0",
        "target_api": TARGET_API_BASE,
        "cache_enabled": CACHE_ENABLED,
        "active_sessions": len(sessions)
    }


@app.get("/stats")
async def stats():
    """Session statistics."""
    total_pii = sum(
        s.detector.get_stats()['unique_pii_count']
        for s in sessions.values()
    )
    return {
        "active_sessions": len(sessions),
        "total_pii_scrubbed": total_pii,
        "cache_enabled": CACHE_ENABLED,
        "cache_size": CACHE_SIZE
    }


@app.post("/{path:path}", dependencies=[Depends(verify_api_key)])
@app.get("/{path:path}", dependencies=[Depends(verify_api_key)])
async def proxy(request: Request, path: str):
    """
    Proxy endpoint that scrubs PII from requests and restores in responses.
    """
    start_time = time.time()
    shield = get_session(request)

    # Read and process request body
    body = await request.body()
    body_str = body.decode('utf-8') if body else ""

    # Scrub PII from request
    scrubbed_body, metadata = shield.process_request(body_str)

    # Forward to target API
    target_url = f"{TARGET_API_BASE}/{path}"
    headers = {k: v for k, v in request.headers.items() if k.lower() not in ('host', 'content-length')}

    # Set host header for target
    host = TARGET_API_BASE.split("//")[-1].split("/")[0]
    headers["host"] = host

    # Use target API key if configured
    if TARGET_API_KEY and TARGET_API_KEY != "not-needed":
        headers["Authorization"] = f"Bearer {TARGET_API_KEY}"

    try:
        if request.method == "POST":
            resp = await http_client.post(
                target_url,
                headers=headers,
                content=scrubbed_body.encode('utf-8')
            )
        else:
            resp = await http_client.get(
                target_url,
                headers=headers
            )

        # Read response
        response_body = resp.content.decode('utf-8')

        # Restore PII in response
        restored_body = shield.process_response(response_body)

        # Calculate overhead
        overhead_ms = (time.time() - start_time) * 1000

        # Add privacy headers
        response_headers = {
            "X-Privacy-Shield": "active",
            "X-PII-Scrubbed": str(metadata.get('pii_count', 0)),
            "X-Processing-Time-Ms": f"{overhead_ms:.2f}",
            "Content-Type": resp.headers.get("Content-Type", "application/json")
        }

        return Response(
            content=restored_body,
            status_code=resp.status_code,
            headers=response_headers
        )

    except httpx.TimeoutException:
        return JSONResponse(
            status_code=504,
            content={"error": "Gateway timeout", "shield": "active"}
        )
    except Exception as e:
        import logging
        import re
        logger = logging.getLogger("privacy-shield")
        # Sanitize error message to prevent PII token leakage
        error_str = str(e)
        # Strip PII tokens and their original values
        error_str = re.sub(r'<PII_\w+_\w{12}>', '[REDACTED]', error_str)
        error_str = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL]', error_str)
        logger.error(f"Privacy shield error: {error_str}")
        return JSONResponse(
            status_code=500,
            content={"error": "Privacy check failed", "shield": "active"}
        )


@app.on_event("shutdown")
async def shutdown():
    """Cleanup on shutdown."""
    await http_client.aclose()


if __name__ == "__main__":
    print(f"🔒 API Privacy Shield starting on port {PORT}")
    print(f"📡 Proxying to: {TARGET_API_BASE}")
    print(f"💾 Cache: {'enabled' if CACHE_ENABLED else 'disabled'} (size={CACHE_SIZE}, ttl={CACHE_TTL}s)")
    print(f"🧪 Test with: curl http://localhost:{PORT}/health")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
