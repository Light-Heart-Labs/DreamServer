#!/usr/bin/env python3
"""Export Dream Server extension metadata as JSON, Markdown, or NDJSON."""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import yaml


MANIFEST_NAMES = ("manifest.yaml", "manifest.yml", "manifest.json")
VALID_CATEGORIES = {"core", "recommended", "optional"}
VALID_TYPES = {"docker", "host-systemd"}
VALID_STATUSES = {"always-on", "enabled", "disabled", "missing"}


@dataclass
class CatalogIssue:
    code: str
    message: str
    severity: str = "error"
    service: str | None = None
    path: str | None = None


@dataclass
class FeatureEntry:
    id: str
    name: str
    category: str
    priority: int
    description: str = ""


@dataclass
class ServiceEntry:
    id: str
    name: str
    category: str
    type: str
    status: str
    aliases: list[str]
    depends_on: list[str]
    gpu_backends: list[str]
    feature_count: int
    path: str
    compose_file: str
    features: list[FeatureEntry] = field(default_factory=list)

    def to_dict(self, include_features: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "category": self.category,
            "type": self.type,
            "status": self.status,
            "aliases": self.aliases,
            "depends_on": self.depends_on,
            "gpu_backends": self.gpu_backends,
            "feature_count": self.feature_count,
            "path": self.path,
            "compose_file": self.compose_file,
        }
        if include_features:
            payload["features"] = [asdict(feature) for feature in self.features]
        return payload


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export a catalog of Dream Server extensions."
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Dream Server project directory (defaults to this repo).",
    )
    parser.add_argument(
        "--format",
        choices=("json", "markdown", "ndjson"),
        default="json",
        help="Output format (default: json).",
    )
    parser.add_argument(
        "--category",
        choices=sorted(VALID_CATEGORIES),
        help="Filter services by category.",
    )
    parser.add_argument(
        "--status",
        choices=sorted(VALID_STATUSES),
        help="Filter services by runtime status.",
    )
    parser.add_argument(
        "--service-type",
        choices=sorted(VALID_TYPES),
        help="Filter services by service.type.",
    )
    parser.add_argument(
        "--gpu-backend",
        action="append",
        default=[],
        help="Filter services that include one or more gpu_backends values.",
    )
    parser.add_argument(
        "--service",
        action="append",
        default=[],
        help="Include only specific service IDs (repeatable).",
    )
    parser.add_argument(
        "--include-features",
        action="store_true",
        help="Include full feature payload in JSON/NDJSON output.",
    )
    parser.add_argument(
        "--sort",
        choices=("id", "name", "category", "status", "feature_count"),
        default="id",
        help="Sort key for services output.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Return non-zero if catalog issues are found.",
    )
    parser.add_argument(
        "--summary-only",
        action="store_true",
        help="Print only summary output.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Write output to file instead of stdout.",
    )
    parser.add_argument(
        "--compact",
        action="store_true",
        help="Compact JSON output (json/ndjson only).",
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


def as_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    return [str(value)]


def as_int(value: Any, default: int = 0) -> int:
    try:
        if isinstance(value, bool):
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def service_status(service_dir: Path, compose_file: str) -> str:
    if not compose_file:
        return "always-on"
    enabled = service_dir / compose_file
    disabled = service_dir / f"{compose_file}.disabled"
    if enabled.exists():
        return "enabled"
    if disabled.exists():
        return "disabled"
    return "missing"


def collect_features(document: dict[str, Any], issues: list[CatalogIssue], service_id: str, manifest_path: Path) -> list[FeatureEntry]:
    raw_features = document.get("features")
    if raw_features is None:
        return []
    if not isinstance(raw_features, list):
        issues.append(
            CatalogIssue(
                code="features-not-list",
                message="features should be a list",
                severity="warning",
                service=service_id,
                path=str(manifest_path),
            )
        )
        return []

    features: list[FeatureEntry] = []
    for idx, raw in enumerate(raw_features):
        if not isinstance(raw, dict):
            issues.append(
                CatalogIssue(
                    code="feature-invalid",
                    message=f"feature[{idx}] is not an object",
                    severity="warning",
                    service=service_id,
                    path=str(manifest_path),
                )
            )
            continue
        feature_id = str(raw.get("id") or f"feature-{idx}")
        features.append(
            FeatureEntry(
                id=feature_id,
                name=str(raw.get("name") or feature_id),
                category=str(raw.get("category") or "uncategorized"),
                priority=as_int(raw.get("priority"), 0),
                description=str(raw.get("description") or ""),
            )
        )
    return features


def build_service_entry(service_dir: Path, manifest_path: Path, document: dict[str, Any], issues: list[CatalogIssue]) -> ServiceEntry | None:
    service = document.get("service")
    if not isinstance(service, dict):
        issues.append(
            CatalogIssue(
                code="service-section-missing",
                message="manifest missing service mapping",
                service=service_dir.name,
                path=str(manifest_path),
            )
        )
        return None

    service_id = str(service.get("id") or service_dir.name)
    category = str(service.get("category") or "optional")
    service_type = str(service.get("type") or "docker")
    compose_file = str(service.get("compose_file") or "")
    aliases = as_string_list(service.get("aliases"))
    depends_on = as_string_list(service.get("depends_on"))
    gpu_backends = as_string_list(service.get("gpu_backends") or ["amd", "nvidia"])
    features = collect_features(document, issues, service_id, manifest_path)

    if document.get("schema_version") != "dream.services.v1":
        issues.append(
            CatalogIssue(
                code="schema-version-invalid",
                message="schema_version should be dream.services.v1",
                service=service_id,
                path=str(manifest_path),
            )
        )

    if service_dir.name != service_id:
        issues.append(
            CatalogIssue(
                code="service-id-dir-mismatch",
                message=f"service.id '{service_id}' differs from directory '{service_dir.name}'",
                severity="warning",
                service=service_id,
                path=str(manifest_path),
            )
        )

    if category not in VALID_CATEGORIES:
        issues.append(
            CatalogIssue(
                code="category-invalid",
                message=f"unknown category '{category}'",
                service=service_id,
                path=str(manifest_path),
            )
        )

    if service_type not in VALID_TYPES:
        issues.append(
            CatalogIssue(
                code="type-invalid",
                message=f"unknown service.type '{service_type}'",
                service=service_id,
                path=str(manifest_path),
            )
        )

    return ServiceEntry(
        id=service_id,
        name=str(service.get("name") or service_id),
        category=category,
        type=service_type,
        status=service_status(service_dir, compose_file),
        aliases=aliases,
        depends_on=depends_on,
        gpu_backends=gpu_backends,
        feature_count=len(features),
        path=str(service_dir.relative_to(service_dir.parents[2])),
        compose_file=compose_file,
        features=features,
    )


def discover_services(project_dir: Path) -> tuple[list[ServiceEntry], list[CatalogIssue]]:
    services_dir = project_dir / "extensions" / "services"
    issues: list[CatalogIssue] = []
    entries: list[ServiceEntry] = []

    if not services_dir.exists():
        issues.append(
            CatalogIssue(
                code="extensions-dir-missing",
                message=f"missing directory: {services_dir}",
                path=str(services_dir),
            )
        )
        return entries, issues

    for service_dir in sorted(services_dir.iterdir()):
        if not service_dir.is_dir():
            continue

        manifest_path = find_manifest(service_dir)
        if manifest_path is None:
            issues.append(
                CatalogIssue(
                    code="manifest-missing",
                    message="service directory has no manifest file",
                    severity="warning",
                    service=service_dir.name,
                    path=str(service_dir),
                )
            )
            continue

        try:
            document = load_document(manifest_path)
        except Exception as exc:
            issues.append(
                CatalogIssue(
                    code="manifest-parse-failed",
                    message=str(exc),
                    service=service_dir.name,
                    path=str(manifest_path),
                )
            )
            continue

        if not isinstance(document, dict):
            issues.append(
                CatalogIssue(
                    code="manifest-root-invalid",
                    message="manifest root must be an object",
                    service=service_dir.name,
                    path=str(manifest_path),
                )
            )
            continue

        entry = build_service_entry(service_dir, manifest_path, document, issues)
        if entry is not None:
            entries.append(entry)

    return entries, issues


def apply_filters(
    entries: list[ServiceEntry],
    *,
    category: str | None,
    status: str | None,
    service_type: str | None,
    gpu_backends: list[str],
    service_ids: list[str],
) -> list[ServiceEntry]:
    filtered = entries
    if category:
        filtered = [entry for entry in filtered if entry.category == category]
    if status:
        filtered = [entry for entry in filtered if entry.status == status]
    if service_type:
        filtered = [entry for entry in filtered if entry.type == service_type]
    if gpu_backends:
        required = set(gpu_backends)
        filtered = [
            entry
            for entry in filtered
            if required.intersection(set(entry.gpu_backends))
        ]
    if service_ids:
        allowed = set(service_ids)
        filtered = [entry for entry in filtered if entry.id in allowed]
    return filtered


def sort_entries(entries: list[ServiceEntry], sort_key: str) -> list[ServiceEntry]:
    if sort_key == "feature_count":
        return sorted(entries, key=lambda item: (item.feature_count, item.id))
    if sort_key == "name":
        return sorted(entries, key=lambda item: (item.name.lower(), item.id))
    if sort_key == "category":
        return sorted(entries, key=lambda item: (item.category, item.id))
    if sort_key == "status":
        return sorted(entries, key=lambda item: (item.status, item.id))
    return sorted(entries, key=lambda item: item.id)


def make_summary(entries: list[ServiceEntry], issues: list[CatalogIssue]) -> dict[str, Any]:
    categories = Counter(entry.category for entry in entries)
    statuses = Counter(entry.status for entry in entries)
    service_types = Counter(entry.type for entry in entries)
    feature_count = sum(entry.feature_count for entry in entries)
    issue_counts = Counter(issue.severity for issue in issues)

    return {
        "service_count": len(entries),
        "feature_count": feature_count,
        "categories": dict(sorted(categories.items())),
        "statuses": dict(sorted(statuses.items())),
        "types": dict(sorted(service_types.items())),
        "issues": {
            "total": len(issues),
            "errors": issue_counts.get("error", 0),
            "warnings": issue_counts.get("warning", 0),
        },
    }


def build_payload(entries: list[ServiceEntry], issues: list[CatalogIssue], include_features: bool) -> dict[str, Any]:
    return {
        "summary": make_summary(entries, issues),
        "issues": [asdict(issue) for issue in issues],
        "services": [entry.to_dict(include_features=include_features) for entry in entries],
    }


def render_markdown(payload: dict[str, Any]) -> str:
    summary = payload["summary"]
    lines = [
        "# Dream Server Extension Catalog",
        "",
        f"- Services: {summary['service_count']}",
        f"- Features: {summary['feature_count']}",
        f"- Categories: {json.dumps(summary['categories'], sort_keys=True)}",
        f"- Statuses: {json.dumps(summary['statuses'], sort_keys=True)}",
        "",
        "| ID | Category | Status | Type | Features | GPU | Aliases | Depends On |",
        "|---|---|---|---|---:|---|---|---|",
    ]

    for service in payload["services"]:
        aliases = ", ".join(service["aliases"]) or "-"
        deps = ", ".join(service["depends_on"]) or "-"
        backends = ", ".join(service["gpu_backends"]) or "-"
        lines.append(
            "| {id} | {category} | {status} | {type} | {feature_count} | {gpu} | {aliases} | {depends_on} |".format(
                id=service["id"],
                category=service["category"],
                status=service["status"],
                type=service["type"],
                feature_count=service["feature_count"],
                gpu=backends,
                aliases=aliases,
                depends_on=deps,
            )
        )

    if payload["issues"]:
        lines.extend(
            [
                "",
                "## Catalog Issues",
                "",
                "| Severity | Code | Service | Message |",
                "|---|---|---|---|",
            ]
        )
        for issue in payload["issues"]:
            lines.append(
                "| {severity} | {code} | {service} | {message} |".format(
                    severity=issue["severity"],
                    code=issue["code"],
                    service=issue.get("service") or "-",
                    message=str(issue["message"]).replace("|", "\\|"),
                )
            )

    return "\n".join(lines) + "\n"


def render_ndjson(payload: dict[str, Any], compact: bool) -> str:
    separators = (",", ":") if compact else (",", ": ")
    lines = []
    for service in payload["services"]:
        lines.append(json.dumps(service, separators=separators))
    return "\n".join(lines) + ("\n" if lines else "")


def emit_output(text: str, output: Path | None) -> None:
    if output is None:
        sys.stdout.write(text)
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text, encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    project_dir = args.project_dir.resolve()

    entries, issues = discover_services(project_dir)
    entries = apply_filters(
        entries,
        category=args.category,
        status=args.status,
        service_type=args.service_type,
        gpu_backends=args.gpu_backend,
        service_ids=args.service,
    )
    entries = sort_entries(entries, args.sort)
    payload = build_payload(entries, issues, include_features=bool(args.include_features))

    if args.summary_only:
        content = json.dumps(payload["summary"], indent=None if args.compact else 2)
        emit_output(content + "\n", args.output)
    elif args.format == "markdown":
        emit_output(render_markdown(payload), args.output)
    elif args.format == "ndjson":
        emit_output(render_ndjson(payload, compact=bool(args.compact)), args.output)
    else:
        indent = None if args.compact else 2
        separators = (",", ":") if args.compact else None
        emit_output(json.dumps(payload, indent=indent, separators=separators) + "\n", args.output)

    if args.strict and payload["summary"]["issues"]["errors"] > 0:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
