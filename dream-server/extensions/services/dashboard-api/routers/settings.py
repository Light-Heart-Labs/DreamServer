"""General settings endpoints.

GET  /api/settings  — read current Dream Server settings from .env
PATCH /api/settings — update mutable settings; secrets are never writable via API

Secret keys (marked "secret": true in .env.schema.json) are stripped from
every GET response so they can never leak through this endpoint.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from config import EXTENSIONS_DIR
from env_utils import load_schema, read_env, write_env_key
from models import SettingsPatch, SettingsResponse
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["settings"])

_VALID_MODES: frozenset[str] = frozenset({"local", "cloud", "hybrid"})

# .env keys that map to SettingsResponse fields (none of these are secrets).
_ENV_TO_FIELD: dict[str, str] = {
    "LLM_MODEL":     "llm_model",
    "DREAM_MODE":    "mode",
    "TIER":          "tier",
    "GPU_BACKEND":   "gpu_backend",
    "DREAM_VERSION": "dream_version",
}


def _secret_keys(schema: dict[str, Any]) -> frozenset[str]:
    """Return the set of env keys marked secret in the schema."""
    return frozenset(
        k for k, v in schema.get("properties", {}).items() if v.get("secret")
    )


def _enabled_services() -> list[str]:
    """Return service IDs whose compose.yaml exists under EXTENSIONS_DIR."""
    services: list[str] = []
    if not EXTENSIONS_DIR.exists():
        return services
    for item in sorted(EXTENSIONS_DIR.iterdir()):
        if item.is_dir() and (item / "compose.yaml").exists():
            services.append(item.name)
    return services


def _voice_enabled(env: dict[str, str]) -> bool:
    return bool(env.get("WHISPER_MODEL") or env.get("TTS_VOICE"))


def _rag_enabled(env: dict[str, str]) -> bool:
    return bool(env.get("QDRANT_PORT") or env.get("EMBEDDING_MODEL"))


@router.get("/api/settings", response_model=SettingsResponse)
async def get_settings(api_key: str = Depends(verify_api_key)):
    """Return current Dream Server settings from .env.

    Secret keys defined in .env.schema.json are never included in the response.
    """
    env = read_env()
    schema = load_schema()
    masked = _secret_keys(schema)

    data: dict[str, Any] = {}
    for env_key, field in _ENV_TO_FIELD.items():
        if env_key not in masked:
            data[field] = env.get(env_key)

    data["enabled_services"] = _enabled_services()
    data["voice_enabled"] = _voice_enabled(env)
    data["rag_enabled"] = _rag_enabled(env)

    return SettingsResponse(**data)


@router.patch("/api/settings", response_model=SettingsResponse)
async def patch_settings(
    patch: SettingsPatch,
    api_key: str = Depends(verify_api_key),
):
    """Update mutable Dream Server settings in .env.

    Secret keys can never be written via this endpoint.
    """
    errors: list[str] = []
    updates: dict[str, str] = {}

    if patch.mode is not None:
        if patch.mode not in _VALID_MODES:
            errors.append(f"mode must be one of: {', '.join(sorted(_VALID_MODES))}")
        else:
            updates["DREAM_MODE"] = patch.mode

    if patch.llm_model is not None:
        if not patch.llm_model.strip():
            errors.append("llm_model must not be blank")
        else:
            updates["LLM_MODEL"] = patch.llm_model.strip()

    if patch.tier is not None:
        updates["TIER"] = patch.tier.strip().upper()

    if patch.voice_enabled is not None:
        updates["VOICE_ENABLED"] = "true" if patch.voice_enabled else "false"

    if patch.rag_enabled is not None:
        updates["RAG_ENABLED"] = "true" if patch.rag_enabled else "false"

    if errors:
        raise HTTPException(status_code=422, detail=errors)

    for env_key, value in updates.items():
        write_env_key(env_key, value)
        logger.info("Setting updated: %s", env_key)

    return await get_settings(api_key=api_key)
