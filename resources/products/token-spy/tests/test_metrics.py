import importlib.util
from pathlib import Path

METRICS_PATH = Path(__file__).resolve().parents[1] / "sidecar" / "metrics.py"
spec = importlib.util.spec_from_file_location("token_spy_metrics", METRICS_PATH)
metrics_module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(metrics_module)
normalize_cost_and_speed_metrics = metrics_module.normalize_cost_and_speed_metrics


def test_normalize_typical_values():
    metrics = normalize_cost_and_speed_metrics(
        total_tokens=1200,
        total_cost=2.4,
        avg_latency_ms=400,
    )

    assert metrics["cost_per_1k_tokens"] == 2.0
    assert metrics["tokens_per_second"] == 3000.0


def test_normalize_uses_ttft_plus_latency_when_available():
    metrics = normalize_cost_and_speed_metrics(
        total_tokens=600,
        total_cost=1.2,
        avg_latency_ms=300,
        avg_ttft_ms=200,
    )

    assert metrics["cost_per_1k_tokens"] == 2.0
    assert metrics["tokens_per_second"] == 1200.0


def test_normalize_zero_tokens_returns_none_for_both():
    metrics = normalize_cost_and_speed_metrics(
        total_tokens=0,
        total_cost=3.0,
        avg_latency_ms=100,
    )

    assert metrics["cost_per_1k_tokens"] is None
    assert metrics["tokens_per_second"] is None


def test_normalize_zero_or_missing_denominator_returns_none_speed():
    zero_latency = normalize_cost_and_speed_metrics(
        total_tokens=200,
        total_cost=0.5,
        avg_latency_ms=0,
    )
    missing_all_timing = normalize_cost_and_speed_metrics(
        total_tokens=200,
        total_cost=0.5,
        avg_latency_ms=None,
        avg_ttft_ms=None,
    )

    assert zero_latency["tokens_per_second"] is None
    assert missing_all_timing["tokens_per_second"] is None
    assert zero_latency["cost_per_1k_tokens"] == 2.5
    assert missing_all_timing["cost_per_1k_tokens"] == 2.5
