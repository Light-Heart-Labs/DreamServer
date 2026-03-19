"""HTML fragments for agent operations cards."""

from __future__ import annotations

import html as html_mod

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

from agent_monitor import get_full_agent_metrics
from security import verify_api_key

router = APIRouter(tags=["fragments"])


def _escape(value) -> str:
    return html_mod.escape(str(value))


def _format_rate(value: float | int | None) -> str:
    if value is None:
        return "0.0"
    return f"{float(value):.1f}"


def _status_class(value: float | int) -> str:
    if value <= 0:
        return "status-idle"
    if value < 10:
        return "status-warn"
    return "status-ok"


def _render_history_points(history: list[dict]) -> str:
    if not history:
        return """
        <li class="history-empty">
            <span>No recent throughput samples yet.</span>
        </li>
        """

    return "".join(
        f"""
        <li>
            <span>{_escape(point.get('timestamp', 'unknown'))}</span>
            <strong>{_escape(_format_rate(point.get('tokens_per_sec', 0)))}</strong>
        </li>
        """
        for point in history[-5:]
    )


def _build_agents_fragment(metrics: dict) -> str:
    agent = metrics.get("agent", {})
    cluster = metrics.get("cluster", {})
    throughput = metrics.get("throughput", {})

    current_tps = float(throughput.get("current", 0) or 0)
    average_tps = float(throughput.get("average", 0) or 0)
    peak_tps = float(throughput.get("peak", 0) or 0)
    session_count = int(agent.get("session_count", 0) or 0)
    queue_depth = int(agent.get("queue_depth", 0) or 0)
    failover_ready = bool(cluster.get("failover_ready", False))
    history = throughput.get("history", [])

    return f"""
    <section class="fragment-card agents-fragment">
        <header class="fragment-header">
            <div>
                <h3>Agent Operations</h3>
                <p>Session pressure, queue depth, and failover readiness for the local agent swarm.</p>
            </div>
            <span class="status-chip {'status-ok' if failover_ready else 'status-warn'}">
                {_escape('Failover ready' if failover_ready else 'Single-node')}
            </span>
        </header>

        <div class="summary-grid">
            <article>
                <span class="summary-label">Sessions</span>
                <strong>{_escape(session_count)}</strong>
            </article>
            <article>
                <span class="summary-label">Queue depth</span>
                <strong>{_escape(queue_depth)}</strong>
            </article>
            <article>
                <span class="summary-label">Current TPS</span>
                <strong class="{_status_class(current_tps)}">{_escape(_format_rate(current_tps))}</strong>
            </article>
            <article>
                <span class="summary-label">Average TPS</span>
                <strong>{_escape(_format_rate(average_tps))}</strong>
            </article>
            <article>
                <span class="summary-label">Peak TPS</span>
                <strong>{_escape(_format_rate(peak_tps))}</strong>
            </article>
        </div>

        <div class="detail-grid">
            <article class="detail-card">
                <span class="summary-label">Error rate (1h)</span>
                <strong>{_escape(_format_rate(agent.get('error_rate_1h', 0)))}%</strong>
            </article>
            <article class="detail-card">
                <span class="summary-label">Cluster GPUs</span>
                <strong>{_escape(cluster.get('active_gpus', 0))} / {_escape(cluster.get('total_gpus', 0))}</strong>
            </article>
            <article class="detail-card">
                <span class="summary-label">Last update</span>
                <strong>{_escape(agent.get('last_update', 'unknown'))}</strong>
            </article>
        </div>

        <div class="history-panel">
            <span class="summary-label">Recent throughput</span>
            <ul class="history-list">
                {_render_history_points(history)}
            </ul>
        </div>
    </section>
    """


@router.get("/api/fragments/agents")
async def agents_fragment(api_key: str = Depends(verify_api_key)):
    """Return an HTML fragment for agent operations cards."""
    metrics = get_full_agent_metrics()
    return HTMLResponse(content=_build_agents_fragment(metrics))
