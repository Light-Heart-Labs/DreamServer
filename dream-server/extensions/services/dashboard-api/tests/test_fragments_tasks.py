"""Tests for the workflow task fragment endpoint."""

from __future__ import annotations

from unittest.mock import AsyncMock


def test_tasks_fragment_requires_auth(test_client):
    resp = test_client.get("/api/fragments/tasks")
    assert resp.status_code == 401


def test_tasks_fragment_renders_catalog_cards(test_client, monkeypatch):
    monkeypatch.setattr(
        "routers.fragments_tasks.load_workflow_catalog",
        lambda: {
            "workflows": [
                {
                    "id": "daily-research",
                    "name": "Daily Research",
                    "description": "Gather fresh links and summarize them.",
                    "category": "research",
                    "dependencies": ["searxng", "llama-server"],
                },
                {
                    "id": "slack-briefing",
                    "name": "Slack Briefing",
                    "description": "Post a morning briefing to Slack.",
                    "category": "ops",
                    "dependencies": ["n8n"],
                },
            ]
        },
    )
    monkeypatch.setattr(
        "routers.fragments_tasks.get_n8n_workflows",
        AsyncMock(
            return_value=[
                {
                    "name": "Daily Research",
                    "active": True,
                    "statistics": {"executions": {"total": 18}},
                }
            ]
        ),
    )
    monkeypatch.setattr(
        "routers.fragments_tasks.check_workflow_dependencies",
        AsyncMock(side_effect=[{"searxng": True, "llama-server": True}, {"n8n": False}]),
    )

    resp = test_client.get("/api/fragments/tasks", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    body = resp.text
    assert "Automation Tasks" in body
    assert "Daily Research" in body
    assert "Slack Briefing" in body
    assert "Active" in body
    assert "Blocked" in body
    assert "Executions: 18" in body


def test_tasks_fragment_handles_empty_catalog(test_client, monkeypatch):
    monkeypatch.setattr("routers.fragments_tasks.load_workflow_catalog", lambda: {"workflows": []})
    monkeypatch.setattr("routers.fragments_tasks.get_n8n_workflows", AsyncMock(return_value=[]))

    resp = test_client.get("/api/fragments/tasks", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "No automation tasks discovered" in resp.text


def test_match_installed_workflow_accepts_partial_name_matches():
    from routers.fragments_tasks import _match_installed_workflow

    installed = [{"name": "Nightly Research Sync", "active": True}]
    match = _match_installed_workflow({"name": "Research Sync"}, installed)
    assert match == installed[0]


def test_build_tasks_fragment_summarizes_counts():
    from routers.fragments_tasks import _build_tasks_fragment

    html = _build_tasks_fragment(
        [
            {"name": "Task A", "description": "A", "category": "ops", "status": "active", "executions": 4, "dependencies": []},
            {"name": "Task B", "description": "B", "category": "ops", "status": "blocked", "executions": 0, "dependencies": []},
        ]
    )

    assert "2 catalogued" in html
    assert ">1<" in html
    assert "Task A" in html


def test_render_task_cards_escapes_content():
    from routers.fragments_tasks import _render_task_cards

    html = _render_task_cards(
        [
            {
                "name": "<script>alert(1)</script>",
                "description": "Dangerous",
                "category": "ops",
                "status": "blocked",
                "executions": 0,
                "dependencies": [{"name": "n8n", "ready": False}],
            }
        ]
    )

    assert "<script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html


def test_render_task_cards_handles_empty_state():
    from routers.fragments_tasks import _render_task_cards

    html = _render_task_cards([])
    assert "No automation tasks discovered" in html


def test_status_badge_maps_known_states():
    from routers.fragments_tasks import _status_badge

    assert _status_badge("active") == "status-ok"
    assert _status_badge("blocked") == "status-error"
    assert _status_badge("available") == "status-idle"


def test_tasks_fragment_marks_installed_but_inactive_workflows(test_client, monkeypatch):
    monkeypatch.setattr(
        "routers.fragments_tasks.load_workflow_catalog",
        lambda: {
            "workflows": [
                {
                    "id": "report",
                    "name": "Weekly Report",
                    "description": "Compile a weekly report.",
                    "category": "ops",
                    "dependencies": [],
                }
            ]
        },
    )
    monkeypatch.setattr(
        "routers.fragments_tasks.get_n8n_workflows",
        AsyncMock(return_value=[{"name": "Weekly Report", "active": False, "statistics": {"executions": {"total": 3}}}]),
    )
    monkeypatch.setattr("routers.fragments_tasks.check_workflow_dependencies", AsyncMock(return_value={}))

    resp = test_client.get("/api/fragments/tasks", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "Installed" in resp.text
