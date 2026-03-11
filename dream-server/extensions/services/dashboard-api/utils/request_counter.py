"""Simple request counter for API metrics. Thread-safe for concurrent access."""

import threading

_lock = threading.Lock()
_request_count = 0


def increment():
    global _request_count
    with _lock:
        _request_count += 1


def get_count():
    with _lock:
        return _request_count
