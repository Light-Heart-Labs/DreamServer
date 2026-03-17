#!/usr/bin/env python3
"""Audit Dream Server extension manifests for registry consistency."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml


MANIFEST_NAMES = ("manifest.yaml", "manifest.yml", "manifest.json")
VALID_CATEGORIES = {"core", "recommended", "optional"}
VALID_TYPES = {"docker", "host-systemd"}
VALID_GPU_BACKENDS = {"amd", "nvidia", "apple", "all", "none"}
OVERLAY_SUFFIXES = {
    "amd": ("compose.amd.yaml", "compose.amd.yml"),
    "nvidia": ("compose.nvidia.yaml", "compose.nvidia.yml"),
    "apple": ("compose.apple.yaml", "compose.apple.yml"),
}
FEATURE_SERVICE_KEYS = (
    ("requirements", "services"),
    ("requirements", "services_all"),
    ("requirements", "services_any"),
    ("enabled_services_all",),
    ("enabled_services_any",),
)


@dataclass
class Issue:
    severity: str
    code: str
    message: str
    service: str | None = None
    path: str | None = None


@dataclass
class ServiceRecord:
    service_id: str
    directory_name: str
    directory: Path
    manifest_path: Path
    manifest: dict[str, Any]
    service: dict[str, Any]
    features: list[dict[str, Any]]
    compose_path: Path | None
    compose_enabled: bool
    overlay_paths: dict[str, Path]
    category: str
    service_type: str
    issues: list[Issue] = field(default_factory=list)

    def add_issue(self, severity: str, code: str, message: str) -> None:
        self.issues.append(
            Issue(
                severity=severity,
                code=code,
                message=message,
                service=self.service_id,
                path=str(self.manifest_path),
            )
        )

    @property
    def status(self) -> str:
        if any(issue.severity == "error" for issue in self.issues):
            return "fail"
        if any(issue.severity == "warning" for issue in self.issues):
            return "warn"
        return "pass"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit Dream Server extension manifests and feature contracts."
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Dream Server project directory (defaults to this repo).",
    )
    parser.add_argument("--json", action="store_true", help="Emit JSON output.")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as failures.",
    )
    parser.add_argument(
        "services",
        nargs="*",
        help="Optional service IDs to audit. Defaults to all services.",
    )
    return parser.parse_args(argv)


def load_document(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        if path.suffix == ".json":
            return json.load(handle)
        return yaml.safe_load(handle)


def find_manifest(service_dir: Path) -> Path | None:
    for name in MANIFEST_NAMES:
        candidate = service_dir / name
        if candidate.exists():
            return candidate
    return None


def as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def as_string_list(value: Any) -> list[str]:
    return [str(item) for item in as_list(value) if str(item)]


def parse_positive_int(value: Any) -> int | None:
    if value in (None, "") or isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def collect_service_references(feature: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    for path in FEATURE_SERVICE_KEYS:
        target: Any = feature
        for key in path:
            if not isinstance(target, dict):
                target = None
                break
            target = target.get(key)
        refs.extend(as_string_list(target))
    return refs


def resolve_compose_path(service_dir: Path, compose_file: str) -> tuple[Path | None, bool]:
    if not compose_file:
        return None, False

    enabled = service_dir / compose_file
    if enabled.exists():
        return enabled, True

    disabled = service_dir / f"{compose_file}.disabled"
    if disabled.exists():
        return disabled, False

    return enabled, False


def load_compose_service(path: Path, service_id: str) -> Any:
    document = load_document(path)
    if not isinstance(document, dict):
        raise ValueError("compose root must be a mapping")
    services = document.get("services", {})
    if not isinstance(services, dict):
        raise ValueError("compose services block must be a mapping")
    if services == {}:
        return {}
    return services.get(service_id)


def extract_target_ports(service_def: Any) -> list[int]:
    if not isinstance(service_def, dict):
        return []

    results: list[int] = []
    for port in as_list(service_def.get("ports")):
        if isinstance(port, int) and port > 0:
            results.append(port)
            continue
        if isinstance(port, str):
            tail = port.rsplit(":", 1)[-1].split("/", 1)[0]
            try:
                results.append(int(tail))
            except ValueError:
                continue
            continue
        if isinstance(port, dict):
            target = parse_positive_int(port.get("target"))
            if target:
                results.append(target)
    return results


def ports_reference_env(service_def: Any, env_name: str) -> bool:
    if not isinstance(service_def, dict) or not env_name:
        return False

    needle = f"${{{env_name}"
    for port in as_list(service_def.get("ports")):
        if isinstance(port, str) and needle in port:
            return True
        if isinstance(port, dict):
            published = port.get("published")
            if isinstance(published, str) and env_name in published:
                return True
    return False


def discover_services(project_dir: Path) -> tuple[list[ServiceRecord], list[Issue]]:
    ext_dir = project_dir / "extensions" / "services"
    records: list[ServiceRecord] = []
    issues: list[Issue] = []

    if not ext_dir.exists():
        return records, [
            Issue(
                severity="error",
                code="extensions-dir-missing",
                message="extensions/services directory not found",
                path=str(ext_dir),
            )
        ]

    for service_dir in sorted(ext_dir.iterdir()):
        if not service_dir.is_dir():
            continue

        manifest_path = find_manifest(service_dir)
        if manifest_path is None:
            issues.append(
                Issue(
                    severity="warning",
                    code="manifest-missing",
                    message="service directory has no manifest",
                    service=service_dir.name,
                    path=str(service_dir),
                )
            )
            continue

        try:
            manifest = load_document(manifest_path)
        except Exception as exc:
            issues.append(
                Issue(
                    severity="error",
                    code="manifest-invalid",
                    message=f"failed to parse manifest: {exc}",
                    service=service_dir.name,
                    path=str(manifest_path),
                )
            )
            continue

        if not isinstance(manifest, dict):
            issues.append(
                Issue(
                    severity="error",
                    code="manifest-shape-invalid",
                    message="manifest root must be a mapping",
                    service=service_dir.name,
                    path=str(manifest_path),
                )
            )
            continue

        service = manifest.get("service")
        if not isinstance(service, dict):
            issues.append(
                Issue(
                    severity="error",
                    code="service-section-missing",
                    message="manifest must contain a service mapping",
                    service=service_dir.name,
                    path=str(manifest_path),
                )
            )
            continue

        features = manifest.get("features") or []
        if not isinstance(features, list):
            issues.append(
                Issue(
                    severity="warning",
                    code="features-invalid",
                    message="features should be a list",
                    service=service.get("id", service_dir.name),
                    path=str(manifest_path),
                )
            )
            features = []

        compose_path, compose_enabled = resolve_compose_path(
            service_dir, str(service.get("compose_file") or "")
        )
        overlay_paths = {
            backend: next(
                (service_dir / name for name in names if (service_dir / name).exists()),
                None,
            )
            for backend, names in OVERLAY_SUFFIXES.items()
        }

        records.append(
            ServiceRecord(
                service_id=str(service.get("id") or service_dir.name),
                directory_name=service_dir.name,
                directory=service_dir,
                manifest_path=manifest_path,
                manifest=manifest,
                service=service,
                features=features,
                compose_path=compose_path,
                compose_enabled=compose_enabled,
                overlay_paths=overlay_paths,
                category=str(service.get("category") or "optional"),
                service_type=str(service.get("type") or "docker"),
            )
        )

        records[-1].overlay_paths = {
            backend: path
            for backend, path in records[-1].overlay_paths.items()
            if path is not None
        }

    return records, issues


def filter_records(records: list[ServiceRecord], requested: list[str]) -> tuple[list[ServiceRecord], list[Issue]]:
    if not requested:
        return records, []

    selected = [record for record in records if record.service_id in set(requested)]
    known = {record.service_id for record in records}
    missing = [
        Issue(
            severity="error",
            code="service-not-found",
            message=f"requested service '{service_id}' was not found",
            service=service_id,
        )
        for service_id in requested
        if service_id not in known
    ]
    return selected, missing


def validate_records(records: list[ServiceRecord], global_issues: list[Issue], reference_records: list[ServiceRecord]) -> None:
    known_services = {record.service_id for record in reference_records}
    alias_owners: dict[str, set[str]] = {}
    feature_owners: dict[str, set[str]] = {}
    service_id_owners: dict[str, set[str]] = {}

    for record in reference_records:
        service_id_owners.setdefault(record.service_id, set()).add(record.directory_name)
        for alias in as_string_list(record.service.get("aliases")):
            alias_owners.setdefault(alias, set()).add(record.service_id)
        for feature in record.features:
            if not isinstance(feature, dict):
                continue
            feature_id = str(feature.get("id") or "")
            if feature_id:
                feature_owners.setdefault(feature_id, set()).add(record.service_id)

    for service_id, owners in service_id_owners.items():
        if len(owners) > 1:
            global_issues.append(
                Issue(
                    severity="error",
                    code="service-id-collision",
                    message=f"service.id '{service_id}' is declared in multiple directories",
                    service=service_id,
                )
            )

    for record in records:
        manifest = record.manifest
        service = record.service

        if manifest.get("schema_version") != "dream.services.v1":
            record.add_issue("error", "schema-version-invalid", "schema_version must be dream.services.v1")

        if record.directory_name != record.service_id:
            record.add_issue("error", "service-id-directory-mismatch", "service.id must match its directory name")

        if not str(service.get("name") or "").strip():
            record.add_issue("error", "service-name-missing", "service.name is required")

        if record.category not in VALID_CATEGORIES:
            record.add_issue("error", "service-category-invalid", "service.category is invalid")

        if record.service_type not in VALID_TYPES:
            record.add_issue("error", "service-type-invalid", "service.type is invalid")

        if parse_positive_int(service.get("port")) is None:
            record.add_issue("error", "service-port-invalid", "service.port must be a positive integer")

        health = str(service.get("health") or "")
        if not health.startswith("/"):
            record.add_issue("error", "service-health-invalid", "service.health must start with '/'")

        backends = as_string_list(service.get("gpu_backends") or ["amd", "nvidia"])
        invalid_backends = [backend for backend in backends if backend not in VALID_GPU_BACKENDS]
        if invalid_backends:
            record.add_issue("error", "service-gpu-backends-invalid", f"unknown gpu_backends values: {', '.join(invalid_backends)}")

        aliases = as_string_list(service.get("aliases"))
        seen_aliases: set[str] = set()
        for alias in aliases:
            if alias in seen_aliases:
                record.add_issue("error", "alias-duplicate-local", f"alias '{alias}' is listed more than once")
                continue
            seen_aliases.add(alias)
            owners = alias_owners.get(alias, set())
            if owners - {record.service_id}:
                owner = sorted(owners - {record.service_id})[0]
                record.add_issue("error", "alias-collision", f"alias '{alias}' already belongs to '{owner}'")

        env_vars = service.get("env_vars")
        if env_vars is not None and not isinstance(env_vars, list):
            record.add_issue("error", "env-vars-invalid", "service.env_vars must be a list when present")

        if record.service_type == "docker":
            compose_file = str(service.get("compose_file") or "")
            if record.category != "core" and not compose_file:
                record.add_issue("error", "compose-file-missing", "non-core docker services must declare service.compose_file")
            elif compose_file and (record.compose_path is None or not record.compose_path.exists()):
                record.add_issue("error", "compose-file-missing", f"compose file '{compose_file}' was not found")
            elif record.compose_path and record.compose_path.exists():
                try:
                    base_service = load_compose_service(record.compose_path, record.service_id)
                except Exception as exc:
                    record.add_issue("error", "compose-invalid", f"failed to parse compose file: {exc}")
                    base_service = None

                if record.category != "core" and base_service is None:
                    record.add_issue("error", "compose-service-missing", f"compose file does not define service '{record.service_id}'")

                backends_for_stub = [backend for backend in backends if backend in {"amd", "nvidia", "apple"}]
                if base_service == {}:
                    for backend in backends_for_stub:
                        if backend not in record.overlay_paths:
                            record.add_issue("error", "overlay-required", f"stub compose requires compose.{backend}.yaml")

                # Warn when filesystem overlays don't match declared gpu_backends.
                # This helps avoid stale overlay files after backend contract changes.
                for overlay_backend in record.overlay_paths.keys():
                    if "all" in backends or "none" in backends:
                        break
                    if overlay_backend not in backends_for_stub:
                        record.add_issue(
                            "warning",
                            "overlay-backend-extra",
                            f"compose.{overlay_backend}.yaml exists but gpu_backends does not include '{overlay_backend}'",
                        )

                definitions = [definition for definition in [base_service] if isinstance(definition, dict)]
                for overlay_path in record.overlay_paths.values():
                    try:
                        overlay_service = load_compose_service(overlay_path, record.service_id)
                    except Exception as exc:
                        record.add_issue("error", "overlay-invalid", f"failed to parse {overlay_path.name}: {exc}")
                        continue
                    if overlay_service is None:
                        record.add_issue("error", "overlay-service-missing", f"{overlay_path.name} does not define service '{record.service_id}'")
                        continue
                    definitions.append(overlay_service)

                container_name = str(service.get("container_name") or "")
                if container_name and definitions:
                    if not any(definition.get("container_name") == container_name for definition in definitions):
                        record.add_issue("error", "container-name-mismatch", f"container_name '{container_name}' was not found in compose definitions")

                port = parse_positive_int(service.get("port"))
                if port is not None and definitions:
                    if not any(port in extract_target_ports(definition) for definition in definitions):
                        record.add_issue("error", "compose-port-mismatch", f"no compose port mapping targets manifest service.port {port}")

                external_port_env = str(service.get("external_port_env") or "")
                if external_port_env and definitions:
                    if not any(ports_reference_env(definition, external_port_env) for definition in definitions):
                        record.add_issue("warning", "compose-port-env-unused", f"compose ports do not reference '{external_port_env}'")

                if definitions and not any("healthcheck" in definition for definition in definitions):
                    record.add_issue("warning", "healthcheck-missing", "docker service has no healthcheck stanza in compose definitions")

        for dep in as_string_list(service.get("depends_on")):
            if dep not in known_services:
                record.add_issue("error", "dependency-missing", f"depends_on references unknown service '{dep}'")

        for feature in record.features:
            if not isinstance(feature, dict):
                record.add_issue("error", "feature-invalid", "each feature entry must be a mapping")
                continue

            for required in ("id", "name", "description", "category", "priority"):
                if feature.get(required) in (None, ""):
                    record.add_issue("error", "feature-field-missing", f"feature is missing required field '{required}'")

            feature_id = str(feature.get("id") or "")
            owners = feature_owners.get(feature_id, set())
            if feature_id and owners - {record.service_id}:
                owner = sorted(owners - {record.service_id})[0]
                record.add_issue("error", "feature-id-collision", f"feature id '{feature_id}' already belongs to '{owner}'")

            for ref in collect_service_references(feature):
                if ref not in known_services:
                    record.add_issue("error", "feature-service-reference-invalid", f"feature references unknown service '{ref}'")


def build_payload(project_dir: Path, records: list[ServiceRecord], global_issues: list[Issue], strict: bool, requested: list[str]) -> dict[str, Any]:
    errors = sum(1 for issue in global_issues if issue.severity == "error")
    warnings = sum(1 for issue in global_issues if issue.severity == "warning")

    services = []
    for record in records:
        errors += sum(1 for issue in record.issues if issue.severity == "error")
        warnings += sum(1 for issue in record.issues if issue.severity == "warning")
        services.append(
            {
                "service_id": record.service_id,
                "category": record.category,
                "type": record.service_type,
                "status": record.status,
                "issues": [asdict(issue) for issue in record.issues],
            }
        )

    result = "fail" if errors > 0 or (strict and warnings > 0) else "pass"
    return {
        "project_dir": str(project_dir),
        "requested_services": requested,
        "summary": {
            "services_audited": len(records),
            "errors": errors,
            "warnings": warnings,
            "strict": strict,
            "result": result,
        },
        "global_issues": [asdict(issue) for issue in global_issues],
        "services": services,
    }


def print_human_report(payload: dict[str, Any]) -> None:
    summary = payload["summary"]
    print("Dream Server Extension Audit")
    print(f"Project: {payload['project_dir']}")
    if payload["requested_services"]:
        print(f"Scope: {', '.join(payload['requested_services'])}")
    else:
        print(f"Scope: all extensions ({summary['services_audited']})")
    print("")

    for issue in payload["global_issues"]:
        prefix = "ERROR" if issue["severity"] == "error" else "WARN"
        print(f"{prefix} global {issue['code']}: {issue['message']}")
    if payload["global_issues"]:
        print("")

    for service in payload["services"]:
        print(f"{service['status'].upper():4} {service['service_id']} ({service['category']}, {service['type']})")
        for issue in service["issues"]:
            prefix = "ERROR" if issue["severity"] == "error" else "WARN"
            print(f"     {prefix} {issue['code']}: {issue['message']}")

    print("")
    print(
        "Summary: "
        f"{summary['services_audited']} services, "
        f"{summary['errors']} errors, "
        f"{summary['warnings']} warnings, "
        f"result={summary['result']}"
    )


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    project_dir = args.project_dir.resolve()
    records, global_issues = discover_services(project_dir)
    selected, missing = filter_records(records, args.services)
    global_issues.extend(missing)
    validate_records(selected, global_issues, records)
    payload = build_payload(project_dir, selected, global_issues, args.strict, args.services)

    if args.json:
        json.dump(payload, sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        print_human_report(payload)

    if payload["summary"]["errors"] > 0:
        return 1
    if args.strict and payload["summary"]["warnings"] > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
