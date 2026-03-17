#!/usr/bin/env python3
"""CLI wrapper for shared service registry artifact generation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from service_registry import (
    RegistryBuildError,
    build_registry,
    ensure_registry_artifact,
    load_registry_artifact,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate extension manifests and generate service registry artifact."
    )
    parser.add_argument(
        "--root-dir",
        default=".",
        help="Dream Server root directory (default: current directory).",
    )
    parser.add_argument(
        "--extensions-dir",
        default=None,
        help="Override extensions/services directory for manifest discovery.",
    )
    parser.add_argument(
        "--schema",
        default=None,
        help="Override manifest schema path.",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Path to write shared registry artifact JSON.",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate manifests and print summary without writing artifact.",
    )
    parser.add_argument(
        "--print-json",
        action="store_true",
        help="Print generated/loaded registry JSON to stdout.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Regenerate artifact even if cache appears fresh.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    root_dir = Path(args.root_dir).resolve()
    extensions_dir = Path(args.extensions_dir).resolve() if args.extensions_dir else None
    schema_path = Path(args.schema).resolve() if args.schema else None

    try:
        if args.validate_only:
            registry = build_registry(
                root_dir=root_dir,
                extensions_dir=extensions_dir,
                schema_path=schema_path,
                strict=True,
            )
            print(
                "[PASS] Manifests valid "
                f"({registry['manifest_count']} manifests, {registry['service_count']} services)"
            )
            if args.print_json:
                json.dump(registry, sys.stdout, indent=2, sort_keys=True)
                print()
            return 0

        artifact_path = ensure_registry_artifact(
            root_dir=root_dir,
            output_path=Path(args.output).resolve() if args.output else None,
            extensions_dir=extensions_dir,
            schema_path=schema_path,
            strict=True,
            force=args.force,
        )
        print(str(artifact_path))

        if args.print_json:
            artifact = load_registry_artifact(artifact_path)
            json.dump(artifact, sys.stdout, indent=2, sort_keys=True)
            print()
        return 0
    except RegistryBuildError as exc:
        for err in exc.errors:
            print(f"[FAIL] {err}", file=sys.stderr)
        return 1
    except Exception as exc:  # pragma: no cover - CLI fallback
        print(f"[FAIL] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

