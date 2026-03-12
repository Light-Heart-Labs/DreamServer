"""Model Hub API router — unified model management across backends.

Endpoints:
  GET  /api/models                    — List all models (catalog + downloaded + loaded)
  GET  /api/models/active             — Currently loaded model info
  POST /api/models/{model_id}/download — Start a model download from HuggingFace
  POST /api/models/{model_id}/load    — Switch active model
  DELETE /api/models/{model_id}       — Delete a downloaded model
  GET  /api/models/download-status    — Active download progress
  GET  /api/models/providers          — Cloud provider configurations
  PUT  /api/models/providers/{provider} — Save cloud provider API key
"""

import asyncio
import httpx
import json
import logging
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config import INSTALL_DIR, DATA_DIR
from security import verify_api_key
from gpu import get_gpu_info

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/models", tags=["models"])

# --- Paths ---

CATALOG_PATH = Path(INSTALL_DIR) / "config" / "model_catalog.json"
MODELS_DIR = Path(DATA_DIR) / "models"
PROVIDERS_FILE = Path(DATA_DIR) / "config" / "providers.json"
DOWNLOAD_STATUS_FILE = Path(DATA_DIR) / "model-download-status.json"
LLAMA_CONFIG_PATH = Path(INSTALL_DIR) / "config" / "llama-server" / "models.ini"
ENV_FILE = Path(INSTALL_DIR) / ".env"

# --- Pydantic Schemas ---


class ProviderConfig(BaseModel):
    api_key: str = Field(..., min_length=1)
    default_model: Optional[str] = None


class ModelEntry(BaseModel):
    id: str
    name: str
    family: Optional[str] = None
    description: str
    size_gb: float
    vram_required_gb: float
    context_length: int
    tokens_per_sec_estimate: Optional[int] = None
    quantization: Optional[str] = None
    specialty: str = "General"
    backend: str = "llama-server"
    status: str = "available"  # available | downloaded | loaded | downloading
    fits_vram: bool = True


class ActiveModel(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    backend: Optional[str] = None
    tokens_per_sec: Optional[float] = None
    context_length: Optional[int] = None


class ProviderInfo(BaseModel):
    id: str
    name: str
    description: str
    configured: bool = False
    default_model: Optional[str] = None
    available_models: list[str] = []
    docs_url: Optional[str] = None


# --- Catalog Loading ---


def load_catalog() -> dict:
    """Load the model catalog from disk."""
    if not CATALOG_PATH.exists():
        logger.warning("Model catalog not found at %s", CATALOG_PATH)
        return {"version": 1, "models": [], "providers": []}
    try:
        return json.loads(CATALOG_PATH.read_text())
    except Exception as e:
        logger.error("Failed to load model catalog: %s", e)
        return {"version": 1, "models": [], "providers": []}


def get_downloaded_gguf_files() -> set[str]:
    """Return set of .gguf filenames present in the models directory."""
    if not MODELS_DIR.exists():
        return set()
    return {f.name for f in MODELS_DIR.iterdir() if f.suffix == ".gguf" and f.is_file()}


def get_active_model_from_config() -> Optional[str]:
    """Read the active model filename from llama-server models.ini."""
    if not LLAMA_CONFIG_PATH.exists():
        return None
    try:
        content = LLAMA_CONFIG_PATH.read_text()
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("filename"):
                _, _, value = stripped.partition("=")
                return value.strip()
    except Exception:
        pass
    return None


def load_provider_configs() -> dict[str, dict]:
    """Load saved cloud provider configurations."""
    if not PROVIDERS_FILE.exists():
        return {}
    try:
        return json.loads(PROVIDERS_FILE.read_text())
    except Exception:
        return {}


def save_provider_configs(configs: dict[str, dict]) -> None:
    """Persist cloud provider configurations to disk."""
    PROVIDERS_FILE.parent.mkdir(parents=True, exist_ok=True)
    PROVIDERS_FILE.write_text(json.dumps(configs, indent=2))
    try:
        PROVIDERS_FILE.chmod(0o600)
    except OSError:
        pass


def get_vram_total_gb() -> Optional[float]:
    """Get total VRAM in GB from GPU info."""
    gpu = get_gpu_info()
    if gpu:
        return gpu.memory_total_mb / 1024
    return None


def get_download_status() -> Optional[dict]:
    """Read active download progress from status file."""
    if not DOWNLOAD_STATUS_FILE.exists():
        return None
    try:
        data = json.loads(DOWNLOAD_STATUS_FILE.read_text())
        if data.get("status") == "complete":
            return None
        return data
    except Exception:
        return None


def write_download_status(status: dict) -> None:
    """Write download status to file."""
    DOWNLOAD_STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    DOWNLOAD_STATUS_FILE.write_text(json.dumps(status))


def _get_llm_backend() -> str:
    """Read the configured LLM backend from the .env file."""
    if ENV_FILE.exists():
        try:
            for line in ENV_FILE.read_text().splitlines():
                line = line.strip()
                if line.startswith("LLM_BACKEND="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return "llama-server"


def _get_ollama_url() -> str:
    """Read the Ollama URL from the .env file or use default."""
    port = "11434"
    if ENV_FILE.exists():
        try:
            for line in ENV_FILE.read_text().splitlines():
                line = line.strip()
                if line.startswith("OLLAMA_PORT="):
                    port = line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return f"http://localhost:{port}"


async def fetch_ollama_models() -> list[ModelEntry]:
    """Query the local Ollama instance for installed models."""
    url = _get_ollama_url()
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{url}/api/tags")
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.debug("Ollama not reachable at %s: %s", url, e)
        return []

    models = []
    for m in data.get("models", []):
        name = m.get("name", "")
        model_name = m.get("model", name)
        details = m.get("details", {})

        # Size in bytes → GB
        size_bytes = m.get("size", 0)
        size_gb = round(size_bytes / (1024**3), 1) if size_bytes else 0

        # Quantization from details
        quant = details.get("quantization_level", "")

        # Family
        family = details.get("family", "")

        # Parameter size (e.g. "14B")
        param_size = details.get("parameter_size", "")

        # Build a clean display name
        display_name = name.split(":")[0] if ":" in name else name
        tag = name.split(":")[1] if ":" in name else "latest"

        models.append(ModelEntry(
            id=f"ollama:{name}",
            name=f"{display_name} ({param_size})" if param_size else display_name,
            family=family.capitalize() if family else None,
            description=f"Ollama model · {tag} tag",
            size_gb=size_gb,
            vram_required_gb=size_gb,  # Rough estimate: model size ≈ VRAM needed
            context_length=0,
            quantization=quant or None,
            specialty="General",
            backend="ollama",
            status="downloaded",  # If Ollama has it, it's downloaded
            fits_vram=True,
        ))

    return models


# --- Validators ---

_SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$")
_SAFE_PROVIDER_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")


def validate_model_id(model_id: str) -> str:
    if not _SAFE_ID_RE.match(model_id):
        raise HTTPException(status_code=400, detail="Invalid model ID")
    return model_id


def validate_provider_id(provider_id: str) -> str:
    if not _SAFE_PROVIDER_RE.match(provider_id):
        raise HTTPException(status_code=400, detail="Invalid provider ID")
    return provider_id


# --- Endpoints ---


@router.get("")
async def list_models(api_key: str = Depends(verify_api_key)):
    """Return unified model list from catalog enriched with local state."""
    catalog = load_catalog()
    downloaded = get_downloaded_gguf_files()
    active_file = get_active_model_from_config()
    vram_total = get_vram_total_gb()
    llm_backend = _get_llm_backend()

    models = []
    for entry in catalog.get("models", []):
        # Only include catalog models for the configured backend
        entry_backends = entry.get("backends", ["llama-server"])
        if llm_backend not in entry_backends and llm_backend != "llama-server":
            continue

        gguf_info = entry.get("gguf", {})
        filename = gguf_info.get("filename", "")

        status = "available"
        if filename and filename == active_file:
            status = "loaded"
        elif filename and filename in downloaded:
            status = "downloaded"

        fits = True
        if vram_total is not None:
            fits = entry.get("vram_required_gb", 0) <= vram_total

        models.append(ModelEntry(
            id=entry["id"],
            name=entry["name"],
            family=entry.get("family"),
            description=entry["description"],
            size_gb=entry["size_gb"],
            vram_required_gb=entry.get("vram_required_gb", 0),
            context_length=entry.get("context_length", 0),
            tokens_per_sec_estimate=entry.get("tokens_per_sec_estimate"),
            quantization=entry.get("quantization"),
            specialty=entry.get("specialty", "General"),
            backend=entry.get("backends", ["llama-server"])[0],
            status=status,
            fits_vram=fits,
        ))

    # Check for downloaded files not in catalog (user-added models)
    catalog_filenames = {
        m.get("gguf", {}).get("filename", "") for m in catalog.get("models", [])
    }
    for filename in sorted(downloaded - catalog_filenames):
        if not filename.endswith(".gguf"):
            continue
        name = filename.replace(".gguf", "").replace("-", " ").replace("_", " ")
        status = "loaded" if filename == active_file else "downloaded"
        models.append(ModelEntry(
            id=filename,
            name=name,
            description="User-added model",
            size_gb=0,
            vram_required_gb=0,
            context_length=0,
            backend="llama-server",
            status=status,
            fits_vram=True,
        ))

    # Fetch Ollama models if Ollama is available
    ollama_models = await fetch_ollama_models()
    models.extend(ollama_models)

    gpu = get_gpu_info()
    gpu_data = None
    if gpu:
        gpu_data = {
            "vramTotal": round(gpu.memory_total_mb / 1024, 1),
            "vramUsed": round(gpu.memory_used_mb / 1024, 1),
            "vramFree": round((gpu.memory_total_mb - gpu.memory_used_mb) / 1024, 1),
        }

    return {
        "models": [m.model_dump() for m in models],
        "gpu": gpu_data,
        "currentModel": active_file,
        "llmBackend": llm_backend,
    }


@router.get("/active")
async def get_active(api_key: str = Depends(verify_api_key)):
    """Return the currently loaded model."""
    llm_backend = _get_llm_backend()

    # For Ollama backend, query Ollama for what's running
    if llm_backend == "ollama":
        url = _get_ollama_url()
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{url}/api/ps")
                resp.raise_for_status()
                data = resp.json()
                running = data.get("models", [])
                if running:
                    m = running[0]
                    name = m.get("name", "")
                    display = name.split(":")[0] if ":" in name else name
                    param_size = m.get("details", {}).get("parameter_size", "")
                    return ActiveModel(
                        id=f"ollama:{name}",
                        name=f"{display} ({param_size})" if param_size else display,
                        backend="ollama",
                    )
        except Exception as e:
            logger.debug("Ollama /api/ps failed: %s", e)
        return ActiveModel()

    # For llama-server backend, read from models.ini
    catalog = load_catalog()
    active_file = get_active_model_from_config()

    if not active_file:
        return ActiveModel()

    # Find in catalog for rich metadata
    for entry in catalog.get("models", []):
        gguf = entry.get("gguf", {})
        if gguf.get("filename") == active_file:
            return ActiveModel(
                id=entry["id"],
                name=entry["name"],
                backend="llama-server",
                context_length=entry.get("context_length"),
            )

    return ActiveModel(
        id=active_file, name=active_file,
        backend="llama-server",
    )


@router.post("/{model_id}/download")
async def download_model(model_id: str, api_key: str = Depends(verify_api_key)):
    """Trigger a model download from HuggingFace."""
    validate_model_id(model_id)

    catalog = load_catalog()
    entry = None
    for m in catalog.get("models", []):
        if m["id"] == model_id:
            entry = m
            break

    if not entry:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found in catalog")

    gguf = entry.get("gguf")
    if not gguf:
        raise HTTPException(status_code=400, detail="Model has no download info")

    filename = gguf["filename"]
    downloaded = get_downloaded_gguf_files()
    if filename in downloaded:
        raise HTTPException(status_code=409, detail="Model already downloaded")

    # Check for active download
    current = get_download_status()
    if current and current.get("status") == "downloading":
        raise HTTPException(status_code=409, detail="Another download is in progress")

    # Write initial status
    write_download_status({
        "status": "downloading",
        "model_id": model_id,
        "model": entry["name"],
        "filename": filename,
        "repo": gguf.get("huggingface_repo", ""),
        "percent": 0,
        "bytesDownloaded": 0,
        "bytesTotal": int(entry.get("size_gb", 0) * 1024**3),
        "speedBytesPerSec": 0,
    })

    return {
        "status": "downloading",
        "model_id": model_id,
        "filename": filename,
        "message": f"Download started for {entry['name']}",
    }


@router.post("/{model_id}/load")
async def load_model(model_id: str, api_key: str = Depends(verify_api_key)):
    """Switch the active model."""
    validate_model_id(model_id)

    catalog = load_catalog()
    entry = None
    for m in catalog.get("models", []):
        if m["id"] == model_id:
            entry = m
            break

    if not entry:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found in catalog")

    gguf = entry.get("gguf")
    if not gguf:
        raise HTTPException(status_code=400, detail="Model has no GGUF info")

    filename = gguf["filename"]
    downloaded = get_downloaded_gguf_files()
    if filename not in downloaded:
        raise HTTPException(status_code=400, detail="Model not downloaded yet")

    # Update models.ini
    try:
        LLAMA_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        ctx = entry.get("context_length", 32768)
        config_content = f"[{model_id}]\nfilename = {filename}\nload-on-startup = true\nn-ctx = {ctx}\n"
        LLAMA_CONFIG_PATH.write_text(config_content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update config: {e}")

    return {
        "status": "loaded",
        "model_id": model_id,
        "filename": filename,
        "message": f"Switched to {entry['name']}. Restart llama-server to apply.",
    }


@router.delete("/{model_id}")
async def delete_model(model_id: str, api_key: str = Depends(verify_api_key)):
    """Delete a downloaded model file."""
    validate_model_id(model_id)

    catalog = load_catalog()
    filename = None
    for m in catalog.get("models", []):
        if m["id"] == model_id:
            gguf = m.get("gguf", {})
            filename = gguf.get("filename")
            break

    # Also check if model_id is a direct filename (user-added models)
    if not filename:
        candidate = MODELS_DIR / model_id
        if candidate.exists() and candidate.suffix == ".gguf":
            filename = model_id

    if not filename:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found")

    filepath = MODELS_DIR / filename
    if not filepath.exists():
        raise HTTPException(status_code=404, detail="Model file not found on disk")

    # Prevent deleting the active model
    active_file = get_active_model_from_config()
    if filename == active_file:
        raise HTTPException(status_code=409, detail="Cannot delete the active model. Load a different model first.")

    try:
        filepath.unlink()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete: {e}")

    return {"status": "deleted", "model_id": model_id, "filename": filename}


@router.get("/download-status")
async def download_status(api_key: str = Depends(verify_api_key)):
    """Return current download progress."""
    status = get_download_status()
    if not status:
        return {"active": False}
    return {"active": True, **status}


@router.get("/providers")
async def list_providers(api_key: str = Depends(verify_api_key)):
    """List available cloud providers with configuration status."""
    catalog = load_catalog()
    saved = load_provider_configs()

    providers = []
    for p in catalog.get("providers", []):
        pid = p["id"]
        cfg = saved.get(pid, {})
        providers.append(ProviderInfo(
            id=pid,
            name=p["name"],
            description=p["description"],
            configured=bool(cfg.get("api_key")),
            default_model=cfg.get("default_model"),
            available_models=p.get("models", []),
            docs_url=p.get("docs_url"),
        ))

    return {"providers": [p.model_dump() for p in providers]}


@router.put("/providers/{provider_id}")
async def save_provider(
    provider_id: str,
    config: ProviderConfig,
    api_key: str = Depends(verify_api_key),
):
    """Save API key and settings for a cloud provider."""
    validate_provider_id(provider_id)

    catalog = load_catalog()
    valid_ids = {p["id"] for p in catalog.get("providers", [])}
    if provider_id not in valid_ids:
        raise HTTPException(status_code=404, detail=f"Unknown provider '{provider_id}'")

    configs = load_provider_configs()
    configs[provider_id] = {
        "api_key": config.api_key,
        "default_model": config.default_model,
    }
    save_provider_configs(configs)

    return {"status": "saved", "provider": provider_id}


@router.delete("/providers/{provider_id}")
async def delete_provider(provider_id: str, api_key: str = Depends(verify_api_key)):
    """Remove a cloud provider configuration."""
    validate_provider_id(provider_id)

    configs = load_provider_configs()
    if provider_id not in configs:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not configured")

    del configs[provider_id]
    save_provider_configs(configs)

    return {"status": "deleted", "provider": provider_id}
