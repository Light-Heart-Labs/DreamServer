"""Model-swap endpoint.

POST /api/model/swap
  Body : { "tier": "<tier>", "restart": true }
  Response: text/event-stream (Server-Sent Events)

Each SSE event is a JSON object on a data: line:

  {"type": "log",      "message": "<line from dream-cli>"}
  {"type": "progress", "step": "restart", "status": "running"}
  {"type": "done",     "success": true,  "tier": "T2", "restarted": true}
  {"type": "error",    "message": "...", "step": "swap"|"restart"}

The endpoint runs two subprocesses through the existing dream-cli script so
that tier-resolution logic stays in a single place:

  1. bash dream-cli model swap <tier>  — updates .env in-place
  2. bash dream-cli restart llama-server — (optional) hot-reloads the model
"""

import json
import logging
import re
import subprocess
from collections.abc import Generator
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from config import INSTALL_DIR
from models import ModelSwapRequest
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["model"])

_VALID_TIERS: frozenset[str] = frozenset({
    "0", "1", "2", "3", "4",
    "T0", "T1", "T2", "T3", "T4",
    "CLOUD",
    "NV_ULTRA",
    "SH", "SH_COMPACT", "SH_LARGE",
    "ARC", "ARC_LITE",
})

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[mGKHF]")


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def _find_dream_cli() -> "Path | None":
    candidate = Path(INSTALL_DIR) / "dream-cli"
    return candidate if candidate.exists() else None


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _run_streamed(
    args: list[str],
    cwd: str,
) -> Generator[tuple[str, int], None, None]:
    """Run args as a subprocess and yield (line, -1) per output line, then ("", returncode)."""
    proc = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        cwd=cwd,
    )
    try:
        assert proc.stdout is not None
        for raw in proc.stdout:
            yield (raw.rstrip(), -1)
        proc.wait()
    finally:
        if proc.stdout:
            proc.stdout.close()
        if proc.poll() is None:
            proc.kill()
            proc.wait()
    yield ("", proc.returncode)


def _generate_swap_events(
    tier: str,
    restart: bool,
    cli_path: Path,
) -> Generator[str, None, None]:
    """Sync generator that drives both dream-cli subprocesses and yields SSE strings."""
    install_dir = str(cli_path.parent)
    cli = str(cli_path)

    yield _sse({"type": "log", "message": f"Applying model tier {tier}..."})

    swap_rc = 0
    for line, rc in _run_streamed(["bash", cli, "model", "swap", tier], cwd=install_dir):
        if rc == -1:
            clean = _strip_ansi(line)
            if clean:
                yield _sse({"type": "log", "message": clean})
        else:
            swap_rc = rc

    if swap_rc != 0:
        yield _sse({
            "type": "error",
            "message": f"'dream model swap {tier}' exited with code {swap_rc}",
            "step": "swap",
        })
        return

    if not restart:
        yield _sse({"type": "done", "success": True, "tier": tier, "restarted": False})
        return

    yield _sse({"type": "log", "message": "Restarting llama-server..."})
    yield _sse({"type": "progress", "step": "restart", "status": "running"})

    restart_rc = 0
    for line, rc in _run_streamed(
        ["bash", cli, "restart", "llama-server"], cwd=install_dir
    ):
        if rc == -1:
            clean = _strip_ansi(line)
            if clean:
                yield _sse({"type": "log", "message": clean})
        else:
            restart_rc = rc

    if restart_rc != 0:
        yield _sse({
            "type": "error",
            "message": f"llama-server restart exited with code {restart_rc}",
            "step": "restart",
        })
        return

    yield _sse({"type": "done", "success": True, "tier": tier, "restarted": True})


@router.post("/api/model/swap")
async def swap_model(
    request: ModelSwapRequest,
    api_key: str = Depends(verify_api_key),
) -> StreamingResponse:
    """Swap the active model tier and optionally restart llama-server.

    Streams SSE progress events until the operation completes.
    """
    tier = request.tier.strip().upper()
    if tier not in _VALID_TIERS:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Unknown tier '{request.tier}'. "
                f"Valid tiers: {', '.join(sorted(_VALID_TIERS))}"
            ),
        )

    cli_path = _find_dream_cli()
    if cli_path is None:
        raise HTTPException(
            status_code=501,
            detail=f"dream-cli not found in INSTALL_DIR ({INSTALL_DIR}). "
                   "Ensure the Dream Server is fully installed.",
        )

    logger.info("Model swap requested: tier=%s restart=%s", tier, request.restart)

    return StreamingResponse(
        _generate_swap_events(tier, request.restart, cli_path),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
