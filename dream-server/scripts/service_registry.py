#!/usr/bin/env python3
"""Shared extension manifest validation and service registry builder."""

from __future__ import annotations

import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import yaml
except Exception as exc:  # pragma: no cover - surfaced at runtime if missing
    yaml = None
    YAML_IMPORT_ERROR = exc
else:
    YAML_IMPORT_ERROR = None

MANIFEST_SCHEMA_VERSION = "dream.services.v1"
REGISTRY_SCHEMA_VERSION = "dream.service-registry.v1"
MANIFEST_FILE_NAMES = ("manifest.yaml", "manifest.yml", "manifest.json")
DEFAULT_ARTIFACT_TEMPLATE = "/tmp/dream-service-registry.{uid}.json"


@dataclass
class RegistryBuildError(Exception):
    """Raised when manifest validation or registry build fails."""

    errors: list[str]

    def __str__(self) -> str:
        return "\n".join(self.errors)


def _json_type_name(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__


def _matches_type(value: Any, expected_type: str) -> bool:
    if expected_type == "object":
        return isinstance(value, dict)
    if expected_type == "array":
        return isinstance(value, list)
    if expected_type == "string":
        return isinstance(value, str)
    if expected_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected_type == "number":
        return (isinstance(value, int) or isinstance(value, float)) and not isinstance(
            value, bool
        )
    if expected_type == "boolean":
        return isinstance(value, bool)
    if expected_type == "null":
        return value is None
    return False


def _validate_value(
    value: Any, schema: dict[str, Any], path: str, errors: list[str]
) -> None:
    expected = schema.get("type")
    if expected is not None:
        expected_types = expected if isinstance(expected, list) else [expected]
        if not any(_matches_type(value, et) for et in expected_types):
            errors.append(
                f"{path}: expected type {expected_types}, got {_json_type_name(value)}"
            )
            return

    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: expected constant {schema['const']!r}")

    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: expected one of {schema['enum']!r}, got {value!r}")

    if isinstance(value, str):
        min_length = schema.get("minLength")
        if isinstance(min_length, int) and len(value) < min_length:
            errors.append(f"{path}: length must be >= {min_length}")

        pattern = schema.get("pattern")
        if isinstance(pattern, str):
            try:
                if re.fullmatch(pattern, value) is None:
                    errors.append(f"{path}: does not match pattern {pattern!r}")
            except re.error as exc:
                errors.append(f"{path}: invalid regex in schema {pattern!r}: {exc}")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if minimum is not None and value < minimum:
            errors.append(f"{path}: must be >= {minimum}")
        if maximum is not None and value > maximum:
            errors.append(f"{path}: must be <= {maximum}")

    if isinstance(value, list):
        min_items = schema.get("minItems")
        if isinstance(min_items, int) and len(value) < min_items:
            errors.append(f"{path}: must contain at least {min_items} items")

        if schema.get("uniqueItems") is True:
            seen: set[str] = set()
            duplicates: set[str] = set()
            for item in value:
                key = json.dumps(item, sort_keys=True, default=str)
                if key in seen:
                    duplicates.add(key)
                else:
                    seen.add(key)
            if duplicates:
                errors.append(f"{path}: must not contain duplicate items")

        items_schema = schema.get("items")
        if isinstance(items_schema, dict):
            for idx, item in enumerate(value):
                _validate_value(item, items_schema, f"{path}[{idx}]", errors)

    if isinstance(value, dict):
        required = schema.get("required", [])
        if isinstance(required, list):
            for key in required:
                if key not in value:
                    errors.append(f"{path}: missing required property '{key}'")

        properties = schema.get("properties", {})
        additional = schema.get("additionalProperties", True)
        if not isinstance(properties, dict):
            properties = {}

        for key, child in value.items():
            child_path = f"{path}.{key}"
            if key in properties and isinstance(properties[key], dict):
                _validate_value(child, properties[key], child_path, errors)
            elif additional is False:
                errors.append(f"{path}: unknown property '{key}'")
            elif isinstance(additional, dict):
                _validate_value(child, additional, child_path, errors)


def validate_manifest(manifest: dict[str, Any], schema: dict[str, Any]) -> list[str]:
    """Validate one manifest object using a schema subset used in this repo."""
    errors: list[str] = []
    _validate_value(manifest, schema, "$", errors)
    return errors


def discover_manifest_paths(extensions_dir: Path) -> list[Path]:
    """Return ordered manifest files from extensions/services/*/manifest.*."""
    paths: list[Path] = []
    if not extensions_dir.exists():
        return paths
    for service_dir in sorted(extensions_dir.iterdir()):
        if not service_dir.is_dir():
            continue
        for name in MANIFEST_FILE_NAMES:
            candidate = service_dir / name
            if candidate.exists():
                paths.append(candidate)
                break
    return paths


def read_manifest_file(path: Path) -> dict[str, Any]:
    """Load a JSON or YAML manifest file."""
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        data = json.loads(text)
    else:
        if yaml is None:
            raise RuntimeError(
                f"PyYAML is required to read {path} ({YAML_IMPORT_ERROR})"
            )
        data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ValueError("manifest root must be an object")
    return data


def _service_entry(manifest_path: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    service_dir = manifest_path.parent.resolve()
    service = manifest.get("service", {})
    if not isinstance(service, dict):
        service = {}

    compose_file = str(service.get("compose_file") or "")
    compose_path = ""
    if compose_file:
        full_compose = (service_dir / compose_file).resolve()
        if full_compose.exists():
            compose_path = str(full_compose)

    setup_hook = str(service.get("setup_hook") or "")
    setup_path = ""
    if setup_hook:
        full_hook = (service_dir / setup_hook).resolve()
        if full_hook.exists():
            setup_path = str(full_hook)

    aliases = service.get("aliases", [])
    if not isinstance(aliases, list):
        aliases = []
    depends_on = service.get("depends_on", [])
    if not isinstance(depends_on, list):
        depends_on = []
    gpu_backends = service.get("gpu_backends", [])
    if not isinstance(gpu_backends, list):
        gpu_backends = []

    return {
        "id": str(service.get("id", "")),
        "name": str(service.get("name", "")),
        "aliases": [str(x) for x in aliases],
        "container_name": str(service.get("container_name", "")),
        "host_env": str(service.get("host_env", "")),
        "default_host": str(service.get("default_host", "localhost")),
        "port": int(service.get("port", 0)),
        "external_port_env": str(service.get("external_port_env", "")),
        "external_port_default": int(service.get("external_port_default", 0)),
        "health": str(service.get("health", "/health")),
        "type": str(service.get("type", "docker")),
        "gpu_backends": [str(x) for x in gpu_backends],
        "compose_file": compose_file,
        "compose_path": compose_path,
        "category": str(service.get("category", "optional")),
        "depends_on": [str(x) for x in depends_on],
        "setup_hook": setup_hook,
        "setup_path": setup_path,
        "sidebar_icon": str(service.get("sidebar_icon", "")),
        "manifest_path": str(manifest_path.resolve()),
        "service_dir": str(service_dir),
    }


def _feature_entries(
    service_id: str, manifest_path: Path, features: list[Any]
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        entry = dict(feature)
        entry["service_id"] = service_id
        entry["manifest_path"] = str(manifest_path.resolve())
        entries.append(entry)
    return entries


def _semantic_checks(
    services: list[dict[str, Any]], extensions_dir: Path
) -> list[str]:
    errors: list[str] = []
    id_to_service: dict[str, dict[str, Any]] = {}
    alias_to_service: dict[str, str] = {}

    for service in services:
        sid = service["id"]
        if sid in id_to_service:
            errors.append(
                f"{service['manifest_path']}: duplicate service.id '{sid}' "
                f"(already defined in {id_to_service[sid]['manifest_path']})"
            )
        else:
            id_to_service[sid] = service

    for service in services:
        sid = service["id"]
        service_dir = Path(service["service_dir"])

        if service_dir.parent == extensions_dir and service_dir.name != sid:
            errors.append(
                f"{service['manifest_path']}: service.id '{sid}' should match "
                f"directory name '{service_dir.name}'"
            )

        compose_file = service.get("compose_file", "")
        compose_path = service.get("compose_path", "")
        if compose_file and not compose_path:
            errors.append(
                f"{service['manifest_path']}: compose_file '{compose_file}' not found"
            )

        if (
            service.get("type") == "docker"
            and service.get("category") != "core"
            and not compose_file
        ):
            errors.append(
                f"{service['manifest_path']}: non-core docker service must define compose_file"
            )

        setup_hook = service.get("setup_hook", "")
        setup_path = service.get("setup_path", "")
        if setup_hook and not setup_path:
            errors.append(
                f"{service['manifest_path']}: setup_hook '{setup_hook}' not found"
            )

        keys = [sid, *service.get("aliases", [])]
        for alias in keys:
            owner = alias_to_service.get(alias)
            if owner and owner != sid:
                errors.append(
                    f"{service['manifest_path']}: alias '{alias}' conflicts with service '{owner}'"
                )
            else:
                alias_to_service[alias] = sid

    known_ids = set(id_to_service.keys())
    for service in services:
        for dep in service.get("depends_on", []):
            if dep not in known_ids:
                errors.append(
                    f"{service['manifest_path']}: depends_on references unknown service '{dep}'"
                )

    return errors


def _default_artifact_path() -> Path:
    uid = os.getuid() if hasattr(os, "getuid") else 0
    return Path(DEFAULT_ARTIFACT_TEMPLATE.format(uid=uid))


def build_registry(
    *,
    root_dir: Path | str,
    extensions_dir: Path | str | None = None,
    schema_path: Path | str | None = None,
    strict: bool = True,
) -> dict[str, Any]:
    """Build registry data from manifests and schema."""
    root = Path(root_dir).resolve()
    ext_dir = (
        Path(extensions_dir).resolve()
        if extensions_dir is not None
        else (root / "extensions" / "services").resolve()
    )
    schema_file = (
        Path(schema_path).resolve()
        if schema_path is not None
        else (root / "extensions" / "schema" / "service-manifest.v1.json").resolve()
    )

    if not schema_file.exists():
        raise RegistryBuildError([f"schema file not found: {schema_file}"])

    try:
        schema_obj = json.loads(schema_file.read_text(encoding="utf-8"))
    except Exception as exc:
        raise RegistryBuildError([f"failed to read schema {schema_file}: {exc}"]) from exc

    manifest_paths = discover_manifest_paths(ext_dir)
    services: list[dict[str, Any]] = []
    features: list[dict[str, Any]] = []
    errors: list[str] = []

    for manifest_path in manifest_paths:
        try:
            manifest = read_manifest_file(manifest_path)
        except Exception as exc:
            errors.append(f"{manifest_path}: {exc}")
            continue

        validation_errors = validate_manifest(manifest, schema_obj)
        if validation_errors:
            for err in validation_errors:
                errors.append(f"{manifest_path}: {err}")
            continue

        service_entry = _service_entry(manifest_path, manifest)
        services.append(service_entry)
        service_id = service_entry["id"]
        manifest_features = manifest.get("features", [])
        if isinstance(manifest_features, list):
            features.extend(_feature_entries(service_id, manifest_path, manifest_features))

    errors.extend(_semantic_checks(services, ext_dir))

    services_sorted = sorted(services, key=lambda item: item["id"])
    features_sorted = sorted(
        features,
        key=lambda item: (str(item.get("service_id", "")), str(item.get("id", ""))),
    )

    registry: dict[str, Any] = {
        "schema_version": REGISTRY_SCHEMA_VERSION,
        "manifest_schema_version": MANIFEST_SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "root_dir": str(root),
        "extensions_dir": str(ext_dir),
        "schema_path": str(schema_file),
        "manifest_count": len(manifest_paths),
        "service_count": len(services_sorted),
        "feature_count": len(features_sorted),
        "manifests": [str(p.resolve()) for p in manifest_paths],
        "services": services_sorted,
        "features": features_sorted,
    }

    if errors:
        registry["errors"] = errors
        if strict:
            raise RegistryBuildError(errors)

    return registry


def _artifact_needs_refresh(output_path: Path, source_paths: list[Path]) -> bool:
    if not output_path.exists():
        return True

    artifact_mtime = output_path.stat().st_mtime
    for source in source_paths:
        if source.exists() and source.stat().st_mtime > artifact_mtime:
            return True
    return False


def ensure_registry_artifact(
    *,
    root_dir: Path | str,
    output_path: Path | str | None = None,
    extensions_dir: Path | str | None = None,
    schema_path: Path | str | None = None,
    strict: bool = True,
    force: bool = False,
) -> Path:
    """Ensure a fresh shared registry artifact exists and return its path."""
    root = Path(root_dir).resolve()
    ext_dir = (
        Path(extensions_dir).resolve()
        if extensions_dir is not None
        else (root / "extensions" / "services").resolve()
    )
    schema_file = (
        Path(schema_path).resolve()
        if schema_path is not None
        else (root / "extensions" / "schema" / "service-manifest.v1.json").resolve()
    )
    out = (
        Path(output_path).resolve()
        if output_path is not None
        else _default_artifact_path().resolve()
    )

    source_paths = [Path(__file__).resolve(), schema_file, *discover_manifest_paths(ext_dir)]
    if force or _artifact_needs_refresh(out, source_paths):
        registry = build_registry(
            root_dir=root,
            extensions_dir=ext_dir,
            schema_path=schema_file,
            strict=strict,
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=out.parent, delete=False
        ) as temp_file:
            json.dump(registry, temp_file, indent=2, sort_keys=True)
            temp_file.write("\n")
            tmp_path = Path(temp_file.name)
        tmp_path.replace(out)

    return out


def load_registry_artifact(path: Path | str) -> dict[str, Any]:
    """Load a previously generated registry artifact."""
    artifact_path = Path(path).resolve()
    data = json.loads(artifact_path.read_text(encoding="utf-8"))
    if data.get("schema_version") != REGISTRY_SCHEMA_VERSION:
        raise ValueError(
            f"invalid registry schema version in {artifact_path}: "
            f"{data.get('schema_version')!r}"
        )
    return data


def service_supported_for_backend(
    service: dict[str, Any], gpu_backend: str, *, apple_include_all_docker: bool = True
) -> bool:
    """Return True when a service should be visible for the selected backend."""
    backend = (gpu_backend or "nvidia").lower()
    service_type = str(service.get("type", "docker"))

    if backend == "apple" and apple_include_all_docker:
        return service_type != "host-systemd"

    supported = service.get("gpu_backends") or ["amd", "nvidia", "apple"]
    if not isinstance(supported, list):
        supported = ["amd", "nvidia", "apple"]
    return backend in supported or "all" in supported or "none" in supported


def feature_supported_for_backend(
    feature: dict[str, Any], gpu_backend: str, *, apple_include_all: bool = True
) -> bool:
    """Return True when a feature should be visible for the selected backend."""
    backend = (gpu_backend or "nvidia").lower()
    if backend == "apple" and apple_include_all:
        return True

    supported = feature.get("gpu_backends") or ["amd", "nvidia", "apple"]
    if not isinstance(supported, list):
        supported = ["amd", "nvidia", "apple"]
    return backend in supported or "all" in supported or "none" in supported


def build_runtime_services(
    registry: dict[str, Any], gpu_backend: str, environ: dict[str, str]
) -> dict[str, dict[str, Any]]:
    """Convert canonical registry entries into runtime dashboard service config."""
    services: dict[str, dict[str, Any]] = {}
    for service in registry.get("services", []):
        if not isinstance(service, dict):
            continue
        if not service_supported_for_backend(service, gpu_backend):
            continue

        service_id = service.get("id")
        if not service_id:
            continue

        host_env = service.get("host_env", "")
        default_host = service.get("default_host", "localhost")
        host = environ.get(host_env, default_host) if host_env else default_host

        ext_port_env = service.get("external_port_env", "")
        ext_port_default = int(service.get("external_port_default", service.get("port", 0)))
        external_port = (
            int(environ.get(ext_port_env, str(ext_port_default)))
            if ext_port_env
            else ext_port_default
        )

        services[service_id] = {
            "host": host,
            "port": int(service.get("port", 0)),
            "external_port": external_port,
            "external_port_default": ext_port_default,
            "health": service.get("health", "/health"),
            "name": service.get("name", service_id),
            "category": service.get("category", "optional"),
            "aliases": service.get("aliases", []),
            "type": service.get("type", "docker"),
        }
    return services


def build_runtime_features(
    registry: dict[str, Any], gpu_backend: str
) -> list[dict[str, Any]]:
    """Convert canonical registry entries into runtime dashboard feature list."""
    features: list[dict[str, Any]] = []
    for feature in registry.get("features", []):
        if not isinstance(feature, dict):
            continue
        if not feature_supported_for_backend(feature, gpu_backend):
            continue
        features.append(feature)
    return features

