"""Tests for the sessions HTML fragment endpoint."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest


def _make_session_mock(status: int, payload):
    response = MagicMock()
    response.status = status
    response.json = AsyncMock(return_value=payload)

    get_cm = MagicMock()
    get_cm.__aenter__ = AsyncMock(return_value=response)
    get_cm.__aexit__ = AsyncMock(return_value=False)

    session = MagicMock()
    session.get.return_value = get_cm

    session_cm = MagicMock()
    session_cm.__aenter__ = AsyncMock(return_value=session)
    session_cm.__aexit__ = AsyncMock(return_value=False)
    return session_cm


def test_sessions_fragment_requires_auth(test_client):
    resp = test_client.get("/api/fragments/sessions")
    assert resp.status_code == 401


def test_sessions_fragment_renders_live_rows(test_client):
    payload = [
        {
            "agent": "planner",
            "turns": 4,
            "total_input_tokens": 1200,
            "total_output_tokens": 4800,
        },
        {
            "agent": "coder",
            "turns": 2,
            "total_input_tokens": 800,
            "total_output_tokens": 2100,
        },
    ]

    with patch("aiohttp.ClientSession", return_value=_make_session_mock(200, payload)):
        resp = test_client.get("/api/fragments/sessions", headers=test_client.auth_headers)

    assert resp.status_code == 200
    assert "text/html" in resp.headers["content-type"]
    body = resp.text
    assert "Active Sessions" in body
    assert "planner" in body
    assert "coder" in body
    assert ">6<" in body
    assert "6.9k" in body


def test_sessions_fragment_handles_empty_payload(test_client):
    with patch("aiohttp.ClientSession", return_value=_make_session_mock(200, [])):
        resp = test_client.get("/api/fragments/sessions", headers=test_client.auth_headers)

    assert resp.status_code == 200
    assert "No active agent sessions reported by Token Spy." in resp.text


def test_sessions_fragment_escapes_agent_names(test_client):
    payload = [
        {
            "agent": "<script>alert(1)</script>",
            "turns": 1,
            "total_input_tokens": 100,
            "total_output_tokens": 200,
        }
    ]

    with patch("aiohttp.ClientSession", return_value=_make_session_mock(200, payload)):
        resp = test_client.get("/api/fragments/sessions", headers=test_client.auth_headers)

    assert resp.status_code == 200
    assert "<script>" not in resp.text
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in resp.text


@pytest.mark.asyncio
async def test_fetch_session_rows_returns_empty_on_non_200(monkeypatch):
    from routers.fragments_sessions import _fetch_session_rows

    monkeypatch.setattr("routers.fragments_sessions.TOKEN_SPY_URL", "http://token-spy:8080")

    with patch("aiohttp.ClientSession", return_value=_make_session_mock(503, [])):
        rows = await _fetch_session_rows()

    assert rows == []


@pytest.mark.asyncio
async def test_fetch_session_rows_returns_empty_when_token_spy_disabled(monkeypatch):
    from routers.fragments_sessions import _fetch_session_rows

    monkeypatch.setattr("routers.fragments_sessions.TOKEN_SPY_URL", "")
    rows = await _fetch_session_rows()
    assert rows == []


def test_build_sessions_fragment_formats_counts():
    from routers.fragments_sessions import _build_sessions_fragment

    html = _build_sessions_fragment(
        [
            {"agent": "planner", "turns": 3, "total_input_tokens": 500, "total_output_tokens": 1500},
            {"agent": "coder", "turns": 1, "total_input_tokens": 200, "total_output_tokens": 900},
        ]
    )

    assert "2 tracked" in html
    assert ">4<" in html
    assert "2.4k" in html


def test_format_tokens_helper_handles_ranges():
    from routers.fragments_sessions import _format_tokens

    assert _format_tokens(0) == "0"
    assert _format_tokens(999) == "999"
    assert _format_tokens(1500) == "1.5k"
    assert _format_tokens(2_500_000) == "2.5M"


def test_render_session_rows_empty_state():
    from routers.fragments_sessions import _render_session_rows

    html = _render_session_rows([])
    assert "No active agent sessions reported by Token Spy." in html
    assert "colspan=\"4\"" in html


def test_sessions_fragment_swallows_client_errors(test_client):
    session_cm = MagicMock()
    session_cm.__aenter__ = AsyncMock(side_effect=aiohttp.ClientError("down"))
    session_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("aiohttp.ClientSession", return_value=session_cm):
        resp = test_client.get("/api/fragments/sessions", headers=test_client.auth_headers)

    assert resp.status_code == 200
    assert "No active agent sessions reported by Token Spy." in resp.text
