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


def test_workflow_enable_requires_auth(test_client):
    """POST /api/workflows/{id}/enable without auth → 401."""
    resp = test_client.post("/api/workflows/test-workflow/enable")
    assert resp.status_code == 401


def test_workflow_disable_requires_auth(test_client):
    """DELETE /api/workflows/{id} without auth → 401."""
    resp = test_client.delete("/api/workflows/test-workflow")
    assert resp.status_code == 401


def test_workflow_executions_requires_auth(test_client):
    """GET /api/workflows/{id}/executions without auth → 401."""
    resp = test_client.get("/api/workflows/test-workflow/executions")
    assert resp.status_code == 401


def test_workflow_enable_authenticated(test_client):
    """POST /api/workflows/{id}/enable with auth → 404 when workflow not in catalog."""
    resp = test_client.post(
        "/api/workflows/nonexistent-workflow/enable",
        headers=test_client.auth_headers
    )
    assert resp.status_code == 404


def test_workflow_disable_authenticated(test_client):
    """DELETE /api/workflows/{id} with auth → 404 when workflow not in catalog."""
    resp = test_client.delete(
        "/api/workflows/nonexistent-workflow",
        headers=test_client.auth_headers
    )
    assert resp.status_code == 404


def test_workflow_executions_authenticated(test_client):
    """GET /api/workflows/{id}/executions with auth → 404 when workflow not in catalog."""
    resp = test_client.get(
        "/api/workflows/nonexistent-workflow/executions",
        headers=test_client.auth_headers
    )
    assert resp.status_code == 404
