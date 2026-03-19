"""Tests for the dashboard model catalog router."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest


@pytest.fixture()
def model_catalog_paths(tmp_path, monkeypatch):
    """Redirect model catalog files into an isolated temp directory."""
    import routers.model_catalog as model_catalog

    data_dir = tmp_path / "data"
    models_dir = data_dir / "models"
    install_dir = tmp_path / "install"
    env_file = install_dir / ".env"
    status_file = data_dir / "bootstrap-status.json"

    models_dir.mkdir(parents=True)
    install_dir.mkdir(parents=True)

    monkeypatch.setattr(model_catalog, "MODELS_DIR", models_dir)
    monkeypatch.setattr(model_catalog, "ENV_FILE", env_file)
    monkeypatch.setattr(model_catalog, "DOWNLOAD_STATUS_FILE", status_file)

    return {
        "data_dir": data_dir,
        "models_dir": models_dir,
        "install_dir": install_dir,
        "env_file": env_file,
        "status_file": status_file,
    }


def test_models_requires_auth(test_client):
    """GET /api/models without auth should be rejected."""
    resp = test_client.get("/api/models")
    assert resp.status_code == 401


def test_list_models_reports_current_and_downloaded_state(test_client, model_catalog_paths, monkeypatch):
    """GET /api/models returns GPU info plus loaded/downloaded model states."""
    from models import GPUInfo

    env_file = model_catalog_paths["env_file"]
    env_file.write_text("LLM_MODEL=qwen3-8b\nGGUF_FILE=Qwen3-8B-Q4_K_M.gguf\n")

    downloaded = model_catalog_paths["models_dir"] / "Qwen3-4B-Q4_K_M.gguf"
    downloaded.write_text("placeholder")

    gpu = GPUInfo(
        name="RTX 4080",
        memory_used_mb=8192,
        memory_total_mb=24576,
        memory_percent=33.3,
        utilization_percent=42,
        temperature_c=58,
        gpu_backend="nvidia",
    )

    monkeypatch.setattr("routers.model_catalog.get_gpu_info", lambda: gpu)
    monkeypatch.setattr("routers.model_catalog.get_loaded_model", AsyncMock(return_value="qwen3-8b"))

    resp = test_client.get("/api/models", headers=test_client.auth_headers)
    assert resp.status_code == 200

    data = resp.json()
    assert data["currentModel"] == "qwen3-8b"
    assert data["gpu"] == {"vramTotal": 24.0, "vramUsed": 8.0, "vramFree": 16.0}

    models = {model["id"]: model for model in data["models"]}
    assert models["qwen3-8b"]["status"] == "loaded"
    assert models["qwen3-4b"]["status"] == "downloaded"
    assert models["qwen3-30b-a3b"]["fitsVram"] is True
    assert models["qwen3-coder-next"]["fitsVram"] is False


def test_download_status_prefers_live_bootstrap_metrics(test_client, monkeypatch):
    """GET /api/models/download-status maps bootstrap progress for the dashboard hook."""
    from models import BootstrapStatus

    monkeypatch.setattr(
        "routers.model_catalog.get_bootstrap_status",
        lambda: BootstrapStatus(
            active=True,
            model_name="qwen3-8b",
            percent=41,
            downloaded_gb=2.5,
            total_gb=6.0,
            speed_mbps=12.5,
            eta_seconds=180,
        ),
    )

    resp = test_client.get("/api/models/download-status", headers=test_client.auth_headers)
    assert resp.status_code == 200

    data = resp.json()
    assert data["status"] == "downloading"
    assert data["model"] == "qwen3-8b"
    assert data["percent"] == 41
    assert data["eta"] == 180
    assert data["speedBytesPerSec"] == int(12.5 * 1024 * 1024)


def test_download_model_queues_background_transfer(test_client, model_catalog_paths, monkeypatch):
    """POST /api/models/{id}/download writes queued status and schedules work."""
    scheduled = {}

    async def fake_start_download(model):
        scheduled["model"] = model["id"]

    monkeypatch.setattr("routers.model_catalog._start_download", fake_start_download)

    resp = test_client.post(
        "/api/models/qwen3-4b/download",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() == {"success": True, "status": "queued", "model": "qwen3-4b"}

    assert scheduled["model"] == "qwen3-4b"
    assert model_catalog_paths["status_file"].exists()
    assert '"status": "queued"' in model_catalog_paths["status_file"].read_text()


def test_load_model_updates_env_selection(test_client, model_catalog_paths):
    """POST /api/models/{id}/load persists GGUF_FILE and LLM_MODEL in .env."""
    target = model_catalog_paths["models_dir"] / "Qwen3-8B-Q4_K_M.gguf"
    target.write_text("ready")
    model_catalog_paths["env_file"].write_text("LLM_MODEL=qwen3.5-2b\n")

    resp = test_client.post(
        "/api/models/qwen3-8b/load",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200

    env_text = model_catalog_paths["env_file"].read_text()
    assert "LLM_MODEL=qwen3-8b" in env_text
    assert "GGUF_FILE=Qwen3-8B-Q4_K_M.gguf" in env_text
    assert "Restart llama-server" in resp.json()["message"]


def test_delete_model_rejects_active_configured_model(test_client, model_catalog_paths):
    """DELETE should reject deleting the configured model selection."""
    target = model_catalog_paths["models_dir"] / "Qwen3-8B-Q4_K_M.gguf"
    target.write_text("active")
    model_catalog_paths["env_file"].write_text("LLM_MODEL=qwen3-8b\n")

    resp = test_client.delete(
        "/api/models/qwen3-8b",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 409
    assert target.exists()


def test_delete_model_removes_downloaded_artifact(test_client, model_catalog_paths):
    """DELETE removes model files for inactive downloads."""
    target = model_catalog_paths["models_dir"] / "Qwen3-4B-Q4_K_M.gguf"
    target.write_text("downloaded")
    model_catalog_paths["env_file"].write_text("LLM_MODEL=qwen3-8b\n")

    resp = test_client.delete(
        "/api/models/qwen3-4b",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    assert not target.exists()
