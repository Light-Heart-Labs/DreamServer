"""Tests for updates router endpoints."""

from unittest.mock import patch, MagicMock


def test_get_version_requires_auth(test_client):
    """GET /api/version without auth → 401."""
    resp = test_client.get("/api/version")
    assert resp.status_code == 401


def test_get_version_authenticated(test_client):
    """GET /api/version with auth → 200, returns version info."""
    resp = test_client.get("/api/version", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "current" in data
    assert "latest" in data
    assert "update_available" in data
    assert "checked_at" in data


def test_get_version_with_mock_github(test_client):
    """GET /api/version with mocked GitHub API → returns update info."""
    mock_response = MagicMock()
    mock_response.read.return_value = b'{"tag_name": "v2.0.0", "html_url": "https://github.com/test"}'
    mock_response.__enter__ = lambda self: self
    mock_response.__exit__ = lambda self, *args: None

    with patch("urllib.request.urlopen", return_value=mock_response):
        resp = test_client.get("/api/version", headers=test_client.auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["latest"] == "2.0.0"
        assert "changelog_url" in data


def test_get_releases_manifest_requires_auth(test_client):
    """GET /api/releases/manifest without auth → 401."""
    resp = test_client.get("/api/releases/manifest")
    assert resp.status_code == 401


def test_get_releases_manifest_authenticated(test_client):
    """GET /api/releases/manifest with auth → 200, returns release list."""
    resp = test_client.get("/api/releases/manifest", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "releases" in data
    assert "checked_at" in data
    assert isinstance(data["releases"], list)


def test_trigger_update_requires_auth(test_client):
    """POST /api/update without auth → 401."""
    resp = test_client.post("/api/update", json={"action": "check"})
    assert resp.status_code == 401


def test_trigger_update_no_script(test_client):
    """POST /api/update when update script is missing → 501."""
    resp = test_client.post(
        "/api/update",
        json={"action": "check"},
        headers=test_client.auth_headers
    )
    assert resp.status_code == 501
