"""
Request/response middleware for Dream Server Dashboard API.
- Request timing (X-Response-Time header)
- Request ID for tracing
- Request count for /api/metrics
"""

import time
import uuid
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


class RequestTimingMiddleware(BaseHTTPMiddleware):
    """Add X-Response-Time header, request ID, and increment metrics counter."""

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())[:8]
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        response.headers["X-Response-Time"] = f"{elapsed_ms:.1f}ms"
        response.headers["X-Request-ID"] = request_id
        try:
            from utils.request_counter import increment
            increment()
        except ImportError:
            pass
        return response
