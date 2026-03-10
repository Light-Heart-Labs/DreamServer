"""
Simple in-memory TTL cache for expensive API responses.
Used to reduce load on /api/status when multiple clients poll.
"""

import time
import threading
from typing import Any, Optional

_CACHE: dict[str, tuple[Any, float]] = {}
_LOCK = threading.Lock()
_DEFAULT_TTL = 2.0  # seconds


def get(key: str, ttl: float = _DEFAULT_TTL) -> Optional[Any]:
    """Get cached value if not expired."""
    with _LOCK:
        if key not in _CACHE:
            return None
        value, expires = _CACHE[key]
        if time.monotonic() > expires:
            del _CACHE[key]
            return None
        return value


def set(key: str, value: Any, ttl: float = _DEFAULT_TTL) -> None:
    """Store value with TTL."""
    with _LOCK:
        _CACHE[key] = (value, time.monotonic() + ttl)


def invalidate(key: str) -> None:
    """Remove cached value."""
    with _LOCK:
        _CACHE.pop(key, None)


def clear() -> None:
    """Clear all cached values."""
    with _LOCK:
        _CACHE.clear()
