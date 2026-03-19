import importlib.util
import warnings
from contextlib import contextmanager
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]
COMPAT_DB_BACKEND_PATH = REPO_ROOT / "resources" / "products" / "token-spy" / "db_backend.py"


def _load_module(module_name: str, path: Path):
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def test_compat_module_imports_and_emits_deprecation_warning():
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        module = _load_module("token_spy_db_backend_compat_warn", COMPAT_DB_BACKEND_PATH)

    assert hasattr(module, "DatabaseBackend")
    assert hasattr(module, "get_backend")
    assert any(issubclass(w.category, DeprecationWarning) for w in caught)


def test_log_usage_adapts_legacy_dict_payload():
    module = _load_module("token_spy_db_backend_compat_log", COMPAT_DB_BACKEND_PATH)

    class _FakeBackend:
        def __init__(self):
            self.logged = None

        def log_usage(self, usage_entry):
            self.logged = usage_entry

    fake_backend = _FakeBackend()
    module.get_backend = lambda: fake_backend

    module.log_usage(
        {
            "session_id": "agent-1",
            "provider": "openai",
            "model": "gpt-4o-mini",
            "input_tokens": 12,
            "output_tokens": 30,
            "estimated_cost_usd": 0.123,
            "duration_ms": 222,
            "stop_reason": "stop",
        }
    )

    assert fake_backend.logged is not None
    assert fake_backend.logged.prompt_tokens == 12
    assert fake_backend.logged.completion_tokens == 30
    assert fake_backend.logged.total_tokens == 42
    assert fake_backend.logged.total_cost == 0.123
    assert fake_backend.logged.latency_ms == 222
    assert fake_backend.logged.finish_reason == "stop"


class _FakeCursor:
    def __init__(self, fetchall_result=None, fetchone_result=None):
        self.fetchall_result = fetchall_result or []
        self.fetchone_result = fetchone_result
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params):
        self.executed.append((sql, params))

    def fetchall(self):
        return self.fetchall_result

    def fetchone(self):
        return self.fetchone_result


class _FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self, **kwargs):
        return self._cursor


@contextmanager
def _fake_db_connection(cursor):
    yield _FakeConnection(cursor)


def test_query_helpers_keep_legacy_shape():
    module = _load_module("token_spy_db_backend_compat_query", COMPAT_DB_BACKEND_PATH)

    usage_rows = [
        {
            "request_id": "r1",
            "input_tokens": 1,
            "output_tokens": 2,
            "estimated_cost_usd": 0.1,
            "duration_ms": 11,
            "stop_reason": "stop",
        }
    ]
    summary_row = {
        "request_count": 10,
        "total_input_tokens": 100,
        "total_output_tokens": 200,
        "total_cost": 1.5,
        "avg_duration_ms": 30,
    }
    session_row = {
        "message_count": 2,
        "total_tokens": 30,
        "last_activity": "2026-01-01T00:00:00Z",
    }

    usage_cursor = _FakeCursor(fetchall_result=usage_rows)
    module.get_db_connection = lambda: _fake_db_connection(usage_cursor)
    usage = module.query_usage(agent="agent-1", start_time="2026-01-01", end_time="2026-01-02", limit=5)
    assert usage == usage_rows

    summary_cursor = _FakeCursor(fetchone_result=summary_row)
    module.get_db_connection = lambda: _fake_db_connection(summary_cursor)
    summary = module.query_summary(hours=12)
    assert summary == summary_row

    session_cursor = _FakeCursor(fetchone_result=session_row)
    module.get_db_connection = lambda: _fake_db_connection(session_cursor)
    session_status = module.query_session_status(agent="agent-1")
    assert session_status == session_row
