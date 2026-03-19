"""HTML fragments for operational error summaries."""

from __future__ import annotations

import html as html_mod

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse

from config import MANIFEST_ERRORS
from helpers import get_all_services
from security import verify_api_key

router = APIRouter(tags=["fragments"])


def _escape(value) -> str:
    return html_mod.escape(str(value))


def _render_manifest_errors(errors: list[dict]) -> str:
    if not errors:
        return "<li>No manifest parsing errors detected.</li>"

    return "".join(
        f"<li><strong>{_escape(item.get('file', 'unknown'))}</strong>: {_escape(item.get('error', 'Unknown error'))}</li>"
        for item in errors
    )


def _render_service_errors(services: list) -> str:
    failing = [service for service in services if service.status not in {"healthy", "not_deployed"}]
    if not failing:
        return "<li>All deployed services are healthy.</li>"

    return "".join(
        f"<li><strong>{_escape(service.name)}</strong>: {_escape(service.status)} on port {_escape(service.external_port)}</li>"
        for service in failing
    )


def _build_errors_fragment(manifest_errors: list[dict], services: list) -> str:
    failing = [service for service in services if service.status not in {"healthy", "not_deployed"}]
    total_issues = len(manifest_errors) + len(failing)

    return f"""
    <section class="fragment-card errors-fragment">
        <header class="fragment-header">
            <div>
                <h3>Error Summary</h3>
                <p>Configuration and runtime issues that need operator attention.</p>
            </div>
            <span class="status-chip {'status-error' if total_issues else 'status-ok'}">{_escape(total_issues)} issue(s)</span>
        </header>

        <div class="summary-grid">
            <article><span class="summary-label">Manifest errors</span><strong>{_escape(len(manifest_errors))}</strong></article>
            <article><span class="summary-label">Service errors</span><strong>{_escape(len(failing))}</strong></article>
        </div>

        <div class="detail-grid">
            <article class="detail-card">
                <span class="summary-label">Manifest load issues</span>
                <ul class="error-list">
                    {_render_manifest_errors(manifest_errors)}
                </ul>
            </article>
            <article class="detail-card">
                <span class="summary-label">Runtime service issues</span>
                <ul class="error-list">
                    {_render_service_errors(services)}
                </ul>
            </article>
        </div>
    </section>
    """


@router.get("/api/fragments/errors")
async def errors_fragment(api_key: str = Depends(verify_api_key)):
    """Return an HTML fragment for runtime and configuration errors."""
    services = await get_all_services()
    return HTMLResponse(content=_build_errors_fragment(MANIFEST_ERRORS, services))
