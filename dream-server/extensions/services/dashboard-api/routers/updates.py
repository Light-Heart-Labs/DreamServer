"""Version checking and update endpoints."""

import json
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from config import INSTALL_DIR
from models import VersionInfo, UpdateAction
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["updates"])


@router.get("/api/version", response_model=VersionInfo, dependencies=[Depends(verify_api_key)])
async def get_version():
    """Get current Dream Server version and check for updates."""
    import urllib.request
    import urllib.error

    version_file = Path(INSTALL_DIR) / ".version"
    current = version_file.read_text().strip() if version_file.exists() else "0.0.0"

    result = {"current": current, "latest": None, "update_available": False, "changelog_url": None, "checked_at": datetime.now(timezone.utc).isoformat() + "Z"}

    try:
        req = urllib.request.Request("https://api.github.com/repos/Light-Heart-Labs/DreamServer/releases/latest", headers={"Accept": "application/vnd.github.v3+json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            latest = data.get("tag_name", "").lstrip("v")
            if latest:
                result["latest"] = latest
                result["changelog_url"] = data.get("html_url")
                current_parts = [int(x) for x in current.split(".") if x.isdigit()][:3]
                latest_parts = [int(x) for x in latest.split(".") if x.isdigit()][:3]
                current_parts += [0] * (3 - len(current_parts))
                latest_parts += [0] * (3 - len(latest_parts))
                result["update_available"] = latest_parts > current_parts
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, json.JSONDecodeError, ValueError):
        pass

    return result


@router.get("/api/releases/manifest", dependencies=[Depends(verify_api_key)])
async def get_release_manifest():
    """Get release manifest with version history."""
    import urllib.request
    import urllib.error

    try:
        req = urllib.request.Request("https://api.github.com/repos/Light-Heart-Labs/DreamServer/releases?per_page=5", headers={"Accept": "application/vnd.github.v3+json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            releases = json.loads(resp.read())
            return {
                "releases": [
                    {"version": r.get("tag_name", "").lstrip("v"), "date": r.get("published_at", ""), "title": r.get("name", ""), "changelog": r.get("body", "")[:500] + "..." if len(r.get("body", "")) > 500 else r.get("body", ""), "url": r.get("html_url", ""), "prerelease": r.get("prerelease", False)}
                    for r in releases
                ],
                "checked_at": datetime.now(timezone.utc).isoformat() + "Z"
            }
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, json.JSONDecodeError):
        version_file = Path(INSTALL_DIR) / ".version"
        current = version_file.read_text().strip() if version_file.exists() else "0.0.0"
        return {
            "releases": [{"version": current, "date": datetime.now(timezone.utc).isoformat() + "Z", "title": f"Dream Server {current}", "changelog": "Release information unavailable. Check GitHub directly.", "url": "https://github.com/Light-Heart-Labs/DreamServer/releases", "prerelease": False}],
            "checked_at": datetime.now(timezone.utc).isoformat() + "Z",
            "error": "Could not fetch release information"
        }


@router.post("/api/update")
async def trigger_update(action: UpdateAction, background_tasks: BackgroundTasks, api_key: str = Depends(verify_api_key)):
    """Trigger update actions via dashboard."""
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
            result = subprocess.run([str(script_path), "check"], capture_output=True, text=True, timeout=30)
            return {"success": True, "update_available": result.returncode == 2, "output": result.stdout + result.stderr}
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Update check timed out")
        except (subprocess.SubprocessError, OSError):
            logger.exception("Update check failed")
            raise HTTPException(status_code=500, detail="Check failed")
    elif action.action == "backup":
        try:
            result = subprocess.run([str(script_path), "backup", f"dashboard-{datetime.now().strftime('%Y%m%d-%H%M%S')}"], capture_output=True, text=True, timeout=60)
            return {"success": result.returncode == 0, "output": result.stdout + result.stderr}
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="Backup timed out")
        except (subprocess.SubprocessError, OSError):
            logger.exception("Backup failed")
            raise HTTPException(status_code=500, detail="Backup failed")
    elif action.action == "update":
        def run_update():
            subprocess.run([str(script_path), "update"], capture_output=True)
        background_tasks.add_task(run_update)
        return {"success": True, "message": "Update started in background. Check logs for progress."}
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action.action}")
