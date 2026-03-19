"""Tests for privacy router endpoints."""

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
