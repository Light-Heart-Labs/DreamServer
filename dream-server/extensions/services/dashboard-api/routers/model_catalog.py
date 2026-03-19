"""Model catalog and local model management endpoints for the dashboard."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from config import DATA_DIR, INSTALL_DIR
from gpu import get_gpu_info
from helpers import get_bootstrap_status, get_loaded_model
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["models"])

MODELS_DIR = Path(DATA_DIR) / "models"
ENV_FILE = Path(INSTALL_DIR) / ".env"
DOWNLOAD_STATUS_FILE = Path(DATA_DIR) / "bootstrap-status.json"
DOWNLOAD_CHUNK_SIZE = 1024 * 1024

MODEL_CATALOG: list[dict[str, Any]] = [
    {
        "id": "qwen3.5-2b",
        "name": "Qwen3.5 2B",
        "gguf_file": "Qwen3.5-2B-Q4_K_M.gguf",
        "llm_model": "qwen3.5-2b",
        "download_url": "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf",
        "sizeGb": 1.8,
        "vramRequired": 2,
        "contextLength": 16384,
        "specialty": "Bootstrap",
        "description": "Small bootstrap model for instant startup and low-memory systems.",
        "tokensPerSec": 140,
        "quantization": "Q4_K_M",
    },
    {
        "id": "qwen3-4b",
        "name": "Qwen3 4B",
        "gguf_file": "Qwen3-4B-Q4_K_M.gguf",
        "llm_model": "qwen3-4b",
        "download_url": "https://huggingface.co/unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
        "sizeGb": 3.2,
        "vramRequired": 4,
        "contextLength": 16384,
        "specialty": "Fast",
        "description": "Fast local model for entry-level Apple Silicon and small GPUs.",
        "tokensPerSec": 110,
        "quantization": "Q4_K_M",
    },
    {
        "id": "qwen3-8b",
        "name": "Qwen3 8B",
        "gguf_file": "Qwen3-8B-Q4_K_M.gguf",
        "llm_model": "qwen3-8b",
        "download_url": "https://huggingface.co/unsloth/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf",
        "sizeGb": 5.4,
        "vramRequired": 8,
        "contextLength": 32768,
        "specialty": "General",
        "description": "Balanced default model for most Dream Server installs.",
        "tokensPerSec": 75,
        "quantization": "Q4_K_M",
    },
    {
        "id": "qwen3-30b-a3b",
        "name": "Qwen3 30B-A3B",
        "gguf_file": "Qwen3-30B-A3B-Q4_K_M.gguf",
        "llm_model": "qwen3-30b-a3b",
        "download_url": "https://huggingface.co/unsloth/Qwen3-30B-A3B-GGUF/resolve/main/Qwen3-30B-A3B-Q4_K_M.gguf",
        "sizeGb": 18.5,
        "vramRequired": 24,
        "contextLength": 32768,
        "specialty": "Balanced",
        "description": "High-quality MoE model for prosumer GPUs and unified-memory systems.",
        "tokensPerSec": 38,
        "quantization": "Q4_K_M",
    },
    {
        "id": "qwen3-coder-next",
        "name": "Qwen3 Coder Next",
        "gguf_file": "qwen3-coder-next-Q4_K_M.gguf",
        "llm_model": "qwen3-coder-next",
        "download_url": "https://huggingface.co/unsloth/Qwen3-Coder-Next-GGUF/resolve/main/Qwen3-Coder-Next-Q4_K_M.gguf",
        "sizeGb": 45.0,
        "vramRequired": 80,
        "contextLength": 131072,
        "specialty": "Code",
        "description": "Flagship coding model for large-memory workstations and clusters.",
        "tokensPerSec": 22,
        "quantization": "Q4_K_M",
    },
]


def _load_env_settings() -> dict[str, str]:
    values: dict[str, str] = {}
    if not ENV_FILE.exists():
        return values
    try:
        for line in ENV_FILE.read_text().splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    except OSError:
        logger.warning("Failed to read env file %s", ENV_FILE)
    return values


def _write_env_settings(updates: dict[str, str]) -> None:
    env_lines: list[str] = []
    if ENV_FILE.exists():
        env_lines = ENV_FILE.read_text().splitlines()

    seen: set[str] = set()
    new_lines: list[str] = []
    for line in env_lines:
        if "=" not in line or line.lstrip().startswith("#"):
            new_lines.append(line)
            continue
        key, _ = line.split("=", 1)
        key = key.strip()
        if key in updates:
            new_lines.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            new_lines.append(line)

    for key, value in updates.items():
        if key not in seen:
            new_lines.append(f"{key}={value}")

    ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    ENV_FILE.write_text("\n".join(new_lines).rstrip() + "\n")


def _resolve_model_lookup() -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for model in MODEL_CATALOG:
        lookup[model["id"]] = model
        lookup[model["llm_model"]] = model
        lookup[model["gguf_file"]] = model
    return lookup


MODEL_LOOKUP = _resolve_model_lookup()


def _status_from_bootstrap_file() -> dict[str, Any]:
    if not DOWNLOAD_STATUS_FILE.exists():
        return {"status": "idle"}

    try:
        raw = json.loads(DOWNLOAD_STATUS_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return {"status": "idle"}

    if not isinstance(raw, dict):
        return {"status": "idle"}

    status = raw.get("status") or "idle"
    if status == "complete":
        return {"status": "complete", **raw}
    if status == "error":
        return {"status": "error", **raw}
    if status in {"downloading", "queued"}:
        return {"status": status, **raw}
    return {"status": "idle"}


def _write_download_status(payload: dict[str, Any]) -> None:
    DOWNLOAD_STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    DOWNLOAD_STATUS_FILE.write_text(json.dumps(payload, indent=2))


def _download_model_artifact(model: dict[str, Any]) -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    target = MODELS_DIR / model["gguf_file"]
    temp = target.with_suffix(target.suffix + ".part")

    try:
        with urllib.request.urlopen(model["download_url"]) as response:
            total = int(response.headers.get("Content-Length") or 0)
            downloaded = 0
            _write_download_status(
                {
                    "status": "downloading",
                    "model": model["id"],
                    "percent": 0,
                    "bytesDownloaded": 0,
                    "bytesTotal": total,
                    "speedBytesPerSec": 0,
                }
            )

            with temp.open("wb") as handle:
                while True:
                    chunk = response.read(DOWNLOAD_CHUNK_SIZE)
                    if not chunk:
                        break
                    handle.write(chunk)
                    downloaded += len(chunk)
                    percent = round((downloaded / total) * 100, 1) if total else 0
                    _write_download_status(
                        {
                            "status": "downloading",
                            "model": model["id"],
                            "percent": percent,
                            "bytesDownloaded": downloaded,
                            "bytesTotal": total,
                            "speedBytesPerSec": 0,
                        }
                    )
        temp.replace(target)
        _write_download_status({"status": "complete", "model": model["id"]})
    except Exception as exc:  # pragma: no cover - exercised via endpoint contract
        logger.exception("Model download failed for %s", model["id"])
        try:
            if temp.exists():
                temp.unlink()
        except OSError:
            pass
        _write_download_status({"status": "error", "model": model["id"], "message": str(exc)})


async def _start_download(model: dict[str, Any]) -> None:
    await asyncio.to_thread(_download_model_artifact, model)


async def get_model_catalog_payload() -> dict[str, Any]:
    env = await asyncio.to_thread(_load_env_settings)
    gpu_info = await asyncio.to_thread(get_gpu_info)
    loaded_model = await get_loaded_model()

    configured_model = env.get("LLM_MODEL")
    configured_file = env.get("GGUF_FILE")
    current_ref = loaded_model or configured_model or configured_file
    current_model = MODEL_LOOKUP.get(current_ref or "")

    models = []
    vram_total = round((gpu_info.memory_total_mb / 1024), 1) if gpu_info else 0
    vram_used = round((gpu_info.memory_used_mb / 1024), 1) if gpu_info else 0
    vram_free = round(max(vram_total - vram_used, 0), 1) if gpu_info else 0

    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    for model in MODEL_CATALOG:
        file_path = MODELS_DIR / model["gguf_file"]
        downloaded = file_path.exists()
        active = current_model and current_model["id"] == model["id"]
        models.append(
            {
                "id": model["id"],
                "name": model["name"],
                "size": f'{model["sizeGb"]:.1f} GB',
                "sizeGb": model["sizeGb"],
                "vramRequired": model["vramRequired"],
                "contextLength": model["contextLength"],
                "specialty": model["specialty"],
                "description": model["description"],
                "tokensPerSec": model["tokensPerSec"],
                "quantization": model["quantization"],
                "status": "loaded" if active else "downloaded" if downloaded else "available",
                "fitsVram": not gpu_info or vram_total >= model["vramRequired"],
                "fitsCurrentVram": not gpu_info or vram_free >= model["vramRequired"],
            }
        )

    return {
        "models": models,
        "gpu": {
            "vramTotal": vram_total,
            "vramUsed": vram_used,
            "vramFree": vram_free,
        }
        if gpu_info
        else None,
        "currentModel": current_model["id"] if current_model else current_ref,
    }


@router.get("/api/models")
async def list_models(api_key: str = Depends(verify_api_key)):
    """Return the dashboard model catalog and local status."""
    return await get_model_catalog_payload()


@router.get("/api/models/download-status")
async def model_download_status(api_key: str = Depends(verify_api_key)):
    """Expose bootstrap/download progress to the dashboard."""
    bootstrap = await asyncio.to_thread(get_bootstrap_status)
    if bootstrap.active:
        return {
            "status": "downloading",
            "model": bootstrap.model_name,
            "percent": bootstrap.percent,
            "bytesDownloaded": int((bootstrap.downloaded_gb or 0) * 1024**3),
            "bytesTotal": int((bootstrap.total_gb or 0) * 1024**3),
            "speedBytesPerSec": int((bootstrap.speed_mbps or 0) * 1024 * 1024),
            "eta": bootstrap.eta_seconds,
        }
    return _status_from_bootstrap_file()


@router.post("/api/models/{model_id}/download")
async def download_model(
    model_id: str,
    background_tasks: BackgroundTasks,
    api_key: str = Depends(verify_api_key),
):
    """Start downloading a model artifact into the local models directory."""
    model = MODEL_LOOKUP.get(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Unknown model: {model_id}")

    existing = _status_from_bootstrap_file()
    if existing.get("status") in {"queued", "downloading"}:
        raise HTTPException(status_code=409, detail="Another model download is already in progress")

    target = MODELS_DIR / model["gguf_file"]
    if target.exists():
        return {"success": True, "status": "downloaded", "model": model["id"]}

    _write_download_status({"status": "queued", "model": model["id"]})
    background_tasks.add_task(_start_download, model)
    return {"success": True, "status": "queued", "model": model["id"]}


@router.post("/api/models/{model_id}/load")
async def load_model(model_id: str, api_key: str = Depends(verify_api_key)):
    """Set the desired model in `.env` for the next llama-server restart."""
    model = MODEL_LOOKUP.get(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Unknown model: {model_id}")

    target = MODELS_DIR / model["gguf_file"]
    if not target.exists():
        raise HTTPException(status_code=404, detail="Model file is not downloaded yet")

    await asyncio.to_thread(
        _write_env_settings,
        {"GGUF_FILE": model["gguf_file"], "LLM_MODEL": model["llm_model"]},
    )
    return {
        "success": True,
        "model": model["id"],
        "message": "Model selection saved. Restart llama-server to apply the change.",
    }


@router.delete("/api/models/{model_id}")
async def delete_model(model_id: str, api_key: str = Depends(verify_api_key)):
    """Delete a locally downloaded model artifact."""
    model = MODEL_LOOKUP.get(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Unknown model: {model_id}")

    env = await asyncio.to_thread(_load_env_settings)
    configured = env.get("LLM_MODEL")
    if configured == model["llm_model"]:
        raise HTTPException(status_code=409, detail="Cannot delete the active configured model")

    target = MODELS_DIR / model["gguf_file"]
    if not target.exists():
        raise HTTPException(status_code=404, detail="Model file is not present")

    try:
        target.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete model: {exc}") from exc

    part = target.with_suffix(target.suffix + ".part")
    if part.exists():
        try:
            part.unlink()
        except OSError:
            logger.warning("Failed to clean partial download for %s", model["id"])

    return {"success": True, "model": model["id"]}
