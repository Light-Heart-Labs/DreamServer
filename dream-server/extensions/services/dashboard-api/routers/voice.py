"""Voice service status, settings persistence, and token stubs."""

import asyncio
import json
import logging
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from config import SERVICES, SETUP_CONFIG_DIR
from helpers import check_service_health
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["voice"])


def _voice_settings_file() -> Path:
    return Path(SETUP_CONFIG_DIR) / "voice-settings.json"


def _default_voice_settings() -> dict:
    return {
        "voice": os.environ.get("AUDIO_TTS_VOICE", "af_heart"),
        "speed": 1.0,
        "wakeWord": False,
    }


def load_voice_settings() -> dict:
    """Load persisted voice settings, falling back to sensible defaults."""
    settings = _default_voice_settings()
    path = _voice_settings_file()
    if not path.exists():
        return settings

    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        logger.warning("Failed to read voice settings from %s", path)
        return settings

    if not isinstance(data, dict):
        return settings

    merged = {**settings, **data}
    try:
        merged["speed"] = float(merged.get("speed", 1.0))
    except (TypeError, ValueError):
        merged["speed"] = 1.0
    merged["wakeWord"] = bool(merged.get("wakeWord", False))
    return merged


def save_voice_settings(payload: dict) -> dict:
    """Validate and persist voice settings."""
    settings = _default_voice_settings()
    settings["voice"] = str(payload.get("voice") or settings["voice"]).strip() or settings["voice"]

    try:
        settings["speed"] = float(payload.get("speed", settings["speed"]))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="speed must be a number") from exc

    if settings["speed"] < 0.5 or settings["speed"] > 2.0:
        raise HTTPException(status_code=400, detail="speed must be between 0.5 and 2.0")

    settings["wakeWord"] = bool(payload.get("wakeWord", settings["wakeWord"]))

    path = _voice_settings_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(settings, indent=2))
    return settings


async def get_voice_status_payload() -> dict:
    """Probe voice-related services used by the dashboard."""
    probes = {
        "stt": ("whisper", SERVICES.get("whisper")),
        "tts": ("tts", SERVICES.get("tts")),
        "livekit": (
            "livekit",
            {
                "name": "LiveKit",
                "host": os.environ.get("LIVEKIT_HOST", "host.docker.internal"),
                "port": int(os.environ.get("LIVEKIT_PORT", "7880")),
                "external_port": int(os.environ.get("LIVEKIT_PORT", "7880")),
                "health": os.environ.get("LIVEKIT_HEALTH_PATH", "/"),
            },
        ),
    }

    async def run_probe(alias: str, service_id: str, config: dict | None) -> tuple[str, dict]:
        if not config:
            return alias, {
                "id": service_id,
                "name": service_id,
                "status": "not_configured",
                "port": None,
                "message": f"{service_id} is not configured",
            }

        result = await check_service_health(service_id, config)
        return alias, {
            "id": service_id,
            "name": result.name,
            "status": result.status,
            "port": result.external_port,
            "message": None if result.status == "healthy" else f"{result.name} is {result.status}",
        }

    results = await asyncio.gather(
        *(run_probe(alias, service_id, config) for alias, (service_id, config) in probes.items())
    )
    services = {alias: payload for alias, payload in results}
    available = all(service["status"] == "healthy" for service in services.values())

    if available:
        message = "Voice services ready"
    else:
        unavailable = [svc["name"] for svc in services.values() if svc["status"] != "healthy"]
        message = f"Voice services unavailable: {', '.join(unavailable)}"

    return {"available": available, "services": services, "message": message}


@router.get("/api/voice/status")
async def voice_status(api_key: str = Depends(verify_api_key)):
    """Return health details for STT/TTS/LiveKit dependencies."""
    return await get_voice_status_payload()


@router.get("/api/voice/settings")
async def get_voice_settings(api_key: str = Depends(verify_api_key)):
    """Return persisted voice preferences for the dashboard."""
    return load_voice_settings()


@router.post("/api/voice/settings")
async def update_voice_settings(payload: dict, api_key: str = Depends(verify_api_key)):
    """Persist voice preferences for the dashboard."""
    return save_voice_settings(payload)


@router.post("/api/voice/token")
async def create_voice_token(api_key: str = Depends(verify_api_key)):
    """Stub endpoint until the LiveKit token issuer is wired in."""
    raise HTTPException(
        status_code=501,
        detail="Voice session tokens are not configured in this build.",
    )
