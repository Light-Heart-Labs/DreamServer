"""Tests for workflows router endpoints."""

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
    """GET /api/workflows without auth → 401 (categories are in same endpoint)."""
    resp = test_client.get("/api/workflows")
    assert resp.status_code == 401


def test_workflow_categories_authenticated(test_client):
    """GET /api/workflows with auth → 200, returns categories in response."""
    resp = test_client.get("/api/workflows", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "categories" in data
    assert isinstance(data["categories"], dict)


def test_n8n_status_requires_auth(test_client):
    """GET /api/workflows without auth → 401 (n8n info is in same endpoint)."""
    resp = test_client.get("/api/workflows")
    assert resp.status_code == 401


def test_n8n_status_authenticated(test_client):
    """GET /api/workflows with auth → 200, returns n8nAvailable and n8nUrl."""
    resp = test_client.get("/api/workflows", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "n8nAvailable" in data
    assert "n8nUrl" in data


def test_workflow_enable_requires_auth(test_client):
    """POST /api/workflows/{id}/enable without auth → 401."""
    resp = test_client.post("/api/workflows/test-workflow/enable")
    assert resp.status_code == 401


def test_workflow_disable_requires_auth(test_client):
    """DELETE /api/workflows/{id} without auth → 401."""
    resp = test_client.delete("/api/workflows/test-workflow")
    assert resp.status_code == 401
