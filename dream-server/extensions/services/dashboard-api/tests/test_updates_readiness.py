"""Tests for update readiness API endpoints and helpers."""

from __future__ import annotations

from pathlib import Path


def test_update_readiness_includes_expected_sections(test_client, monkeypatch):
    """GET /api/update/readiness should return update, compatibility, and rollback sections."""
    import routers.updates as updates_router

    async def _fake_get_version():
        return {
            "current": "2.0.0",
            "latest": "2.1.0",
            "update_available": True,
            "changelog_url": "https://example.com/release",
            "checked_at": "2026-03-17T00:00:00Z",
        }

    monkeypatch.setattr(updates_router, "get_version", _fake_get_version)
    monkeypatch.setattr(
        updates_router,
        "_resolve_update_script_for_readiness",
        lambda: Path("/tmp/dream-update.sh"),
    )
    monkeypatch.setattr(
        updates_router,
        "_check_compatibility_status",
        lambda: {
            "available": True,
            "ok": True,
            "checked_at": "2026-03-17T00:00:00Z",
            "details": "[PASS] compatibility check complete",
        },
    )
    monkeypatch.setattr(
        updates_router,
        "_collect_rollback_state",
        lambda: {
            "backup_dir": "/tmp/backups",
            "backup_count": 2,
            "latest_backup": "backup-20260317-120000",
            "available": True,
        },
    )

    resp = test_client.get("/api/update/readiness", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["current"] == "2.0.0"
    assert data["latest"] == "2.1.0"
    assert data["update_system"]["available"] is True
    assert data["compatibility"]["ok"] is True
    assert data["rollback"]["backup_count"] == 2


def test_update_readiness_without_update_script(test_client, monkeypatch):
    """GET /api/update/readiness should expose unavailable update script state cleanly."""
    import routers.updates as updates_router

    async def _fake_get_version():
        return {
            "current": "2.0.0",
            "latest": None,
            "update_available": False,
            "changelog_url": None,
            "checked_at": "2026-03-17T00:00:00Z",
        }

    monkeypatch.setattr(updates_router, "get_version", _fake_get_version)
    monkeypatch.setattr(
        updates_router,
        "_resolve_update_script_for_readiness",
        lambda: None,
    )
    monkeypatch.setattr(
        updates_router,
        "_check_compatibility_status",
        lambda: {
            "available": False,
            "ok": None,
            "checked_at": "2026-03-17T00:00:00Z",
            "details": "check-compatibility.sh not found",
        },
    )
    monkeypatch.setattr(
        updates_router,
        "_collect_rollback_state",
        lambda: {
            "backup_dir": "/tmp/backups",
            "backup_count": 0,
            "latest_backup": None,
            "available": False,
        },
    )

    resp = test_client.get("/api/update/readiness", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["update_system"]["available"] is False
    assert data["compatibility"]["available"] is False
    assert data["rollback"]["available"] is False


def test_collect_rollback_state_reads_data_dir(monkeypatch, tmp_path):
    """Rollback helper should enumerate backups from DREAM_DATA_DIR/backups."""
    import routers.updates as updates_router

    data_dir = tmp_path / "dream-data"
    backups_dir = data_dir / "backups"
    backups_dir.mkdir(parents=True)
    (backups_dir / "backup-20260317-120000").mkdir()
    (backups_dir / "backup-20260316-090000").mkdir()

    monkeypatch.setenv("DREAM_DATA_DIR", str(data_dir))

    state = updates_router._collect_rollback_state()
    assert state["available"] is True
    assert state["backup_count"] == 2
    assert state["latest_backup"] == "backup-20260317-120000"

