"""Tests for the Model Hub API router.

Coverage:
  - Model listing (catalog + downloaded state + active detection)
  - Active model query
  - Download trigger (success, already downloaded, concurrent block)
  - Model loading (success, not downloaded, config write)
  - Model deletion (success, active model guard, not found)
  - Download status
  - Provider CRUD (list, save, delete, validation)
  - Input validation (path traversal, invalid IDs)
  - Auth enforcement
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch, AsyncMock

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def model_env(tmp_path, monkeypatch):
    """Set up isolated directories for model tests."""
    install_dir = tmp_path / "dream-server"
    data_dir = tmp_path / "data"
    config_dir = install_dir / "config"
    models_dir = data_dir / "models"
    llama_dir = config_dir / "llama-server"

    install_dir.mkdir()
    data_dir.mkdir()
    config_dir.mkdir()
    models_dir.mkdir()
    llama_dir.mkdir()

    # Write a test catalog
    catalog = {
        "version": 1,
        "models": [
            {
                "id": "qwen3-8b",
                "name": "Qwen3 8B",
                "family": "Qwen",
                "description": "Fast lightweight model",
                "size_gb": 4.9,
                "vram_required_gb": 6,
                "context_length": 32768,
                "tokens_per_sec_estimate": 120,
                "quantization": "Q4_K_M",
                "specialty": "Fast",
                "backends": ["llama-server"],
                "gguf": {
                    "filename": "Qwen3-8B-Q4_K_M.gguf",
                    "huggingface_repo": "bartowski/Qwen3-8B-GGUF",
                    "huggingface_file": "Qwen3-8B-Q4_K_M.gguf",
                },
            },
            {
                "id": "qwen3-14b",
                "name": "Qwen3 14B",
                "family": "Qwen",
                "description": "High-quality dense model",
                "size_gb": 8.7,
                "vram_required_gb": 10,
                "context_length": 32768,
                "tokens_per_sec_estimate": 55,
                "quantization": "Q4_K_M",
                "specialty": "Balanced",
                "backends": ["llama-server"],
                "gguf": {
                    "filename": "Qwen3-14B-Q4_K_M.gguf",
                    "huggingface_repo": "bartowski/Qwen3-14B-GGUF",
                    "huggingface_file": "Qwen3-14B-Q4_K_M.gguf",
                },
            },
            {
                "id": "big-model-70b",
                "name": "Big Model 70B",
                "family": "Test",
                "description": "Very large model for VRAM tests",
                "size_gb": 35.0,
                "vram_required_gb": 42,
                "context_length": 32768,
                "specialty": "Quality",
                "backends": ["llama-server"],
                "gguf": {
                    "filename": "Big-Model-70B.gguf",
                    "huggingface_repo": "test/big-model",
                    "huggingface_file": "Big-Model-70B.gguf",
                },
            },
        ],
        "providers": [
            {
                "id": "openai",
                "name": "OpenAI",
                "description": "GPT-4o, o1",
                "models": ["gpt-4o", "gpt-4o-mini"],
                "docs_url": "https://platform.openai.com/api-keys",
            },
            {
                "id": "anthropic",
                "name": "Anthropic",
                "description": "Claude 4",
                "models": ["claude-sonnet-4-20250514"],
                "docs_url": "https://console.anthropic.com/settings/keys",
            },
        ],
    }
    (config_dir / "model_catalog.json").write_text(json.dumps(catalog))

    # Write models.ini (qwen3-8b is active)
    (llama_dir / "models.ini").write_text(
        "[qwen3-8b]\nfilename = Qwen3-8B-Q4_K_M.gguf\nload-on-startup = true\nn-ctx = 32768\n"
    )

    # Create the active model file (downloaded)
    (models_dir / "Qwen3-8B-Q4_K_M.gguf").write_text("fake-gguf-data")

    # Monkeypatch the router's module-level paths
    import routers.models as models_mod

    monkeypatch.setattr(models_mod, "CATALOG_PATH", config_dir / "model_catalog.json")
    monkeypatch.setattr(models_mod, "MODELS_DIR", models_dir)
    monkeypatch.setattr(models_mod, "PROVIDERS_FILE", data_dir / "config" / "providers.json")
    monkeypatch.setattr(models_mod, "DOWNLOAD_STATUS_FILE", data_dir / "model-download-status.json")
    monkeypatch.setattr(models_mod, "LLAMA_CONFIG_PATH", llama_dir / "models.ini")
    monkeypatch.setattr(models_mod, "ENV_FILE", install_dir / ".env")

    # Mock Ollama so tests don't depend on a live instance
    monkeypatch.setattr(models_mod, "fetch_ollama_models", AsyncMock(return_value=[]))

    return {
        "install_dir": install_dir,
        "data_dir": data_dir,
        "models_dir": models_dir,
        "config_dir": config_dir,
        "llama_dir": llama_dir,
    }


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------


def test_models_requires_auth(test_client):
    """GET /api/models without auth → 401."""
    resp = test_client.get("/api/models")
    assert resp.status_code == 401


def test_models_active_requires_auth(test_client):
    """GET /api/models/active without auth → 401."""
    resp = test_client.get("/api/models/active")
    assert resp.status_code == 401


def test_models_providers_requires_auth(test_client):
    """GET /api/models/providers without auth → 401."""
    resp = test_client.get("/api/models/providers")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/models — List models
# ---------------------------------------------------------------------------


def test_list_models_returns_catalog(test_client, model_env):
    """GET /api/models returns models from catalog with correct statuses."""
    with patch("routers.models.get_gpu_info", return_value=None):
        resp = test_client.get("/api/models", headers=test_client.auth_headers)

    assert resp.status_code == 200
    data = resp.json()
    assert "models" in data
    assert "currentModel" in data
    assert len(data["models"]) == 3

    # qwen3-8b should be 'loaded' (matches models.ini + file exists)
    qwen8b = next(m for m in data["models"] if m["id"] == "qwen3-8b")
    assert qwen8b["status"] == "loaded"
    assert qwen8b["name"] == "Qwen3 8B"
    assert qwen8b["specialty"] == "Fast"
    assert qwen8b["quantization"] == "Q4_K_M"

    # qwen3-14b should be 'available' (not downloaded)
    qwen14b = next(m for m in data["models"] if m["id"] == "qwen3-14b")
    assert qwen14b["status"] == "available"

    assert data["currentModel"] == "Qwen3-8B-Q4_K_M.gguf"


def test_list_models_downloaded_status(test_client, model_env):
    """A model file on disk (but not active) shows as 'downloaded'."""
    # Create qwen3-14b file on disk
    (model_env["models_dir"] / "Qwen3-14B-Q4_K_M.gguf").write_text("fake")

    with patch("routers.models.get_gpu_info", return_value=None):
        resp = test_client.get("/api/models", headers=test_client.auth_headers)

    assert resp.status_code == 200
    qwen14b = next(m for m in resp.json()["models"] if m["id"] == "qwen3-14b")
    assert qwen14b["status"] == "downloaded"


def test_list_models_user_added_model(test_client, model_env):
    """A .gguf file not in catalog shows as a user-added model."""
    (model_env["models_dir"] / "CustomModel-7B.gguf").write_text("fake")

    with patch("routers.models.get_gpu_info", return_value=None):
        resp = test_client.get("/api/models", headers=test_client.auth_headers)

    models = resp.json()["models"]
    custom = next((m for m in models if m["id"] == "CustomModel-7B.gguf"), None)
    assert custom is not None
    assert custom["description"] == "User-added model"
    assert custom["status"] == "downloaded"


def test_list_models_vram_fits_calculation(test_client, model_env):
    """Models exceeding GPU VRAM show fits_vram=False."""
    from models import GPUInfo

    mock_gpu = GPUInfo(
        name="Test GPU",
        memory_used_mb=8000,
        memory_total_mb=24000,  # 23.4 GB
        memory_percent=33.3,
        utilization_percent=50,
        temperature_c=60,
    )
    with patch("routers.models.get_gpu_info", return_value=mock_gpu):
        resp = test_client.get("/api/models", headers=test_client.auth_headers)

    data = resp.json()
    # qwen3-8b needs 6GB → fits 24GB
    qwen8b = next(m for m in data["models"] if m["id"] == "qwen3-8b")
    assert qwen8b["fits_vram"] is True

    # big-model-70b needs 42GB → does not fit 24GB
    big = next(m for m in data["models"] if m["id"] == "big-model-70b")
    assert big["fits_vram"] is False

    # GPU info should be in response
    assert data["gpu"]["vramTotal"] == 23.4


def test_list_models_empty_catalog(test_client, model_env):
    """Empty catalog with no local files returns empty list."""
    import routers.models as models_mod

    # Write empty catalog
    Path(models_mod.CATALOG_PATH).write_text(json.dumps({"version": 1, "models": [], "providers": []}))

    # Remove any gguf files so no user-added models appear
    for f in model_env["models_dir"].glob("*.gguf"):
        f.unlink()

    with patch("routers.models.get_gpu_info", return_value=None):
        resp = test_client.get("/api/models", headers=test_client.auth_headers)

    assert resp.status_code == 200
    assert resp.json()["models"] == []


# ---------------------------------------------------------------------------
# GET /api/models/active
# ---------------------------------------------------------------------------


def test_active_model_returns_catalog_info(test_client, model_env):
    """Active model returns rich metadata from catalog."""
    resp = test_client.get("/api/models/active", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "qwen3-8b"
    assert data["name"] == "Qwen3 8B"
    assert data["backend"] == "llama-server"
    assert data["context_length"] == 32768


def test_active_model_none_when_no_config(test_client, model_env):
    """No models.ini → returns empty active model."""
    import routers.models as models_mod

    Path(models_mod.LLAMA_CONFIG_PATH).unlink()

    resp = test_client.get("/api/models/active", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert resp.json()["id"] is None


# ---------------------------------------------------------------------------
# POST /api/models/{id}/download
# ---------------------------------------------------------------------------


def test_download_model_success(test_client, model_env):
    """Download a model not yet on disk → 200 with status file written."""
    import routers.models as models_mod

    resp = test_client.post(
        "/api/models/qwen3-14b/download",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "downloading"
    assert data["model_id"] == "qwen3-14b"

    # Status file should exist
    status_file = Path(models_mod.DOWNLOAD_STATUS_FILE)
    assert status_file.exists()
    status = json.loads(status_file.read_text())
    assert status["model_id"] == "qwen3-14b"


def test_download_model_already_downloaded(test_client, model_env):
    """Download a model already on disk → 409."""
    resp = test_client.post(
        "/api/models/qwen3-8b/download",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 409
    assert "already downloaded" in resp.json()["detail"]


def test_download_model_concurrent_block(test_client, model_env):
    """Starting a second download while one is active → 409."""
    import routers.models as models_mod

    models_mod.write_download_status({"status": "downloading", "model_id": "other"})

    resp = test_client.post(
        "/api/models/qwen3-14b/download",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 409
    assert "in progress" in resp.json()["detail"]


def test_download_model_not_in_catalog(test_client, model_env):
    """Download unknown model → 404."""
    resp = test_client.post(
        "/api/models/nonexistent-model/download",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# POST /api/models/{id}/load
# ---------------------------------------------------------------------------


def test_load_model_success(test_client, model_env):
    """Load a downloaded model → updates models.ini."""
    # First download qwen3-14b
    (model_env["models_dir"] / "Qwen3-14B-Q4_K_M.gguf").write_text("fake")

    resp = test_client.post(
        "/api/models/qwen3-14b/load",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "loaded"

    # Verify models.ini was updated
    import routers.models as models_mod

    config = Path(models_mod.LLAMA_CONFIG_PATH).read_text()
    assert "Qwen3-14B-Q4_K_M.gguf" in config


def test_load_model_not_downloaded(test_client, model_env):
    """Load a model that's not on disk → 400."""
    resp = test_client.post(
        "/api/models/qwen3-14b/load",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 400
    assert "not downloaded" in resp.json()["detail"]


def test_load_model_not_in_catalog(test_client, model_env):
    """Load unknown model → 404."""
    resp = test_client.post(
        "/api/models/nonexistent/load",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /api/models/{id}
# ---------------------------------------------------------------------------


def test_delete_model_success(test_client, model_env):
    """Delete a downloaded (non-active) model → removes file."""
    # Add qwen3-14b file
    model_file = model_env["models_dir"] / "Qwen3-14B-Q4_K_M.gguf"
    model_file.write_text("fake")

    resp = test_client.delete(
        "/api/models/qwen3-14b",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    assert not model_file.exists()


def test_delete_active_model_blocked(test_client, model_env):
    """Delete the active model → 409."""
    resp = test_client.delete(
        "/api/models/qwen3-8b",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 409
    assert "active model" in resp.json()["detail"].lower()


def test_delete_model_not_found(test_client, model_env):
    """Delete model not on disk → 404."""
    resp = test_client.delete(
        "/api/models/qwen3-14b",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 404


def test_delete_user_added_model(test_client, model_env):
    """Delete a user-added model by filename → removes file."""
    model_file = model_env["models_dir"] / "CustomModel-7B.gguf"
    model_file.write_text("fake")

    resp = test_client.delete(
        "/api/models/CustomModel-7B.gguf",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    assert not model_file.exists()


# ---------------------------------------------------------------------------
# GET /api/models/download-status
# ---------------------------------------------------------------------------


def test_download_status_inactive(test_client, model_env):
    """No active download → active=False."""
    resp = test_client.get(
        "/api/models/download-status",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["active"] is False


def test_download_status_active(test_client, model_env):
    """Active download → returns progress."""
    import routers.models as models_mod

    models_mod.write_download_status({
        "status": "downloading",
        "model_id": "qwen3-14b",
        "percent": 45.2,
        "bytesDownloaded": 4000000000,
        "bytesTotal": 8700000000,
    })

    resp = test_client.get(
        "/api/models/download-status",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["active"] is True
    assert data["percent"] == 45.2


def test_download_status_complete_shows_inactive(test_client, model_env):
    """Completed download status → active=False."""
    import routers.models as models_mod

    models_mod.write_download_status({"status": "complete"})

    resp = test_client.get(
        "/api/models/download-status",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["active"] is False


# ---------------------------------------------------------------------------
# Provider CRUD
# ---------------------------------------------------------------------------


def test_list_providers(test_client, model_env):
    """GET /api/models/providers lists catalog providers with configured=False."""
    resp = test_client.get("/api/models/providers", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["providers"]) == 2
    openai = next(p for p in data["providers"] if p["id"] == "openai")
    assert openai["configured"] is False
    assert "gpt-4o" in openai["available_models"]


def test_save_provider(test_client, model_env):
    """PUT saves API key and shows as configured."""
    resp = test_client.put(
        "/api/models/providers/openai",
        json={"api_key": "sk-test-12345", "default_model": "gpt-4o"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "saved"

    # Verify it shows as configured
    resp2 = test_client.get("/api/models/providers", headers=test_client.auth_headers)
    openai = next(p for p in resp2.json()["providers"] if p["id"] == "openai")
    assert openai["configured"] is True
    assert openai["default_model"] == "gpt-4o"


def test_save_provider_unknown(test_client, model_env):
    """PUT to unknown provider → 404."""
    resp = test_client.put(
        "/api/models/providers/unknown-provider",
        json={"api_key": "sk-test"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 404


def test_save_provider_empty_key(test_client, model_env):
    """PUT with empty API key → 422 (validation)."""
    resp = test_client.put(
        "/api/models/providers/openai",
        json={"api_key": ""},
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 422


def test_delete_provider(test_client, model_env):
    """DELETE configured provider → removed."""
    # Configure first
    test_client.put(
        "/api/models/providers/openai",
        json={"api_key": "sk-test"},
        headers=test_client.auth_headers,
    )

    resp = test_client.delete(
        "/api/models/providers/openai",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 200

    # Verify it's no longer configured
    resp2 = test_client.get("/api/models/providers", headers=test_client.auth_headers)
    openai = next(p for p in resp2.json()["providers"] if p["id"] == "openai")
    assert openai["configured"] is False


def test_delete_provider_not_configured(test_client, model_env):
    """DELETE unconfigured provider → 404."""
    resp = test_client.delete(
        "/api/models/providers/openai",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Input validation / security
# ---------------------------------------------------------------------------


def test_model_id_path_traversal(test_client, model_env):
    """Path traversal in model ID → 400."""
    resp = test_client.post(
        "/api/models/../../etc/passwd/download",
        headers=test_client.auth_headers,
    )
    # FastAPI path matching may return 404 or 400
    assert resp.status_code in (400, 404, 422)


def test_provider_id_path_traversal(test_client, model_env):
    """Path traversal in provider ID → 400."""
    resp = test_client.put(
        "/api/models/providers/../../etc/passwd",
        json={"api_key": "test"},
        headers=test_client.auth_headers,
    )
    assert resp.status_code in (400, 404, 422)


def test_model_id_special_chars_rejected(test_client, model_env):
    """Model ID with special characters → 400."""
    resp = test_client.post(
        "/api/models/model;rm -rf/download",
        headers=test_client.auth_headers,
    )
    assert resp.status_code in (400, 404, 422)
