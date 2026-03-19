"""Shared helpers for reading and writing Dream Server's .env and loading .env.schema.json.

These utilities are intentionally free of shell evaluation — all reads and
writes are done with plain Python regex so that key names and values with
spaces, quotes, or special characters are handled safely.
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Resolved once at import time; can be overridden via environment variables for
# testing or non-standard deployment layouts.
_INSTALL_DIR = Path(os.environ.get("DREAM_INSTALL_DIR", os.path.expanduser("~/dream-server")))
_ENV_PATH = Path(os.environ.get("DREAM_ENV_FILE", str(_INSTALL_DIR / ".env")))
_SCHEMA_PATH = Path(os.environ.get("DREAM_SCHEMA_FILE", str(_INSTALL_DIR / ".env.schema.json")))

# Matches bare KEY=value lines (no leading spaces, no shell constructs).
_KEY_RE = re.compile(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)', re.MULTILINE)


def read_env() -> dict[str, str]:
    """Parse .env into a {key: value} dict.

    Comments (#…) and blank lines are ignored.  Surrounding single- or
    double-quotes are stripped from values so callers always get the raw
    string.
    """
    env: dict[str, str] = {}
    if not _ENV_PATH.exists():
        logger.warning(".env not found at %s", _ENV_PATH)
        return env

    for line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        m = _KEY_RE.match(stripped)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            val = val[1:-1]
        env[key] = val
    return env


def write_env_key(key: str, value: str) -> None:
    """Update *key* in .env to *value*, or append it if the key is absent.

    The update is done with a single regex substitution on the raw file text
    so line order and comments are preserved.  No shell evaluation is
    performed.
    """
    if not _ENV_PATH.exists():
        logger.warning(".env not found at %s — cannot write key %s", _ENV_PATH, key)
        return

    text = _ENV_PATH.read_text(encoding="utf-8")
    pattern = re.compile(rf'^{re.escape(key)}=.*$', re.MULTILINE)
    replacement = f"{key}={value}"
    if pattern.search(text):
        new_text = pattern.sub(replacement, text, count=1)
    else:
        new_text = text.rstrip("\n") + f"\n{replacement}\n"
    _ENV_PATH.write_text(new_text, encoding="utf-8")


def load_schema() -> dict[str, Any]:
    """Load and return the parsed .env.schema.json.

    Returns an empty dict on any failure and emits a warning so callers can
    degrade gracefully (e.g. skip schema validation rather than crashing).
    """
    if not _SCHEMA_PATH.exists():
        logger.warning(".env.schema.json not found at %s", _SCHEMA_PATH)
        return {}
    try:
        return json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        logger.warning("Failed to parse .env.schema.json: %s", exc)
        return {}


def validate_against_schema(
    field_name: str,
    env_key: str,
    value: object,
    schema: dict[str, Any],
) -> str | None:
    """Check *value* against the schema property for *env_key*.

    Returns an error string when the value violates a schema constraint, or
    ``None`` when the value is valid (or the key has no schema entry).

    Supported constraints: ``enum``, ``minimum``, ``maximum``, ``type``
    (number coercion only — string and boolean fields are accepted as-is).
    """
    prop = schema.get("properties", {}).get(env_key, {})
    if not prop:
        return None  # No schema rule — allow any value.

    allowed = prop.get("enum")
    if allowed is not None and value not in allowed:
        return f"{field_name} must be one of: {', '.join(str(v) for v in allowed)}"

    prop_type = prop.get("type")
    if prop_type == "number":
        try:
            numeric = float(str(value))
        except ValueError:
            return f"{field_name} must be a number"
        minimum = prop.get("minimum")
        maximum = prop.get("maximum")
        if minimum is not None and numeric < minimum:
            return f"{field_name} must be >= {minimum}"
        if maximum is not None and numeric > maximum:
            return f"{field_name} must be <= {maximum}"

    return None
