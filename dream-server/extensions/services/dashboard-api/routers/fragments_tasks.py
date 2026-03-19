"""HTML fragments for workflow-backed task boards."""

from __future__ import annotations

import html as html_mod

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

from routers.workflows import load_workflow_catalog, get_n8n_workflows, check_workflow_dependencies
from security import verify_api_key

router = APIRouter(tags=["fragments"])


def _escape(value) -> str:
    return html_mod.escape(str(value))


def _status_badge(status: str) -> str:
    mapping = {
        "active": "status-ok",
        "installed": "status-warn",
        "available": "status-idle",
        "blocked": "status-error",
    }
    return mapping.get(status, "status-idle")


def _match_installed_workflow(workflow: dict, installed: list[dict]) -> dict | None:
    target = workflow.get("name", "").lower()
    for item in installed:
        name = item.get("name", "").lower()
        if target and (target in name or name in target):
            return item
    return None


def _render_task_cards(tasks: list[dict]) -> str:
    if not tasks:
        return """
        <article class="task-card empty">
            <h4>No automation tasks discovered</h4>
            <p>Add workflow catalog entries to surface repeatable tasks here.</p>
        </article>
        """

    cards = []
    for task in tasks:
        deps = "".join(
            f"<span class=\"dependency-pill {'ok' if dep['ready'] else 'warn'}\">{_escape(dep['name'])}</span>"
            for dep in task["dependencies"]
        ) or "<span class=\"dependency-pill ok\">No dependencies</span>"
        cards.append(
            f"""
            <article class="task-card">
                <div class="task-header">
                    <div>
                        <h4>{_escape(task['name'])}</h4>
                        <p>{_escape(task['description'])}</p>
                    </div>
                    <span class="status-chip {_status_badge(task['status'])}">{_escape(task['status'].title())}</span>
                </div>
                <div class="task-meta">
                    <span>Category: {_escape(task['category'])}</span>
                    <span>Executions: {_escape(task['executions'])}</span>
                </div>
                <div class="dependency-row">{deps}</div>
            </article>
            """
        )
    return "".join(cards)


def _build_tasks_fragment(tasks: list[dict]) -> str:
    active = sum(1 for task in tasks if task["status"] == "active")
    blocked = sum(1 for task in tasks if task["status"] == "blocked")

    return f"""
    <section class="fragment-card tasks-fragment">
        <header class="fragment-header">
            <div>
                <h3>Automation Tasks</h3>
                <p>Workflow-backed automations you can activate, monitor, and troubleshoot.</p>
            </div>
            <span class="status-chip status-ok">{_escape(len(tasks))} catalogued</span>
        </header>

        <div class="summary-grid">
            <article><span class="summary-label">Active</span><strong>{_escape(active)}</strong></article>
            <article><span class="summary-label">Blocked</span><strong>{_escape(blocked)}</strong></article>
            <article><span class="summary-label">Available</span><strong>{_escape(len(tasks) - active)}</strong></article>
        </div>

        <div class="task-grid">
            {_render_task_cards(tasks)}
        </div>
    </section>
    """


@router.get("/api/fragments/tasks")
async def tasks_fragment(api_key: str = Depends(verify_api_key)):
    """Return an HTML fragment for workflow task cards."""
    catalog = load_workflow_catalog()
    installed = await get_n8n_workflows()

    tasks = []
    for workflow in catalog.get("workflows", []):
        installed_match = _match_installed_workflow(workflow, installed)
        dependency_state = await check_workflow_dependencies(workflow.get("dependencies", []))
        blocked = any(not ready for ready in dependency_state.values())

        status = "available"
        executions = 0
        if installed_match:
            status = "active" if installed_match.get("active") else "installed"
            executions = installed_match.get("statistics", {}).get("executions", {}).get("total", 0)
        if blocked:
            status = "blocked"

        tasks.append(
            {
                "name": workflow.get("name", workflow.get("id", "workflow")),
                "description": workflow.get("description", "No description provided."),
                "category": workflow.get("category", "general"),
                "status": status,
                "executions": executions,
                "dependencies": [
                    {"name": dep, "ready": dependency_state.get(dep, True)}
                    for dep in workflow.get("dependencies", [])
                ],
            }
        )

    return HTMLResponse(content=_build_tasks_fragment(tasks))
