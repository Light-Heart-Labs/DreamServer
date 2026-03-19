"""Tests for the errors HTML fragment endpoint."""

from __future__ import annotations

from unittest.mock import AsyncMock

from models import ServiceStatus


def test_errors_fragment_requires_auth(test_client):
    resp = test_client.get("/api/fragments/errors")
    assert resp.status_code == 401


def test_errors_fragment_renders_manifest_and_service_issues(test_client, monkeypatch):
    monkeypatch.setattr(
        "routers.fragments_errors.MANIFEST_ERRORS",
        [{"file": "extensions/services/bad/manifest.yaml", "error": "Unsupported schema_version"}],
    )
    monkeypatch.setattr(
        "routers.fragments_errors.get_all_services",
        AsyncMock(return_value=[
            ServiceStatus(id="webui", name="Open WebUI", port=3000, external_port=3000, status="healthy"),
            ServiceStatus(id="n8n", name="n8n", port=5678, external_port=5678, status="down"),
        ]),
    )

    resp = test_client.get("/api/fragments/errors", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    body = resp.text
    assert "Error Summary" in body
    assert "Unsupported schema_version" in body
    assert "n8n" in body
    assert "down" in body
    assert "2 issue(s)" in body


def test_errors_fragment_handles_clean_state(test_client, monkeypatch):
    monkeypatch.setattr("routers.fragments_errors.MANIFEST_ERRORS", [])
    monkeypatch.setattr(
        "routers.fragments_errors.get_all_services",
        AsyncMock(return_value=[
            ServiceStatus(id="webui", name="Open WebUI", port=3000, external_port=3000, status="healthy"),
            ServiceStatus(id="tts", name="Kokoro", port=8880, external_port=8880, status="not_deployed"),
        ]),
    )

    resp = test_client.get("/api/fragments/errors", headers=test_client.auth_headers)
    assert resp.status_code == 200
    assert "0 issue(s)" in resp.text
    assert "No manifest parsing errors detected." in resp.text
    assert "All deployed services are healthy." in resp.text


def test_render_manifest_errors_escapes_html():
    from routers.fragments_errors import _render_manifest_errors

    html = _render_manifest_errors(
        [{"file": "<script>", "error": "<b>bad</b>"}]
    )
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "&lt;b&gt;bad&lt;/b&gt;" in html


def test_render_service_errors_filters_healthy_states():
    from routers.fragments_errors import _render_service_errors

    html = _render_service_errors(
        [
            ServiceStatus(id="webui", name="Open WebUI", port=3000, external_port=3000, status="healthy"),
            ServiceStatus(id="n8n", name="n8n", port=5678, external_port=5678, status="degraded"),
            ServiceStatus(id="tts", name="Kokoro", port=8880, external_port=8880, status="not_deployed"),
        ]
    )

    assert "Open WebUI" not in html
    assert "Kokoro" not in html
    assert "n8n" in html


def test_build_errors_fragment_counts_total_issues():
    from routers.fragments_errors import _build_errors_fragment

    html = _build_errors_fragment(
        [{"file": "manifest.yaml", "error": "bad"}],
        [
            ServiceStatus(id="n8n", name="n8n", port=5678, external_port=5678, status="down"),
            ServiceStatus(id="webui", name="Open WebUI", port=3000, external_port=3000, status="healthy"),
        ],
    )

    assert "2 issue(s)" in html
    assert "Manifest errors" in html
    assert "Service errors" in html


def test_render_manifest_errors_handles_empty_list():
    from routers.fragments_errors import _render_manifest_errors

    html = _render_manifest_errors([])
    assert "No manifest parsing errors detected." in html
