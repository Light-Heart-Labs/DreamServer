"""Tests for the agent operations fragment endpoint."""

from __future__ import annotations


def test_agents_fragment_requires_auth(test_client):
    resp = test_client.get("/api/fragments/agents")
    assert resp.status_code == 401


def test_agents_fragment_renders_metrics_summary(test_client, monkeypatch):
    monkeypatch.setattr(
        "routers.fragments_agents.get_full_agent_metrics",
        lambda: {
            "agent": {
                "session_count": 7,
                "tokens_per_second": 14.2,
                "error_rate_1h": 0.7,
                "queue_depth": 3,
                "last_update": "2026-03-18T10:15:00",
            },
            "cluster": {
                "active_gpus": 2,
                "total_gpus": 2,
                "failover_ready": True,
            },
            "throughput": {
                "current": 14.2,
                "average": 11.6,
                "peak": 22.1,
                "history": [
                    {"timestamp": "10:10", "tokens_per_sec": 11.1},
                    {"timestamp": "10:15", "tokens_per_sec": 14.2},
                ],
            },
        },
    )

    resp = test_client.get("/api/fragments/agents", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    body = resp.text
    assert "Agent Operations" in body
    assert ">7<" in body
    assert ">3<" in body
    assert "14.2" in body
    assert "11.6" in body
    assert "22.1" in body
    assert "Failover ready" in body
    assert "2 / 2" in body
    assert "10:15" in body


def test_agents_fragment_handles_idle_metrics(test_client, monkeypatch):
    monkeypatch.setattr(
        "routers.fragments_agents.get_full_agent_metrics",
        lambda: {
            "agent": {"session_count": 0, "queue_depth": 0, "error_rate_1h": 0, "last_update": "never"},
            "cluster": {"active_gpus": 0, "total_gpus": 1, "failover_ready": False},
            "throughput": {"current": 0, "average": 0},
        },
    )

    resp = test_client.get("/api/fragments/agents", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "Single-node" in resp.text
    assert "status-idle" in resp.text
    assert "No recent throughput samples yet." in resp.text


def test_build_agents_fragment_escapes_untrusted_strings():
    from routers.fragments_agents import _build_agents_fragment

    html = _build_agents_fragment(
        {
            "agent": {
                "session_count": 1,
                "queue_depth": 0,
                "error_rate_1h": 0,
                "last_update": "<script>alert(1)</script>",
            },
            "cluster": {"active_gpus": 1, "total_gpus": 1, "failover_ready": True},
            "throughput": {"current": 4.2, "average": 4.0},
        }
    )

    assert "<script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html


def test_format_rate_helper():
    from routers.fragments_agents import _format_rate

    assert _format_rate(None) == "0.0"
    assert _format_rate(3) == "3.0"
    assert _format_rate(7.25) == "7.2"


def test_status_class_helper():
    from routers.fragments_agents import _status_class

    assert _status_class(0) == "status-idle"
    assert _status_class(5) == "status-warn"
    assert _status_class(12) == "status-ok"


def test_render_history_points_limits_output():
    from routers.fragments_agents import _render_history_points

    html = _render_history_points(
        [
            {"timestamp": "1", "tokens_per_sec": 1},
            {"timestamp": "2", "tokens_per_sec": 2},
            {"timestamp": "3", "tokens_per_sec": 3},
            {"timestamp": "4", "tokens_per_sec": 4},
            {"timestamp": "5", "tokens_per_sec": 5},
            {"timestamp": "6", "tokens_per_sec": 6},
        ]
    )

    assert "1</span>" not in html
    assert "6</span>" in html


def test_render_history_points_empty_state():
    from routers.fragments_agents import _render_history_points

    html = _render_history_points([])
    assert "No recent throughput samples yet." in html


def test_build_agents_fragment_includes_peak_and_history_labels():
    from routers.fragments_agents import _build_agents_fragment

    html = _build_agents_fragment(
        {
            "agent": {"session_count": 2, "queue_depth": 1, "error_rate_1h": 0.1, "last_update": "now"},
            "cluster": {"active_gpus": 1, "total_gpus": 1, "failover_ready": True},
            "throughput": {
                "current": 9.4,
                "average": 8.8,
                "peak": 13.7,
                "history": [{"timestamp": "10:00", "tokens_per_sec": 9.4}],
            },
        }
    )

    assert "Peak TPS" in html
    assert "Recent throughput" in html
    assert "13.7" in html


def test_escape_helper_stringifies_values():
    from routers.fragments_agents import _escape

    assert _escape(42) == "42"
    assert _escape("<tag>") == "&lt;tag&gt;"


def test_agents_fragment_handles_missing_sections(test_client, monkeypatch):
    monkeypatch.setattr("routers.fragments_agents.get_full_agent_metrics", lambda: {})

    resp = test_client.get("/api/fragments/agents", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "0.0" in resp.text
    assert "0 / 0" in resp.text
