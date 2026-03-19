"""Tests for the GPU cluster HTML fragment endpoint."""

from __future__ import annotations

from unittest.mock import AsyncMock


def test_gpu_cluster_fragment_requires_auth(test_client):
    resp = test_client.get("/api/fragments/gpu-cluster")
    assert resp.status_code == 401


def test_gpu_cluster_fragment_renders_cluster_summary(test_client, monkeypatch):
    from models import GPUInfo

    monkeypatch.setattr("routers.fragments.cluster_status.refresh", AsyncMock())
    monkeypatch.setattr(
        "routers.fragments.cluster_status.to_dict",
        lambda: {
            "nodes": [
                {
                    "name": "node-a",
                    "healthy": True,
                    "memory_used_gb": 8,
                    "memory_total_gb": 24,
                    "backend": "nvidia",
                    "queue_depth": 1,
                },
                {
                    "name": "node-b",
                    "healthy": False,
                    "memory_used_gb": 2,
                    "memory_total_gb": 16,
                    "backend": "nvidia",
                    "queue_depth": 0,
                },
            ],
            "total_gpus": 2,
            "active_gpus": 1,
            "failover_ready": False,
        },
    )
    monkeypatch.setattr(
        "routers.fragments.get_gpu_info",
        lambda: GPUInfo(
            name="RTX 4090",
            memory_used_mb=8192,
            memory_total_mb=24576,
            memory_percent=33.0,
            utilization_percent=40,
            temperature_c=55,
            gpu_backend="nvidia",
        ),
    )
    monkeypatch.setattr(
        "routers.fragments.SERVICES",
        {
            "open-webui": {"name": "Open WebUI"},
            "openclaw": {"name": "OpenClaw (Agents)"},
            "dashboard-api": {"name": "Dashboard API"},
        },
    )

    resp = test_client.get("/api/fragments/gpu-cluster", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]

    body = resp.text
    assert "GPU Cluster" in body
    assert "1 / 2" in body
    assert "RTX 4090" in body
    assert "8.0 GB / 24.0 GB VRAM" in body
    assert "Open WebUI" in body
    assert "OpenClaw (Agents)" in body
    assert "Standby" in body


def test_gpu_cluster_fragment_handles_unified_memory(test_client, monkeypatch):
    from models import GPUInfo

    monkeypatch.setattr("routers.fragments.cluster_status.refresh", AsyncMock())
    monkeypatch.setattr(
        "routers.fragments.cluster_status.to_dict",
        lambda: {"nodes": [], "total_gpus": 0, "active_gpus": 0, "failover_ready": False},
    )
    monkeypatch.setattr(
        "routers.fragments.get_gpu_info",
        lambda: GPUInfo(
            name="M4 Max",
            memory_used_mb=16384,
            memory_total_mb=65536,
            memory_percent=25.0,
            utilization_percent=20,
            temperature_c=45,
            gpu_backend="apple",
            memory_type="unified",
        ),
    )

    resp = test_client.get("/api/fragments/gpu-cluster", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "Unified Memory" in resp.text
    assert "No cluster nodes reported" in resp.text


def test_gpu_cluster_fragment_escapes_node_names(test_client, monkeypatch):
    monkeypatch.setattr("routers.fragments.cluster_status.refresh", AsyncMock())
    monkeypatch.setattr(
        "routers.fragments.cluster_status.to_dict",
        lambda: {
            "nodes": [
                {
                    "name": "<script>alert(1)</script>",
                    "healthy": True,
                    "memory_used_gb": 4,
                    "memory_total_gb": 8,
                    "backend": "nvidia",
                    "queue_depth": 2,
                }
            ],
            "total_gpus": 1,
            "active_gpus": 1,
            "failover_ready": True,
        },
    )
    monkeypatch.setattr("routers.fragments.get_gpu_info", lambda: None)

    resp = test_client.get("/api/fragments/gpu-cluster", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "<script>" not in resp.text
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in resp.text


def test_build_gpu_cluster_fragment_without_visible_services(monkeypatch):
    from routers.fragments import _build_gpu_cluster_fragment

    monkeypatch.setattr("routers.fragments.SERVICES", {"dashboard-api": {"name": "Dashboard API"}})

    html = _build_gpu_cluster_fragment(
        {"nodes": [], "total_gpus": 0, "active_gpus": 0, "failover_ready": False},
        None,
    )
    assert "No cluster-aware services discovered" in html


def test_memory_label_helper_handles_discrete_and_unified():
    from routers.fragments import _memory_label

    assert _memory_label("unified") == "Unified Memory"
    assert _memory_label("discrete") == "VRAM"
