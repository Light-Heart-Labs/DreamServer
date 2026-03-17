#!/usr/bin/env python3
"""
Dream Server Dashboard API
Lightweight backend providing system status for the Dashboard UI.

Default port: DASHBOARD_API_PORT (3002)

Modules:
  config.py       — Shared configuration and manifest loading
  models.py       — Pydantic response schemas
  security.py     — API key authentication
  gpu.py          — GPU detection (NVIDIA + AMD)
  helpers.py      — Service health, LLM metrics, system metrics
  routers/        — Endpoint modules (workflows, features, setup, updates, agents, privacy)
"""

import asyncio
import logging
import os
import socket
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# --- Local modules ---
from config import SERVICES, DATA_DIR, SIDEBAR_ICONS
from models import (
    GPUInfo, ServiceStatus, DiskUsage, ModelInfo, BootstrapStatus,
    FullStatus, PortCheckRequest,
)
from security import verify_api_key
from gpu import get_gpu_info
from helpers import (
    get_all_services,
    get_disk_usage, get_model_info, get_bootstrap_status,
    get_uptime, get_cpu_metrics, get_ram_metrics,
    get_llama_metrics, get_loaded_model, get_llama_context_size,
)
from agent_monitor import collect_metrics

# --- Router imports ---
from routers import workflows, features, setup, updates, agents, privacy

logger = logging.getLogger(__name__)

# --- App ---

app = FastAPI(
    title="Dream Server Dashboard API",
    version="2.0.0",
    description="System status API for Dream Server Dashboard"
)

# --- CORS ---

def get_allowed_origins():
    env_origins = os.environ.get("DASHBOARD_ALLOWED_ORIGINS", "")
    if env_origins:
        return env_origins.split(",")
    origins = [
        "http://localhost:3001", "http://127.0.0.1:3001",
        "http://localhost:3000", "http://127.0.0.1:3000",
    ]
    try:
        hostname = socket.gethostname()
        local_ips = socket.gethostbyname_ex(hostname)[2]
        for ip in local_ips:
            if ip.startswith(("192.168.", "10.", "172.")):
                origins.append(f"http://{ip}:3001")
                origins.append(f"http://{ip}:3000")
    except (OSError, socket.gaierror):
        logger.debug("Could not detect LAN IPs for CORS origins")
    return origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)

# --- Include Routers ---

app.include_router(workflows.router)
app.include_router(features.router)
app.include_router(setup.router)
app.include_router(updates.router)
app.include_router(agents.router)
app.include_router(privacy.router)


# ================================================================
# Core Endpoints (health, status, preflight, services)
# ================================================================

@app.get("/health")
async def health():
    """API health check."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


# --- Preflight ---

@app.get("/api/preflight/docker", dependencies=[Depends(verify_api_key)])
async def preflight_docker():
    """Check if Docker is available."""
    import subprocess
    if os.path.exists("/.dockerenv"):
        return {"available": True, "version": "available (host)"}
    try:
        result = subprocess.run(["docker", "--version"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            version = result.stdout.strip().split()[2].rstrip(",") if len(result.stdout.strip().split()) > 2 else "unknown"
            return {"available": True, "version": version}
        return {"available": False, "error": "Docker command failed"}
    except FileNotFoundError:
        return {"available": False, "error": "Docker not installed"}
    except subprocess.TimeoutExpired:
        return {"available": False, "error": "Docker check timed out"}
    except (subprocess.SubprocessError, OSError):
        logger.exception("Docker preflight check failed")
        return {"available": False, "error": "Docker check failed"}


@app.get("/api/preflight/gpu", dependencies=[Depends(verify_api_key)])
async def preflight_gpu():
    """Check GPU availability."""
    gpu_info = get_gpu_info()
    if gpu_info:
        vram_gb = round(gpu_info.memory_total_mb / 1024, 1)
        result = {"available": True, "name": gpu_info.name, "vram": vram_gb, "backend": gpu_info.gpu_backend, "memory_type": gpu_info.memory_type}
        if gpu_info.memory_type == "unified":
            result["memory_label"] = f"{vram_gb} GB Unified"
        return result

    gpu_backend = os.environ.get("GPU_BACKEND", "").lower()
    if gpu_backend == "amd":
        return {"available": False, "error": "AMD GPU not detected via sysfs. Check /dev/kfd and /dev/dri access."}
    return {"available": False, "error": "No GPU detected. Ensure NVIDIA drivers or AMD amdgpu driver is loaded."}


@app.get("/api/preflight/required-ports")
async def preflight_required_ports():
    """Return the list of service ports for preflight checking (no auth required)."""
    ports = []
    for sid, cfg in SERVICES.items():
        ext_port = cfg.get("external_port", cfg.get("port", 0))
        if ext_port:
            ports.append({"port": ext_port, "service": cfg.get("name", sid)})
    return {"ports": ports}


@app.post("/api/preflight/ports", dependencies=[Depends(verify_api_key)])
async def preflight_ports(request: PortCheckRequest):
    """Check if required ports are available."""
    port_services = {}
    for sid, cfg in SERVICES.items():
        ext_port = cfg.get("external_port", cfg.get("port", 0))
        if ext_port:
            port_services[ext_port] = cfg.get("name", sid)

    conflicts = []
    for port in request.ports:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(1)
                sock.bind(("0.0.0.0", port))
        except socket.error:
            conflicts.append({"port": port, "service": port_services.get(port, "Unknown"), "in_use": True})
    return {"conflicts": conflicts, "available": len(conflicts) == 0}


@app.get("/api/preflight/disk", dependencies=[Depends(verify_api_key)])
async def preflight_disk():
    """Check available disk space."""
    try:
        check_path = DATA_DIR if os.path.exists(DATA_DIR) else Path.home()
        usage = shutil.disk_usage(check_path)
        return {"free": usage.free, "total": usage.total, "used": usage.used, "path": str(check_path)}
    except OSError:
        logger.exception("Disk preflight check failed")
        return {"error": "Disk check failed", "free": 0, "total": 0, "used": 0, "path": ""}


# --- Core Data ---

@app.get("/gpu", response_model=Optional[GPUInfo])
async def gpu(api_key: str = Depends(verify_api_key)):
    """Get GPU metrics."""
    info = get_gpu_info()
    if not info:
        raise HTTPException(status_code=503, detail="GPU not available")
    return info


@app.get("/services", response_model=list[ServiceStatus])
async def services(api_key: str = Depends(verify_api_key)):
    """Get all service health statuses."""
    return await get_all_services()


@app.get("/disk", response_model=DiskUsage)
async def disk(api_key: str = Depends(verify_api_key)):
    return get_disk_usage()


@app.get("/model", response_model=Optional[ModelInfo])
async def model(api_key: str = Depends(verify_api_key)):
    return get_model_info()


@app.get("/bootstrap", response_model=BootstrapStatus)
async def bootstrap(api_key: str = Depends(verify_api_key)):
    return get_bootstrap_status()


@app.get("/status", response_model=FullStatus)
async def status(api_key: str = Depends(verify_api_key)):
    """Get full system status."""
    service_statuses = await get_all_services()
    return FullStatus(
        timestamp=datetime.now(timezone.utc).isoformat(),
        gpu=get_gpu_info(), services=service_statuses,
        disk=get_disk_usage(), model=get_model_info(),
        bootstrap=get_bootstrap_status(), uptime_seconds=get_uptime()
    )


@app.get("/api/status")
async def api_status(api_key: str = Depends(verify_api_key)):
    """Dashboard-compatible status endpoint.

    Wrapped in a top-level try/except so that a transient failure in any
    sub-call (GPU, health checks, llama metrics …) never returns a raw 500
    to the dashboard — the frontend would flash "0/17" otherwise.
    """
    try:
        return await _build_api_status()
    except Exception:
        logger.exception("/api/status handler failed — returning safe fallback")
        return {
            "gpu": None, "services": [], "model": None,
            "bootstrap": None, "uptime": 0,
            "version": app.version, "tier": "Unknown",
            "cpu": {"percent": 0, "temp_c": None},
            "ram": {"used_gb": 0, "total_gb": 0, "percent": 0},
            "inference": {"tokensPerSecond": 0, "lifetimeTokens": 0,
                          "loadedModel": None, "contextSize": None},
        }


async def _build_api_status() -> dict:
    """Build the full status payload.

    Resolves the loaded model name *once* and threads it through the
    metrics and context-size helpers to avoid redundant HTTP round-trips
    to llama-server (previously 5 sequential calls, now 3 parallel).
    """
    gpu_info = get_gpu_info()
    service_statuses = await get_all_services()
    model_info = get_model_info()
    bootstrap_info = get_bootstrap_status()

    # Resolve the loaded model name once, then fan it out.
    loaded_model = await get_loaded_model()
    llama_metrics_data, context_size = await asyncio.gather(
        get_llama_metrics(model_hint=loaded_model),
        get_llama_context_size(model_hint=loaded_model),
    )

    gpu_data = None
    if gpu_info:
        gpu_data = {
            "name": gpu_info.name,
            "vramUsed": round(gpu_info.memory_used_mb / 1024, 1),
            "vramTotal": round(gpu_info.memory_total_mb / 1024, 1),
            "utilization": gpu_info.utilization_percent,
            "temperature": gpu_info.temperature_c,
            "memoryType": gpu_info.memory_type,
            "backend": gpu_info.gpu_backend,
        }
        if gpu_info.power_w is not None:
            gpu_data["powerDraw"] = gpu_info.power_w
        gpu_data["memoryLabel"] = "VRAM Partition" if gpu_info.memory_type == "unified" else "VRAM"

    services_data = [{"name": s.name, "status": s.status, "port": s.external_port, "uptime": None} for s in service_statuses]

    model_data = None
    if model_info:
        model_data = {"name": model_info.name, "tokensPerSecond": None, "contextLength": model_info.context_length}

    bootstrap_data = None
    if bootstrap_info.active:
        bootstrap_data = {
            "active": True, "model": bootstrap_info.model_name or "Full Model",
            "percent": bootstrap_info.percent or 0,
            "bytesDownloaded": int((bootstrap_info.downloaded_gb or 0) * 1024**3),
            "bytesTotal": int((bootstrap_info.total_gb or 0) * 1024**3),
            "eta": bootstrap_info.eta_seconds, "speedMbps": bootstrap_info.speed_mbps
        }

    tier = "Unknown"
    if gpu_info:
        vram_gb = gpu_info.memory_total_mb / 1024
        if gpu_info.memory_type == "unified" and gpu_info.gpu_backend == "amd":
            tier = "Strix Halo 90+" if vram_gb >= 90 else "Strix Halo Compact"
        elif vram_gb >= 80: tier = "Professional"
        elif vram_gb >= 24: tier = "Prosumer"
        elif vram_gb >= 16: tier = "Standard"
        elif vram_gb >= 8: tier = "Entry"
        else: tier = "Minimal"

    return {
        "gpu": gpu_data, "services": services_data, "model": model_data,
        "bootstrap": bootstrap_data, "uptime": get_uptime(),
        "version": app.version, "tier": tier,
        "cpu": get_cpu_metrics(), "ram": get_ram_metrics(),
        "inference": {
            "tokensPerSecond": llama_metrics_data.get("tokens_per_second", 0),
            "lifetimeTokens": llama_metrics_data.get("lifetime_tokens", 0),
            "loadedModel": loaded_model or (model_data["name"] if model_data else None),
            "contextSize": context_size or (model_data["contextLength"] if model_data else None),
        },
    }


# --- Settings ---

@app.get("/api/service-tokens", dependencies=[Depends(verify_api_key)])
async def service_tokens():
    """Return connection tokens for services that need browser-side auth."""
    tokens = {}
    oc_token = os.environ.get("OPENCLAW_TOKEN", "")
    if not oc_token:
        for path in [Path("/data/openclaw/home/gateway-token"), Path("/dream-server/.env")]:
            try:
                if path.suffix == ".env":
                    for line in path.read_text().splitlines():
                        if line.startswith("OPENCLAW_TOKEN="):
                            oc_token = line.split("=", 1)[1].strip()
                            break
                else:
                    oc_token = path.read_text().strip()
            except (OSError, ValueError):
                continue
            if oc_token:
                break
    if oc_token:
        tokens["openclaw"] = oc_token
    return tokens


@app.get("/api/external-links")
async def get_external_links(api_key: str = Depends(verify_api_key)):
    """Return sidebar-ready external links derived from service manifests."""
    links = []
    for sid, cfg in SERVICES.items():
        ext_port = cfg.get("external_port", cfg.get("port", 0))
        if not ext_port or sid == "dashboard-api":
            continue
        links.append({
            "id": sid, "label": cfg.get("name", sid), "port": ext_port,
            "icon": SIDEBAR_ICONS.get(sid, "ExternalLink"),
            "healthNeedles": [sid, cfg.get("name", sid).lower()],
        })
    return links


@app.get("/api/storage")
async def api_storage(api_key: str = Depends(verify_api_key)):
    """Get storage breakdown for Settings page."""
    models_dir = Path(DATA_DIR) / "models"
    vector_dir = Path(DATA_DIR) / "qdrant"
    data_dir = Path(DATA_DIR)

    def dir_size_gb(path: Path) -> float:
        if not path.exists():
            return 0.0
        total = 0
        try:
            for f in path.rglob("*"):
                if f.is_file():
                    total += f.stat().st_size
        except (PermissionError, OSError):
            pass
        return round(total / (1024**3), 2)

    disk_info = get_disk_usage()
    models_gb = dir_size_gb(models_dir)
    vector_gb = dir_size_gb(vector_dir)
    total_data_gb = dir_size_gb(data_dir)

    return {
        "models": {"formatted": f"{models_gb:.1f} GB", "gb": models_gb, "percent": round(models_gb / disk_info.total_gb * 100, 1) if disk_info.total_gb else 0},
        "vector_db": {"formatted": f"{vector_gb:.1f} GB", "gb": vector_gb, "percent": round(vector_gb / disk_info.total_gb * 100, 1) if disk_info.total_gb else 0},
        "total_data": {"formatted": f"{total_data_gb:.1f} GB", "gb": total_data_gb, "percent": round(total_data_gb / disk_info.total_gb * 100, 1) if disk_info.total_gb else 0},
        "disk": {"used_gb": disk_info.used_gb, "total_gb": disk_info.total_gb, "percent": disk_info.percent}
    }


# --- Startup ---

@app.on_event("startup")
async def startup_event():
    """Start background metrics collection."""
    asyncio.create_task(collect_metrics())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("DASHBOARD_API_PORT", "3002")))
