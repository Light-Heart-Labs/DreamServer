"""Agent monitoring endpoints."""

import html as html_mod

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

from agent_monitor import get_full_agent_metrics, cluster_status, throughput, request_tracker
from models import AgentEvent
from security import verify_api_key

router = APIRouter(tags=["agents"])


@router.get("/api/agents/metrics")
async def get_agent_metrics(api_key: str = Depends(verify_api_key)):
    """Get comprehensive agent monitoring metrics."""
    return get_full_agent_metrics()


@router.get("/api/agents/metrics.html")
async def get_agent_metrics_html(api_key: str = Depends(verify_api_key)):
    """Get agent metrics as HTML fragment for htmx."""
    metrics = get_full_agent_metrics()
    cluster_class = "status-ok" if metrics["cluster"]["failover_ready"] else "status-warn"
    failover_text = "Ready \u2705" if metrics["cluster"]["failover_ready"] else "Single GPU \u26a0\ufe0f"
    last_update_time = metrics["agent"]["last_update"].split("T")[1][:8]
    tokens = metrics.get("tokens", {})
    tokens_k = tokens.get("total_tokens_24h", 0) // 1000
    top_models = tokens.get("top_models", [])
    if top_models:
        rows = "".join(
            "<tr><td>{}</td><td>{}K</td><td>{}</td></tr>".format(
                html_mod.escape(str(m["model"])), m["tokens"] // 1000, m["requests"]
            )
            for m in top_models
        )
        top_models_html = (
            "<article class='metric-card'><h4>Top Models (24h)</h4>"
            "<table><thead><tr><th>Model</th><th>Tokens</th><th>Requests</th></tr></thead>"
            "<tbody>" + rows + "</tbody></table></article>"
        )
    else:
        top_models_html = ""

    html = f"""
    <div class="grid">
        <article class="metric-card">
            <div class="metric-label">Cluster Status</div>
            <div class="metric-value {cluster_class}">{metrics["cluster"]["active_gpus"]}/{metrics["cluster"]["total_gpus"]} GPUs</div>
            <p style="margin: 0; font-size: 0.875rem;">Failover: {failover_text}</p>
        </article>
        <article class="metric-card">
            <div class="metric-label">Active Sessions</div>
            <div class="metric-value">{metrics["agent"]["session_count"]}</div>
            <p style="margin: 0; font-size: 0.875rem;">Updated: {last_update_time}</p>
        </article>
        <article class="metric-card">
            <div class="metric-label">Token Usage (24h)</div>
            <div class="metric-value">{tokens_k}K</div>
            <p style="margin: 0; font-size: 0.875rem;">${tokens.get("total_cost_24h", 0):.4f} | {tokens.get("requests_24h", 0)} reqs</p>
        </article>
        <article class="metric-card">
            <div class="metric-label">Throughput</div>
            <div class="metric-value">{metrics.get("throughput", {}).get("current", 0):.1f}</div>
            <p style="margin: 0; font-size: 0.875rem;">tokens/sec (avg: {metrics.get("throughput", {}).get("average", 0):.1f})</p>
        </article>
    </div>
    {top_models_html}
    """
    return HTMLResponse(content=html)


@router.get("/api/agents/cluster")
async def get_cluster_status(api_key: str = Depends(verify_api_key)):
    """Get cluster health and node status."""
    await cluster_status.refresh()
    return cluster_status.to_dict()


@router.get("/api/agents/throughput")
async def get_throughput(api_key: str = Depends(verify_api_key)):
    """Get throughput metrics (tokens/sec)."""
    return throughput.get_stats()


@router.get("/api/agents/summary")
async def get_agent_summary(api_key: str = Depends(verify_api_key)):
    """Return a compact health summary with a single derived status field.

    Status rules (evaluated in order):
    - ``"critical"``  — error_rate_1h > 25 % **or** cluster has no active GPUs
    - ``"degraded"``  — error_rate_1h > 5 % **or** queue_depth > 10
    - ``"healthy"``   — everything within normal bounds
    """
    metrics = get_full_agent_metrics()
    error_rate = metrics["agent"]["error_rate_1h"]
    active_gpus = metrics["cluster"]["active_gpus"]
    queue_depth = metrics["agent"]["queue_depth"]

    if error_rate > 25.0 or active_gpus == 0:
        status = "critical"
    elif error_rate > 5.0 or queue_depth > 10:
        status = "degraded"
    else:
        status = "healthy"

    return {
        "status": status,
        "active_sessions": metrics["agent"]["session_count"],
        "queue_depth": queue_depth,
        "tps_current": metrics["throughput"].get("current", 0),
        "tps_peak": metrics["throughput"].get("peak", 0),
        "error_rate_1h": error_rate,
        "requests_24h": metrics["tokens"]["requests_24h"],
        "tokens_24h": metrics["tokens"]["total_tokens_24h"],
        "cost_24h": metrics["tokens"]["total_cost_24h"],
        "gpus_active": active_gpus,
        "gpus_total": metrics["cluster"]["total_gpus"],
        "failover_ready": metrics["cluster"]["failover_ready"],
        "timestamp": metrics["timestamp"],
    }


@router.post("/api/agents/event")
async def record_agent_event(event: AgentEvent, api_key: str = Depends(verify_api_key)):
    """Ingest a request completion event from the llama-server proxy or any service.

    Callers should POST with ``{"error": true}`` on failed/timed-out requests
    so that the 1h error rate and 24h request counter stay accurate.
    """
    request_tracker.record(error=event.error)
    return {
        "recorded": True,
        "requests_24h": request_tracker.requests_24h(),
        "error_rate_1h": request_tracker.error_rate_1h(),
    }
