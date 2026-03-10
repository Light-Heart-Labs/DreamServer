"""Simple request counter for API metrics. Avoids circular imports."""

_request_count = 0


def increment():
    global _request_count
    _request_count += 1


def get_count():
    return _request_count
