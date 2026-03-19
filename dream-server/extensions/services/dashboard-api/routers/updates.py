"""Version checking and update endpoints."""

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from config import INSTALL_DIR
from models import VersionInfo, UpdateAction
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["updates"])

_GITHUB_HEADERS = {"Accept": "application/vnd.github.v3+json"}


def _utc_now_iso() -> str:
    """Return an RFC 3339 UTC timestamp that JS Date can parse reliably."""
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_version_state(install_dir: str | Path | None = None) -> tuple[str, dict[str, Any]]:
    """Read version metadata from `.version`.

    Supports both the newer JSON shape used by update tooling and the older
    plain-text version format that still appears in some installs/tests.
    """
    base_dir = Path(install_dir or INSTALL_DIR)
    version_file = base_dir / ".version"
    if not version_file.exists():
        return "0.0.0", {}

    try:
        raw = version_file.read_text().strip()
    except OSError:
        return "0.0.0", {}

    if not raw:
        return "0.0.0", {}

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw.lstrip("v"), {}

    if isinstance(parsed, dict):
        version = str(parsed.get("version") or "0.0.0").strip().lstrip("v")
        return version or "0.0.0", parsed

    if isinstance(parsed, str):
        return parsed.strip().lstrip("v") or "0.0.0", {}

    return "0.0.0", {}


def resolve_install_date(install_dir: str | Path | None = None) -> str | None:
    """Best-effort install date for Settings UI.

    Prefer explicit metadata when available, otherwise fall back to the oldest
    stable file timestamp in the install directory.
    """
    base_dir = Path(install_dir or INSTALL_DIR)
    _, version_meta = _read_version_state(base_dir)
    for key in ("installed_at", "created_at", "initialized_at"):
        value = version_meta.get(key)
        if isinstance(value, str) and value.strip():
            return value

    base = base_dir
    candidates = [base / ".env", base / ".version", base]
    timestamps = []
    for path in candidates:
        if not path.exists():
            continue
        try:
            timestamps.append(path.stat().st_mtime)
        except OSError:
            continue

    if not timestamps:
        return None

    return datetime.fromtimestamp(min(timestamps), tz=timezone.utc).date().isoformat()


def _normalize_release_version(value: str | None) -> list[int]:
    """Convert a release tag into a comparable 3-part integer list."""
    if not value:
        return [0, 0, 0]

    parts = []
    for part in value.lstrip("v").split(".")[:3]:
        digits = "".join(ch for ch in part if ch.isdigit())
        parts.append(int(digits or "0"))
    parts += [0] * (3 - len(parts))
    return parts[:3]


async def resolve_version_info(install_dir: str | Path | None = None) -> dict[str, Any]:
    """Resolve the current/local version and latest release metadata."""
    base_dir = Path(install_dir or INSTALL_DIR)
    current, _ = await asyncio.to_thread(_read_version_state, base_dir)
    result: dict[str, Any] = {
        "current": current,
        "latest": None,
        "update_available": False,
        "changelog_url": None,
        "checked_at": _utc_now_iso(),
    }

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://api.github.com/repos/Light-Heart-Labs/DreamServer/releases/latest",
                headers=_GITHUB_HEADERS,
            )
        data = resp.json()
        latest = str(data.get("tag_name", "")).lstrip("v")
        if latest:
            result["latest"] = latest
            result["changelog_url"] = data.get("html_url")
            result["update_available"] = (
                _normalize_release_version(latest)
                > _normalize_release_version(current)
            )
    except (httpx.HTTPError, httpx.TimeoutException, json.JSONDecodeError, OSError, ValueError):
        pass

    return result


@router.get("/api/version", response_model=VersionInfo, dependencies=[Depends(verify_api_key)])
async def get_version():
    """Get current Dream Server version and check for updates (non-blocking)."""
    return await resolve_version_info()


@router.get("/api/releases/manifest", dependencies=[Depends(verify_api_key)])
async def get_release_manifest():
    """Get release manifest with version history (non-blocking)."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://api.github.com/repos/Light-Heart-Labs/DreamServer/releases?per_page=5",
                headers=_GITHUB_HEADERS,
            )
        releases = resp.json()
        return {
            "releases": [
                {"version": r.get("tag_name", "").lstrip("v"), "date": r.get("published_at", ""), "title": r.get("name", ""), "changelog": r.get("body", "")[:500] + "..." if len(r.get("body", "")) > 500 else r.get("body", ""), "url": r.get("html_url", ""), "prerelease": r.get("prerelease", False)}
                for r in releases
            ],
            "checked_at": _utc_now_iso()
        }
    except (httpx.HTTPError, httpx.TimeoutException, json.JSONDecodeError, OSError):
        current, _ = await asyncio.to_thread(_read_version_state, INSTALL_DIR)
        return {
            "releases": [{"version": current, "date": _utc_now_iso(), "title": f"Dream Server {current}", "changelog": "Release information unavailable. Check GitHub directly.", "url": "https://github.com/Light-Heart-Labs/DreamServer/releases", "prerelease": False}],
            "checked_at": _utc_now_iso(),
            "error": "Could not fetch release information"
        }


_VALID_ACTIONS = {"check", "backup", "update"}


@router.post("/api/update")
async def trigger_update(action: UpdateAction, background_tasks: BackgroundTasks, api_key: str = Depends(verify_api_key)):
    """Trigger update actions via dashboard."""
    if action.action not in _VALID_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action.action}")

    script_path = Path(INSTALL_DIR).parent / "scripts" / "dream-update.sh"
    if not script_path.exists():
        install_script = Path(INSTALL_DIR) / "install.sh"
        if install_script.exists():
            script_path = Path(INSTALL_DIR).parent / "scripts" / "dream-update.sh"
        else:
            script_path = Path(INSTALL_DIR) / "scripts" / "dream-update.sh"

    if not script_path.exists():
        logger.error("dream-update.sh not found at %s", script_path)
        raise HTTPException(status_code=501, detail="Update system not installed.")

    if action.action == "check":
        try:
            proc = await asyncio.create_subprocess_exec(
                str(script_path), "check",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
            return {"success": True, "update_available": proc.returncode == 2, "output": stdout.decode() + stderr.decode()}
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Update check timed out")
        except OSError:
            logger.exception("Update check failed")
            raise HTTPException(status_code=500, detail="Check failed")
    elif action.action == "backup":
        try:
            proc = await asyncio.create_subprocess_exec(
                str(script_path), "backup", f"dashboard-{datetime.now().strftime('%Y%m%d-%H%M%S')}",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
            return {"success": proc.returncode == 0, "output": stdout.decode() + stderr.decode()}
        except asyncio.TimeoutError:
            raise HTTPException(status_code=504, detail="Backup timed out")
        except OSError:
            logger.exception("Backup failed")
            raise HTTPException(status_code=500, detail="Backup failed")
    elif action.action == "update":
        async def run_update():
            proc = await asyncio.create_subprocess_exec(
                str(script_path), "update",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()
        background_tasks.add_task(run_update)
        return {"success": True, "message": "Update started in background. Check logs for progress."}
