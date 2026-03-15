"""
Agent Monitoring Module for Dashboard API
Collects real-time metrics on agent swarms, sessions, and throughput.
"""

import asyncio
import json
from datetime import datetime, timedelta
from typing import List
import os


class AgentMetrics:
    """Real-time agent monitoring metrics"""

    def __init__(self):
        self.last_update = datetime.now()
        self.session_count = 0
        self.tokens_per_second = 0.0
        self.error_rate_1h = 0.0
        self.queue_depth = 0

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
        except (FileNotFoundError, asyncio.TimeoutError, OSError, json.JSONDecodeError):
            pass  # cluster proxy may not be running

    def to_dict(self) -> dict:
        return {
            "nodes": self.nodes,
            "total_gpus": self.total_gpus,
            "active_gpus": self.active_gpus,
            "failover_ready": self.failover_ready
        }


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


async def collect_metrics():
    """Background task to collect metrics periodically"""
    while True:
        try:
            # Update cluster status
            await cluster_status.refresh()

            agent_metrics.last_update = datetime.now()

        except (FileNotFoundError, asyncio.TimeoutError, OSError, json.JSONDecodeError):
            pass  # best-effort background metrics collection

        await asyncio.sleep(5)  # Update every 5 seconds


def get_full_agent_metrics() -> dict:
    """Get all agent monitoring metrics as a dict"""
    return {
        "timestamp": datetime.now().isoformat(),
        "agent": agent_metrics.to_dict(),
        "cluster": cluster_status.to_dict(),
        "throughput": throughput.get_stats()
    }
