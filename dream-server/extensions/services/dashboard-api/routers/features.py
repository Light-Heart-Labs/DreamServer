"""Feature discovery endpoints."""

import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from config import FEATURES, GPU_BACKEND, SERVICES
from gpu import get_gpu_info, get_gpu_tier
from models import GPUInfo
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["features"])


def calculate_feature_status(feature: dict, services: list, gpu_info: Optional[GPUInfo]) -> dict:
    """Calculate whether a feature can be enabled and its status."""
    gpu_vram_gb = (gpu_info.memory_total_mb / 1024) if gpu_info else 0
    gpu_vram_used_gb = (gpu_info.memory_used_mb / 1024) if gpu_info else 0
    gpu_vram_free_gb = gpu_vram_gb - gpu_vram_used_gb

    # On Apple Silicon, when HOST_CHIP is missing (get_gpu_info_apple returned None),
    # fall back to HOST_RAM_GB. Unified memory = VRAM on Apple Silicon.
    if gpu_vram_gb == 0 and GPU_BACKEND == "apple":
        try:
            gpu_vram_gb = float(os.environ.get("HOST_RAM_GB", "0") or "0")
        except (ValueError, TypeError):
            pass
        gpu_vram_free_gb = gpu_vram_gb  # assumes zero current usage; Docker can't measure host memory pressure

    req = feature["requirements"]
    vram_ok = gpu_vram_gb >= req.get("vram_gb", 0)
    vram_fits = gpu_vram_free_gb >= req.get("vram_gb", 0)

    required_services = req.get("services", [])
    required_services_any = req.get("services_any", [])
    all_required = list(dict.fromkeys(required_services + required_services_any))
    services_available = []
    services_missing = []

    for svc_id in all_required:
        svc_status = next((s for s in services if s.id == svc_id), None)
        if svc_status and svc_status.status == "healthy":
            services_available.append(svc_id)
        else:
            services_missing.append(svc_id)

    services_all_ok = all(svc in services_available for svc in required_services)
    services_any_ok = (not required_services_any) or any(svc in services_available for svc in required_services_any)
    services_ok = services_all_ok and services_any_ok

    enabled_all = feature.get("enabled_services_all", required_services)
    enabled_any = feature.get("enabled_services_any", required_services_any)
    enabled_all_ok = all(
        any(s.id == svc and s.status == "healthy" for s in services) for svc in enabled_all
    )
    enabled_any_ok = (not enabled_any) or any(
        any(s.id == svc and s.status == "healthy" for s in services) for svc in enabled_any
    )
    is_enabled = enabled_all_ok and enabled_any_ok

    if is_enabled:
        status = "enabled"
    elif not vram_ok:
        status = "insufficient_vram"
    elif not services_ok:
        status = "services_needed"
    else:
        status = "available"

    return {
        "id": feature["id"],
        "name": feature["name"],
        "description": feature.get("description", ""),
        "icon": feature.get("icon", "Package"),
        "category": feature.get("category", "other"),
        "status": status,
        "enabled": is_enabled,
        "requirements": {
            "vramGb": req.get("vram_gb", 0),
            "vramOk": vram_ok,
            "vramFits": vram_fits,
            "services": all_required,
            "servicesAll": required_services,
            "servicesAny": required_services_any,
            "servicesAvailable": services_available,
            "servicesMissing": services_missing,
            "servicesOk": services_ok,
        },
        "setupTime": feature.get("setup_time", "Unknown"),
        "priority": feature.get("priority", 99)
    }


@router.get("/api/features")
async def api_features(api_key: str = Depends(verify_api_key)):
    """Get feature discovery data."""
    from helpers import get_all_services
    gpu_info = get_gpu_info()
    service_list = await get_all_services()

    feature_statuses = [calculate_feature_status(f, service_list, gpu_info) for f in FEATURES]
    feature_statuses.sort(key=lambda x: x["priority"])

    enabled_count = sum(1 for f in feature_statuses if f["enabled"])
    available_count = sum(1 for f in feature_statuses if f["status"] == "available")
    total_count = len(feature_statuses)

    suggestions = []
    for f in feature_statuses:
        if f["status"] == "available":
            suggestions.append({
                "featureId": f["id"], "name": f["name"],
                "message": f"Your hardware can run {f['name']}. Enable it?",
                "action": f"Enable {f['name']}", "setupTime": f["setupTime"]
            })
        elif f["status"] == "services_needed":
            missing = ", ".join(f["requirements"]["servicesMissing"])
            suggestions.append({
                "featureId": f["id"], "name": f["name"],
                "message": f"{f['name']} needs {missing} to be running.",
                "action": f"Start {missing}", "setupTime": f["setupTime"], "blocked": True
            })

    gpu_vram_gb = (gpu_info.memory_total_mb / 1024) if gpu_info else 0
    memory_type = gpu_info.memory_type if gpu_info else "discrete"

    # Apply Apple Silicon fallback for endpoint-level GPU summary (mirrors calculate_feature_status)
    if gpu_vram_gb == 0 and GPU_BACKEND == "apple":
        try:
            gpu_vram_gb = float(os.environ.get("HOST_RAM_GB", "0") or "0")
        except (ValueError, TypeError):
            pass
        if gpu_vram_gb == 0:
            logger.warning(
                "Apple Silicon VRAM fallback: HOST_RAM_GB is 0 or unset; "
                "all features will show insufficient_vram"
            )
        memory_type = "unified"

    tier_recommendations = []
    if memory_type == "unified" and gpu_info and gpu_info.gpu_backend == "amd":
        if gpu_vram_gb >= 90:
            tier_recommendations = ["Strix Halo 90+ — running qwen3-coder-next (80B MoE, 3B active)", "Plenty of headroom for the flagship model + bootstrap simultaneously", "Voice and Documents work alongside the LLM"]
        else:
            tier_recommendations = ["Strix Halo Compact — running qwen3:30b-a3b (30B MoE, 3B active)", "Fast MoE inference with low memory footprint", "Voice and Documents work alongside the LLM"]
    elif gpu_vram_gb >= 80:
        tier_recommendations = ["Your GPU can run all features simultaneously", "Consider enabling Voice + Documents for the full experience", "Image generation is supported at full quality"]
    elif gpu_vram_gb >= 24:
        tier_recommendations = ["Great GPU for local AI — most features will run well", "Voice and Documents work together", "Image generation may require model unloading"]
    elif gpu_vram_gb >= 16:
        tier_recommendations = ["Solid GPU for core features", "Voice works well with the default model", "For images, use a smaller chat model"]
    elif gpu_vram_gb >= 8:
        tier_recommendations = ["Entry-level GPU — focus on chat first", "Voice is possible with a smaller model", "Consider using the 7B model for better speed"]
    else:
        tier_recommendations = ["Limited GPU memory — chat will work with small models", "Consider cloud hybrid mode for better quality"]

    return {
        "features": feature_statuses,
        "summary": {"enabled": enabled_count, "available": available_count, "total": total_count, "progress": round(enabled_count / total_count * 100) if total_count > 0 else 0},
        "suggestions": suggestions[:3],
        "recommendations": tier_recommendations,
        "gpu": {"name": gpu_info.name if gpu_info else "Unknown", "vramGb": round(gpu_vram_gb, 1), "tier": get_gpu_tier(gpu_vram_gb, memory_type)}
    }


@router.get("/api/features/{feature_id}/enable")
async def feature_enable_instructions(feature_id: str, api_key: str = Depends(verify_api_key)):
    """Get instructions to enable a specific feature."""
    feature = next((f for f in FEATURES if f["id"] == feature_id), None)
    if not feature:
        raise HTTPException(status_code=404, detail=f"Feature not found: {feature_id}")

    def _svc_url(service_id: str) -> str:
        cfg = SERVICES.get(service_id, {})
        port = cfg.get("external_port", cfg.get("port", 0))
        return f"http://localhost:{port}" if port else ""

    def _svc_port(service_id: str) -> int:
        cfg = SERVICES.get(service_id, {})
        return cfg.get("external_port", cfg.get("port", 0))

    webui_url = _svc_url("open-webui")
    dashboard_url = _svc_url("dashboard")
    n8n_url = _svc_url("n8n")

    instructions = {
        "chat": {"steps": ["Chat is already enabled if llama-server is running", "Open the Dashboard and click 'Chat' to start"], "links": [{"label": "Open Chat", "url": webui_url}]},
        "voice": {"steps": [f"Ensure Whisper (STT) is running on port {_svc_port('whisper')}", f"Ensure Kokoro (TTS) is running on port {_svc_port('tts')}", "Start LiveKit for WebRTC", "Open the Voice page in the Dashboard"], "links": [{"label": "Voice Dashboard", "url": f"{dashboard_url}/voice"}]},
        "documents": {"steps": ["Ensure Qdrant vector database is running", "Enable the 'Document Q&A' workflow", "Upload documents via the workflow endpoint"], "links": [{"label": "Workflows", "url": f"{dashboard_url}/workflows"}]},
        "workflows": {"steps": [f"Ensure n8n is running on port {_svc_port('n8n')}", "Open the Workflows page to see available automations", "Click 'Enable' on any workflow to import it"], "links": [{"label": "n8n Dashboard", "url": n8n_url}, {"label": "Workflows", "url": f"{dashboard_url}/workflows"}]},
        "images": {"steps": ["Image generation requires additional setup", "Coming soon in a future update"], "links": []},
        "coding": {"steps": ["Switch to the Qwen2.5-Coder model for best results", "Use the model manager to download and load it", "Chat will now be optimized for code"], "links": [{"label": "Model Manager", "url": f"{dashboard_url}/models"}]},
    }

    return {"featureId": feature_id, "name": feature["name"], "instructions": instructions.get(feature_id, {"steps": [], "links": []})}
