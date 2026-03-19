"""Shared metric normalization helpers for Token Spy sidecar APIs."""

from typing import Optional, Dict


def normalize_cost_and_speed_metrics(
    total_tokens: Optional[int],
    total_cost: Optional[float],
    avg_latency_ms: Optional[float],
    avg_ttft_ms: Optional[float] = None,
) -> Dict[str, Optional[float]]:
    """Compute normalized cost/speed metrics with safe fallback behavior."""
    tokens_value = int(total_tokens) if total_tokens is not None else 0
    cost_value = float(total_cost) if total_cost is not None else 0.0

    cost_per_1k_tokens = (
        (cost_value / tokens_value) * 1000 if tokens_value > 0 else None
    )

    total_time_ms = 0.0
    if avg_ttft_ms is not None and avg_ttft_ms > 0:
        total_time_ms += float(avg_ttft_ms)
    if avg_latency_ms is not None and avg_latency_ms > 0:
        total_time_ms += float(avg_latency_ms)

    tokens_per_second = (
        (tokens_value * 1000 / total_time_ms)
        if tokens_value > 0 and total_time_ms > 0
        else None
    )

    return {
        "cost_per_1k_tokens": cost_per_1k_tokens,
        "tokens_per_second": tokens_per_second,
    }
