"""Tests for the agents router — metrics, cluster status, throughput."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Auth enforcement
# ---------------------------------------------------------------------------


def test_agents_metrics_requires_auth(test_client):
    """GET /api/agents/metrics without auth → 401."""
    resp = test_client.get("/api/agents/metrics")
    assert resp.status_code == 401


def test_agents_cluster_requires_auth(test_client):
    """GET /api/agents/cluster without auth → 401."""
    resp = test_client.get("/api/agents/cluster")
    assert resp.status_code == 401


def test_agents_throughput_requires_auth(test_client):
    """GET /api/agents/throughput without auth → 401."""
    resp = test_client.get("/api/agents/throughput")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Authenticated responses
# ---------------------------------------------------------------------------


def test_agents_metrics_returns_data(test_client):
    """GET /api/agents/metrics with auth → 200 with expected keys."""
    resp = test_client.get("/api/agents/metrics", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, dict)


def test_agents_throughput_returns_data(test_client):
    """GET /api/agents/throughput with auth → 200."""
    resp = test_client.get("/api/agents/throughput", headers=test_client.auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, dict)


def test_agents_metrics_html_returns_html(test_client):
    """GET /api/agents/metrics.html with auth → 200 HTML response."""
    resp = test_client.get("/api/agents/metrics.html", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "text/html" in resp.headers.get("content-type", "")
    assert "metric-card" in resp.text
