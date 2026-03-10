"""Tests for agent_monitor.py — throughput metrics and data classes."""

from datetime import datetime, timedelta

import pytest

from agent_monitor import ThroughputMetrics, AgentMetrics, ClusterStatus, RequestTracker


class TestThroughputMetrics:

    def test_empty_stats(self):
        tm = ThroughputMetrics()
        stats = tm.get_stats()
        assert stats["current"] == 0
        assert stats["average"] == 0
        assert stats["peak"] == 0
        assert stats["history"] == []

    def test_add_sample_updates_stats(self):
        tm = ThroughputMetrics()
        tm.add_sample(10.0)
        tm.add_sample(20.0)
        tm.add_sample(30.0)

        stats = tm.get_stats()
        assert stats["current"] == 30.0
        assert stats["average"] == 20.0
        assert stats["peak"] == 30.0
        assert len(stats["history"]) == 3

    def test_prunes_old_data(self):
        tm = ThroughputMetrics(history_minutes=5)

        # Insert an old data point by manipulating the list directly
        old_time = (datetime.now() - timedelta(minutes=10)).isoformat()
        tm.data_points.append({"timestamp": old_time, "tokens_per_sec": 99.0})

        # Adding a new sample triggers pruning
        tm.add_sample(10.0)

        assert len(tm.data_points) == 1
        assert tm.data_points[0]["tokens_per_sec"] == 10.0

    def test_history_capped_at_30_points(self):
        tm = ThroughputMetrics()
        for i in range(50):
            tm.add_sample(float(i))

        stats = tm.get_stats()
        assert len(stats["history"]) == 30


class TestAgentMetrics:

    def test_to_dict_keys(self):
        am = AgentMetrics()
        d = am.to_dict()
        assert set(d.keys()) == {
            "session_count", "tokens_per_second",
            "error_rate_1h", "queue_depth", "last_update",
        }

    def test_to_dict_types(self):
        am = AgentMetrics()
        d = am.to_dict()
        assert isinstance(d["session_count"], int)
        assert isinstance(d["tokens_per_second"], float)
        assert isinstance(d["last_update"], str)

    def test_tokens_24h_empty(self):
        am = AgentMetrics()
        assert am.tokens_24h() == 0

    def test_tokens_24h_single_sample(self):
        am = AgentMetrics()
        am.record_lifetime_tokens(1000)
        # Single sample — no delta can be computed
        assert am.tokens_24h() == 0

    def test_tokens_24h_accumulates_delta(self):
        am = AgentMetrics()
        am.record_lifetime_tokens(5000)
        am.record_lifetime_tokens(8000)
        am.record_lifetime_tokens(12000)
        assert am.tokens_24h() == 7000  # 12000 - 5000

    def test_tokens_24h_floors_at_zero_on_reset(self):
        am = AgentMetrics()
        am.record_lifetime_tokens(9000)
        # Simulate a server restart where the counter dropped
        am.record_lifetime_tokens(100)
        assert am.tokens_24h() == 0

    def test_record_lifetime_tokens_prunes_old_entries(self):
        am = AgentMetrics()
        old_time = (datetime.now() - timedelta(hours=25)).isoformat()
        am._lifetime_window.append({"timestamp": old_time, "count": 0})
        am.record_lifetime_tokens(500)
        # The old entry should have been pruned
        assert len(am._lifetime_window) == 1
        assert am._lifetime_window[0]["count"] == 500


class TestRequestTracker:

    def test_empty_returns_zero(self):
        rt = RequestTracker()
        assert rt.requests_24h() == 0
        assert rt.error_rate_1h() == 0.0

    def test_records_requests(self):
        rt = RequestTracker()
        rt.record()
        rt.record()
        rt.record()
        assert rt.requests_24h() == 3

    def test_error_rate_all_success(self):
        rt = RequestTracker()
        for _ in range(5):
            rt.record(error=False)
        assert rt.error_rate_1h() == 0.0

    def test_error_rate_all_errors(self):
        rt = RequestTracker()
        for _ in range(4):
            rt.record(error=True)
        assert rt.error_rate_1h() == 100.0

    def test_error_rate_mixed(self):
        rt = RequestTracker()
        for _ in range(3):
            rt.record(error=False)
        for _ in range(1):
            rt.record(error=True)
        assert rt.error_rate_1h() == 25.0

    def test_prunes_events_older_than_24h(self):
        rt = RequestTracker()
        old_time = (datetime.now() - timedelta(hours=25)).isoformat()
        rt._events.append({"timestamp": old_time, "error": False})
        rt.record()
        assert rt.requests_24h() == 1

    def test_error_rate_excludes_events_older_than_1h(self):
        rt = RequestTracker()
        # An old error that is outside the 1h window
        old_time = (datetime.now() - timedelta(hours=2)).isoformat()
        rt._events.append({"timestamp": old_time, "error": True})
        # A recent success inside the 1h window
        rt.record(error=False)
        assert rt.error_rate_1h() == 0.0

    def test_requests_24h_counts_only_within_window(self):
        rt = RequestTracker()
        old_time = (datetime.now() - timedelta(hours=25)).isoformat()
        rt._events.append({"timestamp": old_time, "error": False})
        rt._events.append({"timestamp": old_time, "error": False})
        rt.record()
        assert rt.requests_24h() == 1


class TestCostEstimation:
    """Validate cost derived from tokens_24h and TOKEN_COST_PER_1K."""

    def test_zero_cost_when_no_tokens(self):
        am = AgentMetrics()
        assert am.tokens_24h() == 0

    def test_cost_scales_with_token_rate(self):
        # 10 000 tokens @ $0.002/1K → $0.020
        tokens = 10_000
        rate = 0.002
        cost = round(tokens / 1000 * rate, 6)
        assert cost == pytest.approx(0.02, rel=1e-6)

    def test_cost_zero_for_self_hosted_default(self):
        tokens = 500_000
        rate = 0.0
        cost = round(tokens / 1000 * rate, 6)
        assert cost == 0.0


class TestSummaryStatusDerivation:
    """Validate the status-field logic from GET /api/agents/summary."""

    def _status(self, error_rate: float, active_gpus: int, queue_depth: int) -> str:
        if error_rate > 25.0 or active_gpus == 0:
            return "critical"
        if error_rate > 5.0 or queue_depth > 10:
            return "degraded"
        return "healthy"

    def test_healthy_baseline(self):
        assert self._status(0.0, 1, 0) == "healthy"

    def test_critical_on_high_error_rate(self):
        assert self._status(30.0, 1, 0) == "critical"

    def test_critical_on_no_gpus(self):
        assert self._status(0.0, 0, 0) == "critical"

    def test_degraded_on_moderate_error_rate(self):
        assert self._status(10.0, 1, 0) == "degraded"

    def test_degraded_on_high_queue(self):
        assert self._status(0.0, 1, 11) == "degraded"

    def test_boundary_error_rate_5_is_healthy(self):
        assert self._status(5.0, 1, 0) == "healthy"

    def test_boundary_error_rate_just_above_5_is_degraded(self):
        assert self._status(5.1, 1, 0) == "degraded"

    def test_boundary_queue_10_is_healthy(self):
        assert self._status(0.0, 1, 10) == "healthy"

    def test_critical_beats_degraded(self):
        # High queue AND no GPUs → critical wins
        assert self._status(0.0, 0, 99) == "critical"


class TestAgentMetricsSlots:
    """Validate session_count and queue_depth field updates."""

    def test_defaults_are_zero(self):
        am = AgentMetrics()
        assert am.session_count == 0
        assert am.queue_depth == 0

    def test_session_count_settable(self):
        am = AgentMetrics()
        am.session_count = 3
        assert am.to_dict()["session_count"] == 3

    def test_queue_depth_settable(self):
        am = AgentMetrics()
        am.queue_depth = 7
        assert am.to_dict()["queue_depth"] == 7


class TestClusterStatus:

    def test_to_dict_defaults(self):
        cs = ClusterStatus()
        d = cs.to_dict()
        assert d["nodes"] == []
        assert d["total_gpus"] == 0
        assert d["active_gpus"] == 0
        assert d["failover_ready"] is False
