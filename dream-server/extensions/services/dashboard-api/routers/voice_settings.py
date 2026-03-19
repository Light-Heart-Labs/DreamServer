"""Voice-settings endpoints.

GET  /api/settings/voice  — return current Whisper/TTS configuration
PATCH /api/settings/voice  — update one or more voice settings; each field is
                              validated against .env.schema.json before being
                              written to .env.

Managed .env keys
-----------------
WHISPER_MODEL          : Whisper STT model size  (schema: enum)
TTS_VOICE              : Kokoro TTS voice string  (schema: string, free-form)
WHISPER_VAD_THRESHOLD  : VAD sensitivity 0.0-1.0  (schema: number + bounds)
"""

import logging

from fastapi import APIRouter, Depends, HTTPException

from env_utils import load_schema, read_env, validate_against_schema, write_env_key
from models import VoiceSettingsPatch, VoiceSettingsResponse
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["settings"])


def _build_response(env: dict[str, str], schema: dict) -> VoiceSettingsResponse:
    """Construct a VoiceSettingsResponse from a parsed .env dict and schema."""
    props = schema.get("properties", {})

    whisper_model: str = (
        env.get("WHISPER_MODEL")
        or props.get("WHISPER_MODEL", {}).get("default", "base")
    )

    tts_voice = env.get("TTS_VOICE") or None

    raw_vad = env.get("WHISPER_VAD_THRESHOLD")
    if raw_vad:
        try:
            whisper_vad_threshold: float = float(raw_vad)
        except ValueError:
            logger.warning("Invalid WHISPER_VAD_THRESHOLD in .env: %r — using default", raw_vad)
            whisper_vad_threshold = float(
                props.get("WHISPER_VAD_THRESHOLD", {}).get("default", 0.5)
            )
    else:
        whisper_vad_threshold = float(
            props.get("WHISPER_VAD_THRESHOLD", {}).get("default", 0.5)
        )

    allowed_whisper_models: list[str] = props.get("WHISPER_MODEL", {}).get("enum", [])

    return VoiceSettingsResponse(
        whisper_model=whisper_model,
        tts_voice=tts_voice,
        whisper_vad_threshold=whisper_vad_threshold,
        allowed_whisper_models=allowed_whisper_models,
    )


@router.get("/api/settings/voice", response_model=VoiceSettingsResponse)
async def get_voice_settings(api_key: str = Depends(verify_api_key)):
    """Return current voice settings read from .env.

    Falls back to schema defaults when a key is absent.  Also returns
    allowed_whisper_models so clients can populate a drop-down without
    hard-coding the list.
    """
    return _build_response(read_env(), load_schema())


@router.patch("/api/settings/voice", response_model=VoiceSettingsResponse)
async def patch_voice_settings(
    patch: VoiceSettingsPatch,
    api_key: str = Depends(verify_api_key),
):
    """Update one or more voice settings and write them to .env.

    Every supplied field is validated against .env.schema.json before any
    write is performed.  If any field fails validation the whole request is
    rejected with HTTP 422 and a list of error messages.
    """
    schema = load_schema()
    errors: list[str] = []
    updates: dict[str, str] = {}

    if patch.whisper_model is not None:
        err = validate_against_schema(
            "whisper_model", "WHISPER_MODEL", patch.whisper_model, schema
        )
        if err:
            errors.append(err)
        else:
            updates["WHISPER_MODEL"] = patch.whisper_model

    if patch.tts_voice is not None:
        stripped = patch.tts_voice.strip()
        if not stripped:
            errors.append("tts_voice must not be blank")
        else:
            updates["TTS_VOICE"] = stripped

    if patch.whisper_vad_threshold is not None:
        err = validate_against_schema(
            "whisper_vad_threshold",
            "WHISPER_VAD_THRESHOLD",
            patch.whisper_vad_threshold,
            schema,
        )
        if err:
            errors.append(err)
        else:
            updates["WHISPER_VAD_THRESHOLD"] = str(patch.whisper_vad_threshold)

    if errors:
        raise HTTPException(status_code=422, detail=errors)

    for env_key, value in updates.items():
        write_env_key(env_key, value)
        logger.info("Voice setting updated: %s", env_key)

    return _build_response(read_env(), schema)
