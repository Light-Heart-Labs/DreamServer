"""Tests for the workflows router — catalog loading, validation, and dependency checks."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest


# ---------------------------------------------------------------------------
# Catalog loading
# ---------------------------------------------------------------------------


def test_load_workflow_catalog_returns_default_when_missing():
    """load_workflow_catalog falls back to DEFAULT_WORKFLOW_CATALOG when file is absent."""
    from routers.workflows import load_workflow_catalog
    catalog = load_workflow_catalog()
    assert isinstance(catalog, dict)
    assert "workflows" in catalog


def test_load_workflow_catalog_handles_malformed_json(tmp_path, monkeypatch):
    """Malformed JSON gracefully returns default catalog."""
    import config
    bad_file = tmp_path / "catalog.json"
    bad_file.write_text("not valid json{{{")
    monkeypatch.setattr(config, "WORKFLOW_CATALOG_FILE", bad_file)
    # Re-import to pick up patched value
    import routers.workflows as wf_mod
    monkeypatch.setattr(wf_mod, "WORKFLOW_CATALOG_FILE", bad_file)

    catalog = wf_mod.load_workflow_catalog()
    assert isinstance(catalog, dict)
    assert "workflows" in catalog


def test_load_workflow_catalog_handles_non_dict_root(tmp_path, monkeypatch):
    """Non-dict root (e.g. a list) returns default catalog."""
    import config
    bad_file = tmp_path / "catalog.json"
    bad_file.write_text(json.dumps(["not", "a", "dict"]))
    monkeypatch.setattr(config, "WORKFLOW_CATALOG_FILE", bad_file)
    import routers.workflows as wf_mod
    monkeypatch.setattr(wf_mod, "WORKFLOW_CATALOG_FILE", bad_file)

    catalog = wf_mod.load_workflow_catalog()
    assert isinstance(catalog, dict)
    assert "workflows" in catalog


def test_load_workflow_catalog_reads_valid_file(tmp_path, monkeypatch):
    """Valid catalog file is loaded correctly."""
    import config
    catalog_file = tmp_path / "catalog.json"
    catalog_data = {
        "workflows": [
            {"id": "test-wf", "name": "Test", "description": "A test workflow", "file": "test.json"}
        ],
        "categories": {"general": {"name": "General"}}
    }
    catalog_file.write_text(json.dumps(catalog_data))
    monkeypatch.setattr(config, "WORKFLOW_CATALOG_FILE", catalog_file)
    import routers.workflows as wf_mod
    monkeypatch.setattr(wf_mod, "WORKFLOW_CATALOG_FILE", catalog_file)

    catalog = wf_mod.load_workflow_catalog()
    assert len(catalog["workflows"]) == 1
    assert catalog["workflows"][0]["id"] == "test-wf"
    assert catalog["categories"]["general"]["name"] == "General"


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


def test_workflows_list_requires_auth(test_client):
    """GET /api/workflows without auth → 401."""
    resp = test_client.get("/api/workflows")
    assert resp.status_code == 401


def test_workflow_enable_requires_auth(test_client):
    """POST /api/workflows/x/enable without auth → 401."""
    resp = test_client.post("/api/workflows/test/enable")
    assert resp.status_code == 401


def test_workflow_delete_requires_auth(test_client):
    """DELETE /api/workflows/x without auth → 401."""
    resp = test_client.delete("/api/workflows/test")
    assert resp.status_code == 401


def test_workflow_enable_invalid_id_format(test_client):
    """Workflow IDs with special characters are rejected."""
    resp = test_client.post(
        "/api/workflows/../../etc/passwd/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code in (400, 404, 422)


def test_workflow_enable_nonexistent(test_client):
    """Enabling a workflow not in catalog returns 404."""
    resp = test_client.post(
        "/api/workflows/does-not-exist/enable",
        headers=test_client.auth_headers,
    )
    assert resp.status_code == 404


def test_workflow_executions_requires_auth(test_client):
    """GET /api/workflows/x/executions without auth → 401."""
    resp = test_client.get("/api/workflows/test/executions")
    assert resp.status_code == 401
