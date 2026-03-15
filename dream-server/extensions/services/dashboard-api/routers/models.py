"""Model Hub API router — unified model management across backends.

Endpoints:
  GET  /api/models                    — List all models (catalog + custom + downloaded + loaded)
  GET  /api/models/active             — Currently loaded model info
  POST /api/models/{model_id}/download — Start a model download from HuggingFace
  POST /api/models/{model_id}/load    — Switch active model
  DELETE /api/models/{model_id}       — Delete a downloaded model
  GET  /api/models/download-status    — Active download progress
  GET  /api/models/providers          — Cloud provider configurations
  PUT  /api/models/providers/{provider} — Save cloud provider API key
  POST /api/models/custom             — Add a custom GGUF model entry
  GET  /api/models/custom             — List custom model entries
  DELETE /api/models/custom/{model_id} — Remove a custom model entry
"""

import asyncio
import httpx
import json
import logging
import os
import re
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
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
CUSTOM_MODELS_FILE = Path(DATA_DIR) / "config" / "custom_models.json"
DOWNLOAD_STATUS_FILE = Path(DATA_DIR) / "model-download-status.json"
LLAMA_CONFIG_PATH = Path(INSTALL_DIR) / "config" / "llama-server" / "models.ini"
ENV_FILE = Path(INSTALL_DIR) / ".env"
HF_CACHE_DIR = Path(DATA_DIR) / "hf-cache"

MODEL_CONTROLLER_URL = os.environ.get("MODEL_CONTROLLER_URL", "http://model-controller:3003")
MODEL_CONTROLLER_SECRET = os.environ.get("MODEL_CONTROLLER_SECRET", "")


def _read_env_var(key: str) -> Optional[str]:
    """Read a variable from the .env file on disk (NOT os.environ).

    This is needed because model-controller updates the .env file after switching
    models, but the dashboard-api Docker process env is only set at container start.
    """
    if not ENV_FILE.exists():
        return None
    try:
        for line in ENV_FILE.read_text().splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            eq = stripped.find("=")
            if eq == -1:
                continue
            k = stripped[:eq].strip()
            if k == key:
                v = stripped[eq + 1:].strip().strip("\"'")
                return v or None
    except Exception:
        pass
    return None

# --- Pydantic Schemas ---


class ProviderConfig(BaseModel):
    api_key: str = Field(..., min_length=1)
    default_model: Optional[str] = None


class CustomModelInput(BaseModel):
    """Schema for adding a custom GGUF model."""
    name: str = Field(..., min_length=1, max_length=200)
    huggingface_repo: str = Field(..., min_length=3, max_length=300)
    huggingface_file: str = Field(..., min_length=3, max_length=300)
    family: Optional[str] = None
    description: Optional[str] = None
    size_gb: Optional[float] = None
    vram_required_gb: Optional[float] = None
    context_length: Optional[int] = None
    quantization: Optional[str] = None
    specialty: Optional[str] = "General"

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
    gguf: Optional[dict] = None  # {filename, huggingface_repo, huggingface_file}


class ActiveModel(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    backend: Optional[str] = None
    tokens_per_sec: Optional[float] = None
    context_length: Optional[int] = None
    status: Optional[str] = None  # 'running', 'stopped', or None


class ProviderInfo(BaseModel):
    id: str
    name: str
    description: str
    configured: bool = False
    default_model: Optional[str] = None
    available_models: list[str] = []
    docs_url: Optional[str] = None


class SwitchModelRequest(BaseModel):
    """Request body for switching the active model via the controller."""
    model_file: str = Field(..., min_length=1, max_length=500)
    backend: str = Field(default="llama-server", pattern="^(llama-server|llamacpp|vllm)$")


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


def get_vllm_cached_models() -> set[str]:
    """Return the set of HuggingFace model IDs already cached for vLLM.

    Checks HF cache directory structure: hub/models--org--name/
    """
    hub_dir = HF_CACHE_DIR / "hub"
    if not hub_dir.exists():
        return set()
    cached = set()
    for item in hub_dir.iterdir():
        if item.is_dir() and item.name.startswith("models--"):
            # Convert models--Qwen--Qwen3-8B -> Qwen/Qwen3-8B
            parts = item.name.replace("models--", "", 1).split("--", 1)
            if len(parts) == 2:
                cached.add(f"{parts[0]}/{parts[1]}")
    return cached


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
        # Treat completed and errored downloads as inactive
        if data.get("status") in ("complete", "error"):
            return None
        return data
    except Exception:
        return None


def write_download_status(status: dict) -> None:
    """Write download status to file."""
    DOWNLOAD_STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    DOWNLOAD_STATUS_FILE.write_text(json.dumps(status))


def _get_llm_backend() -> str:
    """Read the configured LLM backend from the .env file.

    Recognizes 'ollama', 'llama-server', and 'vllm'.
    Auto-detects vllm if VLLM_MODEL is set in .env.
    """
    if ENV_FILE.exists():
        try:
            has_vllm_model = False
            explicit_backend = None
            for line in ENV_FILE.read_text().splitlines():
                line = line.strip()
                if line.startswith("LLM_BACKEND="):
                    explicit_backend = line.split("=", 1)[1].strip().strip('"').strip("'")
                if line.startswith("VLLM_MODEL="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if val:
                        has_vllm_model = True
            if explicit_backend:
                return explicit_backend
            if has_vllm_model:
                return "vllm"
        except Exception:
            pass
    return "llama-server"


def _get_ollama_url() -> str:
    """Read the Ollama API URL from .env.

    Since Ollama now runs as the llama-server Docker service,
    use LLM_API_URL (set by model-controller during backend switch).
    Falls back to localhost:11434 for backward compatibility.
    """
    if ENV_FILE.exists():
        try:
            for line in ENV_FILE.read_text().splitlines():
                line = line.strip()
                if line.startswith("LLM_API_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return "http://llama-server:8080"


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


# --- Custom Model Helpers ---

def _load_custom_models() -> list:
    """Load custom models from user data."""
    if not CUSTOM_MODELS_FILE.exists():
        return []
    try:
        return json.loads(CUSTOM_MODELS_FILE.read_text())
    except (json.JSONDecodeError, IOError):
        return []


def _save_custom_models(models: list) -> None:
    """Save custom models to user data."""
    CUSTOM_MODELS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CUSTOM_MODELS_FILE.write_text(json.dumps(models, indent=2))


# --- Endpoints ---


@router.get("")
async def list_models(api_key: str = Depends(verify_api_key)):
    """Return unified model list from catalog enriched with local state."""
    catalog = load_catalog()
    downloaded = get_downloaded_gguf_files()
    vllm_cached = get_vllm_cached_models()
    # Read active model from .env (source of truth, updated by model-controller)
    # with fallback to models.ini (legacy)
    active_file = _read_env_var("GGUF_FILE") or get_active_model_from_config()
    vram_total = get_vram_total_gb()
    llm_backend = _get_llm_backend()

    models = []
    for entry in catalog.get("models", []):

        gguf_info = entry.get("gguf", {})
        vllm_info = entry.get("vllm", {})
        filename = gguf_info.get("filename", "")
        hf_repo = vllm_info.get("huggingface_repo", "")
        backends = entry.get("backends", ["llama-server"])

        status = "available"
        if "vllm" in backends and hf_repo:
            # vLLM model — check HF cache
            if hf_repo in vllm_cached:
                status = "downloaded"
        elif filename:
            if filename == active_file:
                status = "loaded"
            elif filename in downloaded:
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
            backend=backends[0],
            status=status,
            fits_vram=fits,
            gguf=entry.get("gguf"),
        ))

    # Check for downloaded files not in catalog (user-added models)
    catalog_filenames = {
        m.get("gguf", {}).get("filename", "") for m in catalog.get("models", [])
    }

    # Merge custom models from user storage
    custom_models = _load_custom_models()
    custom_filenames = set()
    for cm in custom_models:
        filename = cm.get("gguf", {}).get("filename", "")
        custom_filenames.add(filename)
        status = "available"
        if filename and filename == active_file:
            status = "loaded"
        elif filename and filename in downloaded:
            status = "downloaded"

        fits = True
        if vram_total is not None:
            fits = cm.get("vram_required_gb", 0) <= vram_total

        models.append(ModelEntry(
            id=cm["id"],
            name=cm["name"],
            family=cm.get("family"),
            description=cm.get("description", "Custom model"),
            size_gb=cm.get("size_gb", 0),
            vram_required_gb=cm.get("vram_required_gb", 0),
            context_length=cm.get("context_length", 0),
            tokens_per_sec_estimate=cm.get("tokens_per_sec_estimate"),
            quantization=cm.get("quantization"),
            specialty=cm.get("specialty", "General"),
            backend="llama-server",
            status=status,
            fits_vram=fits,
            gguf=cm.get("gguf"),
        ))

    # Detect orphan downloads (not in catalog or custom models)
    known_filenames = catalog_filenames | custom_filenames
    for filename in sorted(downloaded - known_filenames):
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
            "processes": [
                {"pid": p.pid, "name": p.name, "memoryMb": p.memory_mb}
                for p in getattr(gpu, 'processes', None) or []
            ],
        }

    # Backend capabilities
    can_hot_swap = llm_backend == "ollama"
    capabilities = {
        "canHotSwap": can_hot_swap,
        "requiresRestart": not can_hot_swap,
        "canUnload": True,  # Universal unload — all backends support it
    }

    return {
        "models": [m.model_dump() for m in models],
        "gpu": gpu_data,
        "currentModel": active_file,
        "llmBackend": llm_backend,
        "backendCapabilities": capabilities,
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
                        status="running",
                    )
        except Exception as e:
            logger.debug("Ollama /api/ps failed: %s", e)
        return ActiveModel(backend="ollama", status="stopped")

    # For vllm backend, query the OpenAI-compatible /v1/models
    if llm_backend == "vllm":
        try:
            ollama_url = _get_ollama_url()  # same host:port for vllm container
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{ollama_url}/v1/models")
                resp.raise_for_status()
                data = resp.json()
                models = data.get("data", [])
                if models:
                    model_id = models[0].get("id", "")
                    return ActiveModel(
                        id=model_id,
                        name=model_id,
                        backend="vllm",
                        status="running",
                    )
        except Exception as e:
            logger.debug("vLLM /v1/models query failed: %s", e)
        return ActiveModel(backend="vllm", status="stopped")

    # For llama-server backend, read GGUF_FILE from .env file on disk (updated by model-controller)
    # with fallback to models.ini (legacy). NOTE: We read the file, NOT os.environ,
    # because Docker process env is stale — model-controller updates the file, not our process.
    catalog = load_catalog()
    active_file = _read_env_var("GGUF_FILE") or get_active_model_from_config()

    if not active_file:
        return ActiveModel(backend="llama-server", status="stopped")

    # Probe llama-server health to determine if container is running
    llm_url = _get_llm_api_url()
    is_running = False
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            health = await client.get(f"{llm_url}/health")
            is_running = health.status_code == 200
    except Exception:
        pass

    # Find in catalog for rich metadata
    for entry in catalog.get("models", []):
        gguf = entry.get("gguf", {})
        if gguf.get("filename") == active_file:
            return ActiveModel(
                id=entry["id"],
                name=entry["name"],
                backend="llama-server",
                context_length=entry.get("context_length"),
                status="running" if is_running else "stopped",
            )

    return ActiveModel(
        id=active_file, name=active_file,
        backend="llama-server",
        status="running" if is_running else "stopped",
    )


# --- Backend Controller Proxy ---
# These endpoints proxy to the model-controller sidecar for container management


def _controller_headers() -> dict:
    """Build auth headers for the model-controller sidecar."""
    headers = {}
    if MODEL_CONTROLLER_SECRET:
        headers["Authorization"] = f"Bearer {MODEL_CONTROLLER_SECRET}"
    return headers


@router.post("/backend/switch")
async def switch_backend_model(req: SwitchModelRequest, api_key: str = Depends(verify_api_key)):
    """Switch the active model via the model-controller sidecar.

    The controller updates .env and restarts the llama-server container.
    Model must be pre-downloaded before calling this endpoint.
    """
    try:
        # Normalize backend name for model-controller (expects 'llamacpp', not 'llama-server')
        mc_backend = "llamacpp" if req.backend in ("llama-server", "llamacpp") else req.backend
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.post(
                f"{MODEL_CONTROLLER_URL}/switch",
                json={"model_file": req.model_file, "backend": mc_backend},
                headers=_controller_headers(),
            )
            try:
                data = resp.json()
            except Exception:
                data = {"error": resp.text or "Empty response from controller"}
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=data.get("error", "Controller returned an error"),
                )
            return data
    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Model controller is not reachable. Is the service running?",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Controller proxy failed: {e}")


@router.get("/backend/status")
async def backend_status(api_key: str = Depends(verify_api_key)):
    """Query the model-controller for current backend state.

    Returns container status, loaded model, and health.
    Used for polling during model switches.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{MODEL_CONTROLLER_URL}/status",
                headers=_controller_headers(),
            )
            data = resp.json()
            return data
    except httpx.ConnectError:
        return {
            "backend": "unknown",
            "container": "unreachable",
            "healthy": False,
            "model": None,
            "controllerReachable": False,
        }
    except Exception as e:
        logger.warning("Controller status query failed: %s", e)
        return {
            "backend": "unknown",
            "container": "error",
            "healthy": False,
            "model": None,
            "error": str(e),
        }


# --- Backend Detection & Switching ---


BACKEND_METADATA = {
    "llamacpp": {
        "name": "llama.cpp",
        "description": "GGUF quantized models — lower VRAM usage, fast inference",
        "overlay": None,  # base compose, always available
    },
    "vllm": {
        "name": "vLLM",
        "description": "Full-precision HuggingFace models — higher quality, tensor parallelism",
        "overlay": "docker-compose.vllm.yml",
    },
    "ollama": {
        "name": "Ollama",
        "description": "Easy model management with auto-downloads and a large model library",
        "overlay": "docker-compose.external-llm.yml",
    },
}


class SwitchBackendRequest(BaseModel):
    """Request body for switching the LLM backend."""
    backend: str = Field(..., pattern="^(llamacpp|vllm|ollama)$")
    model: Optional[str] = None


@router.get("/backends")
async def list_backends(api_key: str = Depends(verify_api_key)):
    """Return available LLM backends with active status.

    All backends are always available — overlay files ship with the repo.
    Reads LLM_BACKEND from .env for the active one.
    """
    active_backend = _get_llm_backend()
    # Map common variants to canonical IDs
    if active_backend in ("llama-server", "llamacpp"):
        active_backend = "llamacpp"

    backends = []
    for backend_id, meta in BACKEND_METADATA.items():
        backends.append({
            "id": backend_id,
            "name": meta["name"],
            "description": meta["description"],
            "installed": True,  # overlays ship with repo, always available
            "active": backend_id == active_backend,
        })

    return {
        "backends": backends,
        "activeBackend": active_backend,
    }


class TestModelRequest(BaseModel):
    """Request body for testing the active model."""
    prompt: str = Field(
        default="Explain quantum computing in exactly 3 sentences.",
        description="Prompt to send to the model"
    )
    max_tokens: int = Field(default=128, ge=16, le=512)


def _get_llm_api_url() -> str:
    """Read LLM_API_URL from .env, defaulting to llama-server:8080."""
    if ENV_FILE.exists():
        try:
            for line in ENV_FILE.read_text().splitlines():
                line = line.strip()
                if line.startswith("LLM_API_URL="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return "http://llama-server:8080"


@router.post("/test")
async def test_model(req: TestModelRequest, api_key: str = Depends(verify_api_key)):
    """Send a short prompt to the active LLM and measure token throughput.

    Returns time-to-first-token (TTFT), total tokens, total time, and tok/s.
    Uses the OpenAI-compatible streaming API exposed by all backends.
    """
    import httpx
    import time as time_mod

    llm_url = _get_llm_api_url()
    backend = _get_llm_backend()

    # Handle Ollama vs OpenAI-compatible API URLs
    if backend in ("ollama",):
        api_base = f"{llm_url}/v1/chat/completions"
    else:
        api_base = f"{llm_url}/v1/chat/completions"

    payload = {
        "messages": [{"role": "user", "content": req.prompt}],
        "max_tokens": req.max_tokens,
        "stream": True,
        "temperature": 0.7,
    }

    start_time = time_mod.monotonic()
    ttft = None
    token_count = 0
    response_text = ""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", api_base, json=payload) as resp:
                if resp.status_code != 200:
                    body = await resp.aread()
                    raise HTTPException(
                        status_code=502,
                        detail=f"LLM returned {resp.status_code}: {body.decode()[:200]}"
                    )

                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data = line[6:]
                    if data.strip() == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "") or delta.get("reasoning_content", "") or delta.get("reasoning", "")
                        if content:
                            if ttft is None:
                                ttft = time_mod.monotonic() - start_time
                            token_count += 1
                            response_text += content
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue

        total_time = time_mod.monotonic() - start_time
        # tok/s excludes TTFT (generation speed only)
        gen_time = total_time - (ttft or 0)
        tok_per_sec = token_count / gen_time if gen_time > 0 else 0

        return {
            "success": True,
            "backend": backend,
            "tokens": token_count,
            "ttft_ms": round((ttft or 0) * 1000),
            "total_time_ms": round(total_time * 1000),
            "tok_per_sec": round(tok_per_sec, 1),
            "response": response_text[:500],
        }
    except httpx.ConnectError:
        raise HTTPException(status_code=503, detail="Cannot connect to LLM backend")
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="LLM request timed out")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Model test failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/backends/switch")
async def switch_backend(req: SwitchBackendRequest, api_key: str = Depends(verify_api_key)):
    """Switch the active LLM backend via the model-controller sidecar.

    This stops the current backend container (freeing VRAM), updates
    .env with new COMPOSE_FILE and LLM_BACKEND, then runs
    `docker compose up -d --remove-orphans` to start the new backend.
    """
    try:
        payload = {"backend": req.backend}
        if req.model:
            payload["model"] = req.model

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{MODEL_CONTROLLER_URL}/switch-backend",
                json=payload,
                headers=_controller_headers(),
            )
            try:
                data = resp.json()
            except Exception:
                data = {"error": resp.text or "Empty response from controller"}
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=data.get("error", "Controller returned an error"),
                )
            return data
    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail="Model controller is not reachable. Is the service running?",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Controller proxy failed: {e}")


@router.post("/unload")
async def unload_model(api_key: str = Depends(verify_api_key)):
    """Unload the active model from VRAM.

    For Ollama: calls the Ollama API to unload the model.
    For llama-server/vLLM: stops the inference container via model-controller.
    """
    import httpx

    backend = _get_llm_backend()
    llm_url = _get_llm_api_url()

    if backend == "ollama":
        # Ollama: create a short-lived keep_alive=0 request to unload
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{llm_url}/api/generate",
                    json={"model": "", "keep_alive": 0},
                )
                return {"status": "unloaded", "backend": "ollama"}
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Ollama unload failed: {e}")
    else:
        # llama-server / vLLM: stop the container via model-controller
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{MODEL_CONTROLLER_URL}/stop",
                    headers=_controller_headers(),
                )
                data = resp.json()
                if resp.status_code != 200:
                    raise HTTPException(
                        status_code=resp.status_code,
                        detail=data.get("error", "Stop failed"),
                    )
                return {"status": "unloaded", "backend": backend, **data}
        except HTTPException:
            raise
        except httpx.ConnectError:
            raise HTTPException(status_code=503, detail="Model controller not reachable")
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Unload failed: {e}")


class OllamaPullRequest(BaseModel):
    model: str = Field(..., min_length=1, max_length=200)
    tag: Optional[str] = None


# Ollama model names: alphanumeric, hyphens, dots, colons, underscores, slashes
_SAFE_OLLAMA_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$")


def validate_ollama_model(name: str) -> str:
    if not _SAFE_OLLAMA_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid Ollama model name")
    return name


# Track Ollama pull progress in memory
_ollama_pull_status: dict[str, dict] = {}


# --- Ollama Management Endpoints ---
# NOTE: These MUST appear before /{model_id}/* routes to avoid path conflicts


@router.post("/ollama/load")
async def ollama_load_model(req: OllamaPullRequest, api_key: str = Depends(verify_api_key)):
    """Warm an Ollama model into VRAM by triggering a generate with empty prompt."""
    model_name = validate_ollama_model(req.model)
    url = _get_ollama_url()

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            # Use the generate API with keep_alive to warm the model
            resp = await client.post(
                f"{url}/api/generate",
                json={
                    "model": model_name,
                    "prompt": "",
                    "stream": False,
                    "options": {"num_predict": 0},
                },
            )
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found in Ollama")
            resp.raise_for_status()

        return {"status": "loaded", "model": model_name, "message": f"{model_name} loaded into VRAM"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to load model: {e}")


@router.post("/ollama/unload")
async def ollama_unload_model(req: OllamaPullRequest, api_key: str = Depends(verify_api_key)):
    """Unload an Ollama model from VRAM by setting keep_alive to 0."""
    model_name = validate_ollama_model(req.model)
    url = _get_ollama_url()

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{url}/api/generate",
                json={
                    "model": model_name,
                    "prompt": "",
                    "stream": False,
                    "keep_alive": 0,
                },
            )
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found in Ollama")
            resp.raise_for_status()

        return {"status": "unloaded", "model": model_name, "message": f"{model_name} unloaded from VRAM"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to unload model: {e}")


@router.get("/ollama/info")
async def ollama_info(api_key: str = Depends(verify_api_key)):
    """Return Ollama server info: version, running status, cloud subscription hints."""
    url = _get_ollama_url()
    result = {
        "reachable": False,
        "version": None,
        "runningModels": [],
        "modelCount": 0,
        "cloudHints": {
            "hasCloudModels": False,
            "details": None,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Get version
            ver_resp = await client.get(f"{url}/api/version")
            ver_resp.raise_for_status()
            result["reachable"] = True
            result["version"] = ver_resp.json().get("version")

            # Get running models
            ps_resp = await client.get(f"{url}/api/ps")
            ps_resp.raise_for_status()
            ps_data = ps_resp.json()
            running = ps_data.get("models", [])
            result["runningModels"] = [
                {
                    "name": m.get("name"),
                    "size": m.get("size", 0),
                    "vramSize": m.get("size_vram", 0),
                    "processor": m.get("digest", "")[:12],
                }
                for m in running
            ]

            # Get model count
            tags_resp = await client.get(f"{url}/api/tags")
            tags_resp.raise_for_status()
            all_models = tags_resp.json().get("models", [])
            result["modelCount"] = len(all_models)

            # Cloud detection heuristics:
            # 1. Models with "cloud" in the tag
            # 2. Unusually large model count suggests cloud subscription
            cloud_models = [
                m["name"] for m in all_models
                if "cloud" in m.get("name", "").lower()
                or any(
                    tag in m.get("name", "")
                    for tag in [":cloud", "-cloud"]
                )
            ]
            if cloud_models:
                result["cloudHints"]["hasCloudModels"] = True
                result["cloudHints"]["details"] = f"Cloud models detected: {', '.join(cloud_models[:5])}"

    except Exception as e:
        logger.debug("Ollama info check failed: %s", e)

    return result


@router.post("/ollama/pull")
async def ollama_pull(
    req: OllamaPullRequest,
    api_key: str = Depends(verify_api_key),
):
    """Start pulling an Ollama model. Returns immediately; poll /ollama/pull-status for progress."""
    model_name = validate_ollama_model(req.model)
    if req.tag:
        model_name = f"{model_name}:{req.tag}"

    url = _get_ollama_url()

    # Check if already pulling this model
    if model_name in _ollama_pull_status:
        current = _ollama_pull_status[model_name]
        if current.get("status") == "pulling":
            return {"status": "already_pulling", "model": model_name}

    # Initialize status
    _ollama_pull_status[model_name] = {
        "status": "pulling",
        "model": model_name,
        "percent": 0,
        "detail": "Starting pull...",
        "completed": 0,
        "total": 0,
    }

    # Launch background pull task
    async def _do_pull():
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{url}/api/pull",
                    json={"name": model_name, "stream": True},
                ) as stream:
                    async for line in stream.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        status_text = data.get("status", "")
                        total = data.get("total", 0)
                        completed = data.get("completed", 0)
                        pct = round((completed / total) * 100, 1) if total > 0 else 0

                        _ollama_pull_status[model_name] = {
                            "status": "pulling",
                            "model": model_name,
                            "percent": pct,
                            "detail": status_text,
                            "completed": completed,
                            "total": total,
                        }

                        # Final success message
                        if status_text == "success":
                            _ollama_pull_status[model_name] = {
                                "status": "complete",
                                "model": model_name,
                                "percent": 100,
                                "detail": "Pull complete",
                                "completed": total,
                                "total": total,
                            }
        except Exception as e:
            _ollama_pull_status[model_name] = {
                "status": "error",
                "model": model_name,
                "percent": 0,
                "detail": str(e),
                "completed": 0,
                "total": 0,
            }

    asyncio.create_task(_do_pull())

    return {"status": "pulling", "model": model_name, "message": f"Pull started for {model_name}"}


@router.get("/ollama/pull-status")
async def ollama_pull_status(api_key: str = Depends(verify_api_key)):
    """Return current Ollama pull progress for all active/recent pulls."""
    # Clean up completed/errored pulls older than 60 seconds
    active = {}
    for name, status in _ollama_pull_status.items():
        active[name] = status

    return {"pulls": active}


@router.delete("/ollama/{model_name:path}")
async def ollama_delete(model_name: str, api_key: str = Depends(verify_api_key)):
    """Delete an Ollama model."""
    validate_ollama_model(model_name)

    url = _get_ollama_url()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.request(
                "DELETE",
                f"{url}/api/delete",
                json={"name": model_name},
            )
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail=f"Model '{model_name}' not found in Ollama")
            resp.raise_for_status()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Ollama delete failed: {e}")

    return {"status": "deleted", "model": model_name}


# --- Local Model Management ---


@router.post("/custom")
async def add_custom_model(model: CustomModelInput, api_key: str = Depends(verify_api_key)):
    """Add a custom GGUF model entry."""
    models = _load_custom_models()

    # Generate ID from name
    model_id = re.sub(r'[^a-zA-Z0-9]', '-', model.name.lower()).strip('-')[:64]
    if not model_id:
        raise HTTPException(status_code=400, detail="Invalid model name")

    # Check for duplicates (stored IDs have the 'custom:' prefix)
    full_id = f"custom:{model_id}"
    if any(m["id"] == full_id for m in models):
        raise HTTPException(status_code=409, detail=f"Custom model '{model_id}' already exists")

    # Build the model entry
    entry = {
        "id": f"custom:{model_id}",
        "name": model.name,
        "family": model.family,
        "description": model.description or f"Custom model from {model.huggingface_repo}",
        "size_gb": model.size_gb or 0,
        "vram_required_gb": model.vram_required_gb or 0,
        "context_length": model.context_length or 0,
        "quantization": model.quantization,
        "specialty": model.specialty or "General",
        "backends": ["llama-server"],
        "gguf": {
            "filename": model.huggingface_file,
            "huggingface_repo": model.huggingface_repo,
            "huggingface_file": model.huggingface_file,
        },
    }

    models.append(entry)
    _save_custom_models(models)

    return {"status": "added", "model": entry}


@router.get("/custom")
async def list_custom_models(api_key: str = Depends(verify_api_key)):
    """List user-added custom models."""
    return {"models": _load_custom_models()}


@router.delete("/custom/{model_id}")
async def delete_custom_model(model_id: str, api_key: str = Depends(verify_api_key)):
    """Remove a custom model entry (does not delete the file)."""
    models = _load_custom_models()
    full_id = f"custom:{model_id}" if not model_id.startswith("custom:") else model_id
    filtered = [m for m in models if m["id"] != full_id]

    if len(filtered) == len(models):
        raise HTTPException(status_code=404, detail=f"Custom model '{model_id}' not found")

    _save_custom_models(filtered)
    return {"status": "deleted", "model_id": full_id}


@router.post("/{model_id}/download")
async def download_model(model_id: str, api_key: str = Depends(verify_api_key)):
    """Trigger a model download from HuggingFace.

    Supports both GGUF (llama-server) and full-weight (vLLM) models.
    """
    validate_model_id(model_id)

    catalog = load_catalog()
    entry = None
    for m in catalog.get("models", []):
        if m["id"] == model_id:
            entry = m
            break

    if not entry:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found in catalog")

    # Check for active download
    current = get_download_status()
    if current and current.get("status") == "downloading":
        raise HTTPException(status_code=409, detail="Another download is in progress")

    # Determine download type: vLLM HF cache vs GGUF file
    vllm_info = entry.get("vllm", {})
    gguf = entry.get("gguf")

    if vllm_info.get("huggingface_repo"):
        return await _download_vllm_model(model_id, entry, vllm_info)
    elif gguf:
        return await _download_gguf_model(model_id, entry, gguf)
    else:
        raise HTTPException(status_code=400, detail="Model has no download info")

async def _download_gguf_model(model_id: str, entry: dict, gguf: dict):
    """Download a GGUF model file to the models directory."""
    filename = gguf["filename"]
    downloaded = get_downloaded_gguf_files()
    if filename in downloaded:
        raise HTTPException(status_code=409, detail="Model already downloaded")

    repo = gguf.get("huggingface_repo", "")
    hf_file = gguf.get("huggingface_file", filename)
    total_bytes_est = int(entry.get("size_gb", 0) * 1024**3)

    # Write initial status
    write_download_status({
        "status": "downloading",
        "model_id": model_id,
        "model": entry["name"],
        "filename": filename,
        "repo": repo,
        "percent": 0,
        "bytesDownloaded": 0,
        "bytesTotal": total_bytes_est,
        "speedBytesPerSec": 0,
    })

    # Launch background download task
    async def _do_download():
        try:
            MODELS_DIR.mkdir(parents=True, exist_ok=True)

            # Use huggingface-cli to download
            cmd = [
                "huggingface-cli", "download",
                repo, hf_file,
                "--local-dir", str(MODELS_DIR),
                "--local-dir-use-symlinks", "False",
            ]

            logger.info("Starting download: %s", " ".join(cmd))
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Monitor output for progress (huggingface_hub prints to stderr)
            last_percent = 0
            while True:
                line = await proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue

                # Parse progress from huggingface_hub output
                # Typical format: "Downloading model.gguf:  45%|████      | 2.1G/4.7G [01:23<01:42, 25.3MB/s]"
                pct_match = re.search(r"(\d+)%\|", text)
                speed_match = re.search(r"([\d.]+)(MB|GB|KB)/s", text)

                if pct_match:
                    pct = int(pct_match.group(1))
                    if pct > last_percent:
                        last_percent = pct
                        speed = 0
                        if speed_match:
                            val = float(speed_match.group(1))
                            unit = speed_match.group(2)
                            if unit == "GB":
                                speed = int(val * 1024**3)
                            elif unit == "MB":
                                speed = int(val * 1024**2)
                            elif unit == "KB":
                                speed = int(val * 1024)

                        bytes_done = int(total_bytes_est * pct / 100)

                        write_download_status({
                            "status": "downloading",
                            "model_id": model_id,
                            "model": entry["name"],
                            "filename": filename,
                            "repo": repo,
                            "percent": pct,
                            "bytesDownloaded": bytes_done,
                            "bytesTotal": total_bytes_est,
                            "speedBytesPerSec": speed,
                        })

            await proc.wait()

            if proc.returncode == 0:
                # Verify the file exists
                # huggingface-cli may download to a subfolder, try to find it
                actual_file = MODELS_DIR / hf_file
                if not actual_file.exists():
                    # Search for the file recursively
                    found = list(MODELS_DIR.rglob(hf_file))
                    if found:
                        # Move to MODELS_DIR root
                        import shutil
                        shutil.move(str(found[0]), str(MODELS_DIR / filename))

                write_download_status({
                    "status": "complete",
                    "model_id": model_id,
                    "model": entry["name"],
                    "filename": filename,
                    "percent": 100,
                    "bytesDownloaded": total_bytes_est,
                    "bytesTotal": total_bytes_est,
                })
                logger.info("Download complete: %s", filename)
            else:
                stderr_output = ""
                remaining = await proc.stderr.read()
                if remaining:
                    stderr_output = remaining.decode("utf-8", errors="replace")
                write_download_status({
                    "status": "error",
                    "model_id": model_id,
                    "model": entry["name"],
                    "filename": filename,
                    "message": f"Download failed (exit code {proc.returncode}): {stderr_output[:500]}",
                })
                logger.error("Download failed for %s: exit %d", filename, proc.returncode)
        except Exception as e:
            write_download_status({
                "status": "error",
                "model_id": model_id,
                "model": entry["name"],
                "filename": filename,
                "message": str(e),
            })
            logger.exception("Download error for %s", filename)

    asyncio.create_task(_do_download())

    return {
        "status": "downloading",
        "model_id": model_id,
        "filename": filename,
        "message": f"Download started for {entry['name']}",
    }


async def _download_vllm_model(model_id: str, entry: dict, vllm_info: dict):
    """Pre-download a HuggingFace model to the shared HF cache for vLLM.

    Uses `huggingface-cli download <repo>` which downloads full model weights
    to the standard HF cache directory. When vLLM starts with the same model,
    it finds the cached weights and skips the download.
    """
    repo = vllm_info["huggingface_repo"]
    vllm_cached = get_vllm_cached_models()
    if repo in vllm_cached:
        raise HTTPException(status_code=409, detail="Model already cached")

    total_bytes_est = int(entry.get("size_gb", 0) * 1024**3)

    write_download_status({
        "status": "downloading",
        "model_id": model_id,
        "model": entry["name"],
        "filename": repo,
        "repo": repo,
        "percent": 0,
        "bytesDownloaded": 0,
        "bytesTotal": total_bytes_est,
        "speedBytesPerSec": 0,
    })

    async def _do_vllm_download():
        try:
            HF_CACHE_DIR.mkdir(parents=True, exist_ok=True)

            cmd = [
                "huggingface-cli", "download",
                repo,
                "--cache-dir", str(HF_CACHE_DIR),
            ]

            logger.info("Starting vLLM pre-download: %s", " ".join(cmd))
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            last_percent = 0
            while True:
                line = await proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").strip()
                if not text:
                    continue

                pct_match = re.search(r"(\d+)%\|", text)
                speed_match = re.search(r"([\d.]+)(MB|GB|KB)/s", text)

                if pct_match:
                    pct = int(pct_match.group(1))
                    if pct > last_percent:
                        last_percent = pct
                        speed = 0
                        if speed_match:
                            val = float(speed_match.group(1))
                            unit = speed_match.group(2)
                            if unit == "GB":
                                speed = int(val * 1024**3)
                            elif unit == "MB":
                                speed = int(val * 1024**2)
                            elif unit == "KB":
                                speed = int(val * 1024)

                        bytes_done = int(total_bytes_est * pct / 100)

                        write_download_status({
                            "status": "downloading",
                            "model_id": model_id,
                            "model": entry["name"],
                            "filename": repo,
                            "repo": repo,
                            "percent": pct,
                            "bytesDownloaded": bytes_done,
                            "bytesTotal": total_bytes_est,
                            "speedBytesPerSec": speed,
                        })

            await proc.wait()

            if proc.returncode == 0:
                write_download_status({
                    "status": "complete",
                    "model_id": model_id,
                    "model": entry["name"],
                    "filename": repo,
                    "percent": 100,
                    "bytesDownloaded": total_bytes_est,
                    "bytesTotal": total_bytes_est,
                })
                logger.info("vLLM pre-download complete: %s", repo)
            else:
                stderr_output = ""
                remaining = await proc.stderr.read()
                if remaining:
                    stderr_output = remaining.decode("utf-8", errors="replace")
                write_download_status({
                    "status": "error",
                    "model_id": model_id,
                    "model": entry["name"],
                    "filename": repo,
                    "message": f"Download failed (exit code {proc.returncode}): {stderr_output[:500]}",
                })
                logger.error("vLLM pre-download failed for %s: exit %d", repo, proc.returncode)
        except Exception as e:
            write_download_status({
                "status": "error",
                "model_id": model_id,
                "model": entry["name"],
                "filename": repo,
                "message": str(e),
            })
            logger.exception("vLLM pre-download error for %s", repo)

    asyncio.create_task(_do_vllm_download())

    return {
        "status": "downloading",
        "model_id": model_id,
        "filename": repo,
        "message": f"Pre-downloading {entry['name']} to HF cache for vLLM",
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


# --- Download Proxy (delegates to model-controller) ---

MODEL_CONTROLLER_URL = os.getenv("MODEL_CONTROLLER_URL", "http://model-controller:3003")

@router.post("/download")
async def proxy_download(request: Request, api_key: str = Depends(verify_api_key)):
    """Proxy download request to the model-controller.

    The model-controller handles all downloading (GGUF via fetch, vLLM via restart,
    Ollama via pull API) with WebSocket progress streaming.
    """
    import httpx
    body = await request.json()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{MODEL_CONTROLLER_URL}/download",
                json=body,
            )
            return JSONResponse(content=resp.json(), status_code=resp.status_code)
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="Model controller not reachable")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Proxy error: {e}")


@router.get("/download/jobs")
async def proxy_get_downloads(api_key: str = Depends(verify_api_key)):
    """Proxy download list request to the model-controller."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{MODEL_CONTROLLER_URL}/downloads")
            return JSONResponse(content=resp.json(), status_code=resp.status_code)
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="Model controller not reachable")


@router.delete("/download/{job_id}")
async def proxy_cancel_download(job_id: str, api_key: str = Depends(verify_api_key)):
    """Proxy download cancellation to the model-controller."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.delete(f"{MODEL_CONTROLLER_URL}/downloads/{job_id}")
            return JSONResponse(content=resp.json(), status_code=resp.status_code)
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail="Model controller not reachable")


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



@router.post("/providers/{provider_id}/test-connection")
async def test_provider_connection(provider_id: str, api_key: str = Depends(verify_api_key)):
    """Test a cloud provider API key by making a minimal API call."""
    validate_provider_id(provider_id)

    configs = load_provider_configs()
    provider_config = configs.get(provider_id)
    if not provider_config:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not configured")

    key = provider_config.get("api_key", "")
    catalog = load_catalog()
    provider_info = next((p for p in catalog.get("providers", []) if p["id"] == provider_id), None)

    if not provider_info:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not in catalog")

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            if provider_id == "openai":
                resp = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
                if resp.status_code == 401:
                    return {"status": "error", "message": "Invalid API key"}
                resp.raise_for_status()
                models = resp.json().get("data", [])
                return {"status": "ok", "message": f"Connected — {len(models)} models available"}

            elif provider_id == "anthropic":
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": key,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "claude-haiku-4.5-20251022",
                        "max_tokens": 1,
                        "messages": [{"role": "user", "content": "ping"}],
                    },
                )
                if resp.status_code == 401:
                    return {"status": "error", "message": "Invalid API key"}
                # 200 or 400 (valid key, maybe wrong model) = success
                if resp.status_code in (200, 400):
                    return {"status": "ok", "message": "API key valid — connected to Anthropic"}
                resp.raise_for_status()
                return {"status": "ok", "message": "Connected to Anthropic"}

            elif provider_id == "google":
                resp = await client.get(
                    f"https://generativelanguage.googleapis.com/v1beta/models?key={key}",
                )
                if resp.status_code == 400 or resp.status_code == 403:
                    return {"status": "error", "message": "Invalid API key"}
                resp.raise_for_status()
                models = resp.json().get("models", [])
                return {"status": "ok", "message": f"Connected — {len(models)} models available"}

            else:
                return {"status": "error", "message": f"Test not supported for '{provider_id}'"}

    except httpx.TimeoutException:
        return {"status": "error", "message": "Connection timed out"}
    except Exception as e:
        return {"status": "error", "message": f"Connection failed: {str(e)[:200]}"}
