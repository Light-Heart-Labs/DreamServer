"""Privacy Shield management endpoints."""

import asyncio
import logging
import os

import aiohttp
from fastapi import APIRouter, Depends

from config import SERVICES, INSTALL_DIR
from models import PrivacyShieldStatus, PrivacyShieldToggle
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["privacy"])


@router.get("/api/privacy-shield/status", response_model=PrivacyShieldStatus)
async def get_privacy_shield_status(api_key: str = Depends(verify_api_key)):
    """Get Privacy Shield status and configuration."""
    _ps = SERVICES.get("privacy-shield", {})
    shield_port = int(os.environ.get("SHIELD_PORT", str(_ps.get("port", 0))))
    shield_url = f"http://{_ps.get('host', 'privacy-shield')}:{shield_port}"

    container_running = False
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker", "ps", "--filter", "name=dream-privacy-shield", "--format", "{{.Names}}",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        container_running = "dream-privacy-shield" in stdout.decode()
    except (FileNotFoundError, asyncio.TimeoutError, OSError):
        logger.warning("Failed to check privacy-shield container status")

    service_healthy = False
    if container_running:
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=2)) as session:
                async with session.get(f"{shield_url}/health") as resp:
                    service_healthy = resp.status == 200
        except (asyncio.TimeoutError, aiohttp.ClientError):
            logger.warning("Failed to reach privacy-shield health endpoint")

    return PrivacyShieldStatus(
        enabled=container_running and service_healthy,
        container_running=container_running,
        port=shield_port,
        target_api=os.environ.get("TARGET_API_URL", f"http://{SERVICES.get('llama-server', {}).get('host', 'llama-server')}:{SERVICES.get('llama-server', {}).get('port', 0)}/v1"),
        pii_cache_enabled=os.environ.get("PII_CACHE_ENABLED", "true").lower() == "true",
        message="Privacy Shield is active" if (container_running and service_healthy) else "Privacy Shield is not running. Check: docker compose ps privacy-shield"
    )


@router.post("/api/privacy-shield/toggle")
async def toggle_privacy_shield(request: PrivacyShieldToggle, api_key: str = Depends(verify_api_key)):
    """Enable or disable Privacy Shield."""
    try:
        if request.enable:
            proc = await asyncio.create_subprocess_exec(
                "docker", "compose", "up", "-d", "privacy-shield",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=INSTALL_DIR
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
            if proc.returncode == 0:
                return {"success": True, "message": "Privacy Shield started. PII scrubbing is now active."}
            else:
                return {"success": False, "message": f"Failed to start: {stderr.decode()}"}
        else:
            proc = await asyncio.create_subprocess_exec(
                "docker", "compose", "stop", "privacy-shield",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=INSTALL_DIR
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
            if proc.returncode == 0:
                return {"success": True, "message": "Privacy Shield stopped."}
            else:
                return {"success": False, "message": f"Failed to stop: {stderr.decode()}"}
    except FileNotFoundError:
        return {"success": False, "message": "Docker not available", "note": "Running in development mode without Docker"}
    except asyncio.TimeoutError:
        return {"success": False, "message": "Operation timed out"}
    except OSError:
        logger.exception("Privacy Shield toggle failed")
        return {"success": False, "message": "Privacy Shield operation failed"}


@router.get("/api/privacy-shield/stats")
async def get_privacy_shield_stats(api_key: str = Depends(verify_api_key)):
    """Get Privacy Shield usage statistics."""
    _ps = SERVICES.get("privacy-shield", {})
    shield_port = int(os.environ.get("SHIELD_PORT", str(_ps.get("port", 0))))
    shield_url = f"http://{_ps.get('host', 'privacy-shield')}:{shield_port}"

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            async with session.get(f"{shield_url}/stats") as resp:
                if resp.status == 200:
                    return await resp.json()
                else:
                    return {"error": "Privacy Shield not responding", "status": resp.status}
    except (aiohttp.ClientError, OSError):
        logger.exception("Cannot reach Privacy Shield")
        return {"error": "Cannot reach Privacy Shield", "enabled": False}
