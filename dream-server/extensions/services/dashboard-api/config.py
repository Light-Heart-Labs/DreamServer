"""Shared configuration and manifest loading for Dream Server Dashboard API."""

import importlib.util
import logging
import os
import sys
from pathlib import Path
from typing import Any

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

# --- Manifest Loading ---


_SERVICE_REGISTRY_MODULE: Any | None = None


def _load_service_registry_module() -> Any:
    """Load shared registry helpers from install/scripts/service_registry.py."""
    global _SERVICE_REGISTRY_MODULE
    if _SERVICE_REGISTRY_MODULE is not None:
        return _SERVICE_REGISTRY_MODULE

    install_candidate = Path(INSTALL_DIR) / "scripts" / "service_registry.py"
    fallback_candidate = Path(__file__).resolve().parents[3] / "scripts" / "service_registry.py"
    module_path = install_candidate if install_candidate.exists() else fallback_candidate

    spec = importlib.util.spec_from_file_location("dream_service_registry", module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load service registry module from {module_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    _SERVICE_REGISTRY_MODULE = module
    return module


def _resolve_registry_root(manifest_dir: Path) -> Path:
    """Infer Dream Server root from a manifest directory path."""
    if manifest_dir.name == "services" and manifest_dir.parent.name == "extensions":
        return manifest_dir.parent.parent

    install_root = Path(INSTALL_DIR)
    install_schema = install_root / "extensions" / "schema" / "service-manifest.v1.json"
    if install_schema.exists():
        return install_root

    return Path(__file__).resolve().parents[3]


def _read_manifest_file(path: Path) -> dict[str, Any]:
    """Load a JSON or YAML extension manifest file."""
    registry_mod = _load_service_registry_module()
    return registry_mod.read_manifest_file(path)


def load_extension_manifests(
    manifest_dir: Path, gpu_backend: str
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """Load service and feature definitions from extension manifests."""
    if not manifest_dir.exists():
        logger.info("Extension manifest directory not found: %s", manifest_dir)
        return {}, []

    registry_mod = _load_service_registry_module()
    root_dir = _resolve_registry_root(manifest_dir)
    artifact_override = os.environ.get("DREAM_SERVICE_REGISTRY_PATH")

    try:
        canonical_manifest_dir = (root_dir / "extensions" / "services").resolve()
        if manifest_dir.resolve() == canonical_manifest_dir:
            artifact_path = registry_mod.ensure_registry_artifact(
                root_dir=root_dir,
                output_path=Path(artifact_override).resolve() if artifact_override else None,
                strict=True,
            )
            registry = registry_mod.load_registry_artifact(artifact_path)
        else:
            schema_path = root_dir / "extensions" / "schema" / "service-manifest.v1.json"
            registry = registry_mod.build_registry(
                root_dir=root_dir,
                extensions_dir=manifest_dir,
                schema_path=schema_path,
                strict=True,
            )
    except registry_mod.RegistryBuildError as exc:
        logger.warning("Manifest registry validation failed: %s", "; ".join(exc.errors))
        return {}, []
    except Exception as exc:
        logger.warning("Failed loading manifest registry from %s: %s", manifest_dir, exc)
        return {}, []

    services = registry_mod.build_runtime_services(registry, gpu_backend, dict(os.environ))
    features = registry_mod.build_runtime_features(registry, gpu_backend)
    logger.info(
        "Loaded %d extension manifests (%d services, %d features)",
        registry.get("manifest_count", 0),
        len(services),
        len(features),
    )
    return services, features


# --- Service Registry ---

MANIFEST_SERVICES, MANIFEST_FEATURES = load_extension_manifests(EXTENSIONS_DIR, GPU_BACKEND)
SERVICES = MANIFEST_SERVICES
if not SERVICES:
    logger.error("No services loaded from manifests in %s — dashboard will have no services", EXTENSIONS_DIR)

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
}
