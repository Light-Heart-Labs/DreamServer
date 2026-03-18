"""Router-level integration tests for the Dream Server Dashboard API."""

from __future__ import annotations

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


def test_voice_status_requires_auth(test_client):
    """GET /api/voice/status without auth header → 401."""
    resp = test_client.get("/api/voice/status")
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
# Voice router
# ---------------------------------------------------------------------------


def test_voice_status_authenticated(test_client, monkeypatch):
    """GET /api/voice/status with auth → 200 and structured service payload."""
    import routers.voice as voice_router

    async def fake_status():
        return {
            "available": True,
            "message": "Voice services ready",
            "services": {
                "stt": {"status": "healthy", "name": "Whisper (STT)", "port": 9000},
                "tts": {"status": "healthy", "name": "Kokoro (TTS)", "port": 8880},
                "livekit": {"status": "healthy", "name": "LiveKit", "port": 7880},
            },
        }

    monkeypatch.setattr(voice_router, "get_voice_status_payload", fake_status)

    resp = test_client.get("/api/voice/status", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["available"] is True
    assert "services" in data
    assert data["services"]["stt"]["status"] == "healthy"


def test_voice_settings_round_trip(test_client, tmp_path, monkeypatch):
    """Voice settings can be loaded, saved, and loaded again."""
    import routers.voice as voice_router
    monkeypatch.setattr(voice_router, "SETUP_CONFIG_DIR", tmp_path)

    resp = test_client.get("/api/voice/settings", headers=test_client.auth_headers)
    assert resp.status_code == 200
    defaults = resp.json()
    assert "voice" in defaults
    assert "speed" in defaults
    assert "wakeWord" in defaults

    resp = test_client.post(
        "/api/voice/settings",
        json={"voice": "af_bella", "speed": 1.2, "wakeWord": True},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["voice"] == "af_bella"

    resp = test_client.get("/api/voice/settings", headers=test_client.auth_headers)
    assert resp.status_code == 200
    saved = resp.json()
    assert saved["voice"] == "af_bella"
    assert saved["speed"] == 1.2
    assert saved["wakeWord"] is True


def test_voice_token_stub(test_client):
    """POST /api/voice/token returns a clear stub response instead of 404."""
    resp = test_client.post("/api/voice/token", headers=test_client.auth_headers)
    assert resp.status_code == 501
    assert "not configured" in resp.json()["detail"].lower()


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
# Core API Endpoints
# ---------------------------------------------------------------------------


def test_api_status_authenticated(test_client):
    """GET /api/status with auth → 200, returns full system status."""
    resp = test_client.get("/api/status", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "gpu" in data
    assert "services" in data
    assert "model" in data
    assert "bootstrap" in data
    assert "uptime" in data
    assert "version" in data
    assert "tier" in data
    assert "cpu" in data
    assert "ram" in data
    assert "inference" in data


def test_api_storage_authenticated(test_client):
    """GET /api/storage with auth → 200, returns storage breakdown."""
    resp = test_client.get("/api/storage", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "models" in data
    assert "vector_db" in data
    assert "total_data" in data
    assert "disk" in data
    assert "gb" in data["models"]
    assert "percent" in data["models"]


def test_api_external_links_authenticated(test_client):
    """GET /api/external-links with auth → 200, returns sidebar links."""
    resp = test_client.get("/api/external-links", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    for link in data:
        assert "id" in link
        assert "label" in link
        assert "port" in link
        assert "icon" in link


def test_api_service_tokens_authenticated(test_client):
    """GET /api/service-tokens with auth → 200, returns service tokens."""
    resp = test_client.get("/api/service-tokens", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, dict)


def test_api_test_llm_authenticated(test_client, monkeypatch):
    """GET /api/test/llm with auth → 200 and returns a setup-validation payload."""
    import routers.diagnostics as diagnostics_router

    async def fake_probe(*args, **kwargs):
        return {"success": True, "service": "llama-server", "error": None}

    monkeypatch.setattr(diagnostics_router, "_probe_service", fake_probe)
    monkeypatch.setattr(diagnostics_router, "get_loaded_model", AsyncMock(return_value="qwen3-8b"))

    resp = test_client.get("/api/test/llm", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["model"] == "qwen3-8b"


def test_api_test_voice_authenticated(test_client, monkeypatch):
    """GET /api/test/voice with auth → 200 and returns voice validation details."""
    import routers.diagnostics as diagnostics_router

    async def fake_status():
        return {
            "available": False,
            "message": "Voice services unavailable: LiveKit",
            "services": {"livekit": {"status": "down"}},
        }

    monkeypatch.setattr(diagnostics_router, "get_voice_status_payload", fake_status)

    resp = test_client.get("/api/test/voice", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False
    assert "services" in data
    assert data["error"]
