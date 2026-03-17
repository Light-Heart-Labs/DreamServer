"""Tests for workflows router endpoints."""

from unittest.mock import patch, AsyncMock


def test_workflows_requires_auth(test_client):
    """GET /api/workflows without auth → 401."""
    resp = test_client.get("/api/workflows")
    assert resp.status_code == 401


def test_workflows_authenticated(test_client):
    """GET /api/workflows with auth → 200, returns workflow catalog."""
    resp = test_client.get("/api/workflows", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "workflows" in data
    assert "categories" in data
    assert isinstance(data["workflows"], list)
    assert isinstance(data["categories"], dict)


def test_workflow_categories_requires_auth(test_client):
    """GET /api/workflows/categories without auth → 401."""
    resp = test_client.get("/api/workflows/categories")
    assert resp.status_code == 401


def test_workflow_categories_authenticated(test_client):
    """GET /api/workflows/categories with auth → 200, returns categories."""
    resp = test_client.get("/api/workflows/categories", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, dict)


def test_n8n_status_requires_auth(test_client):
    """GET /api/workflows/n8n/status without auth → 401."""
    resp = test_client.get("/api/workflows/n8n/status")
    assert resp.status_code == 401


def test_n8n_status_authenticated(test_client):
    """GET /api/workflows/n8n/status with auth → 200, returns n8n status."""
    resp = test_client.get("/api/workflows/n8n/status", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "available" in data
    assert "workflow_count" in data


def test_workflow_enable_requires_auth(test_client):
    """POST /api/workflows/{id}/enable without auth → 401."""
    resp = test_client.post("/api/workflows/test-workflow/enable")
    assert resp.status_code == 401


def test_workflow_disable_requires_auth(test_client):
    """POST /api/workflows/{id}/disable without auth → 401."""
    resp = test_client.post("/api/workflows/test-workflow/disable")
    assert resp.status_code == 401
