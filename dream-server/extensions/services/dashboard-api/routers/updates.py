"""Version checking and update endpoints."""

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from config import INSTALL_DIR
from models import VersionInfo, UpdateAction
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["updates"])

_GITHUB_HEADERS = {"Accept": "application/vnd.github.v3+json"}


@router.get("/api/version", response_model=VersionInfo, dependencies=[Depends(verify_api_key)])
async def get_version():
    """Get current Dream Server version and check for updates (non-blocking)."""
    version_file = Path(INSTALL_DIR) / ".version"
    current = await asyncio.to_thread(
        lambda: version_file.read_text().strip() if version_file.exists() else "0.0.0"
    )

    result = {"current": current, "latest": None, "update_available": False, "changelog_url": None, "checked_at": datetime.now(timezone.utc).isoformat() + "Z"}

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://api.github.com/repos/Light-Heart-Labs/DreamServer/releases/latest",
                headers=_GITHUB_HEADERS,
            )
        data = resp.json()
        latest = data.get("tag_name", "").lstrip("v")
        if latest:
            result["latest"] = latest
            result["changelog_url"] = data.get("html_url")
            current_parts = [int(x) for x in current.split(".") if x.isdigit()][:3]
            latest_parts = [int(x) for x in latest.split(".") if x.isdigit()][:3]
            current_parts += [0] * (3 - len(current_parts))
            latest_parts += [0] * (3 - len(latest_parts))
            result["update_available"] = latest_parts > current_parts
    except (httpx.HTTPError, httpx.TimeoutException, json.JSONDecodeError, ValueError, OSError):
        pass

    return result


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
            "checked_at": datetime.now(timezone.utc).isoformat() + "Z"
        }
    except (httpx.HTTPError, httpx.TimeoutException, json.JSONDecodeError, OSError):
        version_file = Path(INSTALL_DIR) / ".version"
        current = await asyncio.to_thread(
            lambda: version_file.read_text().strip() if version_file.exists() else "0.0.0"
        )
        return {
            "releases": [{"version": current, "date": datetime.now(timezone.utc).isoformat() + "Z", "title": f"Dream Server {current}", "changelog": "Release information unavailable. Check GitHub directly.", "url": "https://github.com/Light-Heart-Labs/DreamServer/releases", "prerelease": False}],
            "checked_at": datetime.now(timezone.utc).isoformat() + "Z",
            "error": "Could not fetch release information"
        }


_UPDATE_ENV_KEYS = {
    "DREAM_VERSION", "TIER", "LLM_MODEL", "GGUF_FILE",
    "CTX_SIZE", "GPU_BACKEND", "N_GPU_LAYERS",
}


@router.get("/api/update/dry-run", dependencies=[Depends(verify_api_key)])
async def get_update_dry_run():
    """Preview what a dream update would change without applying anything.

    Returns version comparison, configured image tags, and the .env keys
    that the update process reads or writes.  No containers are started,
    stopped, or re-created.
    """
    import urllib.request
    import urllib.error

    install_path = Path(INSTALL_DIR)

    # ── current version ───────────────────────────────────────────────────────
    current = "0.0.0"
    env_file = install_path / ".env"
    version_file = install_path / ".version"

    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("DREAM_VERSION="):
                current = line.split("=", 1)[1].strip()
                break
    if current == "0.0.0" and version_file.exists():
        try:
            raw = version_file.read_text().strip()
            parsed = json.loads(raw) if raw.startswith("{") else None
            current = (parsed or {}).get("version", raw) or raw or "0.0.0"
        except (json.JSONDecodeError, OSError):
            pass

    # ── latest version from GitHub ────────────────────────────────────────────
    latest: Optional[str] = None
    changelog_url: Optional[str] = None
    update_available = False

    try:
        req = urllib.request.Request(
            "https://api.github.com/repos/Light-Heart-Labs/DreamServer/releases/latest",
            headers={"Accept": "application/vnd.github.v3+json"},
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
            latest = data.get("tag_name", "").lstrip("v") or None
            changelog_url = data.get("html_url") or None
            if latest:
                def _parts(v: str) -> list[int]:
                    return ([int(x) for x in v.split(".") if x.isdigit()][:3] + [0, 0, 0])[:3]
                update_available = _parts(latest) > _parts(current)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, json.JSONDecodeError, ValueError):
        pass

    # ── configured image tags from compose files ──────────────────────────────
    images: list[str] = []
    for compose_file in sorted(install_path.glob("docker-compose*.yml")):
        try:
            for line in compose_file.read_text().splitlines():
                stripped = line.strip()
                if stripped.startswith("image:"):
                    tag = stripped.split(":", 1)[1].strip()
                    if tag and tag not in images:
                        images.append(tag)
        except OSError:
            pass

    # ── .env keys relevant to the update path ────────────────────────────────
    env_snapshot: dict[str, str] = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            if key in _UPDATE_ENV_KEYS:
                env_snapshot[key] = val

    return {
        "dry_run": True,
        "current_version": current,
        "latest_version": latest,
        "update_available": update_available,
        "changelog_url": changelog_url,
        "images": images,
        "env_keys": env_snapshot,
    }


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
