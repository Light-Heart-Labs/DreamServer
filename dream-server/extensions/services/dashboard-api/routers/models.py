"""Model Library router — browse, filter, and manage GGUF models."""

import json
import logging
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from config import AGENT_URL, DATA_DIR, DREAM_AGENT_KEY, INSTALL_DIR
from models import ModelLibraryEntry, ModelLibraryGpu, ModelLibraryResponse
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["models"])

_LIBRARY_PATH = Path(INSTALL_DIR) / "config" / "model-library.json"
_MODELS_DIR = Path(DATA_DIR) / "models"
_ENV_PATH = Path(INSTALL_DIR) / ".env"


def _load_library() -> list[dict]:
    """Load the model library catalog from config/model-library.json."""
    if not _LIBRARY_PATH.exists():
        logger.warning("Model library not found: %s", _LIBRARY_PATH)
        return []
    try:
        data = json.loads(_LIBRARY_PATH.read_text(encoding="utf-8"))
        return data.get("models", [])
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("Failed to load model library: %s", exc)
        return []


def _scan_downloaded_models() -> dict[str, int]:
    """Scan data/models/ for downloaded GGUF files. Returns {filename: size_bytes}."""
    downloaded: dict[str, int] = {}
    if not _MODELS_DIR.is_dir():
        return downloaded
    try:
        for f in _MODELS_DIR.iterdir():
            if f.is_file() and f.suffix == ".gguf" and not f.name.endswith(".part"):
                try:
                    downloaded[f.name] = f.stat().st_size
                except OSError:
                    pass
    except OSError as exc:
        logger.warning("Failed to scan models directory: %s", exc)
    return downloaded


def _read_active_model() -> Optional[str]:
    """Read the currently active GGUF_FILE from .env."""
    if not _ENV_PATH.exists():
        return None
    try:
        for line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
            if line.startswith("GGUF_FILE="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return None


def _get_gpu_vram() -> Optional[ModelLibraryGpu]:
    """Get GPU VRAM info for model compatibility gating."""
    try:
        from gpu import get_gpu_info
        gpu = get_gpu_info()
        if gpu is None:
            return None
        total_gb = gpu.memory_total_mb / 1024
        used_gb = gpu.memory_used_mb / 1024
        return ModelLibraryGpu(
            vramTotal=round(total_gb, 1),
            vramUsed=round(used_gb, 1),
            vramFree=round(total_gb - used_gb, 1),
        )
    except Exception:
        return None


def _format_size(size_mb: int) -> str:
    """Format size in MB to a human-readable string."""
    if size_mb >= 1024:
        return f"{size_mb / 1024:.1f} GB"
    return f"{size_mb} MB"


@router.get("/api/models", response_model=ModelLibraryResponse)
def list_models(api_key: str = Depends(verify_api_key)):
    """List available models with VRAM compatibility and download status."""
    library = _load_library()
    downloaded = _scan_downloaded_models()
    active_gguf = _read_active_model()
    gpu = _get_gpu_vram()

    vram_total_gb = gpu.vramTotal if gpu else 0
    vram_free_gb = gpu.vramFree if gpu else 0

    entries: list[ModelLibraryEntry] = []
    current_model: Optional[str] = None

    for model in library:
        gguf_file = model.get("gguf_file", "")
        model_id = model.get("id", "")

        # Determine status — for split models, check the first part file
        parts = model.get("gguf_parts", [])
        first_part = parts[0]["file"] if parts else gguf_file

        if gguf_file and gguf_file == active_gguf:
            status = "loaded"
            current_model = model_id
        elif first_part and first_part in downloaded:
            status = "downloaded"
        else:
            status = "available"

        vram_req = model.get("vram_required_gb", 0)

        entries.append(ModelLibraryEntry(
            id=model_id,
            name=model.get("name", model_id),
            size=_format_size(model.get("size_mb", 0)),
            sizeGb=round(model.get("size_mb", 0) / 1024, 1),
            vramRequired=vram_req,
            contextLength=model.get("context_length", 0),
            specialty=model.get("specialty", "General"),
            description=model.get("description", ""),
            tokensPerSec=model.get("tokens_per_sec_estimate", 0),
            quantization=model.get("quantization"),
            status=status,
            fitsVram=vram_req <= vram_total_gb if vram_total_gb > 0 else True,
            fitsCurrentVram=vram_req <= vram_free_gb if vram_free_gb > 0 else False,
        ))

    return ModelLibraryResponse(
        models=entries,
        gpu=gpu,
        currentModel=current_model,
    )


@router.get("/api/models/download-status")
def model_download_status(api_key: str = Depends(verify_api_key)):
    """Get current model download progress (if any)."""
    status_path = Path(DATA_DIR) / "model-download-status.json"
    if not status_path.exists():
        return {"status": "idle"}
    try:
        return json.loads(status_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"status": "idle"}


def _call_agent_model(path: str, body: dict, timeout: int = 30) -> dict:
    """Call the host agent model endpoint."""
    url = f"{AGENT_URL}{path}"
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={
            "Authorization": f"Bearer {DREAM_AGENT_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            err_body = json.loads(exc.read().decode())
            detail = err_body.get("error", f"Host agent returned HTTP {exc.code}")
        except (json.JSONDecodeError, OSError):
            detail = f"Host agent returned HTTP {exc.code}"
        raise HTTPException(status_code=502, detail=detail)
    except (urllib.error.URLError, OSError) as exc:
        raise HTTPException(status_code=503, detail=f"Host agent unreachable: {exc}")


def _find_model_in_library(model_id: str) -> Optional[dict]:
    """Look up a model by ID in the library catalog."""
    for model in _load_library():
        if model.get("id") == model_id:
            return model
    return None


@router.post("/api/models/{model_id}/download")
def download_model(model_id: str, api_key: str = Depends(verify_api_key)):
    """Start downloading a model from HuggingFace."""
    model = _find_model_in_library(model_id)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found in library")

    payload = {
        "gguf_file": model["gguf_file"],
        "gguf_url": model.get("gguf_url", ""),
        "gguf_sha256": model.get("gguf_sha256", ""),
    }
    # Split-file models provide gguf_parts array
    if model.get("gguf_parts"):
        payload["gguf_parts"] = model["gguf_parts"]

    result = _call_agent_model("/v1/model/download", payload)
    return result


@router.post("/api/models/download/cancel")
def cancel_download(api_key: str = Depends(verify_api_key)):
    """Cancel an in-progress model download."""
    result = _call_agent_model("/v1/model/download/cancel", {})
    return result


@router.post("/api/models/{model_id}/load")
def load_model(model_id: str, api_key: str = Depends(verify_api_key)):
    """Activate a model — update config and restart llama-server."""
    model = _find_model_in_library(model_id)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found in library")

    # Long timeout — model loading can take minutes
    result = _call_agent_model("/v1/model/activate", {"model_id": model_id}, timeout=600)
    return result


@router.delete("/api/models/{model_id}")
def delete_model(model_id: str, api_key: str = Depends(verify_api_key)):
    """Delete a downloaded model file."""
    model = _find_model_in_library(model_id)
    if model is None:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found in library")

    result = _call_agent_model("/v1/model/delete", {
        "gguf_file": model["gguf_file"],
    })
    return result
