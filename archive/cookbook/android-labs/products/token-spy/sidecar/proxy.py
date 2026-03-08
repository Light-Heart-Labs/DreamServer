"""
Token Spy Sidecar — Transparent LLM API Proxy

Minimal proxy service that forwards requests to upstream LLM providers
while logging usage metrics to the database. Designed to run as a
sidecar container alongside the main application.

Environment Variables:
    AGENT_NAME: Name of the agent using this sidecar (default: unknown)
    API_PROVIDER: Provider type - anthropic, moonshot, openai (default: anthropic)
    UPSTREAM_BASE_URL: Base URL for the upstream API
    UPSTREAM_API_KEY: API key for the upstream service
    DATABASE_URL: Database connection string (PostgreSQL/SQLite)
"""

import importlib.util
import json
import logging
import os
import sys
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

# Import Token Spy components (relative imports work when sidecar is the package)
from .db_backend import DatabaseBackend, get_db, UsageEntry
from .providers import ProviderRegistry, get_provider, get_providers, get_provider_or_none, AnthropicProvider, OpenAICompatibleProvider

# Import Phase 4 auth middleware
from .auth_middleware import auth_middleware, get_upstream_headers

# Import provider keys resolver
from .provider_keys import get_upstream_api_key, get_provider_for_model

# Import dashboard API to mount as sub-application
# Note: This imports the api module which has all middleware properly configured
api_path = os.environ.get("TOKEN_SPY_API_PATH", "/app/sidecar/api.py")
api_path = os.path.abspath(api_path)

# Security: Validate path is within allowed directories
allowed_dirs = ["/app", "/opt/token-spy"]
if not any(api_path.startswith(d) for d in allowed_dirs):
    raise ValueError(
        f"TOKEN_SPY_API_PATH must be within allowed directories: {allowed_dirs}. "
        f"Got: {api_path}"
    )

# Must be a .py file
if not api_path.endswith(".py"):
    raise ValueError(f"TOKEN_SPY_API_PATH must be a .py file: {api_path}")

# Validate API path exists before attempting import
if not os.path.exists(api_path):
    raise FileNotFoundError(
        f"TOKEN_SPY_API_PATH not found: {api_path}. "
        "Set TOKEN_SPY_API_PATH environment variable or ensure /app/sidecar/api.py exists."
    )

# Determine the sidecar directory from api_path
api_dir = os.path.dirname(api_path)
sidecar_dir = os.path.dirname(api_dir)

# Ensure sidecar_dir is in sys.path so relative imports work
if sidecar_dir not in sys.path:
    sys.path.insert(0, sidecar_dir)

try:
    # Import as module from file path
    spec = importlib.util.spec_from_file_location("sidecar.api", api_path)
    api_module = importlib.util.module_from_spec(spec)
    sys.modules["sidecar.api"] = api_module
    spec.loader.exec_module(api_module)
    api_app = api_module.app
except Exception as e:
    raise RuntimeError(
        f"Failed to load API module from {api_path}: {e}. "
        "Ensure all required files are in place and imports are correct."
    ) from e

# ── Configuration ────────────────────────────────────────────────────────────

# Validate required environment variables
# If DATABASE_URL is set (with embedded credentials), POSTGRES_PASSWORD is not required
db_url = os.environ.get("DATABASE_URL", "")
if not db_url and not os.environ.get("POSTGRES_PASSWORD"):
    raise RuntimeError(
        "DATABASE_URL environment variable is not set! "
        "Copy .env.example to .env and configure your database. "
        "See README.md for setup instructions."
    )

AGENT_NAME = os.environ.get("AGENT_NAME", "unknown")
API_PROVIDER = os.environ.get("API_PROVIDER", "anthropic").lower()
UPSTREAM_BASE_URL = os.environ.get("UPSTREAM_BASE_URL", "")
UPSTREAM_API_KEY = os.environ.get("UPSTREAM_API_KEY", "")

# Backwards compatibility for internal deployment
if not UPSTREAM_BASE_URL:
    if API_PROVIDER == "anthropic":
        UPSTREAM_BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
    elif API_PROVIDER == "moonshot":
        UPSTREAM_BASE_URL = os.environ.get("MOONSHOT_BASE_URL", "https://api.moonshot.ai")
    elif API_PROVIDER == "openai":
        UPSTREAM_BASE_URL = "https://api.openai.com"
    else:
        UPSTREAM_BASE_URL = "https://api.anthropic.com"

# Provider instances — initialized once for efficiency
_http_clients: dict[str, httpx.AsyncClient] = {}
_db_backend: DatabaseBackend | None = None

PROVIDER_BASE_URLS = {
    "anthropic": "https://api.anthropic.com",
    "openai": "https://api.openai.com",
    "google": "https://generativelanguage.googleapis.com",
    "moonshot": "https://api.moonshot.ai",
}


def get_http_client(provider: str = "") -> httpx.AsyncClient:
    """Get or create HTTP client for the given provider.

    When called without a provider, uses the default UPSTREAM_BASE_URL.
    When called with a provider name, routes to the correct API endpoint.
    """
    if not provider:
        provider = "_default"

    base_url = PROVIDER_BASE_URLS.get(provider, UPSTREAM_BASE_URL) if provider != "_default" else UPSTREAM_BASE_URL

    if provider not in _http_clients or _http_clients[provider].is_closed:
        _http_clients[provider] = httpx.AsyncClient(
            base_url=base_url,
            timeout=httpx.Timeout(connect=10.0, read=300.0, write=30.0, pool=30.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http_clients[provider]


def get_database() -> DatabaseBackend:
    """Get the database backend."""
    global _db_backend
    if _db_backend is None:
        _db_backend = get_db()
    return _db_backend


# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format=f"%(asctime)s [{AGENT_NAME}] %(levelname)s %(message)s",
)
log = logging.getLogger("token-spy-sidecar")

# ── Cost Calculation ─────────────────────────────────────────────────────────

def estimate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
    cache_read: int,
    cache_write: int,
    provider_type: str = "anthropic"
) -> float:
    """Estimate USD cost based on model and token counts."""
    usage = {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cache_read_tokens": cache_read,
        "cache_write_tokens": cache_write,
    }
    
    provider = get_provider_or_none(provider_type)
    if provider is None:
        log.warning(f"Unknown provider: {provider_type}, returning 0 cost")
        return 0.0
    
    return provider.calculate_cost(usage, model)


# ── FastAPI App ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager."""
    # Startup
    db = get_database()
    db.init_db()
    app.state.db_backend = db
    log.info(f"Token Spy sidecar started for agent={AGENT_NAME}, provider={API_PROVIDER}")
    yield
    # Shutdown
    for c in _http_clients.values():
        if c and not c.is_closed:
            await c.aclose()
    log.info("Token Spy sidecar shutting down")


app = FastAPI(
    title="Token Spy Sidecar",
    description="Transparent LLM API proxy with usage tracking",
    version="2.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

# Phase 4: Add auth middleware
app.middleware("http")(auth_middleware)


# ── Health Check ─────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "agent": AGENT_NAME,
        "provider": API_PROVIDER,
    }


# ── Proxy Endpoints ───────────────────────────────────────────────────────────

@app.post("/v1/messages")
async def proxy_messages(request: Request):
    """Transparent proxy for Anthropic /v1/messages with metrics capture."""
    start = time.time()
    
    raw_body = await request.body()
    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError:
        body = {}
    
    model = body.get("model", "unknown")
    tools = body.get("tools", [])
    is_streaming = body.get("stream", False)
    
    # Analyze request using provider plugin
    provider = get_provider_or_none("anthropic")
    if provider is None:
        log.error("Provider 'anthropic' not registered - unable to analyze request")
        analysis = {}
    else:
        analysis = provider.analyze_request(body)
    
    sys_analysis = {k: v for k, v in analysis.items() if k.startswith(("system_", "base_", "workspace_", "skill_"))}
    msg_analysis = {k: v for k, v in analysis.items() if k.startswith(("message_", "user_", "assistant_", "conversation_"))}
    
    log.info(
        f"→ {model} | msgs={msg_analysis.get('message_count', 0)} | "
        f"sys={sys_analysis.get('system_prompt_total_chars', 0)}ch | "
        f"tools={len(tools)} | stream={is_streaming}"
    )
    
    # Build upstream headers (exclude auth — replaced with provider key below)
    forward_headers = {}
    for key in ("anthropic-version", "content-type", "anthropic-beta",
                "anthropic-dangerous-direct-browser-access", "user-agent", "x-app",
                "accept"):
        val = request.headers.get(key)
        if val:
            forward_headers[key] = val

    # Phase 4: Use provider keys resolver instead of direct UPSTREAM_API_KEY
    tenant_id = "default"
    if hasattr(request.state, "tenant") and hasattr(request.state.tenant, "tenant_id"):
        tenant_id = request.state.tenant.tenant_id

    provider_name = "anthropic"  # Default for /v1/messages
    upstream_key = await get_upstream_api_key(tenant_id, provider_name, "UPSTREAM_API_KEY")

    if upstream_key:
        forward_headers["x-api-key"] = upstream_key
    
    # Phase 4: Inject tenant attribution headers from auth middleware
    tenant_headers = get_upstream_headers(request)
    forward_headers.update(tenant_headers)
    
    client = get_http_client()
    
    if is_streaming:
        return await _handle_anthropic_streaming(
            client, raw_body, forward_headers, model, sys_analysis, msg_analysis,
            tools, start, request=request, endpoint="/v1/messages",
            provider=provider
        )
    else:
        return await _handle_anthropic_non_streaming(
            client, raw_body, forward_headers, model, sys_analysis, msg_analysis,
            tools, start, request=request
        )


@app.post("/v1/chat/completions")
async def proxy_chat_completions(request: Request):
    """Transparent proxy for OpenAI-compatible /v1/chat/completions."""
    start = time.time()
    
    raw_body = await request.body()
    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError:
        body = {}
    
    model = body.get("model", "unknown")
    tools = body.get("tools", [])
    is_streaming = body.get("stream", False)
    
    # Analyze request using provider plugin
    provider = get_provider_or_none("openai")
    
    # Rewrite request for provider compatibility
    if provider:
        body = provider.rewrite_request(body)
        raw_body = json.dumps(body, separators=(",", ":")).encode()
        
        analysis = provider.analyze_request(body)
    else:
        log.error("Provider 'openai' not registered - unable to process request")
        analysis = {}
    
    sys_analysis = {
        "system_prompt_total_chars": analysis.get("system_prompt_total_chars", 0),
        "base_prompt_chars": analysis.get("base_prompt_chars", 0),
    }
    msg_analysis = {
        "message_count": analysis.get("message_count", 0),
        "user_message_count": analysis.get("user_message_count", 0),
        "assistant_message_count": analysis.get("assistant_message_count", 0),
        "conversation_history_chars": analysis.get("conversation_history_chars", 0),
    }
    
    log.info(
        f"→ [openai] {model} | msgs={msg_analysis['message_count']} | "
        f"sys={sys_analysis['system_prompt_total_chars']}ch | "
        f"tools={len(tools)} | stream={is_streaming}"
    )
    
    forward_headers = {}
    for key in ("content-type", "accept", "user-agent"):
        val = request.headers.get(key)
        if val:
            forward_headers[key] = val

    # Phase 4: Use provider keys resolver instead of direct UPSTREAM_API_KEY
    tenant_id = "default"
    if hasattr(request.state, "tenant") and hasattr(request.state.tenant, "tenant_id"):
        tenant_id = request.state.tenant.tenant_id

    provider_name = get_provider_for_model(model)
    upstream_key = await get_upstream_api_key(tenant_id, provider_name, "UPSTREAM_API_KEY")

    if upstream_key:
        forward_headers["authorization"] = f"Bearer {upstream_key}"

    # Phase 4: Inject tenant attribution headers from auth middleware
    tenant_headers = get_upstream_headers(request)
    forward_headers.update(tenant_headers)

    client = get_http_client(provider_name)

    if is_streaming:
        return await _handle_openai_streaming(
            client, raw_body, forward_headers, model, sys_analysis, msg_analysis,
            tools, start, request=request, endpoint="/v1/chat/completions",
            provider=provider
        )
    else:
        return await _handle_openai_non_streaming(
            client, raw_body, forward_headers, model, sys_analysis, msg_analysis,
            tools, start, request=request
        )


# ── Anthropic Stream Handlers ─────────────────────────────────────────────────

async def _handle_anthropic_streaming(
    client, raw_body, headers, model, sys_analysis, msg_analysis, tools,
    start_time, request: Request = None, endpoint: str = "/v1/messages",
    provider=None
):
    """Stream Anthropic SSE response while capturing token metrics.

    Anthropic SSE format uses event: lines (message_start, content_block_delta,
    message_delta, message_stop) followed by data: lines with JSON payloads.
    Usage comes in message_start (input tokens, cache) and message_delta (output tokens).
    """
    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "stop_reason": None,
    }

    async def stream_and_capture():
        current_event = None
        try:
            # Send initial health chunk to establish connection
            yield "event: health\ndata: {\"status\":\"connected\"}\n\n"
            
            async with client.stream("POST", endpoint, content=raw_body, headers=headers) as upstream:
                if upstream.status_code >= 400:
                    error_body = b""
                    async for chunk in upstream.aiter_bytes():
                        error_body += chunk
                    log.error(f"Upstream returned {upstream.status_code}: {error_body[:500]}")
                    yield f"data: {json.dumps({'error': {'message': f'Upstream HTTP {upstream.status_code}', 'type': 'proxy_error'}})}\n\n"
                    return

                async for line in upstream.aiter_lines():
                    yield line + "\n"

                    stripped = line.strip()
                    if stripped.startswith("event:"):
                        current_event = stripped[6:].strip()
                        continue

                    if not stripped.startswith("data:"):
                        continue

                    data_str = stripped[5:].strip()
                    if not data_str or data_str == "[DONE]":
                        continue

                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    # message_start: input tokens and cache stats
                    if current_event == "message_start":
                        msg = data.get("message", {})
                        u = msg.get("usage", {})
                        if u:
                            usage["input_tokens"] = u.get("input_tokens", 0)
                            usage["cache_read_tokens"] = u.get("cache_read_input_tokens", 0)
                            usage["cache_write_tokens"] = u.get("cache_creation_input_tokens", 0)

                    # message_delta: output tokens and stop reason
                    elif current_event == "message_delta":
                        u = data.get("usage", {})
                        if u:
                            usage["output_tokens"] = u.get("output_tokens", 0)
                        delta = data.get("delta", {})
                        if delta.get("stop_reason"):
                            usage["stop_reason"] = delta["stop_reason"]

                    # message_stop: log the completed request
                    elif current_event == "message_stop":
                        _log_entry(model, sys_analysis, msg_analysis, tools, raw_body, usage, start_time, "anthropic", request)

        except httpx.HTTPStatusError as e:
            log.error(f"Upstream HTTP error: {e.response.status_code}")
            # Check if stream completed or was truncated before error
            if provider and usage["input_tokens"] > 0:
                try:
                    if not provider.is_stream_complete(current_event, {}):
                        log.warning("Stream ended without completion marker - possible truncation")
                except Exception:
                    pass  # Ignore errors from provider check during error handling
            yield f"data: {json.dumps({'error': {'message': str(e), 'type': 'proxy_error'}})}\n\n"
        except Exception as e:
            log.error(f"Proxy stream error: {e}")
            if usage["input_tokens"] > 0:
                # Check if stream completed or was truncated
                if provider:
                    try:
                        if not provider.is_stream_complete(current_event, {}):
                            log.warning("Stream ended without completion marker - possible truncation")
                    except Exception:
                        pass  # Ignore errors from provider check during error handling
                _log_entry(model, sys_analysis, msg_analysis, tools, raw_body, usage, start_time, "anthropic", request)

    return StreamingResponse(
        stream_and_capture(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _handle_anthropic_non_streaming(
    client, raw_body, headers, model, sys_analysis, msg_analysis, tools,
    start_time, request: Request = None
):
    """Handle non-streaming Anthropic /v1/messages request."""
    try:
        resp = await client.request("POST", "/v1/messages", content=raw_body, headers=headers)
    except Exception as e:
        log.error(f"Upstream request error: {e}")
        return JSONResponse(
            status_code=502,
            content={"error": {"message": str(e), "type": "proxy_error"}},
        )

    try:
        data = resp.json()
    except Exception:
        data = {}

    u = data.get("usage", {})
    usage = {
        "input_tokens": u.get("input_tokens", 0),
        "output_tokens": u.get("output_tokens", 0),
        "cache_read_tokens": u.get("cache_read_input_tokens", 0),
        "cache_write_tokens": u.get("cache_creation_input_tokens", 0),
        "stop_reason": data.get("stop_reason"),
    }

    _log_entry(model, sys_analysis, msg_analysis, tools, raw_body, usage, start_time, "anthropic", request)
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=dict(resp.headers),
    )


# ── OpenAI Stream Handlers ───────────────────────────────────────────────────

async def _handle_openai_streaming(
    client, raw_body, headers, model, sys_analysis, msg_analysis, tools,
    start_time, request: Request = None, endpoint: str = "/v1/chat/completions",
    provider=None
):
    """Stream OpenAI-compatible SSE response while capturing token metrics.

    OpenAI SSE format has only data: lines (no event: prefix).
    Usage comes in the final chunk (top-level "usage" or choices[0].usage for Moonshot/Kimi).
    Stop reason comes from choices[0].finish_reason.
    Stream ends with data: [DONE].
    """
    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "stop_reason": None,
    }

    async def stream_and_capture():
        try:
            # Send initial health chunk to establish connection
            yield "event: health\ndata: {\"status\":\"connected\"}\n\n"
            
            async with client.stream("POST", endpoint, content=raw_body, headers=headers) as upstream:
                if upstream.status_code >= 400:
                    error_body = b""
                    async for chunk in upstream.aiter_bytes():
                        error_body += chunk
                    log.error(f"Upstream returned {upstream.status_code}: {error_body[:500]}")
                    yield f"data: {json.dumps({'error': {'message': f'Upstream HTTP {upstream.status_code}', 'type': 'proxy_error'}})}\n\n"
                    return

                async for line in upstream.aiter_lines():
                    yield line + "\n"

                    stripped = line.strip()
                    if not stripped.startswith("data:"):
                        continue

                    data_str = stripped[5:].strip()
                    if data_str == "[DONE]":
                        _log_entry(model, sys_analysis, msg_analysis, tools, raw_body, usage, start_time, "openai", request)
                        continue

                    try:
                        data = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    # Check for usage — standard OpenAI puts it at top level
                    chunk_usage = data.get("usage")

                    # Moonshot/Kimi puts usage inside choices[0]
                    choices = data.get("choices", [])
                    if not chunk_usage and choices:
                        chunk_usage = choices[0].get("usage")

                    if chunk_usage:
                        usage["input_tokens"] = chunk_usage.get("prompt_tokens", 0)
                        usage["output_tokens"] = chunk_usage.get("completion_tokens", 0)
                        details = chunk_usage.get("prompt_tokens_details", {})
                        if details:
                            usage["cache_read_tokens"] = details.get("cached_tokens", 0)

                    # Check for stop reason
                    if choices:
                        finish = choices[0].get("finish_reason")
                        if finish:
                            usage["stop_reason"] = finish

        except httpx.HTTPStatusError as e:
            log.error(f"Upstream HTTP error: {e.response.status_code}")
            # Check if stream completed or was truncated before error
            if provider and usage["input_tokens"] > 0 and not provider.is_stream_complete(None, {}):
                log.warning("Stream ended without completion marker - possible truncation")
            yield f"data: {json.dumps({'error': {'message': str(e), 'type': 'proxy_error'}})}\n\n"
        except Exception as e:
            log.error(f"Proxy stream error: {e}")
            if provider and usage["input_tokens"] > 0:
                # Check if stream completed or was truncated
                if not provider.is_stream_complete(None, {}):
                    log.warning("Stream ended without completion marker - possible truncation")
                _log_entry(model, sys_analysis, msg_analysis, tools, raw_body, usage, start_time, "openai", request)

    return StreamingResponse(
        stream_and_capture(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _handle_openai_non_streaming(
    client, raw_body, headers, model, sys_analysis, msg_analysis, tools,
    start_time, request: Request = None
):
    """Handle non-streaming OpenAI-compatible /v1/chat/completions request."""
    try:
        resp = await client.request("POST", "/v1/chat/completions", content=raw_body, headers=headers)
    except Exception as e:
        log.error(f"Upstream request error: {e}")
        return JSONResponse(
            status_code=502,
            content={"error": {"message": str(e), "type": "proxy_error"}},
        )

    try:
        data = resp.json()
    except Exception:
        data = {}

    u = data.get("usage", {})
    choices = data.get("choices", [])
    stop_reason = choices[0].get("finish_reason") if choices else None

    usage = {
        "input_tokens": u.get("prompt_tokens", 0),
        "output_tokens": u.get("completion_tokens", 0),
        "cache_read_tokens": u.get("prompt_tokens_details", {}).get("cached_tokens", 0),
        "cache_write_tokens": 0,
        "stop_reason": stop_reason,
    }

    _log_entry(model, sys_analysis, msg_analysis, tools, raw_body, usage, start_time, "openai", request)
    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=dict(resp.headers),
    )


# ── Logging ───────────────────────────────────────────────────────────────────

def _log_entry(model, sys_analysis, msg_analysis, tools, raw_body, usage, start_time, provider_type: str, request: Request = None):
    """Write a usage entry to the database."""
    duration_ms = int((time.time() - start_time) * 1000)
    cost = estimate_cost(
        model,
        usage["input_tokens"],
        usage["output_tokens"],
        usage["cache_read_tokens"],
        usage["cache_write_tokens"],
        provider_type=provider_type,
    )

    # Build tenant context
    tenant_id = "default"
    api_key_prefix = None
    api_key_name = None
    if request and hasattr(request.state, "tenant"):
        tenant = request.state.tenant
        tenant_id = tenant.tenant_id
        if tenant.api_key:
            api_key_prefix = tenant.api_key.key_prefix
            api_key_name = getattr(tenant.api_key, "name", None)

    import uuid
    entry = UsageEntry(
        session_id=None,
        request_id=str(uuid.uuid4())[:16],
        provider=provider_type,
        model=model,
        api_key_prefix=api_key_prefix,
        tenant_id=tenant_id,
        prompt_tokens=usage["input_tokens"],
        completion_tokens=usage["output_tokens"],
        total_tokens=usage["input_tokens"] + usage["output_tokens"],
        prompt_cost=0.0,
        completion_cost=0.0,
        total_cost=round(cost, 6),
        latency_ms=duration_ms,
        status_code=200,
        finish_reason=usage.get("stop_reason"),
        system_prompt_length=sys_analysis.get("system_prompt_total_chars"),
        api_key_name=api_key_name,
    )

    try:
        db = get_database()
        db.log_usage(entry)
        log.info(
            f"← {model} | in={usage['input_tokens']} out={usage['output_tokens']} "
            f"cache_r={usage['cache_read_tokens']} cache_w={usage['cache_write_tokens']} | "
            f"${cost:.4f} | {duration_ms}ms"
        )
    except Exception as e:
        log.error(f"Failed to log usage: {e}")


# ── Mount Dashboard API ───────────────────────────────────────────────────────
# The api.py app has all dashboard routes, middleware (CORS, rate limiting, audit),
# and organization management. Mounting it here makes both available from one container.
app.mount("/api", api_app)
log.info("Dashboard API mounted at /api")


# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "9110"))
    uvicorn.run(app, host="0.0.0.0", port=port)
