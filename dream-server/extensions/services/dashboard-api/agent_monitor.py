"""
Agent Monitoring Module for Dashboard API
Collects real-time metrics on agent swarms, sessions, and throughput.
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Optional, Dict, List

logger = logging.getLogger(__name__)


class AgentMetrics:
    """Real-time agent monitoring metrics"""

    def __init__(self):
        self.last_update = datetime.now()
        self.session_count = 0
        self.tokens_per_second = 0.0
        self.error_rate_1h = 0.0
        self.queue_depth = 0
        self.requests_24h = 0
        # Rolling 24h window of (timestamp, lifetime_token_count) samples
        self._lifetime_window: List[dict] = []

    def record_lifetime_tokens(self, lifetime_count: int) -> None:
        """Append a lifetime token sample and prune entries older than 24h."""
        self._lifetime_window.append({
            "timestamp": datetime.now().isoformat(),
            "count": lifetime_count,
        })
        cutoff = datetime.now() - timedelta(hours=24)
        self._lifetime_window = [
            s for s in self._lifetime_window
            if datetime.fromisoformat(s["timestamp"]) > cutoff
        ]

    def tokens_24h(self) -> int:
        """Return tokens generated within the rolling 24h window."""
        if len(self._lifetime_window) < 2:
            return 0
        return max(0, self._lifetime_window[-1]["count"] - self._lifetime_window[0]["count"])

    def to_dict(self) -> dict:
        return {
            "session_count": self.session_count,
            "tokens_per_second": round(self.tokens_per_second, 2),
            "error_rate_1h": round(self.error_rate_1h, 2),
            "queue_depth": self.queue_depth,
            "last_update": self.last_update.isoformat()
        }


class ClusterStatus:
    """Cluster health and node status"""

    def __init__(self):
        self.nodes: List[dict] = []
        self.failover_ready = False
        self.total_gpus = 0
        self.active_gpus = 0

    async def refresh(self):
        """Query cluster status from smart proxy"""
        try:
            proc = await asyncio.create_subprocess_exec(
                "curl", "-s", f"http://localhost:{os.environ.get('CLUSTER_PROXY_PORT', '9199')}/status",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)

            if proc.returncode == 0:
                data = json.loads(stdout.decode())
                self.nodes = data.get("nodes", [])
                self.total_gpus = len(self.nodes)
                self.active_gpus = sum(1 for n in self.nodes if n.get("healthy", False))
                self.failover_ready = self.active_gpus > 1
        except Exception as e:
            logger.debug("Cluster status refresh failed: %s", e)

    def to_dict(self) -> dict:
        return {
            "nodes": self.nodes,
            "total_gpus": self.total_gpus,
            "active_gpus": self.active_gpus,
            "failover_ready": self.failover_ready
        }


class RequestTracker:
    """Rolling-window request and error event tracking.

    Events older than 24h are pruned on each write so memory stays bounded.
    The 1h error rate and 24h request count are computed on read against the
    live clock, so callers always get up-to-date values without a background task.
    """

    def __init__(self):
        # Each entry: {"timestamp": iso_str, "error": bool}
        self._events: List[dict] = []

    def record(self, error: bool = False) -> None:
        """Append a request event and prune entries older than 24h."""
        self._events.append({
            "timestamp": datetime.now().isoformat(),
            "error": error,
        })
        cutoff = datetime.now() - timedelta(hours=24)
        self._events = [
            e for e in self._events
            if datetime.fromisoformat(e["timestamp"]) > cutoff
        ]

    def requests_24h(self) -> int:
        """Count requests recorded in the last 24h."""
        cutoff = datetime.now() - timedelta(hours=24)
        return sum(
            1 for e in self._events
            if datetime.fromisoformat(e["timestamp"]) > cutoff
        )

    def error_rate_1h(self) -> float:
        """Return the error percentage (0–100) over the last 1h window."""
        cutoff = datetime.now() - timedelta(hours=1)
        recent = [
            e for e in self._events
            if datetime.fromisoformat(e["timestamp"]) > cutoff
        ]
        if not recent:
            return 0.0
        errors = sum(1 for e in recent if e["error"])
        return round(errors / len(recent) * 100, 2)


class ThroughputMetrics:
    """Real-time throughput tracking"""

    def __init__(self, history_minutes: int = 15):
        self.history_minutes = history_minutes
        self.data_points: List[dict] = []

    def add_sample(self, tokens_per_sec: float):
        """Add a new throughput sample"""
        self.data_points.append({
            "timestamp": datetime.now().isoformat(),
            "tokens_per_sec": tokens_per_sec
        })

        # Prune old data
        cutoff = datetime.now() - timedelta(minutes=self.history_minutes)
        self.data_points = [
            p for p in self.data_points
            if datetime.fromisoformat(p["timestamp"]) > cutoff
        ]

    def get_stats(self) -> dict:
        """Get throughput statistics"""
        if not self.data_points:
            return {"current": 0, "average": 0, "peak": 0, "history": []}

        values = [p["tokens_per_sec"] for p in self.data_points]
        return {
            "current": values[-1] if values else 0,
            "average": sum(values) / len(values),
            "peak": max(values) if values else 0,
            "history": self.data_points[-30:]  # Last 30 points
        }


# Global metrics instances
agent_metrics = AgentMetrics()
cluster_status = ClusterStatus()
throughput = ThroughputMetrics()
request_tracker = RequestTracker()


async def _poll_llama_slots() -> None:
    """Query llama-server /health for active slot counts.

    The /health endpoint returns ``{"slots_idle": N, "slots_processing": N}``.
    We map ``slots_processing`` → ``session_count`` and derive ``queue_depth``
    as any processing slots that have no idle capacity to absorb new requests.
    """
    try:
        import httpx  # noqa: PLC0415
        from config import SERVICES  # noqa: PLC0415
        host = SERVICES["llama-server"]["host"]
        port = SERVICES["llama-server"]["port"]
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"http://{host}:{port}/health")
        data = resp.json()
        slots_processing = int(data.get("slots_processing", 0))
        slots_idle = int(data.get("slots_idle", 0))
        agent_metrics.session_count = slots_processing
        # When all slots are busy, waiting requests pile up in the queue.
        # A non-zero queue_depth signals back-pressure on the inference engine.
        agent_metrics.queue_depth = max(0, slots_processing - (slots_idle + slots_processing)) \
            if slots_idle > 0 else max(0, slots_processing - 1)
    except Exception as e:
        logger.debug("llama-server slot poll failed: %s", e)


async def collect_metrics():
    """Background task to collect metrics periodically"""
    # Lazy import to avoid a circular import at module load time
    from helpers import get_llama_metrics  # noqa: PLC0415

    while True:
        try:
            await asyncio.gather(
                cluster_status.refresh(),
                _poll_llama_slots(),
            )

            llama = await get_llama_metrics()
            tps = float(llama.get("tokens_per_second", 0.0))
            lifetime = int(llama.get("lifetime_tokens", 0))

            agent_metrics.tokens_per_second = tps
            agent_metrics.record_lifetime_tokens(lifetime)
            throughput.add_sample(tps)

            agent_metrics.last_update = datetime.now()

        except Exception as e:
            logger.debug("Agent metrics collection failed: %s", e)

        await asyncio.sleep(5)  # Update every 5 seconds


def get_full_agent_metrics() -> dict:
    """Get all agent monitoring metrics as a dict."""
    from config import TOKEN_COST_PER_1K  # noqa: PLC0415
    th = throughput.get_stats()
    agent_dict = agent_metrics.to_dict()
    # Override with live-computed values from the request tracker so they
    # reflect events pushed between background-loop iterations.
    agent_dict["error_rate_1h"] = request_tracker.error_rate_1h()
    tokens_24h = agent_metrics.tokens_24h()
    cost_24h = round(tokens_24h / 1000 * TOKEN_COST_PER_1K, 6)
    return {
        "timestamp": datetime.now().isoformat(),
        "agent": agent_dict,
        "cluster": cluster_status.to_dict(),
        "throughput": th,
        "tokens": {
            "total_tokens_24h": tokens_24h,
            "top_models": [],
            "total_cost_24h": cost_24h,
            "requests_24h": request_tracker.requests_24h(),
        },
    }
