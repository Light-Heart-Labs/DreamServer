"""Lightweight feature test endpoints used by the dashboard onboarding flow."""

from fastapi import APIRouter, Depends

from config import SERVICES
from helpers import check_service_health, get_loaded_model
from security import verify_api_key
from routers.voice import get_voice_status_payload

router = APIRouter(tags=["diagnostics"])


async def _probe_service(service_id: str, fallback_name: str) -> dict:
    """Check whether a named service is healthy enough for a feature test."""
    config = SERVICES.get(service_id)
    if not config:
        return {
            "success": False,
            "service": fallback_name,
            "error": f"{fallback_name} is not configured",
        }

    result = await check_service_health(service_id, config)
    return {
        "success": result.status == "healthy",
        "service": result.name,
        "error": None if result.status == "healthy" else f"{result.name} is {result.status}",
    }


@router.get("/api/test/llm")
async def test_llm(api_key: str = Depends(verify_api_key)):
    """Quick LLM availability check for setup validation."""
    probe = await _probe_service("llama-server", "llama-server")
    loaded_model = await get_loaded_model() if probe["success"] else None
    return {
        **probe,
        "model": loaded_model,
        "message": (
            f"LLM ready ({loaded_model})"
            if probe["success"] and loaded_model
            else "LLM ready"
            if probe["success"]
            else probe["error"]
        ),
    }


@router.get("/api/test/voice")
async def test_voice(api_key: str = Depends(verify_api_key)):
    """Voice stack availability check for setup validation."""
    status = await get_voice_status_payload()
    return {
        "success": status["available"],
        "message": status["message"],
        "services": status["services"],
        "error": None if status["available"] else status["message"],
    }


@router.get("/api/test/rag")
async def test_rag(api_key: str = Depends(verify_api_key)):
    """Qdrant availability check for document chat."""
    probe = await _probe_service("qdrant", "Qdrant")
    return {
        **probe,
        "message": "RAG pipeline ready" if probe["success"] else probe["error"],
    }


@router.get("/api/test/workflows")
async def test_workflows(api_key: str = Depends(verify_api_key)):
    """n8n availability check for workflows."""
    probe = await _probe_service("n8n", "n8n")
    return {
        **probe,
        "message": "Workflow engine ready" if probe["success"] else probe["error"],
    }
