#!/usr/bin/env python3
"""Port contract parity checks across schema, installers, manifests, and compose."""

from __future__ import annotations

import json
import re
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parents[2]
PORTS_FILE = ROOT_DIR / "config" / "ports.json"
SCHEMA_FILE = ROOT_DIR / ".env.schema.json"
ENV_EXAMPLE_FILE = ROOT_DIR / ".env.example"
LINUX_ENV_TEMPLATE = ROOT_DIR / "installers" / "phases" / "06-directories.sh"
MACOS_ENV_TEMPLATE = ROOT_DIR / "installers" / "macos" / "lib" / "env-generator.sh"


def parse_simple_assignments(path: Path) -> dict[str, int]:
    assignments: dict[str, int] = {}
    pattern = re.compile(r"^([A-Z][A-Z0-9_]+)=([0-9]+)\s*$")
    for line in path.read_text(encoding="utf-8").splitlines():
        m = pattern.match(line.strip())
        if not m:
            continue
        assignments[m.group(1)] = int(m.group(2))
    return assignments


def parse_env_example_defaults(path: Path) -> dict[str, int]:
    defaults: dict[str, int] = {}
    pattern = re.compile(r"^\s*#\s*([A-Z][A-Z0-9_]+)=([0-9]+)\b")
    for line in path.read_text(encoding="utf-8").splitlines():
        m = pattern.match(line)
        if not m:
            continue
        defaults[m.group(1)] = int(m.group(2))
    return defaults


def parse_manifest_port_contract(path: Path) -> tuple[str | None, int | None]:
    env_name = None
    default_port = None
    env_pattern = re.compile(r"^\s*external_port_env:\s*([A-Z][A-Z0-9_]*)\s*$")
    default_pattern = re.compile(r"^\s*external_port_default:\s*([0-9]+)\s*$")
    for line in path.read_text(encoding="utf-8").splitlines():
        if env_name is None:
            env_match = env_pattern.match(line)
            if env_match:
                env_name = env_match.group(1)
        if default_port is None:
            default_match = default_pattern.match(line)
            if default_match:
                default_port = int(default_match.group(1))
        if env_name is not None and default_port is not None:
            break
    return env_name, default_port


def collect_compose_env_defaults(root_dir: Path) -> dict[str, set[int]]:
    compose_defaults: dict[str, set[int]] = {}
    compose_files: list[Path] = []
    compose_files.extend(sorted(root_dir.glob("docker-compose*.yml")))
    compose_files.extend(sorted(root_dir.glob("extensions/services/*/compose*.yaml")))
    compose_files.extend(sorted(root_dir.glob("installers/macos/docker-compose*.yml")))

    pattern = re.compile(r"\$\{([A-Z][A-Z0-9_]+):-([0-9]+)\}")
    for file_path in compose_files:
        text = file_path.read_text(encoding="utf-8")
        for env_name, default_str in pattern.findall(text):
            compose_defaults.setdefault(env_name, set()).add(int(default_str))
    return compose_defaults


def main() -> int:
    errors: list[str] = []

    ports_data = json.loads(PORTS_FILE.read_text(encoding="utf-8"))
    ports = ports_data.get("ports", [])
    if not isinstance(ports, list) or not ports:
        print("[FAIL] config/ports.json missing non-empty 'ports' array")
        return 1

    schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    schema_props = schema.get("properties", {})
    example_defaults = parse_env_example_defaults(ENV_EXAMPLE_FILE)
    linux_defaults = parse_simple_assignments(LINUX_ENV_TEMPLATE)
    macos_defaults = parse_simple_assignments(MACOS_ENV_TEMPLATE)
    compose_defaults = collect_compose_env_defaults(ROOT_DIR)

    seen_env: set[str] = set()

    for entry in ports:
        env = entry.get("env")
        default = entry.get("default")
        service_id = entry.get("service_id")
        require_compose = entry.get("require_compose", True)
        skip_manifest = entry.get("skip_manifest", False)

        if not isinstance(env, str) or not env:
            errors.append("ports.json contains entry with invalid/missing env")
            continue
        if env in seen_env:
            errors.append(f"duplicate env in ports.json: {env}")
            continue
        seen_env.add(env)

        if not isinstance(default, int):
            errors.append(f"{env}: default must be integer")
            continue

        schema_default = (
            schema_props.get(env, {}).get("default")
            if isinstance(schema_props.get(env), dict)
            else None
        )
        if schema_default != default:
            errors.append(
                f"{env}: .env.schema.json default={schema_default} expected {default}"
            )

        example_default = example_defaults.get(env)
        if example_default != default:
            errors.append(
                f"{env}: .env.example default={example_default} expected {default}"
            )

        linux_default = linux_defaults.get(env)
        if linux_default != default:
            errors.append(
                f"{env}: linux installer default={linux_default} expected {default}"
            )

        macos_expected = entry.get("macos_default", default)
        if not isinstance(macos_expected, int):
            errors.append(f"{env}: macos_default must be integer when present")
        else:
            macos_default = macos_defaults.get(env)
            if macos_default != macos_expected:
                errors.append(
                    f"{env}: macOS installer default={macos_default} expected {macos_expected}"
                )

        if not skip_manifest:
            if not isinstance(service_id, str) or not service_id:
                errors.append(f"{env}: missing service_id for manifest check")
            else:
                manifest = ROOT_DIR / "extensions" / "services" / service_id / "manifest.yaml"
                if not manifest.exists():
                    errors.append(f"{env}: missing manifest {manifest}")
                else:
                    manifest_env, manifest_default = parse_manifest_port_contract(manifest)
                    if manifest_env != env:
                        errors.append(
                            f"{env}: manifest external_port_env={manifest_env} in {manifest}"
                        )
                    if manifest_default != default:
                        errors.append(
                            f"{env}: manifest external_port_default={manifest_default} in {manifest}; expected {default}"
                        )

        if require_compose:
            defaults = compose_defaults.get(env, set())
            if not defaults:
                errors.append(f"{env}: no compose file uses ${{{env}:-...}}")
            elif default not in defaults:
                errors.append(
                    f"{env}: compose defaults={sorted(defaults)} missing expected {default}"
                )

    if errors:
        print("[FAIL] port contract drift detected")
        for err in errors:
            print(f"  - {err}")
        return 1

    print("[PASS] port contract parity")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
