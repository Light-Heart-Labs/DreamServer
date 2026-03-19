"""Runtime settings, voice, and diagnostic test endpoints."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config import DATA_DIR, INSTALL_DIR, SERVICES
from gpu import get_gpu_info
from helpers import check_service_health, get_disk_usage, get_uptime
from security import verify_api_key

logger = logging.getLogger(__name__)
router = APIRouter(tags=["runtime"])

_CONFIG_DIR = Path(DATA_DIR) / "config"
_VOICE_SETTINGS_FILE = _CONFIG_DIR / "voice-settings.json"
_SETUP_COMPLETE_FILE = _CONFIG_DIR / "setup-complete.json"
_VERSION_FILE = Path(INSTALL_DIR) / ".version"

_DEFAULT_VOICE_SETTINGS: dict[str, object] = {
    "voice": "default",
    "speed": 1.0,
    "wakeWord": False,
}


class VoiceSettingsUpdate(BaseModel):
    """Patch payload for voice preferences."""

    voice: str | None = Field(default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    speed: float | None = Field(default=None, ge=0.5, le=2.0)
    wakeWord: bool | None = None


class VoiceTokenRequest(BaseModel):
    """Request payload for minting a LiveKit access token."""

    identity: str = Field(default="dashboard-user", min_length=3, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    room: str = Field(default="dream-voice", min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    ttlSeconds: int = Field(default=3600, ge=60, le=86400)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _format_human_date(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%b %d, %Y")


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text())
        return payload if isinstance(payload, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, indent=2))
    tmp_path.replace(path)


def _resolve_install_date() -> datetime:
    setup = _read_json(_SETUP_COMPLETE_FILE)
    setup_date = _parse_datetime(setup.get("completed_at"))
    if setup_date:
        return setup_date

    try:
        created = datetime.fromtimestamp(Path(INSTALL_DIR).stat().st_mtime, tz=timezone.utc)
        return created
    except OSError:
        return datetime.now(timezone.utc)


def _resolve_tier() -> str:
    gpu_info = get_gpu_info()
    if not gpu_info:
        return "Unknown"

    vram_gb = gpu_info.memory_total_mb / 1024
    if gpu_info.memory_type == "unified" and gpu_info.gpu_backend == "amd":
        return "Strix Halo 90+" if vram_gb >= 90 else "Strix Halo Compact"
    if vram_gb >= 80:
        return "Professional"
    if vram_gb >= 24:
        return "Prosumer"
    if vram_gb >= 16:
        return "Standard"
    if vram_gb >= 8:
        return "Entry"
    return "Minimal"


def _format_uptime(seconds: int) -> str:
    if seconds < 60:
        return f"{seconds}s"
    minutes, sec = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    days, hours = divmod(hours, 24)
    if days > 0:
        return f"{days}d {hours}h"
    if hours > 0:
        return f"{hours}h {minutes}m"
    return f"{minutes}m {sec}s"


def _sanitize_voice_settings(raw: dict) -> dict[str, object]:
    settings = dict(_DEFAULT_VOICE_SETTINGS)

    voice = raw.get("voice")
    if isinstance(voice, str) and voice:
        settings["voice"] = voice

    speed = raw.get("speed")
    if isinstance(speed, (int, float)) and 0.5 <= float(speed) <= 2.0:
        settings["speed"] = round(float(speed), 2)

    wake_word = raw.get("wakeWord")
    if isinstance(wake_word, bool):
        settings["wakeWord"] = wake_word

    return settings


def _load_voice_settings() -> dict[str, object]:
    return _sanitize_voice_settings(_read_json(_VOICE_SETTINGS_FILE))


def _build_livekit_http_url() -> str:
    ws_url = os.environ.get("LIVEKIT_URL", "ws://livekit:7880")
    parsed = urlparse(ws_url)
    host = parsed.netloc or parsed.path or "livekit:7880"
    scheme = "https" if parsed.scheme in ("wss", "https") else "http"
    return f"{scheme}://{host}"


async def _check_livekit() -> dict:
    url = _build_livekit_http_url()
    checked_at = _now_iso()
    try:
        timeout = aiohttp.ClientTimeout(total=3)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            start = time.monotonic()
            async with session.get(url) as resp:
                elapsed_ms = round((time.monotonic() - start) * 1000, 1)
                status = "healthy" if resp.status < 500 else "unhealthy"
                return {
                    "id": "livekit",
                    "name": "LiveKit",
                    "status": status,
                    "responseTimeMs": elapsed_ms,
                    "checkedAt": checked_at,
                    "url": url,
                }
    except Exception as exc:
        logger.debug("LiveKit probe failed: %s", exc)
        return {
            "id": "livekit",
            "name": "LiveKit",
            "status": "down",
            "responseTimeMs": None,
            "checkedAt": checked_at,
            "url": url,
            "error": str(exc),
        }


async def _check_service(service_id: str, label: str) -> dict:
    cfg = SERVICES.get(service_id)
    checked_at = _now_iso()
    if not cfg:
        return {
            "id": service_id,
            "name": label,
            "status": "not_configured",
            "responseTimeMs": None,
            "checkedAt": checked_at,
            "url": None,
        }

    status = await check_service_health(service_id, cfg)
    return {
        "id": status.id,
        "name": status.name,
        "status": status.status,
        "responseTimeMs": status.response_time_ms,
        "checkedAt": checked_at,
        "url": f"http://{cfg.get('host', 'localhost')}:{cfg.get('port', 0)}{cfg.get('health', '/')}",
    }


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _encode_hs256_jwt(payload: dict, secret: str) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    header_json = json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signing_input = f"{_b64url(header_json)}.{_b64url(payload_json)}"
    signature = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url(signature)}"


@router.get("/api/settings", dependencies=[Depends(verify_api_key)])
async def api_settings():
    """Return dynamic settings data for the dashboard settings page."""
    disk = get_disk_usage()
    version = _VERSION_FILE.read_text().strip() if _VERSION_FILE.exists() else "2.0.0"
    uptime_seconds = get_uptime()

    return {
        "version": version,
        "installDate": _format_human_date(_resolve_install_date()),
        "tier": _resolve_tier(),
        "uptime": _format_uptime(uptime_seconds),
        "uptimeSeconds": uptime_seconds,
        "storage": {
            "path": disk.path,
            "usedGb": disk.used_gb,
            "totalGb": disk.total_gb,
            "percent": disk.percent,
        },
        "generatedAt": _now_iso(),
    }


@router.get("/api/voice/settings", dependencies=[Depends(verify_api_key)])
async def get_voice_settings():
    """Load persisted voice settings."""
    return _load_voice_settings()


@router.post("/api/voice/settings", dependencies=[Depends(verify_api_key)])
async def save_voice_settings(request: VoiceSettingsUpdate):
    """Persist voice settings and return the saved document."""
    current = _load_voice_settings()
    patch = request.model_dump(exclude_none=True)
    merged = _sanitize_voice_settings({**current, **patch})

    payload = {
        **merged,
        "updatedAt": _now_iso(),
    }
    _atomic_write_json(_VOICE_SETTINGS_FILE, payload)

    return {"success": True, "settings": merged}


@router.get("/api/voice/status", dependencies=[Depends(verify_api_key)])
async def voice_status():
    """Health summary for the voice pipeline."""
    stt_status, tts_status, livekit_status = await asyncio.gather(
        _check_service("whisper", "Whisper (STT)"),
        _check_service("tts", "Kokoro (TTS)"),
        _check_livekit(),
    )
    statuses = {"stt": stt_status, "tts": tts_status, "livekit": livekit_status}
    available = all(s.get("status") == "healthy" for s in statuses.values())

    return {
        "available": available,
        "services": statuses,
        "message": "Voice services ready" if available else "One or more voice services are unavailable",
        "checkedAt": _now_iso(),
    }


@router.post("/api/voice/token", dependencies=[Depends(verify_api_key)])
async def voice_token(request: VoiceTokenRequest):
    """Generate a LiveKit access token for dashboard voice sessions."""
    api_key = os.environ.get("LIVEKIT_API_KEY", "")
    api_secret = os.environ.get("LIVEKIT_API_SECRET", "")
    if not api_key or not api_secret:
        raise HTTPException(status_code=503, detail="LiveKit credentials are not configured")

    now = int(time.time())
    payload = {
        "iss": api_key,
        "sub": request.identity,
        "nbf": now - 10,
        "exp": now + request.ttlSeconds,
        "video": {
            "roomJoin": True,
            "room": request.room,
            "canPublish": True,
            "canSubscribe": True,
        },
    }

    token = _encode_hs256_jwt(payload, api_secret)
    return {
        "token": token,
        "room": request.room,
        "url": os.environ.get("LIVEKIT_URL", "ws://localhost:7880"),
        "expiresAt": datetime.fromtimestamp(now + request.ttlSeconds, tz=timezone.utc).isoformat(),
    }


@router.get("/api/test/{test_id}", dependencies=[Depends(verify_api_key)])
async def run_feature_test(test_id: str):
    """Run lightweight feature diagnostics used by setup/success screens."""
    if test_id == "llm":
        status = await _check_service("llama-server", "llama-server")
        ok = status["status"] == "healthy"
        return {"success": ok, "feature": "llm", "service": status}

    if test_id == "voice":
        voice = await voice_status()
        return {"success": voice["available"], "feature": "voice", "details": voice}

    if test_id == "rag":
        qdrant_status = await _check_service("qdrant", "Qdrant")
        llm_status = await _check_service("llama-server", "llama-server")
        ok = qdrant_status["status"] == "healthy" and llm_status["status"] == "healthy"
        return {"success": ok, "feature": "rag", "services": {"qdrant": qdrant_status, "llm": llm_status}}

    if test_id == "workflows":
        status = await _check_service("n8n", "n8n")
        ok = status["status"] == "healthy"
        return {"success": ok, "feature": "workflows", "service": status}

    raise HTTPException(status_code=404, detail=f"Unknown test target: {test_id}")
