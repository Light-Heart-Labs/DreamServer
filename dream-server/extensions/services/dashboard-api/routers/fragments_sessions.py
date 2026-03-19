"""HTML fragments for live agent session views."""

from __future__ import annotations

import html as html_mod

import aiohttp
from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

from agent_monitor import TOKEN_SPY_API_KEY, TOKEN_SPY_URL
from security import verify_api_key

router = APIRouter(tags=["fragments"])


def _escape(value) -> str:
    return html_mod.escape(str(value))


def _format_tokens(value: int | float | None) -> str:
    if not value:
        return "0"
    value = int(value)
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M"
    if value >= 1_000:
        return f"{value / 1_000:.1f}k"
    return str(value)


async def _fetch_session_rows() -> list[dict]:
    if not TOKEN_SPY_URL:
        return []

    headers = {}
    if TOKEN_SPY_API_KEY:
        headers["Authorization"] = f"Bearer {TOKEN_SPY_API_KEY}"

    timeout = aiohttp.ClientTimeout(total=5)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(f"{TOKEN_SPY_URL}/api/summary", headers=headers) as resp:
            if resp.status != 200:
                return []

            data = await resp.json()
            if not isinstance(data, list):
                return []
            return data


def _render_session_rows(rows: list[dict]) -> str:
    if not rows:
        return """
        <tr>
            <td colspan="4" class="empty-state">No active agent sessions reported by Token Spy.</td>
        </tr>
        """

    rendered = []
    for row in rows:
        agent = _escape(row.get("agent") or row.get("name") or "unknown")
        turns = _escape(row.get("turns", 0))
        output_tokens = _format_tokens(row.get("total_output_tokens", 0))
        input_tokens = _format_tokens(row.get("total_input_tokens", 0))
        rendered.append(
            f"""
            <tr>
                <td>{agent}</td>
                <td>{turns}</td>
                <td>{input_tokens}</td>
                <td>{output_tokens}</td>
            </tr>
            """
        )

    return "".join(rendered)


def _build_sessions_fragment(rows: list[dict]) -> str:
    total_turns = sum(int(row.get("turns", 0) or 0) for row in rows)
    total_output = sum(int(row.get("total_output_tokens", 0) or 0) for row in rows)
    active_agents = len(rows)

    return f"""
    <section class="fragment-card sessions-fragment">
        <header class="fragment-header">
            <div>
                <h3>Active Sessions</h3>
                <p>Live Token Spy summary of multi-agent activity and token usage.</p>
            </div>
            <span class="status-chip status-ok">{_escape(active_agents)} tracked</span>
        </header>

        <div class="summary-grid">
            <article>
                <span class="summary-label">Agents</span>
                <strong>{_escape(active_agents)}</strong>
            </article>
            <article>
                <span class="summary-label">Turns</span>
                <strong>{_escape(total_turns)}</strong>
            </article>
            <article>
                <span class="summary-label">Output tokens</span>
                <strong>{_escape(_format_tokens(total_output))}</strong>
            </article>
        </div>

        <table class="session-table">
            <thead>
                <tr>
                    <th>Agent</th>
                    <th>Turns</th>
                    <th>Input Tokens</th>
                    <th>Output Tokens</th>
                </tr>
            </thead>
            <tbody>
                {_render_session_rows(rows)}
            </tbody>
        </table>
    </section>
    """


@router.get("/api/fragments/sessions")
async def sessions_fragment(api_key: str = Depends(verify_api_key)):
    """Return an HTML fragment for live session summaries."""
    try:
        rows = await _fetch_session_rows()
    except aiohttp.ClientError:
        rows = []
    except aiohttp.ContentTypeError:
        rows = []
    return HTMLResponse(content=_build_sessions_fragment(rows))
