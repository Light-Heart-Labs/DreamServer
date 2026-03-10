"""
API performance metrics endpoint.
Returns request statistics and health for monitoring.
"""

import time
from fastapi import APIRouter, Depends

from security import verify_api_key
from utils.request_counter import get_count

router = APIRouter(prefix="", tags=["Metrics"])

_start_time = time.monotonic()


@router.get("/api/metrics", dependencies=[Depends(verify_api_key)])
async def get_metrics():
    """Return API performance metrics for monitoring and dashboards."""
    uptime_seconds = time.monotonic() - _start_time
    return {
        "request_count": get_count(),
        "uptime_seconds": round(uptime_seconds, 1),
        "uptime_human": _format_uptime(uptime_seconds),
    }


def _format_uptime(seconds: float) -> str:
    s = int(seconds)
    d, s = divmod(s, 86400)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    if d > 0:
        return f"{d}d {h}h {m}m"
    if h > 0:
        return f"{h}h {m}m"
    if m > 0:
        return f"{m}m {s}s"
    return f"{s}s"
