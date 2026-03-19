import asyncio
import importlib.util
import os
import sys
import types
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[4]
DASHBOARD_MAIN_PATH = REPO_ROOT / "resources" / "products" / "token-spy" / "dashboard" / "main.py"
SIDECAR_METRICS_PATH = REPO_ROOT / "resources" / "products" / "token-spy" / "sidecar" / "metrics.py"




def _install_import_stubs():
    if "asyncpg" not in sys.modules:
        fake_asyncpg = types.ModuleType("asyncpg")
        fake_asyncpg.Pool = object
        sys.modules["asyncpg"] = fake_asyncpg

    if "fastapi" not in sys.modules:
        fastapi = types.ModuleType("fastapi")

        class HTTPException(Exception):
            def __init__(self, status_code: int, detail=None, headers=None):
                self.status_code = status_code
                self.detail = detail
                self.headers = headers

        class FastAPI:
            def __init__(self, *args, **kwargs):
                pass

            def _decorator(self, *args, **kwargs):
                def wrap(func):
                    return func
                return wrap

            get = post = put = delete = patch = _decorator

            def add_middleware(self, *args, **kwargs):
                return None

            def mount(self, *args, **kwargs):
                return None

            def include_router(self, *args, **kwargs):
                return None

        def Query(default=None, **kwargs):
            return default

        def Depends(dep=None):
            return dep

        class Request:
            pass

        fastapi.FastAPI = FastAPI
        fastapi.Query = Query
        fastapi.HTTPException = HTTPException
        fastapi.Depends = Depends
        fastapi.Request = Request
        sys.modules["fastapi"] = fastapi

        cors = types.ModuleType("fastapi.middleware.cors")
        cors.CORSMiddleware = object
        sys.modules["fastapi.middleware.cors"] = cors

        staticfiles = types.ModuleType("fastapi.staticfiles")
        class StaticFiles:
            def __init__(self, *args, **kwargs):
                pass
        staticfiles.StaticFiles = StaticFiles
        sys.modules["fastapi.staticfiles"] = staticfiles

        responses = types.ModuleType("fastapi.responses")
        class FileResponse:
            def __init__(self, *args, **kwargs):
                pass
        class JSONResponse:
            def __init__(self, *args, **kwargs):
                pass
        responses.FileResponse = FileResponse
        responses.JSONResponse = JSONResponse
        sys.modules["fastapi.responses"] = responses

        security = types.ModuleType("fastapi.security")
        class HTTPBasic:
            def __call__(self, *args, **kwargs):
                return None
        class HTTPBasicCredentials:
            username = ""
            password = ""
        security.HTTPBasic = HTTPBasic
        security.HTTPBasicCredentials = HTTPBasicCredentials
        sys.modules["fastapi.security"] = security

    if "pydantic" not in sys.modules:
        pydantic = types.ModuleType("pydantic")

        class BaseModel:
            def __init__(self, **kwargs):
                for key, value in kwargs.items():
                    setattr(self, key, value)

        def Field(default=None, **kwargs):
            return default

        pydantic.BaseModel = BaseModel
        pydantic.Field = Field
        sys.modules["pydantic"] = pydantic

    if "pydantic_settings" not in sys.modules:
        pydantic_settings = types.ModuleType("pydantic_settings")

        class BaseSettings:
            def __init__(self, **kwargs):
                for key, value in self.__class__.__dict__.items():
                    if key.startswith("_") or callable(value):
                        continue
                    env_val = os.getenv(key.upper())
                    if env_val is not None:
                        setattr(self, key, env_val)
                    elif key in kwargs:
                        setattr(self, key, kwargs[key])
                    else:
                        setattr(self, key, value)

        pydantic_settings.BaseSettings = BaseSettings
        sys.modules["pydantic_settings"] = pydantic_settings


def _load_module(module_name: str, path: Path):
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def dashboard_main_module():
    os.environ.setdefault("DATABASE_URL", "postgresql://token_spy:token_spy@localhost:5432/token_spy")

    _install_import_stubs()

    try:
        return _load_module("token_spy_dashboard_main", DASHBOARD_MAIN_PATH)
    except Exception as exc:  # pragma: no cover
        pytest.skip(f"Unable to import dashboard main module in this environment: {exc}")


@pytest.fixture(scope="module")
def sidecar_metrics_module():
    return _load_module("token_spy_sidecar_metrics", SIDECAR_METRICS_PATH)


class _AcquireContext:
    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakePool:
    def __init__(self, conn):
        self._conn = conn

    def acquire(self):
        return _AcquireContext(self._conn)


class _FakeConnOverview:
    async def fetchrow(self, query):
        if "COUNT(*) AS requests" in query:
            return {
                "requests": 10,
                "tokens": 2000,
                "cost": 8.0,
                "latency": 250.0,
            }
        if "SUM(tokens_used_this_month)" in query:
            return {
                "tokens_used": 400,
                "token_limit": 1000,
            }
        raise AssertionError(f"Unexpected fetchrow query: {query}")

    async def fetchval(self, query):
        if "SELECT COUNT(*) FROM sessions" in query:
            return 3
        if "SELECT model FROM api_requests" in query:
            return "gpt-4o-mini"
        raise AssertionError(f"Unexpected fetchval query: {query}")


class _FakeConnModels:
    async def fetch(self, query):
        assert "FROM api_requests" in query
        return [
            {
                "provider": "openai",
                "model": "gpt-4o-mini",
                "request_count": 5,
                "total_tokens": 1000,
                "total_cost": 2.0,
                "avg_latency_ms": 500.0,
            },
            {
                "provider": "anthropic",
                "model": "claude-3-haiku",
                "request_count": 2,
                "total_tokens": 0,
                "total_cost": 0.4,
                "avg_latency_ms": 0.0,
            },
        ]


def test_overview_budget_percent_is_derived(dashboard_main_module, monkeypatch):
    async def _fake_get_db_pool():
        return _FakePool(_FakeConnOverview())

    monkeypatch.setattr(dashboard_main_module, "get_db_pool", _fake_get_db_pool)

    result = asyncio.run(dashboard_main_module.get_overview(auth_user=None))

    assert result.total_requests_24h == 10
    assert result.active_sessions == 3
    assert result.top_model == "gpt-4o-mini"
    assert result.budget_used_percent == 40.0


def test_models_list_derives_speed_and_cost_metrics(dashboard_main_module, monkeypatch):
    async def _fake_get_db_pool():
        return _FakePool(_FakeConnModels())

    monkeypatch.setattr(dashboard_main_module, "get_db_pool", _fake_get_db_pool)

    result = asyncio.run(dashboard_main_module.get_models_list(days=7, auth_user=None))

    assert len(result) == 2
    assert result[0].tokens_per_second == 2000.0
    assert result[0].cost_per_1k_tokens == 2.0

    assert result[1].tokens_per_second is None
    assert result[1].cost_per_1k_tokens is None


def test_dashboard_and_sidecar_normalization_are_in_parity(
    dashboard_main_module,
    sidecar_metrics_module,
):
    test_vectors = [
        (1200, 2.4, 400.0, None),
        (600, 1.2, 300.0, 200.0),
        (0, 0.4, 100.0, None),
        (250, 0.5, 0.0, None),
        (250, 0.5, None, None),
    ]

    for total_tokens, total_cost, avg_latency_ms, avg_ttft_ms in test_vectors:
        dashboard_result = dashboard_main_module.normalize_cost_and_speed_metrics(
            total_tokens=total_tokens,
            total_cost=total_cost,
            avg_latency_ms=avg_latency_ms,
            avg_ttft_ms=avg_ttft_ms,
        )
        sidecar_result = sidecar_metrics_module.normalize_cost_and_speed_metrics(
            total_tokens=total_tokens,
            total_cost=total_cost,
            avg_latency_ms=avg_latency_ms,
            avg_ttft_ms=avg_ttft_ms,
        )
        assert dashboard_result == sidecar_result


@pytest.mark.parametrize(
    "raw_origins, expected",
    [
        ("", []),
        ("   ", []),
        ("http://localhost:3000", ["http://localhost:3000"]),
        (
            "http://localhost:3000, http://127.0.0.1:3000",
            ["http://localhost:3000", "http://127.0.0.1:3000"],
        ),
        (
            '["http://localhost:3000", "http://127.0.0.1:3000"]',
            ["http://localhost:3000", "http://127.0.0.1:3000"],
        ),
    ],
)
def test_parse_allowed_origins_accepts_csv_and_json(
    dashboard_main_module,
    raw_origins,
    expected,
):
    assert dashboard_main_module.parse_allowed_origins(raw_origins) == expected


@pytest.mark.parametrize(
    "raw_origins",
    [
        '["http://localhost:3000",]',
        '{"origin": "http://localhost:3000"}',
        "[1, 2]",
    ],
)
def test_parse_allowed_origins_rejects_invalid_json(dashboard_main_module, raw_origins):
    with pytest.raises(ValueError):
        dashboard_main_module.parse_allowed_origins(raw_origins)


def test_get_cors_settings_rejects_credentials_with_wildcard(
    dashboard_main_module,
    monkeypatch,
    caplog,
):
    monkeypatch.setattr(dashboard_main_module.settings, "dashboard_allowed_origins", "*")
    monkeypatch.setattr(
        dashboard_main_module.settings,
        "dashboard_cors_allow_credentials",
        True,
    )

    with caplog.at_level("ERROR"):
        with pytest.raises(ValueError, match="insecure CORS config"):
            dashboard_main_module.get_cors_settings()

    assert "cannot be combined with wildcard origin '*'" in caplog.text


def test_get_cors_settings_allows_wildcard_without_credentials(
    dashboard_main_module,
    monkeypatch,
    caplog,
):
    monkeypatch.setattr(dashboard_main_module.settings, "dashboard_allowed_origins", "*")
    monkeypatch.setattr(
        dashboard_main_module.settings,
        "dashboard_cors_allow_credentials",
        False,
    )

    with caplog.at_level("WARNING"):
        cors_settings = dashboard_main_module.get_cors_settings()

    assert cors_settings["allow_origins"] == ["*"]
    assert cors_settings["allow_credentials"] is False
    assert "wildcard origin '*'" in caplog.text


def test_get_cors_settings_logs_empty_allowlist_info(
    dashboard_main_module,
    monkeypatch,
    caplog,
):
    monkeypatch.setattr(dashboard_main_module.settings, "dashboard_allowed_origins", "")
    monkeypatch.setattr(
        dashboard_main_module.settings,
        "dashboard_cors_allow_credentials",
        True,
    )

    with caplog.at_level("INFO"):
        cors_settings = dashboard_main_module.get_cors_settings()

    assert cors_settings["allow_origins"] == []
    assert cors_settings["allow_credentials"] is True
    assert "CORS allowlist is empty" in caplog.text
