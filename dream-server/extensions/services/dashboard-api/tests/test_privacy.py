"""Tests for privacy router endpoints."""

import asyncio
import urllib.error

import aiohttp
from unittest.mock import patch, AsyncMock, MagicMock


def test_privacy_shield_toggle_requires_auth(test_client):
    """POST /api/privacy-shield/toggle without auth → 401."""
    resp = test_client.post("/api/privacy-shield/toggle", json={"enabled": True})
    assert resp.status_code == 401


def test_privacy_shield_stats_requires_auth(test_client):
    """GET /api/privacy-shield/stats without auth → 401."""
    resp = test_client.get("/api/privacy-shield/stats")
    assert resp.status_code == 401


def test_privacy_shield_stats_authenticated(test_client):
    """GET /api/privacy-shield/stats with auth → 200, returns stats."""
    async def _fake_create_subprocess(*args, **kwargs):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b'{"requests": 0}', b""))
        proc.returncode = 0
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=_fake_create_subprocess):
        resp = test_client.get("/api/privacy-shield/stats", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, dict)


# ---------------------------------------------------------------------------
# /api/privacy-shield/status — health-based detection
# ---------------------------------------------------------------------------


def test_privacy_shield_status_healthy(test_client):
    """GET /api/privacy-shield/status when health endpoint responds 200."""
    resp_mock = AsyncMock()
    resp_mock.status = 200

    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=resp_mock)
    ctx.__aexit__ = AsyncMock(return_value=False)

    session_mock = MagicMock()
    session_mock.get = MagicMock(return_value=ctx)
    session_ctx = AsyncMock()
    session_ctx.__aenter__ = AsyncMock(return_value=session_mock)
    session_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.privacy.aiohttp.ClientSession", return_value=session_ctx):
        resp = test_client.get("/api/privacy-shield/status", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["enabled"] is True
    assert data["container_running"] is True


def test_privacy_shield_status_not_running(test_client):
    """GET /api/privacy-shield/status when health endpoint fails."""
    session_mock = MagicMock()
    session_mock.get = MagicMock(side_effect=aiohttp.ClientError("refused"))
    session_ctx = AsyncMock()
    session_ctx.__aenter__ = AsyncMock(return_value=session_mock)
    session_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.privacy.aiohttp.ClientSession", return_value=session_ctx):
        resp = test_client.get("/api/privacy-shield/status", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["enabled"] is False
    assert data["container_running"] is False


# ---------------------------------------------------------------------------
# /api/privacy-shield/toggle — host agent API
# ---------------------------------------------------------------------------


def test_privacy_shield_toggle_enable_success(test_client):
    """POST /api/privacy-shield/toggle enable=True → success via host agent."""
    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)

    with patch("routers.privacy.urllib.request.urlopen", return_value=mock_resp):
        resp = test_client.post(
            "/api/privacy-shield/toggle",
            json={"enable": True},
            headers=test_client.auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "started" in data["message"].lower() or "active" in data["message"].lower()


def test_privacy_shield_toggle_disable_success(test_client):
    """POST /api/privacy-shield/toggle enable=False → success via host agent."""
    mock_resp = MagicMock()
    mock_resp.status = 200
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)

    with patch("routers.privacy.urllib.request.urlopen", return_value=mock_resp):
        resp = test_client.post(
            "/api/privacy-shield/toggle",
            json={"enable": False},
            headers=test_client.auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "stopped" in data["message"].lower()


def test_privacy_shield_toggle_agent_failure(test_client):
    """POST /api/privacy-shield/toggle when host agent returns failure."""
    mock_resp = MagicMock()
    mock_resp.status = 500
    mock_resp.__enter__ = MagicMock(return_value=mock_resp)
    mock_resp.__exit__ = MagicMock(return_value=False)

    with patch("routers.privacy.urllib.request.urlopen", return_value=mock_resp):
        resp = test_client.post(
            "/api/privacy-shield/toggle",
            json={"enable": True},
            headers=test_client.auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False


def test_privacy_shield_toggle_agent_unreachable(test_client):
    """POST /api/privacy-shield/toggle when host agent is not reachable."""
    with patch("routers.privacy.urllib.request.urlopen",
               side_effect=urllib.error.URLError("Connection refused")):
        resp = test_client.post(
            "/api/privacy-shield/toggle",
            json={"enable": True},
            headers=test_client.auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert "host agent" in data["message"].lower()


def test_privacy_shield_toggle_timeout(test_client):
    """POST /api/privacy-shield/toggle when operation times out."""
    with patch("routers.privacy.urllib.request.urlopen",
               side_effect=asyncio.TimeoutError()):
        resp = test_client.post(
            "/api/privacy-shield/toggle",
            json={"enable": True},
            headers=test_client.auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert "timed out" in data["message"].lower()


def test_privacy_shield_toggle_os_error(test_client):
    """POST /api/privacy-shield/toggle when OS error occurs."""
    with patch("routers.privacy.urllib.request.urlopen",
               side_effect=OSError("broken")):
        resp = test_client.post(
            "/api/privacy-shield/toggle",
            json={"enable": True},
            headers=test_client.auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False


# ---------------------------------------------------------------------------
# /api/privacy-shield/stats — success and error paths
# ---------------------------------------------------------------------------


def test_privacy_shield_stats_success(test_client):
    """GET /api/privacy-shield/stats with mocked healthy response."""
    resp_mock = AsyncMock()
    resp_mock.status = 200
    resp_mock.json = AsyncMock(return_value={"requests": 42, "pii_detected": 3})

    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=resp_mock)
    ctx.__aexit__ = AsyncMock(return_value=False)

    session_mock = MagicMock()
    session_mock.get = MagicMock(return_value=ctx)
    session_ctx = AsyncMock()
    session_ctx.__aenter__ = AsyncMock(return_value=session_mock)
    session_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.privacy.aiohttp.ClientSession", return_value=session_ctx):
        resp = test_client.get("/api/privacy-shield/stats", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["requests"] == 42


def test_privacy_shield_stats_non_200(test_client):
    """GET /api/privacy-shield/stats when service returns non-200."""
    resp_mock = AsyncMock()
    resp_mock.status = 503

    ctx = AsyncMock()
    ctx.__aenter__ = AsyncMock(return_value=resp_mock)
    ctx.__aexit__ = AsyncMock(return_value=False)

    session_mock = MagicMock()
    session_mock.get = MagicMock(return_value=ctx)
    session_ctx = AsyncMock()
    session_ctx.__aenter__ = AsyncMock(return_value=session_mock)
    session_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.privacy.aiohttp.ClientSession", return_value=session_ctx):
        resp = test_client.get("/api/privacy-shield/stats", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert "error" in data


def test_privacy_shield_stats_connection_error(test_client):
    """GET /api/privacy-shield/stats when service is unreachable."""
    session_mock = MagicMock()
    session_mock.get = MagicMock(side_effect=aiohttp.ClientError("refused"))
    session_ctx = AsyncMock()
    session_ctx.__aenter__ = AsyncMock(return_value=session_mock)
    session_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.privacy.aiohttp.ClientSession", return_value=session_ctx):
        resp = test_client.get("/api/privacy-shield/stats", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert "error" in data
    assert data["enabled"] is False
