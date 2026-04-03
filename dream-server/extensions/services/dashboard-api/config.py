"""Shared configuration and manifest loading for Dream Server Dashboard API."""

import json
import logging
import os
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

# --- Paths ---

INSTALL_DIR = os.environ.get("DREAM_INSTALL_DIR", os.path.expanduser("~/dream-server"))
DATA_DIR = os.environ.get("DREAM_DATA_DIR", os.path.expanduser("~/.dream-server"))
EXTENSIONS_DIR = Path(
    os.environ.get(
        "DREAM_EXTENSIONS_DIR",
        str(Path(INSTALL_DIR) / "extensions" / "services")
    )
)

DEFAULT_SERVICE_HOST = os.environ.get("SERVICE_HOST", "host.docker.internal")
GPU_BACKEND = os.environ.get("GPU_BACKEND", "nvidia")


def _read_env_from_file(key: str) -> str:
    """Read a variable from the .env file when not available in process environment."""
    env_path = Path(INSTALL_DIR) / ".env"
    try:
        for line in env_path.read_text().splitlines():
            if line.startswith(f"{key}="):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


# --- Manifest Loading ---


def _read_manifest_file(path: Path) -> dict[str, Any]:
    """Load a JSON or YAML extension manifest file."""
    text = path.read_text()
    if path.suffix.lower() == ".json":
        data = json.loads(text)
    else:
        data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ValueError("Manifest root must be an object")
    return data


def load_extension_manifests(
    manifest_dir: Path, gpu_backend: str,
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]], list[dict[str, str]]]:
    """Load service and feature definitions from extension manifests.

    Returns a 3-tuple: (services, features, errors) where *errors* is a list
    of ``{"file": ..., "error": ...}`` dicts for manifests that failed to load.
    """
    services: dict[str, dict[str, Any]] = {}
    features: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    loaded = 0

    if not manifest_dir.exists():
        logger.info("Extension manifest directory not found: %s", manifest_dir)
        return services, features, errors

    manifest_files: list[Path] = []
    for item in sorted(manifest_dir.iterdir()):
        if item.is_dir():
            for name in ("manifest.yaml", "manifest.yml", "manifest.json"):
                candidate = item / name
                if candidate.exists():
                    manifest_files.append(candidate)
                    break
        elif item.suffix.lower() in (".yaml", ".yml", ".json"):
            manifest_files.append(item)

    for path in manifest_files:
        try:
            # Skip disabled extensions (compose.yaml.disabled convention)
            ext_dir = path.parent
            if (ext_dir / "compose.yaml.disabled").exists() or (ext_dir / "compose.yml.disabled").exists():
                logger.debug("Skipping disabled extension: %s", ext_dir.name)
                continue

            manifest = _read_manifest_file(path)
            if manifest.get("schema_version") != "dream.services.v1":
                logger.warning("Skipping manifest with unsupported schema_version: %s", path)
                errors.append({"file": str(path), "error": "Unsupported schema_version"})
                continue

            service = manifest.get("service")
            if isinstance(service, dict):
                service_id = service.get("id")
                if not service_id:
                    raise ValueError("service.id is required")
                supported = service.get("gpu_backends", ["amd", "nvidia", "apple"])
                if gpu_backend == "apple":
                    if service.get("type") == "host-systemd":
                        continue  # Linux-only service, not available on macOS
                    # All docker services run on macOS regardless of gpu_backends declaration
                elif gpu_backend not in supported and "all" not in supported:
                    continue

                host_env = service.get("host_env")
                default_host = service.get("default_host", "localhost")
                host = os.environ.get(host_env, default_host) if host_env else default_host

                ext_port_env = service.get("external_port_env")
                ext_port_default = service.get("external_port_default", service.get("port", 0))
                if ext_port_env:
                    val = os.environ.get(ext_port_env) or _read_env_from_file(ext_port_env)
                    external_port = int(val) if val else int(ext_port_default)
                else:
                    external_port = int(ext_port_default)

                services[service_id] = {
                    "host": host,
                    "port": int(service.get("port", 0)),
                    "external_port": external_port,
                    "health": service.get("health", "/health"),
                    "name": service.get("name", service_id),
                    "ui_path": service.get("ui_path", "/"),
                    **({"type": service["type"]} if "type" in service else {}),
                    **({"health_port": int(service["health_port"])} if "health_port" in service else {}),
                }

            manifest_features = manifest.get("features", [])
            if isinstance(manifest_features, list):
                for feature in manifest_features:
                    if not isinstance(feature, dict):
                        continue
                    supported = feature.get("gpu_backends", ["amd", "nvidia", "apple"])
                    if gpu_backend != "apple" and gpu_backend not in supported and "all" not in supported:
                        continue
                    if feature.get("id") and feature.get("name"):
                        missing = [f for f in ("description", "icon", "category", "setup_time", "priority") if f not in feature]
                        if missing:
                            logger.warning("Feature '%s' in %s missing optional fields: %s", feature["id"], path, ", ".join(missing))
                        features.append(feature)

            loaded += 1
        except (yaml.YAMLError, json.JSONDecodeError, OSError, KeyError, TypeError, ValueError) as e:
            logger.warning("Failed loading manifest %s: %s", path, e)
            errors.append({"file": str(path), "error": str(e)})

    logger.info("Loaded %d extension manifests (%d services, %d features)", loaded, len(services), len(features))
    return services, features, errors


# --- Service Registry ---

MANIFEST_SERVICES, MANIFEST_FEATURES, MANIFEST_ERRORS = load_extension_manifests(EXTENSIONS_DIR, GPU_BACKEND)
SERVICES = MANIFEST_SERVICES
if not SERVICES:
    logger.error("No services loaded from manifests in %s — dashboard will have no services", EXTENSIONS_DIR)

# Lemonade serves at /api/v1 instead of llama.cpp's /v1. Override the
# health path so the dashboard poll loop hits the correct endpoint.
LLM_BACKEND = os.environ.get("LLM_BACKEND", "")
if LLM_BACKEND == "lemonade" and "llama-server" in SERVICES:
    SERVICES["llama-server"]["health"] = "/api/v1/health"
    logger.info("Lemonade backend detected — overriding llama-server health to /api/v1/health")

# --- Features ---

FEATURES = MANIFEST_FEATURES
if not FEATURES:
    logger.warning("No features loaded from manifests — check %s", EXTENSIONS_DIR)

# --- Workflow Config ---


def resolve_workflow_dir() -> Path:
    """Resolve canonical workflow directory with legacy fallback."""
    env_dir = os.environ.get("WORKFLOW_DIR")
    if env_dir:
        return Path(env_dir)
    canonical = Path(INSTALL_DIR) / "config" / "n8n"
    if canonical.exists():
        return canonical
    return Path(INSTALL_DIR) / "workflows"


WORKFLOW_DIR = resolve_workflow_dir()
WORKFLOW_CATALOG_FILE = WORKFLOW_DIR / "catalog.json"
DEFAULT_WORKFLOW_CATALOG = {"workflows": [], "categories": {}}

def _default_n8n_url() -> str:
    cfg = SERVICES.get("n8n", {})
    host = cfg.get("host", "n8n")
    port = cfg.get("port", 5678)
    return f"http://{host}:{port}"

N8N_URL = os.environ.get("N8N_URL", _default_n8n_url())
N8N_API_KEY = os.environ.get("N8N_API_KEY", "")

# --- Setup / Personas ---

SETUP_CONFIG_DIR = Path(DATA_DIR) / "config"

PERSONAS = {
    "general": {
        "name": "General Helper",
        "system_prompt": "You are a friendly and helpful AI assistant. You're knowledgeable, patient, and aim to be genuinely useful. Keep responses clear and conversational.",
        "icon": "\U0001f4ac"
    },
    "coding": {
        "name": "Coding Buddy",
        "system_prompt": "You are a skilled programmer and technical assistant. You write clean, well-documented code and explain technical concepts clearly. You're precise, thorough, and love solving problems.",
        "icon": "\U0001f4bb"
    },
    "creative": {
        "name": "Creative Writer",
        "system_prompt": "You are an imaginative creative writer and storyteller. You craft vivid descriptions, engaging narratives, and think outside the box. You're expressive and enjoy wordplay.",
        "icon": "\U0001f3a8"
    }
}

# --- Sidebar Icons ---

SIDEBAR_ICONS = {
    "open-webui": "MessageSquare",
    "n8n": "Network",
    "openclaw": "Bot",
    "opencode": "Code",
    "perplexica": "Search",
    "comfyui": "Image",
    "token-spy": "Terminal",
    "langfuse": "BarChart2",
}

# --- Extensions Portal ---

CATALOG_PATH = Path(os.environ.get(
    "DREAM_EXTENSIONS_CATALOG",
    str(Path(INSTALL_DIR) / "config" / "extensions-catalog.json")
))

EXTENSIONS_LIBRARY_DIR = Path(os.environ.get(
    "DREAM_EXTENSIONS_LIBRARY_DIR",
    str(Path(DATA_DIR) / "extensions-library")
))

USER_EXTENSIONS_DIR = Path(os.environ.get(
    "DREAM_USER_EXTENSIONS_DIR",
    str(Path(DATA_DIR) / "user-extensions")
))

def _load_core_service_ids() -> frozenset:
    core_ids_path = Path(INSTALL_DIR) / "config" / "core-service-ids.json"
    if core_ids_path.exists():
        try:
            return frozenset(json.loads(core_ids_path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, OSError):
            pass
    # Fallback to hardcoded list
    return frozenset({
        "dashboard-api", "dashboard", "llama-server", "open-webui",
        "litellm", "langfuse", "n8n", "openclaw", "opencode",
        "perplexica", "searxng", "qdrant", "tts", "whisper",
        "embeddings", "token-spy", "comfyui", "ape", "privacy-shield",
    })


CORE_SERVICE_IDS = _load_core_service_ids()


def load_extension_catalog() -> list[dict]:
    """Load the static extensions catalog JSON. Returns empty list on failure."""
    if not CATALOG_PATH.exists():
        logger.info("Extensions catalog not found at %s", CATALOG_PATH)
        return []
    try:
        data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
        return data.get("extensions", [])
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to load extensions catalog: %s", e)
        return []


EXTENSION_CATALOG = load_extension_catalog()

# --- Host Agent ---

AGENT_HOST = os.environ.get("DREAM_AGENT_HOST", "host.docker.internal")
AGENT_PORT = int(os.environ.get("DREAM_AGENT_PORT", "7710"))
AGENT_URL = f"http://{AGENT_HOST}:{AGENT_PORT}"
DASHBOARD_API_KEY = os.environ.get("DASHBOARD_API_KEY", "")
# Prefer dedicated DREAM_AGENT_KEY; fall back to DASHBOARD_API_KEY for
# existing installs that haven't generated a separate key yet.
DREAM_AGENT_KEY = os.environ.get("DREAM_AGENT_KEY", "") or DASHBOARD_API_KEY
