"""GPU router — per-GPU metrics, topology, and rolling history."""

import asyncio
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from security import verify_api_key

from gpu import (
    decode_gpu_assignment,
    get_gpu_info_amd_detailed,
    get_gpu_info_apple,
    get_gpu_info_nvidia_detailed,
    read_gpu_topology,
)
from models import GPUInfo, IndividualGPU, MultiGPUStatus

logger = logging.getLogger(__name__)

router = APIRouter(tags=["gpu"])

# Rolling history buffer — 60 samples max (5 min at 5 s intervals)
_GPU_HISTORY: deque = deque(maxlen=60)
_HISTORY_POLL_INTERVAL = 5.0

# Simple per-endpoint TTL caches
_detailed_cache: dict = {"expires": 0.0, "value": None}
_topology_cache: dict = {"expires": 0.0, "value": None}
_GPU_DETAILED_TTL = 3.0
_GPU_TOPOLOGY_TTL = 300.0


# ============================================================================
# Internal helpers
# ============================================================================

def _apple_info_to_individual(info: GPUInfo) -> IndividualGPU:
    """Wrap an Apple Silicon aggregate GPUInfo as a single IndividualGPU entry."""
    return IndividualGPU(
        index=0,
        uuid="apple-unified-0",  # 15 chars; GPUCard.jsx calls uuid.slice(-8)
        name=info.name,
        memory_used_mb=info.memory_used_mb,
        memory_total_mb=info.memory_total_mb,
        memory_percent=info.memory_percent,
        utilization_percent=info.utilization_percent,
        temperature_c=info.temperature_c,
        power_w=info.power_w,
        assigned_services=[],
    )


def _get_raw_gpus(gpu_backend: str) -> Optional[list[IndividualGPU]]:
    """Return per-GPU list from the appropriate backend, with fallback."""
    if gpu_backend == "apple":
        info = get_gpu_info_apple()
        if info is None:
            return None
        return [_apple_info_to_individual(info)]
    if gpu_backend == "amd":
        return get_gpu_info_amd_detailed()
    result = get_gpu_info_nvidia_detailed()
    if result:
        return result
    return get_gpu_info_amd_detailed()


def _build_aggregate(gpus: list[IndividualGPU], backend: str) -> GPUInfo:
    """Compute an aggregate GPUInfo from a list of IndividualGPU objects."""
    if len(gpus) == 1:
        g = gpus[0]
        return GPUInfo(
            name=g.name,
            memory_used_mb=g.memory_used_mb,
            memory_total_mb=g.memory_total_mb,
            memory_percent=g.memory_percent,
            utilization_percent=g.utilization_percent,
            temperature_c=g.temperature_c,
            power_w=g.power_w,
            gpu_backend=backend,
        )

    mem_used = sum(g.memory_used_mb for g in gpus)
    mem_total = sum(g.memory_total_mb for g in gpus)
    avg_util = round(sum(g.utilization_percent for g in gpus) / len(gpus))
    max_temp = max(g.temperature_c for g in gpus)
    pw_values = [g.power_w for g in gpus if g.power_w is not None]
    total_power: Optional[float] = round(sum(pw_values), 1) if pw_values else None

    names = [g.name for g in gpus]
    if len(set(names)) == 1:
        display_name = f"{names[0]} \u00d7 {len(gpus)}"
    else:
        display_name = " + ".join(names[:2])
        if len(names) > 2:
            display_name += f" + {len(names) - 2} more"

    return GPUInfo(
        name=display_name,
        memory_used_mb=mem_used,
        memory_total_mb=mem_total,
        memory_percent=round(mem_used / mem_total * 100, 1) if mem_total > 0 else 0.0,
        utilization_percent=avg_util,
        temperature_c=max_temp,
        power_w=total_power,
        gpu_backend=backend,
    )


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/api/gpu/detailed", response_model=MultiGPUStatus, dependencies=[Depends(verify_api_key)])
async def gpu_detailed():
    """Per-GPU metrics with service assignment info (cached 3 s)."""
    now = time.monotonic()
    if now < _detailed_cache["expires"] and _detailed_cache["value"] is not None:
        return _detailed_cache["value"]

    gpu_backend = os.environ.get("GPU_BACKEND", "").lower() or "nvidia"
    gpus = await asyncio.to_thread(_get_raw_gpus, gpu_backend)
    if not gpus:
        raise HTTPException(status_code=503, detail="No GPU data available")

    aggregate = _build_aggregate(gpus, gpu_backend)

    assignment_full = decode_gpu_assignment()
    assignment_data = assignment_full.get("gpu_assignment") if assignment_full else None

    result = MultiGPUStatus(
        gpu_count=len(gpus),
        backend=gpu_backend,
        gpus=gpus,
        topology=None,  # topology is served from its own endpoint
        assignment=assignment_data,
        split_mode=os.environ.get("LLAMA_ARG_SPLIT_MODE") or None,
        tensor_split=os.environ.get("LLAMA_ARG_TENSOR_SPLIT") or None,
        aggregate=aggregate,
    )
    _detailed_cache["expires"] = now + _GPU_DETAILED_TTL
    _detailed_cache["value"] = result
    return result


@router.get("/api/gpu/topology", dependencies=[Depends(verify_api_key)])
async def gpu_topology():
    """GPU topology from config/gpu-topology.json (written by installer / dream-cli). Cached 300 s."""
    now = time.monotonic()
    if now < _topology_cache["expires"] and _topology_cache["value"] is not None:
        return _topology_cache["value"]

    topo = await asyncio.to_thread(read_gpu_topology)
    if not topo:
        raise HTTPException(
            status_code=404,
            detail="GPU topology not available. Run 'dream gpu reassign' to generate it.",
        )

    _topology_cache["expires"] = now + _GPU_TOPOLOGY_TTL
    _topology_cache["value"] = topo
    return topo


@router.get("/api/gpu/history", dependencies=[Depends(verify_api_key)])
async def gpu_history():
    """Rolling 5-minute per-GPU metrics history sampled every 5 s."""
    if not _GPU_HISTORY:
        return {"timestamps": [], "gpus": {}}

    timestamps = [s["timestamp"] for s in _GPU_HISTORY]

    gpu_keys: set[str] = set()
    for sample in _GPU_HISTORY:
        gpu_keys.update(sample["gpus"].keys())

    gpus_data: dict[str, dict] = {}
    for gpu_key in sorted(gpu_keys):
        gpus_data[gpu_key] = {
            "utilization": [],
            "memory_percent": [],
            "temperature": [],
            "power_w": [],
        }
        for sample in _GPU_HISTORY:
            g = sample["gpus"].get(gpu_key, {})
            gpus_data[gpu_key]["utilization"].append(g.get("utilization", 0))
            gpus_data[gpu_key]["memory_percent"].append(g.get("memory_percent", 0))
            gpus_data[gpu_key]["temperature"].append(g.get("temperature", 0))
            gpus_data[gpu_key]["power_w"].append(g.get("power_w"))

    return {"timestamps": timestamps, "gpus": gpus_data}


# ============================================================================
# Background task
# ============================================================================

async def poll_gpu_history() -> None:
    """Background task: append a per-GPU sample to _GPU_HISTORY every 5 s."""
    while True:
        try:
            gpu_backend = os.environ.get("GPU_BACKEND", "").lower() or "nvidia"
            gpus = await asyncio.to_thread(_get_raw_gpus, gpu_backend)
            if gpus:
                sample = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "gpus": {
                        str(g.index): {
                            "utilization": g.utilization_percent,
                            "memory_percent": g.memory_percent,
                            "temperature": g.temperature_c,
                            "power_w": g.power_w,
                        }
                        for g in gpus
                    },
                }
                _GPU_HISTORY.append(sample)
        except Exception:  # Broad catch: background task must survive transient failures
            logger.exception("GPU history poll failed")
        await asyncio.sleep(_HISTORY_POLL_INTERVAL)
