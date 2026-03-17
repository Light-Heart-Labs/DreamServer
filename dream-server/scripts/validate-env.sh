#!/usr/bin/env bash
# Validate .env against .env.schema.json (V2)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="${INSTALL_DIR:-$(dirname "$SCRIPT_DIR")}"

ENV_FILE="${INSTALL_DIR}/.env"
SCHEMA_FILE="${INSTALL_DIR}/.env.schema.json"
STRICT="true"
OUTPUT_JSON="false"
JSON_FILE=""
MODE_OVERRIDE=""
ALLOW_UNKNOWN="false"

usage() {
    cat <<'USAGE'
Usage: validate-env.sh [ENV_FILE] [SCHEMA_FILE] [options]

Options:
  --env-file <path>       Path to .env file (default: INSTALL_DIR/.env)
  --schema-file <path>    Path to schema file (default: INSTALL_DIR/.env.schema.json)
  --mode <local|cloud|hybrid>
                          Override DREAM_MODE from .env
  --strict                Fail with exit code 2 when validation errors exist (default)
  --warn-only             Never fail for validation errors (exit 0)
  --allow-unknown         Do not treat unknown keys as validation errors
  --json                  Print validation report as JSON
  --json-file <path>      Also write JSON report to file
  -h, --help              Show this help

Notes:
  - Exit code 1 means script/system failure (missing files, parse crash, etc.)
  - Exit code 2 means validation errors in strict mode
USAGE
}

POSITIONAL=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --env-file)
            ENV_FILE="${2:-}"
            shift 2
            ;;
        --schema-file)
            SCHEMA_FILE="${2:-}"
            shift 2
            ;;
        --mode)
            MODE_OVERRIDE="${2:-}"
            shift 2
            ;;
        --strict)
            STRICT="true"
            shift
            ;;
        --warn-only)
            STRICT="false"
            shift
            ;;
        --allow-unknown)
            ALLOW_UNKNOWN="true"
            shift
            ;;
        --json)
            OUTPUT_JSON="true"
            shift
            ;;
        --json-file)
            JSON_FILE="${2:-}"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        --)
            shift
            break
            ;;
        -*)
            echo "[ERROR] Unknown option: $1" >&2
            usage
            exit 1
            ;;
        *)
            POSITIONAL+=("$1")
            shift
            ;;
    esac
done

# Backward-compatible positional args: validate-env.sh [env] [schema]
if [[ ${#POSITIONAL[@]} -ge 1 ]]; then
    ENV_FILE="${POSITIONAL[0]}"
fi
if [[ ${#POSITIONAL[@]} -ge 2 ]]; then
    SCHEMA_FILE="${POSITIONAL[1]}"
fi

if [[ ! -f "$ENV_FILE" ]]; then
    echo "[ERROR] Env file not found: $ENV_FILE" >&2
    exit 1
fi

if [[ ! -f "$SCHEMA_FILE" ]]; then
    echo "[ERROR] Schema file not found: $SCHEMA_FILE" >&2
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "[ERROR] python3 is required for validate-env.sh" >&2
    exit 1
fi

tmp_report="$(mktemp)"
cleanup() {
    rm -f "$tmp_report"
}
trap cleanup EXIT

set +e
python3 - "$ENV_FILE" "$SCHEMA_FILE" "$STRICT" "$MODE_OVERRIDE" "$ALLOW_UNKNOWN" > "$tmp_report" <<'PY'
import json
import os
import re
import sys
from dataclasses import dataclass
from typing import Any

ENV_FILE, SCHEMA_FILE, STRICT_RAW, MODE_OVERRIDE, ALLOW_UNKNOWN_RAW = sys.argv[1:6]
STRICT = STRICT_RAW.lower() == "true"
ALLOW_UNKNOWN = ALLOW_UNKNOWN_RAW.lower() == "true"

KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
INT_RE = re.compile(r"^-?[0-9]+$")
NUM_RE = re.compile(r"^-?[0-9]+(?:\.[0-9]+)?$")


@dataclass
class ParsedEntry:
    key: str
    value: str
    line: int


def _strip_inline_comment(value_expr: str) -> str:
    out: list[str] = []
    quote: str | None = None
    escaped = False

    for ch in value_expr:
        if quote is not None:
            out.append(ch)
            if quote == '"':
                if escaped:
                    escaped = False
                    continue
                if ch == "\\":
                    escaped = True
                    continue
            if ch == quote and not escaped:
                quote = None
            continue

        if ch in {"'", '"'}:
            quote = ch
            out.append(ch)
            continue

        if ch == "#":
            prev = out[-1] if out else ""
            if not out or prev.isspace():
                break

        out.append(ch)

    return "".join(out).rstrip()


def _parse_value(raw_value: str, line_no: int, errors: list[dict[str, Any]]) -> str:
    v = raw_value.strip()
    if v == "":
        return ""

    if v[0] not in {"'", '"'}:
        return v

    quote = v[0]
    out: list[str] = []
    escaped = False
    i = 1
    while i < len(v):
        ch = v[i]
        if quote == '"' and ch == "\\" and not escaped:
            escaped = True
            i += 1
            if i >= len(v):
                break
            nxt = v[i]
            # Preserve common escapes literally except quote/backslash for clarity.
            if nxt == '"':
                out.append('"')
            elif nxt == "\\":
                out.append("\\")
            else:
                out.append(nxt)
            escaped = False
            i += 1
            continue

        if ch == quote:
            trailing = v[i + 1 :].strip()
            if trailing and not trailing.startswith("#"):
                errors.append(
                    {
                        "type": "parse",
                        "key": None,
                        "line": line_no,
                        "message": "Unexpected content after quoted value",
                        "hint": "Use KEY=value or KEY=\"value\" with comments after whitespace + #",
                    }
                )
            return "".join(out)

        out.append(ch)
        i += 1

    errors.append(
        {
            "type": "parse",
            "key": None,
            "line": line_no,
            "message": "Unterminated quoted value",
            "hint": "Close the quote or remove unmatched quote characters",
        }
    )
    return "".join(out)


def parse_env(path: str) -> tuple[dict[str, ParsedEntry], list[dict[str, Any]], list[dict[str, Any]]]:
    entries: dict[str, ParsedEntry] = {}
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    with open(path, "r", encoding="utf-8") as f:
        for line_no, raw in enumerate(f, start=1):
            line = raw.rstrip("\n")
            stripped = line.strip()

            if not stripped:
                continue
            if stripped.startswith("#"):
                continue

            if stripped.startswith("export "):
                stripped = stripped[len("export ") :].lstrip()

            if "=" not in stripped:
                errors.append(
                    {
                        "type": "parse",
                        "key": None,
                        "line": line_no,
                        "message": "Invalid env line (missing '=')",
                        "hint": "Use KEY=value format",
                    }
                )
                continue

            key_part, raw_value_expr = stripped.split("=", 1)
            key = key_part.strip()
            if not KEY_RE.match(key):
                errors.append(
                    {
                        "type": "parse",
                        "key": key,
                        "line": line_no,
                        "message": f"Invalid key name '{key}'",
                        "hint": "Keys must match [A-Za-z_][A-Za-z0-9_]*",
                    }
                )
                continue

            clean_expr = _strip_inline_comment(raw_value_expr)
            value = _parse_value(clean_expr, line_no, errors)

            if key in entries:
                warnings.append(
                    {
                        "type": "duplicate",
                        "key": key,
                        "line": line_no,
                        "message": f"Duplicate key '{key}' detected; last value wins",
                        "hint": "Remove duplicates to avoid ambiguity",
                    }
                )

            entries[key] = ParsedEntry(key=key, value=value, line=line_no)

    return entries, errors, warnings


def is_boolean_like(value: str) -> bool:
    return value.lower() in {"true", "false", "1", "0", "yes", "no", "on", "off"}


def is_present(entries: dict[str, ParsedEntry], key: str) -> bool:
    if key not in entries:
        return False
    return entries[key].value.strip() != ""


def add_error(errors: list[dict[str, Any]], *, err_type: str, key: str | None, line: int | None, message: str, hint: str = "") -> None:
    errors.append({"type": err_type, "key": key, "line": line, "message": message, "hint": hint})


def add_warning(warnings: list[dict[str, Any]], *, warn_type: str, key: str | None, line: int | None, message: str, hint: str = "") -> None:
    warnings.append({"type": warn_type, "key": key, "line": line, "message": message, "hint": hint})


def validate(entries: dict[str, ParsedEntry], schema: dict[str, Any], parse_errors: list[dict[str, Any]], parse_warnings: list[dict[str, Any]]) -> dict[str, Any]:
    errors = list(parse_errors)
    warnings = list(parse_warnings)
    deprecated: list[dict[str, Any]] = []

    props: dict[str, Any] = schema.get("properties") or {}
    required: list[str] = list(schema.get("required") or [])

    dream_mode_def = props.get("DREAM_MODE", {})
    mode_enum = dream_mode_def.get("enum") or ["local", "cloud", "hybrid"]
    mode_default = dream_mode_def.get("default") or "local"

    mode = (MODE_OVERRIDE or (entries.get("DREAM_MODE").value if entries.get("DREAM_MODE") else mode_default) or "local").strip()

    if mode not in mode_enum:
        add_error(
            errors,
            err_type="mode",
            key="DREAM_MODE",
            line=entries.get("DREAM_MODE").line if entries.get("DREAM_MODE") else None,
            message=f"Invalid DREAM_MODE '{mode}'",
            hint=f"Use one of: {', '.join(mode_enum)}",
        )

    # Global required keys
    for key in required:
        if not is_present(entries, key):
            add_error(
                errors,
                err_type="missing",
                key=key,
                line=None,
                message=f"Missing required key '{key}'",
                hint=f"Add {key}=... to .env",
            )

    # Mode-specific requirements from custom schema contract
    mode_rules = (schema.get("x-modeRequirements") or {}).get(mode, {})
    for key in mode_rules.get("required", []) or []:
        if not is_present(entries, key):
            add_error(
                errors,
                err_type="missing_mode",
                key=key,
                line=None,
                message=f"Mode '{mode}' requires key '{key}'",
                hint=f"Set {key}=... or switch DREAM_MODE",
            )

    for group in mode_rules.get("required_any", []) or []:
        keys = [str(k) for k in group if str(k).strip()]
        if not keys:
            continue
        if not any(is_present(entries, k) for k in keys):
            add_error(
                errors,
                err_type="missing_mode_any",
                key=None,
                line=None,
                message=f"Mode '{mode}' requires at least one of: {', '.join(keys)}",
                hint=f"Set one of: {', '.join(keys)}",
            )

    # Unknown keys
    if not ALLOW_UNKNOWN:
        for key, entry in entries.items():
            if key not in props:
                add_error(
                    errors,
                    err_type="unknown",
                    key=key,
                    line=entry.line,
                    message=f"Unknown key '{key}' is not defined in schema",
                    hint="Remove it or add it to .env.schema.json",
                )

    # Type + enum checks
    for key, entry in entries.items():
        prop = props.get(key)
        if not prop:
            continue

        value = entry.value
        if value == "":
            continue

        expected_type = prop.get("type", "string")
        if expected_type == "integer" and not INT_RE.match(value):
            add_error(
                errors,
                err_type="type",
                key=key,
                line=entry.line,
                message=f"{key} expects integer, got '{value}'",
                hint=f"Use numeric value, e.g. {key}=1234",
            )
        elif expected_type == "number" and not NUM_RE.match(value):
            add_error(
                errors,
                err_type="type",
                key=key,
                line=entry.line,
                message=f"{key} expects number, got '{value}'",
                hint=f"Use numeric value, e.g. {key}=3.14",
            )
        elif expected_type == "boolean" and not is_boolean_like(value):
            add_error(
                errors,
                err_type="type",
                key=key,
                line=entry.line,
                message=f"{key} expects boolean, got '{value}'",
                hint=f"Use true/false for {key}",
            )

        enum_vals = prop.get("enum")
        if isinstance(enum_vals, list) and enum_vals and value not in enum_vals:
            add_error(
                errors,
                err_type="enum",
                key=key,
                line=entry.line,
                message=f"{key} must be one of: {', '.join(map(str, enum_vals))}",
                hint=f"Set {key} to a supported value",
            )

    # Deprecated key hints
    deprecated_contract = schema.get("x-deprecatedKeys") or {}
    for old_key, meta in deprecated_contract.items():
        if old_key not in entries:
            continue
        replacement = str((meta or {}).get("replacement") or "").strip()
        message = str((meta or {}).get("message") or f"'{old_key}' is deprecated").strip()
        auto_fix = bool((meta or {}).get("auto_fix", False))

        item = {
            "type": "deprecated",
            "key": old_key,
            "line": entries[old_key].line,
            "message": message,
            "replacement": replacement or None,
            "auto_fix": auto_fix,
            "hint": (
                f"Replace {old_key} with {replacement}" if replacement else "Remove deprecated key"
            ),
        }
        deprecated.append(item)

        add_warning(
            warnings,
            warn_type="deprecated",
            key=old_key,
            line=entries[old_key].line,
            message=message,
            hint=item["hint"],
        )

    return {
        "mode": mode,
        "errors": errors,
        "warnings": warnings,
        "deprecated": deprecated,
    }


try:
    schema = json.load(open(SCHEMA_FILE, "r", encoding="utf-8"))
except Exception as exc:
    print(
        json.dumps(
            {
                "success": False,
                "fatal": True,
                "message": f"Failed to load schema: {exc}",
            }
        )
    )
    raise SystemExit(1)

entries, parse_errors, parse_warnings = parse_env(ENV_FILE)
validated = validate(entries, schema, parse_errors, parse_warnings)

errors = validated["errors"]
warnings = validated["warnings"]
deprecated = validated["deprecated"]
mode = validated["mode"]

summary = {
    "errors": len(errors),
    "warnings": len(warnings),
    "deprecated": len(deprecated),
    "parsed_keys": len(entries),
}

report = {
    "success": len(errors) == 0,
    "strict": STRICT,
    "env_file": os.path.abspath(ENV_FILE),
    "schema_file": os.path.abspath(SCHEMA_FILE),
    "mode": mode,
    "summary": summary,
    "errors": errors,
    "warnings": warnings,
    "deprecated": deprecated,
    "keys": sorted(entries.keys()),
}

print(json.dumps(report, indent=2))

if STRICT and errors:
    raise SystemExit(2)
raise SystemExit(0)
PY
rc=$?
set -e

if [[ -n "$JSON_FILE" ]]; then
    mkdir -p "$(dirname "$JSON_FILE")"
    cp "$tmp_report" "$JSON_FILE"
fi

if [[ "$OUTPUT_JSON" == "true" ]]; then
    cat "$tmp_report"
else
    if ! command -v jq >/dev/null 2>&1; then
        cat "$tmp_report"
    else
        errors_count="$(jq -r '.summary.errors' "$tmp_report")"
        warnings_count="$(jq -r '.summary.warnings' "$tmp_report")"
        deprecated_count="$(jq -r '.summary.deprecated' "$tmp_report")"
        mode="$(jq -r '.mode' "$tmp_report")"

        BLUE='\033[0;34m'
        GREEN='\033[0;32m'
        YELLOW='\033[1;33m'
        RED='\033[0;31m'
        NC='\033[0m'

        echo -e "${BLUE}[INFO]${NC} DREAM_MODE: ${mode}"

        if [[ "$errors_count" == "0" ]]; then
            echo -e "${GREEN}[SUCCESS]${NC} .env validation passed"
        else
            echo -e "${RED}[ERROR]${NC} .env validation found ${errors_count} error(s)"
            jq -r '.errors[] | "  - [\(.type)] \(.message)" + (if .line then " (line \(.line))" else "" end) + (if .hint and .hint != "" then "\n      hint: \(.hint)" else "" end)' "$tmp_report"
        fi

        if [[ "$warnings_count" != "0" ]]; then
            echo -e "${YELLOW}[WARN]${NC} ${warnings_count} warning(s)"
            jq -r '.warnings[] | "  - [\(.type)] \(.message)" + (if .line then " (line \(.line))" else "" end)' "$tmp_report"
        fi

        if [[ "$deprecated_count" != "0" ]]; then
            echo -e "${YELLOW}[WARN]${NC} ${deprecated_count} deprecated key(s)"
            jq -r '.deprecated[] | "  - \(.key)" + (if .replacement then " -> \(.replacement)" else "" end) + ": \(.message)"' "$tmp_report"
            echo "  Autofix: ./scripts/migrate-config.sh autofix-env"
        fi

        if [[ "$errors_count" != "0" ]]; then
            echo ""
            echo "Fix .env and re-run: ./scripts/validate-env.sh"
        fi
    fi
fi

exit "$rc"
