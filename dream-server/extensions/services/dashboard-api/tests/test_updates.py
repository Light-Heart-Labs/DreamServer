"""Tests for updates router endpoints."""

import json
from unittest.mock import patch, MagicMock, AsyncMock

import httpx


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


def test_get_version_with_mock_github(test_client, monkeypatch):
    """GET /api/version with mocked GitHub API → returns update info.

    The router fetches releases via ``httpx.AsyncClient`` (see
    ``routers/updates.py::_refresh_release_cache``) and caches the payload
    in a module-level global. Patch the client at the point of use and
    reset the cache/refresh-task globals so the mocked path is exercised
    rather than a leftover payload from a previously-run test.
    """
    import routers.updates as updates_mod

    monkeypatch.setattr(updates_mod, "_version_cache", {"expires_at": 0.0, "payload": None})
    monkeypatch.setattr(updates_mod, "_version_refresh_task", None)

    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "tag_name": "v2.0.0",
        "html_url": "https://github.com/test",
    }

    async def mock_get(url, **kwargs):
        return mock_resp

    mock_client = AsyncMock()
    mock_client.get = mock_get
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.updates.httpx.AsyncClient", return_value=mock_client):
        resp = test_client.get("/api/version", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["latest"] == "2.0.0"
    assert data["changelog_url"] == "https://github.com/test"


def test_get_releases_manifest_requires_auth(test_client):
    """GET /api/releases/manifest without auth → 401."""
    resp = test_client.get("/api/releases/manifest")
    assert resp.status_code == 401


def test_get_releases_manifest_authenticated(test_client):
    """GET /api/releases/manifest with auth → 200, returns release list.

    The router calls ``api.github.com/.../releases`` through
    ``httpx.AsyncClient`` (see ``routers/updates.py::get_release_manifest``).
    Intercept the client with an ``AsyncMock`` that returns a minimal
    releases payload so the test exercises the authenticated happy path
    deterministically, without hitting the real GitHub API (which may
    rate-limit and return a non-list error object).
    """
    mock_resp = MagicMock()
    mock_resp.json.return_value = [
        {
            "tag_name": "v1.0.0",
            "published_at": "2025-01-01T00:00:00Z",
            "name": "Release 1.0.0",
            "body": "Initial release",
            "html_url": "https://github.com/test/releases/v1.0.0",
            "prerelease": False,
        },
    ]

    async def mock_get(url, **kwargs):
        return mock_resp

    mock_client = AsyncMock()
    mock_client.get = mock_get
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.updates.httpx.AsyncClient", return_value=mock_client):
        resp = test_client.get("/api/releases/manifest", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert "releases" in data
    assert "checked_at" in data
    assert isinstance(data["releases"], list)
    assert len(data["releases"]) == 1
    assert data["releases"][0]["version"] == "1.0.0"


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


# ---------------------------------------------------------------------------
# /api/releases/manifest — mocked httpx
# ---------------------------------------------------------------------------


def test_releases_manifest_with_mocked_github(test_client):
    """GET /api/releases/manifest with mocked httpx → returns parsed releases."""
    releases = [
        {
            "tag_name": "v1.5.0",
            "published_at": "2025-12-01T00:00:00Z",
            "name": "Release 1.5.0",
            "body": "Changelog body here",
            "html_url": "https://github.com/test/releases/v1.5.0",
            "prerelease": False,
        },
        {
            "tag_name": "v1.4.0",
            "published_at": "2025-11-01T00:00:00Z",
            "name": "Release 1.4.0",
            "body": "Older changelog",
            "html_url": "https://github.com/test/releases/v1.4.0",
            "prerelease": True,
        },
    ]

    mock_resp = MagicMock()
    mock_resp.json.return_value = releases

    async def mock_get(url, **kwargs):
        return mock_resp

    mock_client = AsyncMock()
    mock_client.get = mock_get
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.updates.httpx.AsyncClient", return_value=mock_client):
        resp = test_client.get("/api/releases/manifest", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["releases"]) == 2
    assert data["releases"][0]["version"] == "1.5.0"
    assert data["releases"][1]["prerelease"] is True
    assert "checked_at" in data


def test_releases_manifest_github_error_fallback(test_client, tmp_path, monkeypatch):
    """GET /api/releases/manifest falls back to local version on httpx error."""
    import routers.updates as updates_mod

    install_dir = tmp_path / "dream-server"
    install_dir.mkdir()
    (install_dir / ".version").write_text("1.2.3")
    monkeypatch.setattr(updates_mod, "INSTALL_DIR", str(install_dir))

    async def mock_get(url, **kwargs):
        raise httpx.HTTPError("connection failed")

    mock_client = AsyncMock()
    mock_client.get = mock_get
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.updates.httpx.AsyncClient", return_value=mock_client):
        resp = test_client.get("/api/releases/manifest", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["releases"]) == 1
    assert data["releases"][0]["version"] == "1.2.3"
    assert "error" in data


# ---------------------------------------------------------------------------
# /api/update/dry-run endpoint
# ---------------------------------------------------------------------------


def test_update_dry_run_requires_auth(test_client):
    """GET /api/update/dry-run without auth → 401."""
    resp = test_client.get("/api/update/dry-run")
    assert resp.status_code == 401


def test_update_dry_run_with_env_and_version(test_client, tmp_path, monkeypatch):
    """GET /api/update/dry-run reads .env and .version for current version."""
    import routers.updates as updates_mod

    install_dir = tmp_path / "dream-server"
    install_dir.mkdir()

    env_content = (
        "# Dream Server\n"
        "DREAM_VERSION=1.3.0\n"
        "TIER=mid\n"
        "GPU_BACKEND=nvidia\n"
        "LLM_MODEL=qwen3-coder-next\n"
        "SOME_OTHER_KEY=ignored\n"
    )
    (install_dir / ".env").write_text(env_content)

    monkeypatch.setattr(updates_mod, "INSTALL_DIR", str(install_dir))

    # Mock urllib so we do not hit GitHub
    with patch("urllib.request.urlopen", side_effect=OSError("mocked")):
        resp = test_client.get("/api/update/dry-run", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["dry_run"] is True
    assert data["current_version"] == "1.3.0"
    assert data["latest_version"] is None
    assert data["update_available"] is False
    # env_keys should only contain keys in _UPDATE_ENV_KEYS
    assert "DREAM_VERSION" in data["env_keys"]
    assert "TIER" in data["env_keys"]
    assert "GPU_BACKEND" in data["env_keys"]
    assert "LLM_MODEL" in data["env_keys"]
    assert "SOME_OTHER_KEY" not in data["env_keys"]


def test_update_dry_run_version_from_version_file(test_client, tmp_path, monkeypatch):
    """GET /api/update/dry-run falls back to .version file when .env has no DREAM_VERSION."""
    import routers.updates as updates_mod

    install_dir = tmp_path / "dream-server"
    install_dir.mkdir()
    (install_dir / ".version").write_text("2.0.1")

    monkeypatch.setattr(updates_mod, "INSTALL_DIR", str(install_dir))

    with patch("urllib.request.urlopen", side_effect=OSError("mocked")):
        resp = test_client.get("/api/update/dry-run", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_version"] == "2.0.1"


def test_update_dry_run_version_from_json_version_file(test_client, tmp_path, monkeypatch):
    """GET /api/update/dry-run reads JSON-formatted .version file."""
    import routers.updates as updates_mod

    install_dir = tmp_path / "dream-server"
    install_dir.mkdir()
    (install_dir / ".version").write_text(json.dumps({"version": "3.1.4"}))

    monkeypatch.setattr(updates_mod, "INSTALL_DIR", str(install_dir))

    with patch("urllib.request.urlopen", side_effect=OSError("mocked")):
        resp = test_client.get("/api/update/dry-run", headers=test_client.auth_headers)

    assert resp.status_code == 200
    assert resp.json()["current_version"] == "3.1.4"


def test_update_dry_run_reads_compose_images(test_client, tmp_path, monkeypatch):
    """GET /api/update/dry-run extracts image tags from docker-compose files."""
    import routers.updates as updates_mod

    install_dir = tmp_path / "dream-server"
    install_dir.mkdir()

    compose_content = (
        "services:\n"
        "  app:\n"
        "    image: ghcr.io/dream/server:latest\n"
        "  db:\n"
        "    image: postgres:16\n"
    )
    (install_dir / "docker-compose.base.yml").write_text(compose_content)
    monkeypatch.setattr(updates_mod, "INSTALL_DIR", str(install_dir))

    with patch("urllib.request.urlopen", side_effect=OSError("mocked")):
        resp = test_client.get("/api/update/dry-run", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert "ghcr.io/dream/server:latest" in data["images"] or " ghcr.io/dream/server" in str(data["images"])
    assert len(data["images"]) >= 1


def test_update_dry_run_no_files(test_client, tmp_path, monkeypatch):
    """GET /api/update/dry-run with no .env or .version → defaults to 0.0.0."""
    import routers.updates as updates_mod

    install_dir = tmp_path / "dream-server"
    install_dir.mkdir()
    monkeypatch.setattr(updates_mod, "INSTALL_DIR", str(install_dir))

    with patch("urllib.request.urlopen", side_effect=OSError("mocked")):
        resp = test_client.get("/api/update/dry-run", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert data["current_version"] == "0.0.0"
    assert data["env_keys"] == {}
    assert data["images"] == []


# ---------------------------------------------------------------------------
# POST /api/update — invalid action
# ---------------------------------------------------------------------------


def test_trigger_update_invalid_action(test_client, tmp_path, monkeypatch):
    """POST /api/update with unknown action → 400."""
    import routers.updates as updates_mod

    # Create a fake script so we get past the 501 check
    install_dir = tmp_path / "dream-server"
    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir()
    script = scripts_dir / "dream-update.sh"
    script.write_text("#!/bin/bash\nexit 0")
    script.chmod(0o755)
    monkeypatch.setattr(updates_mod, "INSTALL_DIR", str(install_dir))

    resp = test_client.post(
        "/api/update",
        json={"action": "destroy"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400
    assert "Unknown action" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# POST /api/update — "update" action returns background message
# ---------------------------------------------------------------------------


def test_trigger_update_action_update(test_client, tmp_path, monkeypatch):
    """POST /api/update with action=update → 200, starts background task."""
    import routers.updates as updates_mod

    install_dir = tmp_path / "dream-server"
    install_dir.mkdir()
    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir()
    script = scripts_dir / "dream-update.sh"
    script.write_text("#!/bin/bash\nexit 0")
    script.chmod(0o755)
    monkeypatch.setattr(updates_mod, "INSTALL_DIR", str(install_dir))

    resp = test_client.post(
        "/api/update",
        json={"action": "update"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "background" in data["message"].lower()


# ---------------------------------------------------------------------------
# POST /api/update — "check" action with script present
# ---------------------------------------------------------------------------


def test_trigger_update_action_check(test_client, tmp_path, monkeypatch):
    """POST /api/update with action=check → 200, runs script and returns output."""
    import routers.updates as updates_mod

    install_dir = tmp_path / "dream-server"
    install_dir.mkdir()
    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir()
    script = scripts_dir / "dream-update.sh"
    script.write_text("#!/bin/bash\necho 'no updates'\nexit 0")
    script.chmod(0o755)
    monkeypatch.setattr(updates_mod, "INSTALL_DIR", str(install_dir))

    resp = test_client.post(
        "/api/update",
        json={"action": "check"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["update_available"] is False
    assert "no updates" in data["output"]


# ---------------------------------------------------------------------------
# POST /api/update — "backup" action
# ---------------------------------------------------------------------------


def test_trigger_update_action_backup(test_client, tmp_path, monkeypatch):
    """POST /api/update with action=backup → 200, runs backup script."""
    import routers.updates as updates_mod

    install_dir = tmp_path / "dream-server"
    install_dir.mkdir()
    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir()
    script = scripts_dir / "dream-update.sh"
    script.write_text("#!/bin/bash\necho 'backup complete'\nexit 0")
    script.chmod(0o755)
    monkeypatch.setattr(updates_mod, "INSTALL_DIR", str(install_dir))

    resp = test_client.post(
        "/api/update",
        json={"action": "backup"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "backup" in data["output"].lower()
