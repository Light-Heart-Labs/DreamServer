"""Tests for main.py — core endpoints and helper functions."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from main import get_allowed_origins, _build_api_status


# --- get_allowed_origins ---


class TestGetAllowedOrigins:

    def test_returns_env_origins_when_set(self, monkeypatch):
        monkeypatch.setenv("DASHBOARD_ALLOWED_ORIGINS", "http://foo:3000,http://bar:3001")
        origins = get_allowed_origins()
        assert origins == ["http://foo:3000", "http://bar:3001"]

    def test_returns_defaults_when_env_not_set(self, monkeypatch):
        monkeypatch.delenv("DASHBOARD_ALLOWED_ORIGINS", raising=False)
        origins = get_allowed_origins()
        assert "http://localhost:3001" in origins
        assert "http://127.0.0.1:3001" in origins

    def test_includes_lan_ips(self, monkeypatch):
        monkeypatch.delenv("DASHBOARD_ALLOWED_ORIGINS", raising=False)
        monkeypatch.setattr("main.socket.gethostname", lambda: "test-host")
        monkeypatch.setattr(
            "main.socket.gethostbyname_ex",
            lambda h: ("test-host", [], ["192.168.1.100"]),
        )
        origins = get_allowed_origins()
        assert "http://192.168.1.100:3001" in origins
        assert "http://192.168.1.100:3000" in origins

    def test_handles_socket_error(self, monkeypatch):
        import socket
        monkeypatch.delenv("DASHBOARD_ALLOWED_ORIGINS", raising=False)
        monkeypatch.setattr("main.socket.gethostname", lambda: "test-host")
        monkeypatch.setattr(
            "main.socket.gethostbyname_ex",
            MagicMock(side_effect=socket.gaierror("lookup failed")),
        )
        # Should not raise; just returns defaults without LAN IPs
        origins = get_allowed_origins()
        assert "http://localhost:3001" in origins


# --- /api/preflight/docker ---


class TestPreflightDocker:

    def test_docker_available(self, test_client, monkeypatch):
        import asyncio
        import os.path as _ospath
        monkeypatch.setattr(_ospath, "exists", lambda p: False)

        mock_proc = AsyncMock()
        mock_proc.returncode = 0
        mock_proc.communicate = AsyncMock(return_value=(b"Docker version 24.0.7, build afdd53b", b""))

        monkeypatch.setattr(asyncio, "create_subprocess_exec", AsyncMock(return_value=mock_proc))

        resp = test_client.get("/api/preflight/docker", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is True
        assert "24.0.7" in data["version"]

    def test_docker_not_installed(self, test_client, monkeypatch):
        import asyncio
        import os.path as _ospath
        monkeypatch.setattr(_ospath, "exists", lambda p: False)
        monkeypatch.setattr(
            asyncio, "create_subprocess_exec",
            AsyncMock(side_effect=FileNotFoundError("docker not found")),
        )

        resp = test_client.get("/api/preflight/docker", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is False
        assert "not installed" in data["error"]

    def test_docker_timeout(self, test_client, monkeypatch):
        import asyncio
        import os.path as _ospath
        monkeypatch.setattr(_ospath, "exists", lambda p: False)

        mock_proc = AsyncMock()
        mock_proc.communicate = AsyncMock(side_effect=asyncio.TimeoutError())

        monkeypatch.setattr(asyncio, "create_subprocess_exec", AsyncMock(return_value=mock_proc))
        monkeypatch.setattr(asyncio, "wait_for", AsyncMock(side_effect=asyncio.TimeoutError()))

        resp = test_client.get("/api/preflight/docker", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is False
        assert "timed out" in data["error"]


# --- /api/preflight/gpu ---


class TestPreflightGpu:

    def test_gpu_available(self, test_client, monkeypatch):
        from models import GPUInfo
        gpu = GPUInfo(
            name="RTX 4090", memory_used_mb=2048, memory_total_mb=24576,
            memory_percent=8.3, utilization_percent=35, temperature_c=62,
            gpu_backend="nvidia",
        )
        monkeypatch.setattr("main.get_gpu_info", lambda: gpu)

        resp = test_client.get("/api/preflight/gpu", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is True
        assert data["name"] == "RTX 4090"
        assert data["backend"] == "nvidia"

    def test_gpu_unavailable_amd(self, test_client, monkeypatch):
        monkeypatch.setattr("main.get_gpu_info", lambda: None)
        monkeypatch.setenv("GPU_BACKEND", "amd")

        resp = test_client.get("/api/preflight/gpu", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is False
        assert "AMD" in data["error"]

    def test_unified_memory_label(self, test_client, monkeypatch):
        from models import GPUInfo
        gpu = GPUInfo(
            name="AMD Strix Halo", memory_used_mb=10240, memory_total_mb=98304,
            memory_percent=10.4, utilization_percent=15, temperature_c=55,
            memory_type="unified", gpu_backend="amd",
        )
        monkeypatch.setattr("main.get_gpu_info", lambda: gpu)

        resp = test_client.get("/api/preflight/gpu", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["available"] is True
        assert data["memory_type"] == "unified"
        assert "Unified" in data["memory_label"]


# --- /api/preflight/disk ---


class TestPreflightDisk:

    def test_returns_disk_info(self, test_client, monkeypatch):
        from collections import namedtuple
        DiskUsageTuple = namedtuple('usage', ['total', 'used', 'free'])
        monkeypatch.setattr("main.os.path.exists", lambda p: True)
        monkeypatch.setattr("main.shutil.disk_usage", lambda p: DiskUsageTuple(500 * 1024**3, 200 * 1024**3, 300 * 1024**3))

        resp = test_client.get("/api/preflight/disk", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 500 * 1024**3
        assert data["used"] == 200 * 1024**3
        assert data["free"] == 300 * 1024**3

    def test_handles_exception(self, test_client, monkeypatch):
        monkeypatch.setattr("main.os.path.exists", lambda p: True)
        monkeypatch.setattr("main.shutil.disk_usage", MagicMock(side_effect=OSError("disk error")))

        resp = test_client.get("/api/preflight/disk", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "error" in data


# --- _build_api_status ---


class TestBuildApiStatus:

    @pytest.mark.asyncio
    async def test_returns_full_structure(self, monkeypatch):
        from models import GPUInfo, BootstrapStatus, ModelInfo

        gpu = GPUInfo(
            name="RTX 4090", memory_used_mb=2048, memory_total_mb=24576,
            memory_percent=8.3, utilization_percent=35, temperature_c=62,
            gpu_backend="nvidia",
        )
        monkeypatch.setattr("main.get_gpu_info", lambda: gpu)
        monkeypatch.setattr("main.get_all_services", AsyncMock(return_value=[]))
        monkeypatch.setattr("main.get_model_info", lambda: ModelInfo(name="Test-32B", size_gb=16.0, context_length=32768))
        monkeypatch.setattr("main.get_bootstrap_status", lambda: BootstrapStatus(active=False))
        monkeypatch.setattr("main.get_loaded_model", AsyncMock(return_value="Test-32B"))
        monkeypatch.setattr("main.get_llama_metrics", AsyncMock(return_value={"tokens_per_second": 25.5, "lifetime_tokens": 10000}))
        monkeypatch.setattr("main.get_llama_context_size", AsyncMock(return_value=32768))
        monkeypatch.setattr("main.get_uptime", lambda: 3600)
        monkeypatch.setattr("main.get_cpu_metrics", lambda: {"percent": 15.0, "temp_c": 55})
        monkeypatch.setattr("main.get_ram_metrics", lambda: {"used_gb": 16.0, "total_gb": 64.0, "percent": 25.0})

        result = await _build_api_status()
        assert result["gpu"] is not None
        assert result["gpu"]["name"] == "RTX 4090"
        assert result["tier"] == "Prosumer"
        assert result["uptime"] == 3600
        assert result["inference"]["tokensPerSecond"] == 25.5
        assert result["inference"]["loadedModel"] == "Test-32B"

    @pytest.mark.asyncio
    async def test_tier_professional(self, monkeypatch):
        from models import GPUInfo, BootstrapStatus

        gpu = GPUInfo(
            name="H100", memory_used_mb=4096, memory_total_mb=81920,
            memory_percent=5.0, utilization_percent=10, temperature_c=45,
            gpu_backend="nvidia",
        )
        monkeypatch.setattr("main.get_gpu_info", lambda: gpu)
        monkeypatch.setattr("main.get_all_services", AsyncMock(return_value=[]))
        monkeypatch.setattr("main.get_model_info", lambda: None)
        monkeypatch.setattr("main.get_bootstrap_status", lambda: BootstrapStatus(active=False))
        monkeypatch.setattr("main.get_loaded_model", AsyncMock(return_value=None))
        monkeypatch.setattr("main.get_llama_metrics", AsyncMock(return_value={"tokens_per_second": 0, "lifetime_tokens": 0}))
        monkeypatch.setattr("main.get_llama_context_size", AsyncMock(return_value=None))
        monkeypatch.setattr("main.get_uptime", lambda: 0)
        monkeypatch.setattr("main.get_cpu_metrics", lambda: {"percent": 0, "temp_c": None})
        monkeypatch.setattr("main.get_ram_metrics", lambda: {"used_gb": 0, "total_gb": 0, "percent": 0})

        result = await _build_api_status()
        assert result["tier"] == "Professional"

    @pytest.mark.asyncio
    async def test_tier_strix_halo(self, monkeypatch):
        from models import GPUInfo, BootstrapStatus

        gpu = GPUInfo(
            name="Strix Halo", memory_used_mb=10240, memory_total_mb=98304,
            memory_percent=10.4, utilization_percent=15, temperature_c=55,
            memory_type="unified", gpu_backend="amd",
        )
        monkeypatch.setattr("main.get_gpu_info", lambda: gpu)
        monkeypatch.setattr("main.get_all_services", AsyncMock(return_value=[]))
        monkeypatch.setattr("main.get_model_info", lambda: None)
        monkeypatch.setattr("main.get_bootstrap_status", lambda: BootstrapStatus(active=False))
        monkeypatch.setattr("main.get_loaded_model", AsyncMock(return_value=None))
        monkeypatch.setattr("main.get_llama_metrics", AsyncMock(return_value={"tokens_per_second": 0, "lifetime_tokens": 0}))
        monkeypatch.setattr("main.get_llama_context_size", AsyncMock(return_value=None))
        monkeypatch.setattr("main.get_uptime", lambda: 0)
        monkeypatch.setattr("main.get_cpu_metrics", lambda: {"percent": 0, "temp_c": None})
        monkeypatch.setattr("main.get_ram_metrics", lambda: {"used_gb": 0, "total_gb": 0, "percent": 0})

        result = await _build_api_status()
        assert result["tier"] == "Strix Halo 90+"


# --- /api/service-tokens ---


class TestServiceTokens:

    def test_returns_token_from_env(self, test_client, monkeypatch):
        monkeypatch.setenv("OPENCLAW_TOKEN", "my-secret-token")

        resp = test_client.get("/api/service-tokens", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("openclaw") == "my-secret-token"

    def test_returns_empty_when_no_token(self, test_client, monkeypatch):
        monkeypatch.delenv("OPENCLAW_TOKEN", raising=False)
        # The file-based fallback paths (/data/openclaw/..., /dream-server/.env)
        # won't exist in test environment, so all fallbacks fail gracefully.

        resp = test_client.get("/api/service-tokens", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        # Either empty dict or no openclaw key
        assert "openclaw" not in data


# --- /api/external-links ---


class TestExternalLinks:

    def test_returns_links_for_services(self, test_client, monkeypatch):
        import config
        monkeypatch.setattr(config, "SERVICES", {
            "open-webui": {"name": "Open WebUI", "port": 3000, "external_port": 3000, "health": "/health", "host": "localhost"},
            "n8n": {"name": "n8n", "port": 5678, "external_port": 5678, "health": "/healthz", "host": "localhost"},
            "dashboard-api": {"name": "Dashboard API", "port": 3002, "external_port": 3002, "health": "/health", "host": "localhost"},
        })
        # Also patch the SERVICES imported in main module
        monkeypatch.setattr("main.SERVICES", config.SERVICES)

        resp = test_client.get("/api/external-links", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        link_ids = [link["id"] for link in data]
        assert "open-webui" in link_ids
        assert "n8n" in link_ids

    def test_excludes_dashboard_api(self, test_client, monkeypatch):
        import config
        monkeypatch.setattr(config, "SERVICES", {
            "dashboard-api": {"name": "Dashboard API", "port": 3002, "external_port": 3002, "health": "/health", "host": "localhost"},
        })
        monkeypatch.setattr("main.SERVICES", config.SERVICES)

        resp = test_client.get("/api/external-links", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 0


# --- /api/storage ---


class TestApiStorage:

    def test_returns_storage_breakdown(self, test_client, monkeypatch):
        from models import DiskUsage
        monkeypatch.setattr("main.get_disk_usage", lambda: DiskUsage(
            path="/tmp", used_gb=100.0, total_gb=500.0, percent=20.0,
        ))
        monkeypatch.setattr("main.DATA_DIR", "/tmp/dream-test-nonexistent-data")

        resp = test_client.get("/api/storage", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "models" in data
        assert "vector_db" in data
        assert "total_data" in data
        assert "disk" in data
        assert data["disk"]["total_gb"] == 500.0
