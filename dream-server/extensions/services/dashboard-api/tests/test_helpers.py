"""Tests for helpers.py — model info, bootstrap status, token tracking, system metrics."""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import aiohttp
import httpx
import pytest

from helpers import (
    get_model_info, get_bootstrap_status, _update_lifetime_tokens,
    get_uptime, get_cpu_metrics, get_ram_metrics,
    check_service_health, get_all_services,
    get_llama_metrics, get_loaded_model, get_llama_context_size,
    get_disk_usage,
)
from models import BootstrapStatus, ServiceStatus, DiskUsage


# --- get_model_info ---


class TestGetModelInfo:

    def test_parses_32b_awq_model(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('LLM_MODEL=Qwen2.5-32B-Instruct-AWQ\n')

        info = get_model_info()
        assert info is not None
        assert info.name == "Qwen2.5-32B-Instruct-AWQ"
        assert info.size_gb == 16.0
        assert info.quantization == "AWQ"

    def test_parses_7b_model(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('LLM_MODEL=Qwen2.5-7B-Instruct\n')

        info = get_model_info()
        assert info is not None
        assert info.size_gb == 4.0
        assert info.quantization is None

    def test_parses_14b_gptq_model(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('LLM_MODEL=Qwen2.5-14B-Instruct-GPTQ\n')

        info = get_model_info()
        assert info is not None
        assert info.size_gb == 8.0
        assert info.quantization == "GPTQ"

    def test_parses_70b_model(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('LLM_MODEL=Llama-3-70B-GGUF\n')

        info = get_model_info()
        assert info is not None
        assert info.size_gb == 35.0
        assert info.quantization == "GGUF"

    def test_returns_none_when_no_env(self, install_dir):
        # No .env file created
        assert get_model_info() is None

    def test_returns_none_when_no_llm_model_line(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('SOME_OTHER_VAR=foo\n')

        assert get_model_info() is None

    def test_handles_quoted_value(self, install_dir):
        env_file = install_dir / ".env"
        env_file.write_text('LLM_MODEL="Qwen2.5-7B-Instruct"\n')

        info = get_model_info()
        assert info is not None
        assert info.name == "Qwen2.5-7B-Instruct"


# --- get_bootstrap_status ---


class TestGetBootstrapStatus:

    def test_inactive_when_no_file(self, data_dir):
        status = get_bootstrap_status()
        assert isinstance(status, BootstrapStatus)
        assert status.active is False

    def test_inactive_when_complete(self, data_dir):
        status_file = data_dir / "bootstrap-status.json"
        status_file.write_text(json.dumps({"status": "complete"}))

        status = get_bootstrap_status()
        assert status.active is False

    def test_inactive_when_empty_status(self, data_dir):
        status_file = data_dir / "bootstrap-status.json"
        status_file.write_text(json.dumps({"status": ""}))

        status = get_bootstrap_status()
        assert status.active is False

    def test_active_download(self, data_dir):
        status_file = data_dir / "bootstrap-status.json"
        status_file.write_text(json.dumps({
            "status": "downloading",
            "model": "Qwen2.5-32B",
            "percent": 42.5,
            "bytesDownloaded": 5 * 1024**3,
            "bytesTotal": 12 * 1024**3,
            "speedBytesPerSec": 50 * 1024**2,
            "eta": "3m 20s",
        }))

        status = get_bootstrap_status()
        assert status.active is True
        assert status.model_name == "Qwen2.5-32B"
        assert status.percent == 42.5
        assert status.eta_seconds == 200  # 3*60 + 20

    def test_eta_calculating(self, data_dir):
        status_file = data_dir / "bootstrap-status.json"
        status_file.write_text(json.dumps({
            "status": "downloading",
            "percent": 1.0,
            "eta": "calculating...",
        }))

        status = get_bootstrap_status()
        assert status.active is True
        assert status.eta_seconds is None

    def test_handles_malformed_json(self, data_dir):
        status_file = data_dir / "bootstrap-status.json"
        status_file.write_text("not json!")

        status = get_bootstrap_status()
        assert status.active is False


# --- _update_lifetime_tokens ---


class TestUpdateLifetimeTokens:

    def test_fresh_start(self, data_dir):
        result = _update_lifetime_tokens(100.0)
        assert result == 100

    def test_accumulates_across_calls(self, data_dir):
        _update_lifetime_tokens(100.0)
        result = _update_lifetime_tokens(250.0)
        assert result == 250  # 100 + (250 - 100)

    def test_handles_server_restart(self, data_dir):
        """When server_counter < prev, the counter has reset."""
        _update_lifetime_tokens(500.0)
        # Server restarted, counter back to 50
        result = _update_lifetime_tokens(50.0)
        # Should add 50 (treats reset counter as fresh delta)
        assert result == 550  # 500 + 50

    def test_handles_corrupted_token_file(self, data_dir):
        """Corrupted JSON should log a warning and start fresh."""
        token_file = data_dir / "token_counter.json"
        token_file.write_text("not valid json{{{")
        result = _update_lifetime_tokens(100.0)
        assert result == 100

    def test_handles_unwritable_token_file(self, data_dir, monkeypatch):
        """When the token file cannot be written, should not raise."""
        import helpers
        monkeypatch.setattr(helpers, "_TOKEN_FILE", data_dir / "readonly" / "token.json")
        # Parent dir doesn't exist, so write will fail
        result = _update_lifetime_tokens(50.0)
        assert result == 50


# --- System metrics (cross-platform) ---


class TestGetUptime:

    def test_returns_int(self):
        result = get_uptime()
        assert isinstance(result, int)
        assert result >= 0

    def test_returns_zero_on_unsupported_platform(self, monkeypatch):
        monkeypatch.setattr("helpers.platform.system", lambda: "UnknownOS")
        assert get_uptime() == 0


class TestGetCpuMetrics:

    def test_returns_expected_keys(self):
        result = get_cpu_metrics()
        assert "percent" in result
        assert "temp_c" in result
        assert isinstance(result["percent"], (int, float))

    def test_returns_defaults_on_unsupported_platform(self, monkeypatch):
        monkeypatch.setattr("helpers.platform.system", lambda: "UnknownOS")
        result = get_cpu_metrics()
        assert result == {"percent": 0, "temp_c": None}


class TestGetRamMetrics:

    def test_returns_expected_keys(self):
        result = get_ram_metrics()
        assert "used_gb" in result
        assert "total_gb" in result
        assert "percent" in result

    def test_returns_defaults_on_unsupported_platform(self, monkeypatch):
        monkeypatch.setattr("helpers.platform.system", lambda: "UnknownOS")
        result = get_ram_metrics()
        assert result == {"used_gb": 0, "total_gb": 0, "percent": 0}


# --- check_service_health ---


class TestCheckServiceHealth:

    _CONFIG = {
        "name": "test-svc",
        "port": 8080,
        "external_port": 8080,
        "health": "/health",
        "host": "localhost",
    }

    @pytest.mark.asyncio
    async def test_healthy_on_200(self, mock_aiohttp_session, monkeypatch):
        session = mock_aiohttp_session(status=200)
        monkeypatch.setattr("helpers._get_aio_session", AsyncMock(return_value=session))

        result = await check_service_health("test-svc", self._CONFIG)
        assert result.status == "healthy"
        assert result.id == "test-svc"
        assert result.port == 8080

    @pytest.mark.asyncio
    async def test_unhealthy_on_500(self, mock_aiohttp_session, monkeypatch):
        session = mock_aiohttp_session(status=500)
        monkeypatch.setattr("helpers._get_aio_session", AsyncMock(return_value=session))

        result = await check_service_health("test-svc", self._CONFIG)
        assert result.status == "unhealthy"

    @pytest.mark.asyncio
    async def test_degraded_on_timeout(self, monkeypatch):
        session = MagicMock()
        session.get = MagicMock(side_effect=asyncio.TimeoutError())
        monkeypatch.setattr("helpers._get_aio_session", AsyncMock(return_value=session))

        result = await check_service_health("test-svc", self._CONFIG)
        assert result.status == "degraded"

    @pytest.mark.asyncio
    async def test_not_deployed_on_dns_failure(self, monkeypatch):
        from collections import namedtuple
        ConnKey = namedtuple('ConnectionKey', ['host', 'port', 'is_ssl', 'ssl', 'proxy', 'proxy_auth', 'proxy_headers_hash'])
        conn_key = ConnKey('test-svc', 8080, False, None, None, None, None)
        os_err = OSError("Name or service not known")
        os_err.strerror = "Name or service not known"
        exc = aiohttp.ClientConnectorError(conn_key, os_err)
        session = MagicMock()
        session.get = MagicMock(side_effect=exc)
        monkeypatch.setattr("helpers._get_aio_session", AsyncMock(return_value=session))

        result = await check_service_health("test-svc", self._CONFIG)
        assert result.status == "not_deployed"

    @pytest.mark.asyncio
    async def test_down_on_connection_refused(self, monkeypatch):
        conn_key = MagicMock()
        exc = aiohttp.ClientConnectorError(conn_key, OSError("Connection refused"))
        session = MagicMock()
        session.get = MagicMock(side_effect=exc)
        monkeypatch.setattr("helpers._get_aio_session", AsyncMock(return_value=session))

        result = await check_service_health("test-svc", self._CONFIG)
        assert result.status == "down"

    @pytest.mark.asyncio
    async def test_down_on_os_error(self, monkeypatch):
        session = MagicMock()
        session.get = MagicMock(side_effect=OSError("connection refused"))
        monkeypatch.setattr("helpers._get_aio_session", AsyncMock(return_value=session))

        result = await check_service_health("test-svc", self._CONFIG)
        assert result.status == "down"


# --- get_all_services ---


class TestGetAllServices:

    @pytest.mark.asyncio
    async def test_returns_all_statuses(self, monkeypatch):
        fake_services = {
            "svc-a": {"name": "Service A", "port": 8001, "external_port": 8001, "health": "/health", "host": "localhost"},
            "svc-b": {"name": "Service B", "port": 8002, "external_port": 8002, "health": "/health", "host": "localhost"},
        }
        monkeypatch.setattr("helpers.SERVICES", fake_services)

        async def fake_health(sid, cfg):
            return ServiceStatus(id=sid, name=cfg["name"], port=cfg["port"],
                                 external_port=cfg["external_port"], status="healthy")

        monkeypatch.setattr("helpers.check_service_health", fake_health)

        result = await get_all_services()
        assert len(result) == 2
        ids = {s.id for s in result}
        assert ids == {"svc-a", "svc-b"}

    @pytest.mark.asyncio
    async def test_exception_in_one_service_returns_down(self, monkeypatch):
        fake_services = {
            "ok-svc": {"name": "OK", "port": 8001, "external_port": 8001, "health": "/health", "host": "localhost"},
            "bad-svc": {"name": "Bad", "port": 8002, "external_port": 8002, "health": "/health", "host": "localhost"},
        }
        monkeypatch.setattr("helpers.SERVICES", fake_services)

        async def fake_health(sid, cfg):
            if sid == "bad-svc":
                raise RuntimeError("unexpected failure")
            return ServiceStatus(id=sid, name=cfg["name"], port=cfg["port"],
                                 external_port=cfg["external_port"], status="healthy")

        monkeypatch.setattr("helpers.check_service_health", fake_health)

        result = await get_all_services()
        assert len(result) == 2
        bad = next(s for s in result if s.id == "bad-svc")
        assert bad.status == "down"
        ok = next(s for s in result if s.id == "ok-svc")
        assert ok.status == "healthy"

    @pytest.mark.asyncio
    async def test_empty_services_returns_empty(self, monkeypatch):
        monkeypatch.setattr("helpers.SERVICES", {})
        result = await get_all_services()
        assert result == []


# --- get_llama_metrics ---


class TestGetLlamaMetrics:

    @pytest.mark.asyncio
    async def test_parses_prometheus_metrics(self, monkeypatch):
        from conftest import load_golden_fixture
        prom_text = load_golden_fixture("prometheus_metrics.txt")

        fake_services = {
            "llama-server": {"host": "localhost", "port": 8080, "health": "/health", "name": "llama-server"},
        }
        monkeypatch.setattr("helpers.SERVICES", fake_services)

        # Reset the previous token state so TPS calculation is fresh
        import helpers
        helpers._prev_tokens.update({"count": 0, "time": 0.0, "tps": 0.0})

        mock_response = MagicMock()
        mock_response.text = prom_text
        mock_response.status_code = 200

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        monkeypatch.setattr("helpers.httpx.AsyncClient", lambda **kw: mock_client)

        result = await get_llama_metrics(model_hint="test-model")
        assert "tokens_per_second" in result
        assert "lifetime_tokens" in result
        assert isinstance(result["tokens_per_second"], (int, float))

    @pytest.mark.asyncio
    async def test_returns_zero_on_failure(self, monkeypatch):
        fake_services = {
            "llama-server": {"host": "localhost", "port": 8080, "health": "/health", "name": "llama-server"},
        }
        monkeypatch.setattr("helpers.SERVICES", fake_services)

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=OSError("connection refused"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        monkeypatch.setattr("helpers.httpx.AsyncClient", lambda **kw: mock_client)

        result = await get_llama_metrics(model_hint="test-model")
        assert result["tokens_per_second"] == 0


# --- get_loaded_model ---


class TestGetLoadedModel:

    @pytest.mark.asyncio
    async def test_returns_model_with_loaded_status(self, monkeypatch):
        fake_services = {
            "llama-server": {"host": "localhost", "port": 8080, "health": "/health", "name": "llama-server"},
        }
        monkeypatch.setattr("helpers.SERVICES", fake_services)

        mock_response = MagicMock()
        mock_response.json = MagicMock(return_value={
            "data": [
                {"id": "idle-model", "status": {"value": "idle"}},
                {"id": "loaded-model", "status": {"value": "loaded"}},
            ]
        })

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        monkeypatch.setattr("helpers.httpx.AsyncClient", lambda **kw: mock_client)

        result = await get_loaded_model()
        assert result == "loaded-model"

    @pytest.mark.asyncio
    async def test_returns_first_model_when_no_loaded(self, monkeypatch):
        fake_services = {
            "llama-server": {"host": "localhost", "port": 8080, "health": "/health", "name": "llama-server"},
        }
        monkeypatch.setattr("helpers.SERVICES", fake_services)

        mock_response = MagicMock()
        mock_response.json = MagicMock(return_value={
            "data": [
                {"id": "only-model", "status": {"value": "idle"}},
            ]
        })

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        monkeypatch.setattr("helpers.httpx.AsyncClient", lambda **kw: mock_client)

        result = await get_loaded_model()
        assert result == "only-model"

    @pytest.mark.asyncio
    async def test_returns_none_on_failure(self, monkeypatch):
        fake_services = {
            "llama-server": {"host": "localhost", "port": 8080, "health": "/health", "name": "llama-server"},
        }
        monkeypatch.setattr("helpers.SERVICES", fake_services)

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=httpx.ConnectError("unreachable"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        monkeypatch.setattr("helpers.httpx.AsyncClient", lambda **kw: mock_client)

        result = await get_loaded_model()
        assert result is None


# --- get_llama_context_size ---


class TestGetLlamaContextSize:

    @pytest.mark.asyncio
    async def test_returns_n_ctx(self, monkeypatch):
        fake_services = {
            "llama-server": {"host": "localhost", "port": 8080, "health": "/health", "name": "llama-server"},
        }
        monkeypatch.setattr("helpers.SERVICES", fake_services)

        mock_response = MagicMock()
        mock_response.json = MagicMock(return_value={
            "default_generation_settings": {"n_ctx": 32768}
        })

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        monkeypatch.setattr("helpers.httpx.AsyncClient", lambda **kw: mock_client)

        result = await get_llama_context_size(model_hint="test-model")
        assert result == 32768

    @pytest.mark.asyncio
    async def test_returns_none_on_failure(self, monkeypatch):
        fake_services = {
            "llama-server": {"host": "localhost", "port": 8080, "health": "/health", "name": "llama-server"},
        }
        monkeypatch.setattr("helpers.SERVICES", fake_services)

        mock_client = AsyncMock()
        mock_client.get = AsyncMock(side_effect=httpx.ConnectError("unreachable"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        monkeypatch.setattr("helpers.httpx.AsyncClient", lambda **kw: mock_client)

        result = await get_llama_context_size(model_hint="test-model")
        assert result is None


# --- get_disk_usage ---


class TestGetDiskUsage:

    def test_returns_disk_usage(self, monkeypatch):
        monkeypatch.setattr("helpers.INSTALL_DIR", "/tmp")

        result = get_disk_usage()
        assert isinstance(result, DiskUsage)
        assert result.total_gb > 0
        assert result.used_gb >= 0
        assert 0 <= result.percent <= 100

    def test_falls_back_to_home_dir(self, monkeypatch):
        monkeypatch.setattr("helpers.INSTALL_DIR", "/nonexistent/path/that/does/not/exist")

        import os
        result = get_disk_usage()
        assert isinstance(result, DiskUsage)
        assert result.path == os.path.expanduser("~")
        assert result.total_gb > 0
