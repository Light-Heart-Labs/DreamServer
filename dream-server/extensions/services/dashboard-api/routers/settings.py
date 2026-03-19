"""
Settings endpoints — read and write Dream Server runtime configuration.

GET  /api/settings  — return current settings (secrets masked)
PATCH /api/settings — update one or more settings in .env
"""

import logging
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from config import INSTALL_DIR
from models import SettingsResponse, SettingsPatch
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["settings"])

# ---------------------------------------------------------------------------
# Keys that must be masked in GET responses — anything that matches is
# replaced with "***" so secrets are never returned to the browser.
# ---------------------------------------------------------------------------
_SECRET_SUFFIXES = frozenset([
    "API_KEY", "SECRET", "PASSWORD", "TOKEN", "PRIVATE_KEY",
])


def _is_secret(key: str) -> bool:
    upper = key.upper()
    return any(s in upper for s in _SECRET_SUFFIXES)


# ---------------------------------------------------------------------------
# .env helpers
# ---------------------------------------------------------------------------

def _env_path() -> Path:
    return Path(INSTALL_DIR) / ".env"


def _read_env() -> dict[str, str]:
    """Parse .env into a plain dict.  Comments and blank lines are ignored."""
    path = _env_path()
    result: dict[str, str] = {}
    if not path.exists():
        return result
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, val = line.partition("=")
            result[key.strip()] = val.strip()
    return result


def _write_env_key(key: str, value: str) -> None:
    """Update an existing key or append a new one to .env.

    Uses a regex replacement so the line's original position is preserved;
    only falls through to append when the key is not yet present.
    Does not use eval, shell expansion, or os.system.
    """
    path = _env_path()
    if not path.exists():
        path.write_text(f"{key}={value}\n", encoding="utf-8")
        return

    content = path.read_text(encoding="utf-8")
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    if pattern.search(content):
        content = pattern.sub(f"{key}={value}", content)
    else:
        # Ensure the file ends with a newline before appending
        if content and not content.endswith("\n"):
            content += "\n"
        content += f"{key}={value}\n"
    path.write_text(content, encoding="utf-8")


# ---------------------------------------------------------------------------
# Extension-state helpers
# ---------------------------------------------------------------------------

def _enabled_services() -> list[str]:
    """Return service IDs whose compose.yaml is present (not .disabled).

    Core services (llama-server, open-webui, dashboard, dashboard-api) live
    in docker-compose.base.yml and have no compose.yaml in extensions/; they
    are always considered enabled and are excluded from this list to keep the
    response focused on optional/recommended extensions.
    """
    ext_dir = Path(INSTALL_DIR) / "extensions" / "services"
    if not ext_dir.exists():
        return []
    enabled = []
    for svc_dir in sorted(ext_dir.iterdir()):
        if svc_dir.is_dir() and (svc_dir / "compose.yaml").exists():
            enabled.append(svc_dir.name)
    return enabled


def _service_enabled(service_id: str, enabled: list[str]) -> bool:
    return service_id in enabled


# ---------------------------------------------------------------------------
# Business logic
# ---------------------------------------------------------------------------

_VALID_MODES = frozenset(["local", "cloud", "hybrid"])

# .env key → settings field name (for the keys we surface)
_ENV_KEYS = {
    "LLM_MODEL":    "llm_model",
    "DREAM_MODE":   "mode",
    "TIER":         "tier",
    "GPU_BACKEND":  "gpu_backend",
    "DREAM_VERSION": "dream_version",
    "VOICE_ENABLED": "voice_enabled_override",
    "RAG_ENABLED":   "rag_enabled_override",
}


def _build_settings() -> SettingsResponse:
    """Read .env and derive the full settings payload."""
    env = _read_env()
    enabled = _enabled_services()

    # voice_enabled: true if whisper OR tts extension compose.yaml is present,
    # or if VOICE_ENABLED=true is set explicitly in .env
    voice_enabled = (
        _service_enabled("whisper", enabled)
        or _service_enabled("tts", enabled)
        or env.get("VOICE_ENABLED", "").lower() == "true"
    )

    # rag_enabled: true if qdrant extension is enabled, or RAG_ENABLED=true
    rag_enabled = (
        _service_enabled("qdrant", enabled)
        or env.get("RAG_ENABLED", "").lower() == "true"
    )

    return SettingsResponse(
        llm_model=env.get("LLM_MODEL", ""),
        mode=env.get("DREAM_MODE", "local"),
        tier=env.get("TIER", ""),
        gpu_backend=env.get("GPU_BACKEND", ""),
        dream_version=env.get("DREAM_VERSION", ""),
        enabled_services=enabled,
        voice_enabled=voice_enabled,
        rag_enabled=rag_enabled,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/api/settings", response_model=SettingsResponse)
async def get_settings(api_key: str = Depends(verify_api_key)):
    """Return current Dream Server settings.

    All values are read from .env at request time so they reflect the live
    on-disk state.  Secret-looking keys (API_KEY, TOKEN, PASSWORD …) are
    never included in the response.
    """
    try:
        return _build_settings()
    except OSError as exc:
        logger.error("Failed to read .env: %s", exc)
        raise HTTPException(status_code=500, detail="Could not read configuration file.")


@router.patch("/api/settings", response_model=SettingsResponse)
async def patch_settings(
    patch: SettingsPatch,
    api_key: str = Depends(verify_api_key),
):
    """Update one or more settings and persist them to .env.

    Only the fields present in the request body are written; unset fields are
    left unchanged.  Secrets are never accepted or returned.

    Note: voice_enabled and rag_enabled write convenience flags
    (VOICE_ENABLED, RAG_ENABLED) to .env.  Actually enabling or disabling the
    underlying Docker extensions (whisper, tts, qdrant) requires the
    'dream enable / dream disable' CLI commands which rename compose.yaml on
    the host — that file-system operation cannot be performed safely from
    inside the dashboard container.
    """
    env_path = _env_path()
    if not env_path.exists():
        raise HTTPException(
            status_code=503,
            detail=f".env not found at {env_path}. Is DREAM_INSTALL_DIR set correctly?",
        )

    updates: dict[str, str] = {}

    if patch.llm_model is not None:
        if not patch.llm_model.strip():
            raise HTTPException(status_code=422, detail="llm_model cannot be empty.")
        updates["LLM_MODEL"] = patch.llm_model.strip()

    if patch.mode is not None:
        if patch.mode not in _VALID_MODES:
            raise HTTPException(
                status_code=422,
                detail=f"mode must be one of: {', '.join(sorted(_VALID_MODES))}.",
            )
        updates["DREAM_MODE"] = patch.mode

    if patch.tier is not None:
        updates["TIER"] = patch.tier.strip()

    if patch.voice_enabled is not None:
        updates["VOICE_ENABLED"] = "true" if patch.voice_enabled else "false"

    if patch.rag_enabled is not None:
        updates["RAG_ENABLED"] = "true" if patch.rag_enabled else "false"

    if not updates:
        # Nothing to write — return current state unchanged
        return _build_settings()

    try:
        for key, val in updates.items():
            _write_env_key(key, val)
            logger.info("settings: updated %s", key)
    except OSError as exc:
        logger.error("Failed to write .env: %s", exc)
        raise HTTPException(status_code=500, detail="Could not write configuration file.")

    return _build_settings()
