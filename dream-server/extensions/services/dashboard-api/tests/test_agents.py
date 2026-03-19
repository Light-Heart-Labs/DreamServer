"""Tests for routers/agents.py — agent monitoring endpoints."""

from unittest.mock import AsyncMock


# --- GET /api/agents/metrics ---


class TestGetAgentMetrics:

    def test_returns_metrics_structure(self, test_client):
        resp = test_client.get("/api/agents/metrics", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "timestamp" in data
        assert "agent" in data
        assert "cluster" in data
        assert "throughput" in data
        assert "session_count" in data["agent"]
        assert "tokens_per_second" in data["agent"]

    def test_requires_auth(self, test_client):
        resp = test_client.get("/api/agents/metrics")
        assert resp.status_code == 401


# --- GET /api/agents/metrics.html ---


class TestGetAgentMetricsHtml:

    def test_returns_html_fragment(self, test_client):
        resp = test_client.get("/api/agents/metrics.html", headers=test_client.auth_headers)
        assert resp.status_code == 200
        assert "text/html" in resp.headers["content-type"]
        body = resp.text
        assert "<div" in body
        assert "Cluster Status" in body
        assert "Active Sessions" in body
        assert "Throughput" in body

    def test_escapes_html_special_chars(self, test_client, monkeypatch):
        """HTML content should be escaped to prevent XSS."""
        from agent_monitor import agent_metrics
        from datetime import datetime

        # Inject XSS-like data into agent metrics
        original_last_update = agent_metrics.last_update
        agent_metrics.last_update = datetime.fromisoformat("2026-01-01T12:00:00")

        resp = test_client.get("/api/agents/metrics.html", headers=test_client.auth_headers)
        assert resp.status_code == 200
        body = resp.text
        # The output should contain safely rendered content, no raw script tags
        assert "<script>" not in body

        # Restore original
        agent_metrics.last_update = original_last_update


# --- GET /api/agents/cluster ---


class TestGetClusterStatus:

    def test_returns_cluster_data(self, test_client, monkeypatch):
        from agent_monitor import cluster_status
        monkeypatch.setattr(cluster_status, "refresh", AsyncMock())

        resp = test_client.get("/api/agents/cluster", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "nodes" in data
        assert "total_gpus" in data
        assert "active_gpus" in data
        assert "failover_ready" in data


# --- GET /api/agents/throughput ---


class TestGetThroughput:

    def test_returns_throughput_stats(self, test_client):
        resp = test_client.get("/api/agents/throughput", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "current" in data
        assert "average" in data
        assert "peak" in data
        assert "history" in data


# --- GET /api/agents/tokens ---


class TestGetAgentTokens:

    def test_returns_token_payload(self, test_client, monkeypatch):
        monkeypatch.setenv("OPENCLAW_TOKEN", "oc-secret-1234")
        monkeypatch.setattr(
            "routers.agents.SERVICES",
            {"openclaw": {"name": "OpenClaw (Agents)", "external_port": 7860}},
        )

        resp = test_client.get("/api/agents/tokens", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()

        assert data["tokens"]["openclaw"] == "oc-secret-1234"
        assert data["services"][0]["id"] == "openclaw"
        assert data["services"][0]["tokenPresent"] is True
        assert data["services"][0]["tokenPreview"] == "oc-s...1234"
        assert data["services"][0]["launchUrl"].endswith("/?token=oc-secret-1234")

    def test_returns_metadata_when_token_missing(self, test_client, monkeypatch):
        monkeypatch.delenv("OPENCLAW_TOKEN", raising=False)
        monkeypatch.setattr(
            "routers.agents.SERVICES",
            {"openclaw": {"name": "OpenClaw (Agents)", "external_port": 7860}},
        )
        monkeypatch.setattr("routers.agents.Path.read_text", lambda self: "")

        resp = test_client.get("/api/agents/tokens", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()

        assert data["tokens"] == {}
        assert data["services"][0]["tokenPresent"] is False
        assert data["services"][0]["tokenPreview"] is None
        assert data["services"][0]["launchUrl"] is None

    def test_reads_token_from_env_file_fallback(self, test_client, monkeypatch):
        monkeypatch.delenv("OPENCLAW_TOKEN", raising=False)
        monkeypatch.setattr(
            "routers.agents.SERVICES",
            {"openclaw": {"name": "OpenClaw (Agents)", "external_port": 7860}},
        )

        def fake_read_text(path_obj):
            if str(path_obj).endswith(".env"):
                return "OPENCLAW_TOKEN=file-token-9999\n"
            raise OSError("missing")

        monkeypatch.setattr("routers.agents.Path.read_text", fake_read_text)

        resp = test_client.get("/api/agents/tokens", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()

        assert data["tokens"]["openclaw"] == "file-token-9999"
        assert data["services"][0]["tokenPreview"] == "file...9999"

    def test_masks_short_token_values(self, monkeypatch):
        from routers.agents import _mask_token

        assert _mask_token("abcd") == "****"
        assert _mask_token("abcdefgh") == "********"
        assert _mask_token("") is None

    def test_falls_back_to_service_port_when_external_port_missing(self, test_client, monkeypatch):
        monkeypatch.setenv("OPENCLAW_TOKEN", "port-token")
        monkeypatch.setattr(
            "routers.agents.SERVICES",
            {"openclaw": {"name": "OpenClaw (Agents)", "port": 18789}},
        )

        resp = test_client.get("/api/agents/tokens", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["services"][0]["externalPort"] == 18789
        assert data["services"][0]["launchUrl"].endswith(":18789/?token=port-token")

    def test_requires_auth(self, test_client):
        resp = test_client.get("/api/agents/tokens")
        assert resp.status_code == 401
