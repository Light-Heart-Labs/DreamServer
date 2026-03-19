"""Router-level integration tests for the Dream Server Dashboard API."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch



# ---------------------------------------------------------------------------
# Health & Core
# ---------------------------------------------------------------------------


def test_health_returns_ok(test_client):
    """GET /health should return 200 with status 'ok' — no auth required."""
    resp = test_client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "timestamp" in data


# ---------------------------------------------------------------------------
# Auth enforcement — no Bearer token → 401
# ---------------------------------------------------------------------------


def test_setup_status_requires_auth(test_client):
    """GET /api/setup/status without auth header → 401."""
    resp = test_client.get("/api/setup/status")
    assert resp.status_code == 401


def test_api_status_requires_auth(test_client):
    """GET /api/status without auth header → 401."""
    resp = test_client.get("/api/status")
    assert resp.status_code == 401


def test_privacy_shield_status_requires_auth(test_client):
    """GET /api/privacy-shield/status without auth header → 401."""
    resp = test_client.get("/api/privacy-shield/status")
    assert resp.status_code == 401


def test_workflows_requires_auth(test_client):
    """GET /api/workflows without auth header → 401."""
    resp = test_client.get("/api/workflows")
    assert resp.status_code == 401


def test_agents_metrics_requires_auth(test_client):
    """GET /api/agents/metrics without auth header → 401."""
    resp = test_client.get("/api/agents/metrics")
    assert resp.status_code == 401


def test_agents_cluster_requires_auth(test_client):
    """GET /api/agents/cluster without auth header → 401."""
    resp = test_client.get("/api/agents/cluster")
    assert resp.status_code == 401


def test_agents_throughput_requires_auth(test_client):
    """GET /api/agents/throughput without auth header → 401."""
    resp = test_client.get("/api/agents/throughput")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Setup router
# ---------------------------------------------------------------------------


def test_setup_status_authenticated(test_client, setup_config_dir):
    """GET /api/setup/status with auth → 200, returns first_run and personas_available."""
    resp = test_client.get("/api/setup/status", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "first_run" in data
    assert "personas_available" in data
    assert isinstance(data["personas_available"], list)
    assert len(data["personas_available"]) > 0


def test_setup_status_first_run_true(test_client, setup_config_dir):
    """first_run is True when setup-complete.json does not exist."""
    resp = test_client.get("/api/setup/status", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert resp.json()["first_run"] is True


def test_setup_status_first_run_false(test_client, setup_config_dir):
    """first_run is False when setup-complete.json exists."""
    (setup_config_dir / "setup-complete.json").write_text('{"completed_at": "now"}')
    resp = test_client.get("/api/setup/status", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert resp.json()["first_run"] is False


def test_setup_persona_valid(test_client, setup_config_dir):
    """POST /api/setup/persona with valid persona → 200, writes persona.json."""
    resp = test_client.post(
        "/api/setup/persona",
        json={"persona": "general"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["persona"] == "general"
    persona_file = setup_config_dir / "persona.json"
    assert persona_file.exists()


def test_setup_persona_invalid(test_client, setup_config_dir):
    """POST /api/setup/persona with invalid persona → 400."""
    resp = test_client.post(
        "/api/setup/persona",
        json={"persona": "nonexistent-persona"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400


def test_setup_complete(test_client, setup_config_dir):
    """POST /api/setup/complete → 200, writes setup-complete.json."""
    resp = test_client.post("/api/setup/complete", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert (setup_config_dir / "setup-complete.json").exists()


def test_list_personas(test_client):
    """GET /api/setup/personas → 200, returns list with at least general/coding/creative."""
    resp = test_client.get("/api/setup/personas", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "personas" in data
    persona_ids = [p["id"] for p in data["personas"]]
    assert "general" in persona_ids
    assert "coding" in persona_ids


def test_get_persona_info_existing(test_client):
    """GET /api/setup/persona/general → 200 with persona details."""
    resp = test_client.get("/api/setup/persona/general", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "general"
    assert "name" in data
    assert "system_prompt" in data


def test_get_persona_info_nonexistent(test_client):
    """GET /api/setup/persona/nonexistent → 404."""
    resp = test_client.get("/api/setup/persona/nonexistent", headers=test_client.auth_headers)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Preflight endpoints
# ---------------------------------------------------------------------------


def test_preflight_ports_empty_list(test_client):
    """POST /api/preflight/ports with empty ports list → 200, no conflicts."""
    resp = test_client.post(
        "/api/preflight/ports",
        json={"ports": []},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["conflicts"] == []
    assert data["available"] is True


def test_preflight_required_ports_no_auth(test_client):
    """GET /api/preflight/required-ports → 200, no auth required."""
    resp = test_client.get("/api/preflight/required-ports")
    assert resp.status_code == 200
    data = resp.json()
    assert "ports" in data
    assert isinstance(data["ports"], list)


def test_preflight_docker_authenticated(test_client):
    """GET /api/preflight/docker with auth → 200, returns docker availability."""
    resp = test_client.get("/api/preflight/docker", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "available" in data
    if data["available"]:
        assert "version" in data


def test_preflight_gpu_authenticated(test_client):
    """GET /api/preflight/gpu with auth → 200, returns GPU info or error."""
    resp = test_client.get("/api/preflight/gpu", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "available" in data
    if data["available"]:
        assert "name" in data
        assert "vram" in data
        assert "backend" in data
    else:
        assert "error" in data


def test_preflight_disk_authenticated(test_client):
    """GET /api/preflight/disk with auth → 200, returns disk space info."""
    resp = test_client.get("/api/preflight/disk", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "free" in data
    assert "total" in data
    assert "used" in data
    assert "path" in data


# ---------------------------------------------------------------------------
# Workflow path-traversal and catalog miss
# ---------------------------------------------------------------------------


def test_workflow_enable_path_traversal(test_client):
    """POST with path-traversal chars in workflow_id → 400 (regex rejects it)."""
    resp = test_client.post(
        "/api/workflows/../../etc/passwd/enable",
        headers=test_client.auth_headers,
    )
    # FastAPI path matching will either 404 (no route match) or 400 (validation).
    # Either is acceptable — the traversal must NOT succeed (not 200).
    assert resp.status_code in (400, 404, 422)


def test_workflow_enable_unknown_id(test_client):
    """POST /api/workflows/valid-id/enable → 404 when not in catalog."""
    resp = test_client.post(
        "/api/workflows/valid-id/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Privacy Shield (mock subprocess so docker is not required)
# ---------------------------------------------------------------------------


def test_privacy_shield_status_with_mock(test_client):
    """GET /api/privacy-shield/status → 200 with mocked docker subprocess."""

    async def _fake_create_subprocess(*args, **kwargs):
        proc = MagicMock()
        proc.communicate = AsyncMock(return_value=(b"", b""))
        proc.returncode = 0
        return proc

    with patch("asyncio.create_subprocess_exec", side_effect=_fake_create_subprocess):
        resp = test_client.get(
            "/api/privacy-shield/status",
            headers=test_client.auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "enabled" in data
    assert "container_running" in data
    assert "port" in data


# ---------------------------------------------------------------------------
# Runtime router (settings + voice + diagnostics)
# ---------------------------------------------------------------------------


def test_api_settings_returns_expected_shape(test_client, tmp_path, monkeypatch):
    """GET /api/settings returns dynamic values and storage summary."""
    import routers.runtime as runtime_router

    version_file = tmp_path / ".version"
    version_file.write_text("2.6.4")

    setup_file = tmp_path / "setup-complete.json"
    setup_file.write_text(json.dumps({"completed_at": "2026-03-10T10:11:12Z"}))

    monkeypatch.setattr(runtime_router, "_VERSION_FILE", version_file)
    monkeypatch.setattr(runtime_router, "_SETUP_COMPLETE_FILE", setup_file)
    monkeypatch.setattr(runtime_router, "get_disk_usage", lambda: SimpleNamespace(path="/tmp", used_gb=10.5, total_gb=200.0, percent=5.3))
    monkeypatch.setattr(runtime_router, "get_uptime", lambda: 3723)
    monkeypatch.setattr(runtime_router, "_resolve_tier", lambda: "Prosumer")

    resp = test_client.get("/api/settings", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == "2.6.4"
    assert data["installDate"] == "Mar 10, 2026"
    assert data["tier"] == "Prosumer"
    assert data["uptime"] == "1h 2m"
    assert data["storage"]["path"] == "/tmp"
    assert data["storage"]["percent"] == 5.3
    assert "generatedAt" in data


def test_voice_settings_defaults_then_save_roundtrip(test_client, tmp_path, monkeypatch):
    """GET returns defaults; POST persists voice settings; GET returns persisted values."""
    import routers.runtime as runtime_router

    settings_file = tmp_path / "voice-settings.json"
    monkeypatch.setattr(runtime_router, "_VOICE_SETTINGS_FILE", settings_file)

    get_default = test_client.get("/api/voice/settings", headers=test_client.auth_headers)
    assert get_default.status_code == 200
    assert get_default.json() == {"voice": "default", "speed": 1.0, "wakeWord": False}

    save_resp = test_client.post(
        "/api/voice/settings",
        json={"voice": "jenny", "speed": 1.3, "wakeWord": True},
        headers=test_client.auth_headers,
    )
    assert save_resp.status_code == 200
    assert save_resp.json()["success"] is True
    assert settings_file.exists()

    get_saved = test_client.get("/api/voice/settings", headers=test_client.auth_headers)
    assert get_saved.status_code == 200
    assert get_saved.json() == {"voice": "jenny", "speed": 1.3, "wakeWord": True}


def test_voice_status_aggregates_service_health(test_client, monkeypatch):
    """GET /api/voice/status reports stt, tts, and livekit health plus available=true."""
    import routers.runtime as runtime_router

    stt = {"id": "whisper", "name": "Whisper (STT)", "status": "healthy", "responseTimeMs": 12.1, "checkedAt": "x", "url": "http://whisper:8000/health"}
    tts = {"id": "tts", "name": "Kokoro (TTS)", "status": "healthy", "responseTimeMs": 14.9, "checkedAt": "x", "url": "http://tts:8880/health"}
    livekit = {"id": "livekit", "name": "LiveKit", "status": "healthy", "responseTimeMs": 9.0, "checkedAt": "x", "url": "http://livekit:7880"}

    monkeypatch.setattr(runtime_router, "_check_service", AsyncMock(side_effect=[stt, tts]))
    monkeypatch.setattr(runtime_router, "_check_livekit", AsyncMock(return_value=livekit))

    resp = test_client.get("/api/voice/status", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["available"] is True
    assert data["services"]["stt"]["status"] == "healthy"
    assert data["services"]["tts"]["status"] == "healthy"
    assert data["services"]["livekit"]["status"] == "healthy"


def test_voice_token_requires_livekit_credentials(test_client, monkeypatch):
    """POST /api/voice/token returns 503 when LIVEKIT credentials are missing."""
    monkeypatch.delenv("LIVEKIT_API_KEY", raising=False)
    monkeypatch.delenv("LIVEKIT_API_SECRET", raising=False)

    resp = test_client.post(
        "/api/voice/token",
        json={"identity": "dashboard-test", "room": "dream-voice"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 503
    assert "not configured" in resp.json()["detail"]


def test_voice_token_returns_jwt_with_credentials(test_client, monkeypatch):
    """POST /api/voice/token returns a JWT-like token when credentials exist."""
    monkeypatch.setenv("LIVEKIT_API_KEY", "livekit-key")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "super-secret")
    monkeypatch.setenv("LIVEKIT_URL", "ws://livekit:7880")

    resp = test_client.post(
        "/api/voice/token",
        json={"identity": "dashboard-test", "room": "dream-voice", "ttlSeconds": 600},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["room"] == "dream-voice"
    assert data["url"] == "ws://livekit:7880"
    assert len(data["token"].split(".")) == 3


def test_diagnostic_voice_endpoint_uses_voice_status(test_client, monkeypatch):
    """GET /api/test/voice maps to voice status and returns success bool."""
    import routers.runtime as runtime_router

    monkeypatch.setattr(
        runtime_router,
        "voice_status",
        AsyncMock(return_value={"available": True, "services": {"stt": {}, "tts": {}, "livekit": {}}, "message": "ok", "checkedAt": "now"}),
    )

    resp = test_client.get("/api/test/voice", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["feature"] == "voice"
    assert data["success"] is True


def test_diagnostic_unknown_target_returns_404(test_client):
    """Unknown diagnostics target should return 404."""
    resp = test_client.get("/api/test/not-a-real-target", headers=test_client.auth_headers)
    assert resp.status_code == 404
