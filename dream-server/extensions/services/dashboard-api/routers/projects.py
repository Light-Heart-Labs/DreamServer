"""Projects router — proxies a small subset of the Vikunja API.

Acts as a thin pass-through so the React dashboard never has to hold the
Vikunja API token in the browser. The token lives only in `.env` (read by
config.py as VIKUNJA_API_TOKEN) and is injected server-side here.

Open Claw on the Pi 5 talks to Vikunja DIRECTLY (not through this proxy)
because it lives on a different host and already holds its own copy of
VIKUNJA_API_TOKEN.

Per Dream Server design philosophy: narrow exception handling at the I/O
boundary only, and only to map a specific failure mode to a meaningful
HTTP status. Everything else propagates.
"""

import logging

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException

from config import VIKUNJA_API_TOKEN, VIKUNJA_URL
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["projects"])

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def _auth_headers() -> dict:
    if not VIKUNJA_API_TOKEN:
        raise HTTPException(
            status_code=503,
            detail=(
                "VIKUNJA_API_TOKEN is not set. Create an API token in Vikunja "
                "(Settings → API Tokens) with write scope on projects+tasks, "
                "then add it to .env as VIKUNJA_API_TOKEN=tk_…"
            ),
        )
    return {"Authorization": f"Bearer {VIKUNJA_API_TOKEN}"}


async def _vikunja_request(method: str, path: str, *, json: dict | None = None) -> dict | list:
    url = f"{VIKUNJA_URL.rstrip('/')}{path}"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            resp = await client.request(method, url, headers=_auth_headers(), json=json)
        except httpx.ConnectError as exc:
            raise HTTPException(status_code=503, detail=f"Vikunja unreachable at {url}") from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(status_code=504, detail="Vikunja request timed out") from exc

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    if not resp.content:
        return {}
    return resp.json()


@router.get("/api/projects/status")
async def projects_status(api_key: str = Depends(verify_api_key)):
    """Lightweight health probe used by the Projects page banner."""
    url = f"{VIKUNJA_URL.rstrip('/')}/api/v1/info"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            resp = await client.get(url)
        except httpx.ConnectError:
            return {"available": False, "configured": bool(VIKUNJA_API_TOKEN), "message": "Vikunja unreachable"}
        except httpx.TimeoutException:
            return {"available": False, "configured": bool(VIKUNJA_API_TOKEN), "message": "Vikunja timed out"}

    healthy = resp.status_code == 200
    return {
        "available": healthy,
        "configured": bool(VIKUNJA_API_TOKEN),
        "url": VIKUNJA_URL,
        "version": (resp.json() or {}).get("version") if healthy else None,
        "message": "Vikunja ready" if healthy else f"HTTP {resp.status_code}",
    }


@router.get("/api/projects")
async def list_projects(api_key: str = Depends(verify_api_key)):
    """List all projects the API token can see."""
    return await _vikunja_request("GET", "/api/v1/projects")


@router.get("/api/projects/{project_id}/tasks")
async def list_project_tasks(project_id: int, api_key: str = Depends(verify_api_key)):
    """List tasks belonging to a single project."""
    return await _vikunja_request("GET", f"/api/v1/projects/{project_id}/tasks")


@router.put("/api/projects/{project_id}/tasks")
async def create_project_task(
    project_id: int,
    task: dict = Body(...),
    api_key: str = Depends(verify_api_key),
):
    """Create a new task in a project. Body is forwarded to Vikunja unchanged.

    Minimal payload: ``{"title": "Do the thing"}``.
    """
    if not isinstance(task, dict) or not task.get("title"):
        raise HTTPException(status_code=422, detail="task.title is required")
    return await _vikunja_request("PUT", f"/api/v1/projects/{project_id}/tasks", json=task)


@router.post("/api/projects/tasks/{task_id}")
async def update_task(
    task_id: int,
    patch: dict = Body(...),
    api_key: str = Depends(verify_api_key),
):
    """Update a task (status, title, description, …)."""
    return await _vikunja_request("POST", f"/api/v1/tasks/{task_id}", json=patch)

