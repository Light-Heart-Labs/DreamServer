"""HTML fragment endpoints for dashboard cards and htmx-style embeds."""

from __future__ import annotations

import html as html_mod

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

from agent_monitor import cluster_status
from config import SERVICES
from gpu import get_gpu_info
from security import verify_api_key

router = APIRouter(tags=["fragments"])


def _escape(value) -> str:
    return html_mod.escape(str(value))


def _status_class(healthy: bool) -> str:
    return "status-ok" if healthy else "status-warn"


def _memory_label(memory_type: str | None) -> str:
    return "Unified Memory" if memory_type == "unified" else "VRAM"


def _format_gb(value: float | int | None) -> str:
    if value is None:
        return "0.0 GB"
    return f"{float(value):.1f} GB"


def _render_service_tags() -> str:
    visible = []
    for service_id, cfg in SERVICES.items():
        if service_id == "dashboard-api":
            continue
        visible.append(cfg.get("name", service_id))

    if not visible:
        return "<span class=\"service-pill\">No cluster-aware services discovered</span>"

    return "".join(
        f"<span class=\"service-pill\">{_escape(name)}</span>"
        for name in sorted(visible)
    )


def _render_node_cards(nodes: list[dict]) -> str:
    if not nodes:
        return """
        <article class="node-card empty">
            <div class="node-name">No cluster nodes reported</div>
            <p class="node-meta">The smart proxy has not published any GPU workers yet.</p>
        </article>
        """

    cards = []
    for index, node in enumerate(nodes, start=1):
        name = _escape(node.get("name") or node.get("id") or f"node-{index}")
        healthy = bool(node.get("healthy", False))
        memory_used = _format_gb(node.get("memory_used_gb"))
        memory_total = _format_gb(node.get("memory_total_gb"))
        backend = _escape(node.get("backend", "gpu"))
        status_label = "Healthy" if healthy else "Standby"

        cards.append(
            f"""
            <article class="node-card">
                <div class="node-header">
                    <div>
                        <div class="node-name">{name}</div>
                        <div class="node-meta">{backend} worker</div>
                    </div>
                    <span class="status-chip {_status_class(healthy)}">{status_label}</span>
                </div>
                <div class="node-stats">
                    <div><span>Memory</span><strong>{memory_used} / {memory_total}</strong></div>
                    <div><span>Queue</span><strong>{_escape(node.get("queue_depth", 0))}</strong></div>
                </div>
            </article>
            """
        )

    return "".join(cards)


def _build_gpu_cluster_fragment(cluster: dict, gpu_info) -> str:
    nodes = cluster.get("nodes", [])
    total = cluster.get("total_gpus", 0)
    active = cluster.get("active_gpus", 0)
    host_summary = "Host GPU unavailable"
    if gpu_info:
        host_summary = (
            f"{_escape(gpu_info.name)} • "
            f"{_format_gb(gpu_info.memory_used_mb / 1024)} / "
            f"{_format_gb(gpu_info.memory_total_mb / 1024)} "
            f"{_memory_label(gpu_info.memory_type)}"
        )

    failover_text = "Failover ready" if cluster.get("failover_ready") else "Single-node or degraded"

    return f"""
    <section class="fragment-card gpu-cluster-fragment">
        <header class="fragment-header">
            <div>
                <h3>GPU Cluster</h3>
                <p>Live worker health, memory pressure, and failover readiness.</p>
            </div>
            <span class="status-chip {_status_class(bool(cluster.get('failover_ready')))}">{_escape(failover_text)}</span>
        </header>

        <div class="summary-grid">
            <article>
                <span class="summary-label">Healthy GPUs</span>
                <strong>{_escape(active)} / {_escape(total)}</strong>
            </article>
            <article>
                <span class="summary-label">Host accelerator</span>
                <strong>{host_summary}</strong>
            </article>
        </div>

        <div class="node-grid">
            {_render_node_cards(nodes)}
        </div>

        <footer class="fragment-footer">
            <span class="summary-label">Cluster-aware services</span>
            <div class="service-pills">{_render_service_tags()}</div>
        </footer>
    </section>
    """


@router.get("/api/fragments/gpu-cluster")
async def gpu_cluster_fragment(api_key: str = Depends(verify_api_key)):
    """Return an HTML fragment for cluster health cards."""
    await cluster_status.refresh()
    cluster = cluster_status.to_dict()
    gpu_info = get_gpu_info()
    return HTMLResponse(content=_build_gpu_cluster_fragment(cluster, gpu_info))
