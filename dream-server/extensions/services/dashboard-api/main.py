#!/usr/bin/env python3
"""
Dream Server Dashboard API
Lightweight backend providing system status for the Dashboard UI.

Default port: DASHBOARD_API_PORT (3002)

Modules:
  config.py       — Shared configuration and manifest loading
  models.py       — Pydantic response schemas
  security.py     — API key authentication
  gpu.py          — GPU detection (NVIDIA + AMD)
  helpers.py      — Service health, LLM metrics, system metrics
  routers/        — Endpoint modules (workflows, features, setup, updates, agents, privacy)
"""

import asyncio
import json
import logging
import os
import re
import socket
import shutil
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, Depends, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware

# --- Local modules ---
from config import (
    SERVICES, DATA_DIR, INSTALL_DIR, SIDEBAR_ICONS, MANIFEST_ERRORS,
    AGENT_URL, DREAM_AGENT_KEY,
)
from models import (
    GPUInfo, ServiceStatus, DiskUsage, ModelInfo, BootstrapStatus,
    FullStatus, PortCheckRequest,
)
from security import verify_api_key
from gpu import get_gpu_info
from helpers import (
    get_all_services, get_cached_services, set_services_cache,
    get_disk_usage, dir_size_gb, get_model_info, get_bootstrap_status,
    get_uptime, get_cpu_metrics, get_ram_metrics,
    get_llama_metrics, get_loaded_model, get_llama_context_size,
)
from agent_monitor import collect_metrics
from routers import (
    workflows, features, setup, updates, agents, privacy, extensions,
    gpu as gpu_router, resources, voice, models as models_router, templates,
)


# ================================================================
# TTL Cache — avoids redundant subprocess/IO calls every poll cycle
# ================================================================

class TTLCache:
    """Simple in-memory cache with per-key TTL (seconds)."""

    def __init__(self):
        self._store: dict[str, tuple[float, object]] = {}

    def get(self, key: str) -> object | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: object, ttl: float):
        self._store[key] = (time.monotonic() + ttl, value)


_cache = TTLCache()

# Cache TTLs (seconds)
_GPU_CACHE_TTL = 3.0
_STATUS_CACHE_TTL = 2.0
_STORAGE_CACHE_TTL = 30.0
_SETTINGS_SUMMARY_CACHE_TTL = 5.0
_SETTINGS_CONFIG_CACHE_TTL = 15.0
_SETTINGS_ENV_CACHE_TTL = 5.0
_SERVICE_POLL_INTERVAL = 10.0  # background health check interval

_ENV_ASSIGNMENT_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
_ENV_COMMENTED_ASSIGNMENT_RE = re.compile(r"^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$")
_SENSITIVE_ENV_KEY_RE = re.compile(
    r"(SECRET|TOKEN|PASSWORD|(?:^|_)PASS(?:$|_)|API_KEY|PRIVATE_KEY|ENCRYPTION_KEY|(?:^|_)SALT(?:$|_))"
)
_SETTINGS_APPLY_ALLOWED_SERVICES = frozenset({
    "llama-server", "open-webui", "litellm", "langfuse", "n8n",
    "openclaw", "opencode", "perplexica", "searxng", "qdrant",
    "tts", "whisper", "embeddings", "token-spy", "comfyui",
    "ape", "privacy-shield", "dreamforge",
})
_LLAMA_APPLY_KEYS = {
    "CTX_SIZE", "MAX_CONTEXT", "GGUF_FILE", "GGUF_URL", "GGUF_SHA256",
    "LLM_MODEL", "LLM_MODEL_SIZE_MB", "LLM_BACKEND", "N_GPU_LAYERS", "GPU_BACKEND",
    "OLLAMA_PORT", "OLLAMA_URL", "LLM_API_URL", "MODEL_PROFILE",
}
_OPEN_WEBUI_APPLY_KEYS = {
    "ENABLE_IMAGE_GENERATION", "IMAGE_GENERATION_ENGINE", "IMAGE_SIZE",
    "IMAGE_STEPS", "IMAGE_GENERATION_MODEL", "COMFYUI_BASE_URL",
    "COMFYUI_WORKFLOW", "COMFYUI_WORKFLOW_NODES", "AUDIO_STT_ENGINE",
    "AUDIO_STT_OPENAI_API_BASE_URL", "AUDIO_STT_OPENAI_API_KEY",
    "AUDIO_STT_MODEL", "AUDIO_TTS_ENGINE", "AUDIO_TTS_OPENAI_API_BASE_URL",
    "AUDIO_TTS_OPENAI_API_KEY", "AUDIO_TTS_MODEL", "AUDIO_TTS_VOICE",
}
_TOKEN_SPY_APPLY_KEYS = {
    "TOKEN_SPY_URL", "TOKEN_SPY_API_KEY",
}
_PRIVACY_SHIELD_APPLY_KEYS = {
    "TARGET_API_URL", "PII_CACHE_ENABLED", "SHIELD_PORT",
}
_MANUAL_RESTART_KEYS = {
    "DASHBOARD_API_KEY", "DREAM_AGENT_KEY", "DASHBOARD_PORT",
    "DASHBOARD_API_PORT", "DREAM_AGENT_PORT", "DREAM_AGENT_HOST",
}

logger = logging.getLogger(__name__)


def _resolve_install_root() -> Path:
    host_root = Path("/dream-server")
    if host_root.exists():
        return host_root
    return Path(INSTALL_DIR)


def _read_installed_version() -> str:
    install_root = _resolve_install_root()
    env_file = install_root / ".env"
    if env_file.exists():
        try:
            for line in env_file.read_text().splitlines():
                if line.startswith("DREAM_VERSION="):
                    return line.split("=", 1)[1].strip().strip("\"'")
        except OSError:
            pass

    version_file = install_root / ".version"
    if version_file.exists():
        try:
            raw = version_file.read_text().strip()
            if raw:
                return raw
        except OSError:
            pass

    manifest_file = install_root / "manifest.json"
    if manifest_file.exists():
        try:
            data = json.loads(manifest_file.read_text())
            version = (
                data.get("release", {}).get("version")
                or data.get("dream_version")
                or data.get("manifestVersion")
            )
            if version:
                return str(version)
        except (OSError, json.JSONDecodeError, ValueError, AttributeError):
            pass

    return app.version


def _normalize_timestamp_precision(timestamp: str) -> str:
    match = re.match(r"^(.*?\.\d{6})\d+(.*)$", timestamp)
    if match:
        return f"{match.group(1)}{match.group(2)}"
    return timestamp


def _read_install_date() -> Optional[str]:
    install_root = _resolve_install_root()
    env_file = install_root / ".env"
    if env_file.exists():
        try:
            for line in env_file.read_text(encoding="utf-8").splitlines()[:8]:
                if line.startswith("# Generated by ") and " on " in line:
                    raw_timestamp = line.split(" on ", 1)[1].strip()
                    normalized = _normalize_timestamp_precision(raw_timestamp)
                    try:
                        return datetime.fromisoformat(normalized).isoformat()
                    except ValueError:
                        return raw_timestamp
        except OSError:
            pass

    for candidate in (
        env_file,
        install_root / ".version",
        install_root / "manifest.json",
    ):
        if candidate.exists():
            try:
                return datetime.fromtimestamp(candidate.stat().st_mtime, tz=timezone.utc).isoformat()
            except OSError:
                continue

    return None


def _infer_tier(gpu_info) -> str:
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


def _serialize_gpu(gpu_info) -> Optional[dict]:
    if not gpu_info:
        return None

    gpu_count = 1
    gpu_count_env = os.environ.get("GPU_COUNT", "")
    if gpu_count_env.isdigit():
        gpu_count = int(gpu_count_env)
    elif " × " in gpu_info.name:
        try:
            gpu_count = int(gpu_info.name.rsplit(" × ", 1)[-1])
        except ValueError:
            pass
    elif " + " in gpu_info.name:
        gpu_count = gpu_info.name.count(" + ") + 1

    gpu_data = {
        "name": gpu_info.name,
        "vramUsed": round(gpu_info.memory_used_mb / 1024, 1),
        "vramTotal": round(gpu_info.memory_total_mb / 1024, 1),
        "utilization": gpu_info.utilization_percent,
        "temperature": gpu_info.temperature_c,
        "memoryType": gpu_info.memory_type,
        "backend": gpu_info.gpu_backend,
        "gpu_count": gpu_count,
        "memoryLabel": "VRAM Partition" if gpu_info.memory_type == "unified" else "VRAM",
    }
    if gpu_info.power_w is not None:
        gpu_data["powerDraw"] = gpu_info.power_w
    return gpu_data


def _serialize_model(model_info) -> Optional[dict]:
    if not model_info:
        return None
    return {
        "name": model_info.name,
        "contextLength": model_info.context_length,
    }


def _serialize_services(service_statuses: list[ServiceStatus], uptime: int) -> list[dict]:
    return [
        {
            "name": service.name,
            "status": service.status,
            "port": service.external_port,
            "uptime": uptime if service.status == "healthy" else None,
        }
        for service in service_statuses
    ]


def _fallback_services() -> list[dict]:
    links = []
    for service_id, config in SERVICES.items():
        external_port = config.get("external_port", config.get("port", 0))
        if not external_port:
            continue
        links.append({
            "name": config.get("name", service_id),
            "status": "unknown",
            "port": external_port,
            "uptime": None,
        })
    return links


def _resolve_runtime_env_path() -> Path:
    install_root = _resolve_install_root()
    env_path = install_root / ".env"
    if env_path.exists():
        return env_path
    return Path(INSTALL_DIR) / ".env"


def _resolve_bundled_path(name: str) -> Path:
    return Path(__file__).resolve().parent / name


def _resolve_template_path(name: str) -> Path:
    install_root = _resolve_install_root()
    for candidate in (
        install_root / name,
        _resolve_bundled_path(name),
        Path(INSTALL_DIR) / name,
    ):
        if candidate.exists():
            return candidate
    return _resolve_bundled_path(name)


def _strip_env_quotes(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def _read_env_map_from_path(path: Path) -> tuple[dict[str, str], list[dict[str, Any]]]:
    try:
        return _parse_env_text(path.read_text(encoding="utf-8"))
    except OSError:
        return {}, []


def _parse_env_text(raw_text: str) -> tuple[dict[str, str], list[dict[str, Any]]]:
    values: dict[str, str] = {}
    issues: list[dict[str, Any]] = []

    for index, line in enumerate(raw_text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue

        match = _ENV_ASSIGNMENT_RE.match(line)
        if not match:
            issues.append({
                "key": None,
                "line": index,
                "message": "Line is not a valid KEY=value entry.",
            })
            continue

        key, value = match.groups()
        values[key] = _strip_env_quotes(value)

    return values, issues


def _normalize_bool(value: Any) -> Optional[str]:
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value).strip().lower()
    if text in {"true", "1", "yes", "on"}:
        return "true"
    if text in {"false", "0", "no", "off"}:
        return "false"
    return None


def _humanize_env_key(key: str) -> str:
    return key.replace("_", " ").title().replace("Llm", "LLM").replace("Api", "API").replace("Gpu", "GPU")


def _is_secret_field(key: str, definition: Optional[dict[str, Any]] = None) -> bool:
    if definition is not None and "secret" in definition:
        return bool(definition.get("secret"))

    upper_key = key.upper()
    if "PUBLIC_KEY" in upper_key:
        return False
    return bool(_SENSITIVE_ENV_KEY_RE.search(upper_key))


def _slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def _load_env_schema() -> tuple[dict[str, Any], set[str]]:
    schema_path = _resolve_template_path(".env.schema.json")
    if not schema_path.exists():
        return {}, set()

    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return {}, set()

    properties = schema.get("properties", {})
    required = set(schema.get("required", []))
    if not isinstance(properties, dict):
        properties = {}
    return properties, required


def _build_env_sections(schema_keys: list[str]) -> list[dict[str, Any]]:
    example_path = _resolve_template_path(".env.example")
    if not example_path.exists():
        return [{
            "id": "configuration",
            "title": "Configuration",
            "keys": schema_keys,
        }]

    try:
        lines = example_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return [{
            "id": "configuration",
            "title": "Configuration",
            "keys": schema_keys,
        }]

    sections: list[dict[str, Any]] = []
    section_index: dict[str, dict[str, Any]] = {}
    current = {"id": "configuration", "title": "Configuration", "keys": []}
    sections.append(current)
    section_index[current["id"]] = current

    def ensure_section(title: str) -> dict[str, Any]:
        slug = _slugify(title) or "configuration"
        if slug in section_index:
            return section_index[slug]
        section = {"id": slug, "title": title, "keys": []}
        sections.append(section)
        section_index[slug] = section
        return section

    idx = 0
    while idx < len(lines):
        if (
            idx + 2 < len(lines)
            and lines[idx].lstrip().startswith("#")
            and set(lines[idx].replace("#", "").strip()) <= {"═"}
            and lines[idx + 1].lstrip().startswith("#")
            and set(lines[idx + 2].replace("#", "").strip()) <= {"═"}
        ):
            title = lines[idx + 1].lstrip("#").strip()
            if title:
                current = ensure_section(title)
            idx += 3
            continue

        match = _ENV_ASSIGNMENT_RE.match(lines[idx]) or _ENV_COMMENTED_ASSIGNMENT_RE.match(lines[idx])
        if match:
            key = match.group(1)
            if key in schema_keys and key not in current["keys"]:
                current["keys"].append(key)
        idx += 1

    remaining = [key for key in schema_keys if not any(key in section["keys"] for section in sections)]
    if remaining:
        extra = ensure_section("Advanced")
        extra["keys"].extend(remaining)

    return [section for section in sections if section["keys"]]


def _build_env_fields(
    schema_properties: dict[str, Any],
    required_keys: set[str],
    values: dict[str, str],
) -> dict[str, dict[str, Any]]:
    fields: dict[str, dict[str, Any]] = {}

    for key, definition in schema_properties.items():
        field_type = definition.get("type", "string")
        value = values.get(key, "")
        fields[key] = {
            "key": key,
            "label": _humanize_env_key(key),
            "type": field_type,
            "description": definition.get("description", ""),
            "required": key in required_keys,
            "secret": _is_secret_field(key, definition),
            "enum": definition.get("enum", []),
            "default": definition.get("default"),
            "value": value,
            "hasValue": value != "",
        }

    for key, value in values.items():
        if key in fields:
            fields[key]["value"] = value
            fields[key]["hasValue"] = value != ""
            continue
        fields[key] = {
            "key": key,
            "label": _humanize_env_key(key),
            "type": "string",
            "description": "Local override not described by the built-in schema.",
            "required": False,
            "secret": _is_secret_field(key),
            "enum": [],
            "default": None,
            "value": value,
            "hasValue": value != "",
        }

    return fields


def _validate_env_values(
    values: dict[str, str],
    fields: dict[str, dict[str, Any]],
    parse_issues: Optional[list[dict[str, Any]]] = None,
) -> list[dict[str, Any]]:
    issues = list(parse_issues or [])

    for key, field in fields.items():
        value = values.get(key, "")
        field_type = field.get("type", "string")
        required = field.get("required", False)
        enum_values = field.get("enum") or []

        if value == "":
            if required:
                issues.append({"key": key, "message": "Required value is missing."})
            continue

        if enum_values and value not in enum_values:
            issues.append({"key": key, "message": f"Must be one of: {', '.join(enum_values)}."})
            continue

        if field_type == "integer":
            try:
                int(str(value).strip())
            except (TypeError, ValueError):
                issues.append({"key": key, "message": "Must be a whole number."})
        elif field_type == "boolean":
            if _normalize_bool(value) is None:
                issues.append({"key": key, "message": "Must be true or false."})

    return issues


def _serialize_form_values(
    raw_values: dict[str, Any],
    fields: dict[str, dict[str, Any]],
    current_values: Optional[dict[str, str]] = None,
) -> dict[str, str]:
    serialized: dict[str, str] = {}
    current_values = current_values or {}

    for key, field in fields.items():
        value = raw_values.get(key, current_values.get(key, ""))
        # Reject newlines and null bytes to prevent .env injection
        if value is not None and any(c in str(value) for c in ("\n", "\r", "\0")):
            raise HTTPException(
                status_code=400,
                detail=f"Value for '{key}' contains invalid characters (newlines or null bytes are not allowed)",
            )
        if value is None:
            serialized[key] = current_values.get(key, "") if field.get("secret") else ""
            continue

        field_type = field.get("type", "string")
        if field.get("secret") and str(value).strip() == "":
            serialized[key] = current_values.get(key, "")
            continue
        if field_type == "boolean":
            normalized = _normalize_bool(value)
            serialized[key] = normalized if normalized is not None else str(value).strip()
        elif field_type == "integer":
            serialized[key] = str(value).strip()
        else:
            serialized[key] = str(value)

    return serialized


def _match_apply_service(key: str) -> Optional[str]:
    if key in _LLAMA_APPLY_KEYS or key.startswith(("LLAMA_", "GGUF_")):
        return "llama-server"
    if (
        key in _OPEN_WEBUI_APPLY_KEYS
        or key.startswith("WEBUI_")
        or key.startswith("OPENAI_API_")
        or key.startswith("SEARXNG_")
    ):
        return "open-webui"
    if key in _TOKEN_SPY_APPLY_KEYS or key.startswith("TOKEN_SPY_"):
        return "token-spy"
    if key in _PRIVACY_SHIELD_APPLY_KEYS or key.startswith("SHIELD_"):
        return "privacy-shield"
    if key.startswith("LITELLM_"):
        return "litellm"
    if key.startswith("LANGFUSE_"):
        return "langfuse"
    if key.startswith("N8N_"):
        return "n8n"
    if key.startswith("COMFYUI_"):
        return "comfyui"
    if key.startswith("WHISPER_"):
        return "whisper"
    if key.startswith("QDRANT_"):
        return "qdrant"
    if key.startswith("TTS_") or key.startswith("KOKORO_"):
        return "tts"
    if key.startswith("EMBEDDINGS_"):
        return "embeddings"
    if key.startswith("PERPLEXICA_"):
        return "perplexica"
    if key.startswith("APE_"):
        return "ape"
    return None


def _build_apply_summary(services: list[str], manual_keys: list[str]) -> str:
    if services and manual_keys:
        return (
            f"Saved changes can be applied now to {', '.join(services)}. "
            f"Other keys still need a broader manual restart: {', '.join(manual_keys)}."
        )
    if services:
        return f"Saved changes are ready to apply to {', '.join(services)}."
    if manual_keys:
        return (
            "Saved changes were written to .env, but these keys still need a manual stack restart: "
            + ", ".join(manual_keys)
            + "."
        )
    return "No service recreation is required for the saved keys."


def _compute_env_apply_plan(previous_values: dict[str, str], next_values: dict[str, str]) -> dict[str, Any]:
    changed_keys = sorted(
        key for key in set(previous_values) | set(next_values)
        if previous_values.get(key, "") != next_values.get(key, "")
    )
    services: set[str] = set()
    manual_keys: list[str] = []

    for key in changed_keys:
        service = _match_apply_service(key)
        if service and service in _SETTINGS_APPLY_ALLOWED_SERVICES:
            services.add(service)
            continue
        if key in _MANUAL_RESTART_KEYS or key.startswith("DREAM_AGENT_"):
            manual_keys.append(key)
            continue
        if key not in {"TZ", "TIMEZONE"}:
            manual_keys.append(key)

    services_list = sorted(services)
    manual_list = sorted(set(manual_keys))
    if not changed_keys:
        status = "none"
    elif services_list and manual_list:
        status = "partial"
    elif services_list:
        status = "ready"
    else:
        status = "manual"

    return {
        "status": status,
        "changedKeys": changed_keys,
        "services": services_list,
        "manualKeys": manual_list,
        "supported": bool(services_list),
        "summary": _build_apply_summary(services_list, manual_list),
    }


def _render_env_from_values(values: dict[str, str]) -> str:
    example_path = _resolve_template_path(".env.example")
    seen: set[str] = set()
    output_lines: list[str] = []

    if example_path.exists():
        try:
            example_lines = example_path.read_text(encoding="utf-8").splitlines()
        except OSError:
            example_lines = []
    else:
        example_lines = []

    for line in example_lines:
        assignment = _ENV_ASSIGNMENT_RE.match(line)
        commented_assignment = _ENV_COMMENTED_ASSIGNMENT_RE.match(line)

        if assignment:
            key = assignment.group(1)
            output_lines.append(f"{key}={values.get(key, '')}")
            seen.add(key)
            continue

        if commented_assignment:
            key = commented_assignment.group(1)
            seen.add(key)
            value = values.get(key, "")
            if value != "":
                output_lines.append(f"{key}={value}")
            else:
                output_lines.append(line)
            continue

        output_lines.append(line)

    extras = [(key, value) for key, value in values.items() if key not in seen and value != ""]
    if extras:
        if output_lines and output_lines[-1] != "":
            output_lines.append("")
        output_lines.extend([
            "# Additional Local Overrides",
            "# Values below were preserved because they are not part of .env.example.",
        ])
        for key, value in extras:
            output_lines.append(f"{key}={value}")

    return "\n".join(output_lines).rstrip() + "\n"


def _clear_settings_caches():
    for key in ("settings_summary", "settings_env", "status"):
        _cache._store.pop(key, None)


def _call_agent_core_recreate(service_ids: list[str]) -> dict[str, Any]:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DREAM_AGENT_KEY}",
    }
    data = json.dumps({"service_ids": service_ids}).encode("utf-8")
    request = urllib.request.Request(
        f"{AGENT_URL}/v1/core/recreate",
        data=data,
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def _check_host_agent_available() -> bool:
    try:
        with urllib.request.urlopen(f"{AGENT_URL}/health", timeout=3) as response:
            return response.status == 200
    except Exception:
        return False


def _build_settings_env_payload(
    *,
    raw_text: Optional[str] = None,
    backup_path: Optional[str] = None,
    apply_plan: Optional[dict[str, Any]] = None,
) -> dict:
    env_path = _resolve_runtime_env_path()
    if raw_text is None:
        try:
            raw_text = env_path.read_text(encoding="utf-8")
        except OSError:
            raw_text = ""

    values, parse_issues = _parse_env_text(raw_text)
    schema_properties, required_keys = _load_env_schema()
    fields = _build_env_fields(schema_properties, required_keys, values)
    sections = _build_env_sections(list(fields.keys()))
    issues = _validate_env_values(values, fields, parse_issues)
    public_fields: dict[str, dict[str, Any]] = {}
    public_values: dict[str, str] = {}

    for key, field in fields.items():
        public_field = {**field}
        if field.get("secret"):
            public_field["value"] = ""
            public_values[key] = ""
        else:
            public_values[key] = field["value"]
        public_fields[key] = public_field

    return {
        "path": _relative_install_path(env_path),
        "raw": "",
        "values": public_values,
        "fields": public_fields,
        "sections": sections,
        "issues": issues,
        "saveHint": "Saving writes the .env file directly, keeps existing secret values when left blank, never sends stored secrets back to the browser, and stores a timestamped backup under data/config-backups first.",
        "restartHint": "Some DreamServer services need a container recreate before changed values fully take effect. Use Apply changes when it becomes available after saving.",
        "backupPath": backup_path,
        "applyPlan": apply_plan,
        "agentAvailable": _check_host_agent_available(),
    }


def _relative_install_path(path: Path) -> str:
    try:
        return str(path.relative_to(_resolve_install_root())).replace("\\", "/")
    except ValueError:
        return str(path).replace("\\", "/")


def _resolve_env_backup_root() -> Path:
    backup_root = Path(DATA_DIR) / "config-backups"
    backup_root.mkdir(parents=True, exist_ok=True)
    return backup_root


def _display_backup_path(path: Path) -> str:
    data_root = Path(DATA_DIR)
    try:
        return f"data/{path.relative_to(data_root).as_posix()}"
    except ValueError:
        return str(path).replace("\\", "/")


def _write_text_atomic(path: Path, raw_text: str):
    temp_path = path.with_name(f"{path.name}.tmp-{os.getpid()}-{int(time.time() * 1000)}")
    try:
        try:
            temp_path.write_text(raw_text, encoding="utf-8")
            if path.exists():
                try:
                    shutil.copymode(path, temp_path)
                except OSError:
                    pass
            os.replace(temp_path, path)
            return
        except PermissionError:
            if not path.exists():
                raise
            path.write_text(raw_text, encoding="utf-8")
            return
    finally:
        try:
            if temp_path.exists():
                temp_path.unlink()
        except OSError:
            pass


def _prepare_env_save(payload: dict[str, Any]) -> tuple[str, list[dict[str, Any]], dict[str, Any]]:
    mode = payload.get("mode", "form")
    env_path = _resolve_runtime_env_path()
    current_values, _ = _read_env_map_from_path(env_path)
    schema_properties, required_keys = _load_env_schema()

    if mode != "form":
        raise HTTPException(
            status_code=400,
            detail={"message": "Only form-based editing is supported for security reasons."},
        )

    submitted_values = payload.get("values", {})
    if not isinstance(submitted_values, dict):
        raise HTTPException(
            status_code=400,
            detail={"message": "Form configuration payload must be an object."},
        )

    base_fields = _build_env_fields(schema_properties, required_keys, current_values)
    invalid_keys = sorted(set(submitted_values.keys()) - set(base_fields.keys()))
    if invalid_keys:
        return _render_env_from_values(current_values), [
            {
                "key": key,
                "message": "Field is not editable from the dashboard. Only schema-backed fields and existing local overrides can be changed here.",
            }
            for key in invalid_keys
        ], _compute_env_apply_plan(current_values, current_values)

    normalized_values = _serialize_form_values(submitted_values, base_fields, current_values)
    merged_values = {**current_values, **normalized_values}
    merged_fields = _build_env_fields(schema_properties, required_keys, merged_values)
    issues = _validate_env_values(merged_values, merged_fields)
    apply_plan = _compute_env_apply_plan(current_values, merged_values)
    return _render_env_from_values(merged_values), issues, apply_plan

# --- App ---

app = FastAPI(
    title="Dream Server Dashboard API",
    version="2.0.0",
    description="System status API for Dream Server Dashboard"
)

# --- CORS ---

def get_allowed_origins():
    env_origins = os.environ.get("DASHBOARD_ALLOWED_ORIGINS", "")
    if env_origins:
        return env_origins.split(",")
    origins = [
        "http://localhost:3001", "http://127.0.0.1:3001",
        "http://localhost:3000", "http://127.0.0.1:3000",
    ]
    try:
        hostname = socket.gethostname()
        local_ips = socket.gethostbyname_ex(hostname)[2]
        for ip in local_ips:
            if ip.startswith(("192.168.", "10.", "172.")):
                origins.append(f"http://{ip}:3001")
                origins.append(f"http://{ip}:3000")
    except (OSError, socket.gaierror):
        logger.debug("Could not detect LAN IPs for CORS origins")
    return origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)

# --- Include Routers ---

app.include_router(workflows.router)
app.include_router(features.router)
app.include_router(setup.router)
app.include_router(updates.router)
app.include_router(agents.router)
app.include_router(privacy.router)
app.include_router(extensions.router)
app.include_router(gpu_router.router)
app.include_router(resources.router)
app.include_router(voice.router)
app.include_router(models_router.router)
app.include_router(templates.router)


# ================================================================
# Core Endpoints (health, status, preflight, services)
# ================================================================

@app.get("/health")
async def health():
    """API health check."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


# --- Preflight ---

@app.get("/api/preflight/docker", dependencies=[Depends(verify_api_key)])
async def preflight_docker():
    """Check if Docker is available."""
    if os.path.exists("/.dockerenv"):
        return {"available": True, "version": "available (host)"}
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker", "--version",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=5)
        if proc.returncode == 0:
            parts = stdout.decode().strip().split()
            version = parts[2].rstrip(",") if len(parts) > 2 else "unknown"
            return {"available": True, "version": version}
        return {"available": False, "error": "Docker command failed"}
    except FileNotFoundError:
        return {"available": False, "error": "Docker not installed"}
    except asyncio.TimeoutError:
        return {"available": False, "error": "Docker check timed out"}
    except OSError:
        logger.exception("Docker preflight check failed")
        return {"available": False, "error": "Docker check failed"}


@app.get("/api/preflight/gpu", dependencies=[Depends(verify_api_key)])
async def preflight_gpu():
    """Check GPU availability."""
    gpu_info = await asyncio.to_thread(get_gpu_info)
    if gpu_info:
        vram_gb = round(gpu_info.memory_total_mb / 1024, 1)
        result = {"available": True, "name": gpu_info.name, "vram": vram_gb, "backend": gpu_info.gpu_backend, "memory_type": gpu_info.memory_type}
        if gpu_info.memory_type == "unified":
            result["memory_label"] = f"{vram_gb} GB Unified"
        return result

    gpu_backend = os.environ.get("GPU_BACKEND", "").lower()
    if gpu_backend == "amd":
        return {"available": False, "error": "AMD GPU not detected via sysfs. Check /dev/kfd and /dev/dri access."}
    return {"available": False, "error": "No GPU detected. Ensure NVIDIA drivers or AMD amdgpu driver is loaded."}


@app.get("/api/preflight/required-ports")
async def preflight_required_ports():
    """Return the list of service ports for preflight checking (no auth required)."""
    # When health cache exists, filter out services not in the compose stack
    cached = get_cached_services()
    deployed = {s.id for s in cached if s.status != "not_deployed"} if cached else None

    ports = []
    for sid, cfg in SERVICES.items():
        if deployed is not None and sid not in deployed:
            continue
        ext_port = cfg.get("external_port", cfg.get("port", 0))
        if ext_port:
            ports.append({"port": ext_port, "service": cfg.get("name", sid)})
    return {"ports": ports}


@app.post("/api/preflight/ports", dependencies=[Depends(verify_api_key)])
async def preflight_ports(request: PortCheckRequest):
    """Check if required ports are available."""
    port_services = {}
    for sid, cfg in SERVICES.items():
        ext_port = cfg.get("external_port", cfg.get("port", 0))
        if ext_port:
            port_services[ext_port] = cfg.get("name", sid)

    conflicts = []
    for port in request.ports:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.settimeout(1)
                sock.bind(("0.0.0.0", port))
        except socket.error:
            conflicts.append({"port": port, "service": port_services.get(port, "Unknown"), "in_use": True})
    return {"conflicts": conflicts, "available": len(conflicts) == 0}


@app.get("/api/preflight/disk", dependencies=[Depends(verify_api_key)])
async def preflight_disk():
    """Check available disk space."""
    try:
        check_path = DATA_DIR if os.path.exists(DATA_DIR) else Path.home()
        usage = shutil.disk_usage(check_path)
        return {"free": usage.free, "total": usage.total, "used": usage.used, "path": str(check_path)}
    except OSError:
        logger.exception("Disk preflight check failed")
        return {"error": "Disk check failed", "free": 0, "total": 0, "used": 0, "path": ""}


# --- Core Data ---

@app.get("/gpu", response_model=Optional[GPUInfo])
async def gpu(api_key: str = Depends(verify_api_key)):
    """Get GPU metrics (cached for a few seconds to avoid nvidia-smi spam)."""
    cached = _cache.get("gpu_info")
    if cached is not None:
        if not cached:
            raise HTTPException(status_code=503, detail="GPU not available")
        return cached
    info = await asyncio.to_thread(get_gpu_info)
    _cache.set("gpu_info", info, _GPU_CACHE_TTL)
    if not info:
        raise HTTPException(status_code=503, detail="GPU not available")
    return info


@app.get("/services", response_model=list[ServiceStatus])
async def services(api_key: str = Depends(verify_api_key)):
    """Get all service health statuses (from background poll cache)."""
    cached = get_cached_services()
    if cached is not None:
        return cached
    return await get_all_services()


@app.get("/disk", response_model=DiskUsage)
async def disk(api_key: str = Depends(verify_api_key)):
    return await asyncio.to_thread(get_disk_usage)


@app.get("/model", response_model=Optional[ModelInfo])
async def model(api_key: str = Depends(verify_api_key)):
    return await asyncio.to_thread(get_model_info)


@app.get("/bootstrap", response_model=BootstrapStatus)
async def bootstrap(api_key: str = Depends(verify_api_key)):
    return await asyncio.to_thread(get_bootstrap_status)


@app.get("/status", response_model=FullStatus)
async def status(api_key: str = Depends(verify_api_key)):
    """Get full system status. Runs sync helpers in thread pool concurrently."""
    service_statuses, gpu_info, disk_info, model_info, bootstrap_info, uptime = await asyncio.gather(
        _get_services(),
        asyncio.to_thread(get_gpu_info),
        asyncio.to_thread(get_disk_usage),
        asyncio.to_thread(get_model_info),
        asyncio.to_thread(get_bootstrap_status),
        asyncio.to_thread(get_uptime),
    )
    return FullStatus(
        timestamp=datetime.now(timezone.utc).isoformat(),
        gpu=gpu_info, services=service_statuses,
        disk=disk_info, model=model_info,
        bootstrap=bootstrap_info, uptime_seconds=uptime
    )


@app.get("/api/status")
async def api_status(api_key: str = Depends(verify_api_key)):
    """Dashboard-compatible status endpoint.

    Wrapped in a top-level try/except so that a transient failure in any
    sub-call (GPU, health checks, llama metrics …) never returns a raw 500
    to the dashboard — the frontend would flash "0/17" otherwise.
    """
    try:
        return await _build_api_status()
    except Exception:
        logger.exception("/api/status handler failed — returning safe fallback")
        return {
            "gpu": None, "services": [], "model": None,
            "bootstrap": None, "uptime": 0,
            "version": app.version, "tier": "Unknown",
            "cpu": {"percent": 0, "temp_c": None},
            "ram": {"used_gb": 0, "total_gb": 0, "percent": 0},
            "disk": {"used_gb": 0, "total_gb": 0, "percent": 0},
            "system": {"uptime": 0, "hostname": os.environ.get("HOSTNAME", "dream-server")},
            "inference": {"tokensPerSecond": 0, "lifetimeTokens": 0,
                          "loadedModel": None, "contextSize": None},
            "manifest_errors": MANIFEST_ERRORS,
        }


async def _build_api_status() -> dict:
    """Build the full status payload.

    Runs ALL sync helpers (GPU, disk, CPU, RAM, model, bootstrap)
    concurrently in the thread pool while async health checks and
    llama-server queries run on the event loop — no serial blocking.
    """
    # Fan out: sync helpers in threads + async health checks simultaneously
    (
        gpu_info, model_info, bootstrap_info, uptime,
        cpu_metrics, ram_metrics, disk_info,
        service_statuses, loaded_model,
    ) = await asyncio.gather(
        asyncio.to_thread(get_gpu_info),
        asyncio.to_thread(get_model_info),
        asyncio.to_thread(get_bootstrap_status),
        asyncio.to_thread(get_uptime),
        asyncio.to_thread(get_cpu_metrics),
        asyncio.to_thread(get_ram_metrics),
        asyncio.to_thread(get_disk_usage),
        _get_services(),
        get_loaded_model(),
    )

    # Second fan-out: llama metrics + context size (need loaded_model)
    llama_metrics_data, context_size = await asyncio.gather(
        get_llama_metrics(model_hint=loaded_model),
        get_llama_context_size(model_hint=loaded_model),
    )

    gpu_data = None
    if gpu_info:
        # Infer gpu_count from display name ("RTX 4090 × 2") or env var GPU_COUNT
        gpu_count = 1
        gpu_count_env = os.environ.get("GPU_COUNT", "")
        if gpu_count_env.isdigit():
            gpu_count = int(gpu_count_env)
        elif " \u00d7 " in gpu_info.name:
            try:
                gpu_count = int(gpu_info.name.rsplit(" \u00d7 ", 1)[-1])
            except ValueError:
                pass
        elif " + " in gpu_info.name:
            gpu_count = gpu_info.name.count(" + ") + 1

        gpu_data = {
            "name": gpu_info.name,
            "vramUsed": round(gpu_info.memory_used_mb / 1024, 1),
            "vramTotal": round(gpu_info.memory_total_mb / 1024, 1),
            "utilization": gpu_info.utilization_percent,
            "temperature": gpu_info.temperature_c,
            "memoryType": gpu_info.memory_type,
            "backend": gpu_info.gpu_backend,
            "gpu_count": gpu_count,
        }
        if gpu_info.power_w is not None:
            gpu_data["powerDraw"] = gpu_info.power_w
        gpu_data["memoryLabel"] = "VRAM Partition" if gpu_info.memory_type == "unified" else "VRAM"

    services_data = [{"name": s.name, "status": s.status, "port": s.external_port, "uptime": uptime if s.status == "healthy" else None} for s in service_statuses]

    model_data = None
    if model_info:
        model_data = {"name": model_info.name, "tokensPerSecond": llama_metrics_data.get("tokens_per_second") or None, "contextLength": context_size or model_info.context_length}

    bootstrap_data = None
    if bootstrap_info.active:
        bootstrap_data = {
            "active": True, "model": bootstrap_info.model_name or "Full Model",
            "percent": bootstrap_info.percent or 0,
            "bytesDownloaded": int((bootstrap_info.downloaded_gb or 0) * 1024**3),
            "bytesTotal": int((bootstrap_info.total_gb or 0) * 1024**3),
            "eta": bootstrap_info.eta_seconds, "speedMbps": bootstrap_info.speed_mbps
        }

    tier = "Unknown"
    if gpu_info:
        vram_gb = gpu_info.memory_total_mb / 1024
        if gpu_info.memory_type == "unified" and gpu_info.gpu_backend == "amd":
            tier = "Strix Halo 90+" if vram_gb >= 90 else "Strix Halo Compact"
        elif vram_gb >= 80:
            tier = "Professional"
        elif vram_gb >= 24:
            tier = "Prosumer"
        elif vram_gb >= 16:
            tier = "Standard"
        elif vram_gb >= 8:
            tier = "Entry"
        else:
            tier = "Minimal"

    result = {
        "gpu": gpu_data, "services": services_data, "model": model_data,
        "bootstrap": bootstrap_data, "uptime": uptime,
        "version": app.version, "tier": tier,
        "cpu": cpu_metrics, "ram": ram_metrics,
        "disk": {"used_gb": disk_info.used_gb, "total_gb": disk_info.total_gb, "percent": disk_info.percent},
        "system": {"uptime": uptime, "hostname": os.environ.get("HOSTNAME", "dream-server")},
        "inference": {
            "tokensPerSecond": llama_metrics_data.get("tokens_per_second", 0),
            "lifetimeTokens": llama_metrics_data.get("lifetime_tokens", 0),
            "loadedModel": loaded_model or (model_data["name"] if model_data else None),
            "contextSize": context_size or (model_data["contextLength"] if model_data else None),
        },
        "manifest_errors": MANIFEST_ERRORS,
    }
    return result


# --- Settings ---

@app.get("/api/service-tokens", dependencies=[Depends(verify_api_key)])
async def service_tokens():
    """Return connection tokens for services that need browser-side auth."""
    def _read_tokens():
        tokens = {}
        oc_token = os.environ.get("OPENCLAW_TOKEN", "")
        if not oc_token:
            for path in [Path("/data/openclaw/home/gateway-token"), Path("/dream-server/.env")]:
                try:
                    if path.suffix == ".env":
                        for line in path.read_text().splitlines():
                            if line.startswith("OPENCLAW_TOKEN="):
                                oc_token = line.split("=", 1)[1].strip()
                                break
                    else:
                        oc_token = path.read_text().strip()
                except (OSError, ValueError):
                    continue
                if oc_token:
                    break
        if oc_token:
            tokens["openclaw"] = oc_token
        return tokens

    return await asyncio.to_thread(_read_tokens)


@app.get("/api/external-links")
async def get_external_links(api_key: str = Depends(verify_api_key)):
    """Return sidebar-ready external links derived from service manifests."""
    links = []
    for sid, cfg in SERVICES.items():
        ext_port = cfg.get("external_port", cfg.get("port", 0))
        if not ext_port or sid == "dashboard-api":
            continue
        links.append({
            "id": sid, "label": cfg.get("name", sid), "port": ext_port,
            "ui_path": cfg.get("ui_path", "/"),
            "icon": SIDEBAR_ICONS.get(sid, "ExternalLink"),
            "healthNeedles": [sid, cfg.get("name", sid).lower()],
        })
    return links


@app.get("/api/storage")
async def api_storage(api_key: str = Depends(verify_api_key)):
    """Get storage breakdown for Settings page (cached, runs in thread pool)."""
    cached = _cache.get("storage")
    if cached is not None:
        return cached

    def _compute_storage():
        models_dir = Path(DATA_DIR) / "models"
        vector_dir = Path(DATA_DIR) / "qdrant"
        data_dir = Path(DATA_DIR)

        disk_info = get_disk_usage()
        models_gb = dir_size_gb(models_dir)
        vector_gb = dir_size_gb(vector_dir)
        other_gb = dir_size_gb(data_dir) - models_gb - vector_gb
        total_data_gb = models_gb + vector_gb + max(other_gb, 0)

        return {
            "models": {"formatted": f"{models_gb:.1f} GB", "gb": models_gb, "percent": round(models_gb / disk_info.total_gb * 100, 1) if disk_info.total_gb else 0},
            "vector_db": {"formatted": f"{vector_gb:.1f} GB", "gb": vector_gb, "percent": round(vector_gb / disk_info.total_gb * 100, 1) if disk_info.total_gb else 0},
            "total_data": {"formatted": f"{total_data_gb:.1f} GB", "gb": total_data_gb, "percent": round(total_data_gb / disk_info.total_gb * 100, 1) if disk_info.total_gb else 0},
            "disk": {"used_gb": disk_info.used_gb, "total_gb": disk_info.total_gb, "percent": disk_info.percent}
        }

    result = await asyncio.to_thread(_compute_storage)
    _cache.set("storage", result, _STORAGE_CACHE_TTL)
    return result


@app.get("/api/settings/summary")
async def api_settings_summary(api_key: str = Depends(verify_api_key)):
    """Fast settings payload that avoids slow live service probes on first load."""
    cached = _cache.get("settings_summary")
    if cached is not None:
        return cached

    gpu_info, model_info, uptime, cpu_metrics, ram_metrics = await asyncio.gather(
        asyncio.to_thread(get_gpu_info),
        asyncio.to_thread(get_model_info),
        asyncio.to_thread(get_uptime),
        asyncio.to_thread(get_cpu_metrics),
        asyncio.to_thread(get_ram_metrics),
    )

    cached_services = get_cached_services()
    services_data = (
        _serialize_services(cached_services, uptime)
        if cached_services is not None
        else _fallback_services()
    )

    result = {
        "version": _read_installed_version(),
        "install_date": _read_install_date(),
        "tier": _infer_tier(gpu_info),
        "uptime": uptime,
        "cpu": cpu_metrics,
        "ram": ram_metrics,
        "gpu": _serialize_gpu(gpu_info),
        "model": _serialize_model(model_info),
        "services": services_data,
        "system": {
            "uptime": uptime,
            "hostname": os.environ.get("HOSTNAME", "dream-server"),
        },
        "manifest_errors": MANIFEST_ERRORS,
    }
    _cache.set("settings_summary", result, _SETTINGS_SUMMARY_CACHE_TTL)
    return result


@app.get("/api/settings/env")
async def api_settings_env(api_key: str = Depends(verify_api_key)):
    cached = _cache.get("settings_env")
    if cached is not None:
        return cached

    result = await asyncio.to_thread(_build_settings_env_payload)
    _cache.set("settings_env", result, _SETTINGS_ENV_CACHE_TTL)
    return result


@app.put("/api/settings/env")
async def api_settings_env_save(
    payload: dict[str, Any] = Body(...),
    api_key: str = Depends(verify_api_key),
):
    env_path = _resolve_runtime_env_path()
    raw_text, issues, apply_plan = await asyncio.to_thread(_prepare_env_save, payload)
    if issues:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Configuration validation failed.",
                "issues": issues,
            },
        )

    env_path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup_root = await asyncio.to_thread(_resolve_env_backup_root)
    backup_path = backup_root / f".env.backup.{timestamp}"
    backup_relative = None

    if env_path.exists():
        try:
            shutil.copy2(env_path, backup_path)
            backup_relative = _display_backup_path(backup_path)
        except OSError as exc:
            raise HTTPException(
                status_code=500,
                detail={
                    "message": "Could not create a configuration backup before saving.",
                    "reason": str(exc),
                },
            ) from exc

    try:
        await asyncio.to_thread(_write_text_atomic, env_path, raw_text)
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Could not write the updated environment file.",
                "reason": str(exc),
            },
        ) from exc

    _clear_settings_caches()
    result = await asyncio.to_thread(
        _build_settings_env_payload,
        raw_text=raw_text,
        backup_path=backup_relative,
        apply_plan=apply_plan,
    )
    _cache.set("settings_env", result, _SETTINGS_ENV_CACHE_TTL)
    return result


@app.post("/api/settings/env/apply")
async def api_settings_env_apply(
    payload: dict[str, Any] = Body(...),
    api_key: str = Depends(verify_api_key),
):
    service_ids = payload.get("service_ids", [])
    if not isinstance(service_ids, list) or not service_ids:
        raise HTTPException(
            status_code=400,
            detail={"message": "service_ids must be a non-empty list."},
        )

    normalized: list[str] = []
    for service_id in sorted(set(service_ids)):
        if not isinstance(service_id, str) or service_id not in _SETTINGS_APPLY_ALLOWED_SERVICES:
            raise HTTPException(
                status_code=400,
                detail={"message": f"Service is not eligible for dashboard-triggered apply: {service_id}"},
            )
        normalized.append(service_id)

    try:
        await asyncio.to_thread(_call_agent_core_recreate, normalized)
        _clear_settings_caches()
        return {
            "success": True,
            "services": normalized,
            "message": f"Applied runtime changes to {', '.join(normalized)}.",
        }
    except urllib.error.HTTPError as exc:
        detail = f"Host agent returned HTTP {exc.code}."
        try:
            payload = json.loads(exc.read().decode("utf-8"))
            detail = payload.get("error", detail)
        except Exception:
            pass
        raise HTTPException(status_code=503, detail={"message": detail}) from exc
    except urllib.error.URLError as exc:
        raise HTTPException(
            status_code=503,
            detail={"message": "Dream host agent is not reachable. Start the host agent, then try Apply changes again."},
        ) from exc
    except OSError as exc:
        logger.exception("Settings apply failed")
        raise HTTPException(
            status_code=500,
            detail={"message": f"Could not apply runtime changes: {exc}"},
        ) from exc


# --- Service Health Polling ---

async def _get_services() -> list[ServiceStatus]:
    """Return cached service health, falling back to live check."""
    cached = get_cached_services()
    if cached is not None:
        return cached
    return await get_all_services()


async def _poll_service_health():
    """Background task: poll all service health on a timer.

    Results stored via set_services_cache(). API endpoints read
    cached results instead of running live checks. The poll can
    take as long as it needs — nobody waits for it.
    """
    await asyncio.sleep(2)  # let services start
    while True:
        try:
            statuses = await get_all_services()
            set_services_cache(statuses)
        except Exception:
            logger.exception("Service health poll failed")
        await asyncio.sleep(_SERVICE_POLL_INTERVAL)


# --- Startup ---

@app.on_event("startup")
async def startup_event():
    """Start background tasks."""
    asyncio.create_task(collect_metrics())
    asyncio.create_task(_poll_service_health())
    asyncio.create_task(gpu_router.poll_gpu_history())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("DASHBOARD_API_PORT", "3002")))
