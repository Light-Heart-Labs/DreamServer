"""Setup wizard, persona management, and chat endpoints."""

import json
import logging
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import aiohttp
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from config import SERVICES, PERSONAS, SETUP_CONFIG_DIR, INSTALL_DIR
from models import PersonaRequest, ChatRequest
from security import verify_api_key

logger = logging.getLogger(__name__)

router = APIRouter(tags=["setup"])


def get_active_persona_prompt() -> str:
    """Get the system prompt for the active persona."""
    persona_file = SETUP_CONFIG_DIR / "persona.json"
    if persona_file.exists():
        try:
            with open(persona_file) as f:
                data = json.load(f)
                return data.get("system_prompt", PERSONAS["general"]["system_prompt"])
        except Exception:
            pass
    return PERSONAS["general"]["system_prompt"]


@router.get("/api/setup/status")
async def setup_status(api_key: str = Depends(verify_api_key)):
    """Check if this is a first-run scenario."""
    setup_complete_file = SETUP_CONFIG_DIR / "setup-complete.json"
    first_run = not setup_complete_file.exists()

    step = 0
    progress_file = SETUP_CONFIG_DIR / "setup-progress.json"
    if progress_file.exists():
        try:
            with open(progress_file) as f:
                step = json.load(f).get("step", 0)
        except Exception:
            pass

    persona = None
    persona_file = SETUP_CONFIG_DIR / "persona.json"
    if persona_file.exists():
        try:
            with open(persona_file) as f:
                persona = json.load(f).get("persona")
        except Exception:
            pass

    return {"first_run": first_run, "step": step, "persona": persona, "personas_available": list(PERSONAS.keys())}


@router.post("/api/setup/persona")
async def setup_persona(request: PersonaRequest, api_key: str = Depends(verify_api_key)):
    """Set the user's chosen persona."""
    if request.persona not in PERSONAS:
        raise HTTPException(status_code=400, detail=f"Invalid persona. Choose from: {list(PERSONAS.keys())}")

    persona_info = PERSONAS[request.persona]
    SETUP_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    persona_data = {
        "persona": request.persona, "name": persona_info["name"],
        "system_prompt": persona_info["system_prompt"], "icon": persona_info["icon"],
        "selected_at": datetime.now(timezone.utc).isoformat()
    }
    with open(SETUP_CONFIG_DIR / "persona.json", "w") as f:
        json.dump(persona_data, f, indent=2)

    with open(SETUP_CONFIG_DIR / "setup-progress.json", "w") as f:
        json.dump({"step": 2, "persona_selected": True}, f)

    return {"success": True, "persona": request.persona, "name": persona_info["name"], "message": f"Great choice! Your assistant is now a {persona_info['name']}."}


@router.post("/api/setup/complete")
async def setup_complete(api_key: str = Depends(verify_api_key)):
    """Mark the first-run setup as complete."""
    SETUP_CONFIG_DIR.mkdir(parents=True, exist_ok=True)

    with open(SETUP_CONFIG_DIR / "setup-complete.json", "w") as f:
        json.dump({"completed_at": datetime.now(timezone.utc).isoformat(), "version": "1.0.0"}, f, indent=2)

    progress_file = SETUP_CONFIG_DIR / "setup-progress.json"
    if progress_file.exists():
        progress_file.unlink()

    return {"success": True, "redirect": "/", "message": "Setup complete! Welcome to Dream Server."}


@router.get("/api/setup/persona/{persona_id}")
async def get_persona_info(persona_id: str, api_key: str = Depends(verify_api_key)):
    """Get details about a specific persona."""
    if persona_id not in PERSONAS:
        raise HTTPException(status_code=404, detail=f"Persona not found: {persona_id}")
    return {"id": persona_id, **PERSONAS[persona_id]}


@router.get("/api/setup/personas")
async def list_personas(api_key: str = Depends(verify_api_key)):
    """List all available personas."""
    return {"personas": [{"id": pid, **pdata} for pid, pdata in PERSONAS.items()]}


@router.post("/api/setup/test")
async def run_setup_diagnostics(api_key: str = Depends(verify_api_key)):
    """Run diagnostic tests for setup wizard."""
    script_path = Path(INSTALL_DIR) / "scripts" / "dream-test-functional.sh"
    if not script_path.exists():
        script_path = Path(os.getcwd()) / "dream-test-functional.sh"

    if not script_path.exists():
        async def error_stream():
            yield "Diagnostic script not found. Running basic connectivity tests...\n"
            async with aiohttp.ClientSession() as session:
                services = [
                    (cfg.get("name", sid), f"http://{cfg.get('host', sid)}:{cfg.get('port', 80)}{cfg.get('health', '/')}")
                    for sid, cfg in SERVICES.items()
                ]
                for name, url in services:
                    try:
                        async with session.get(url, timeout=5) as resp:
                            status = "\u2713" if resp.status == 200 else "\u2717"
                            yield f"{status} {name}: {resp.status}\n"
                    except Exception as e:
                        yield f"\u2717 {name}: {e}\n"
            yield "\nSetup complete!\n"
        return StreamingResponse(error_stream(), media_type="text/plain")

    def run_tests():
        process = subprocess.Popen(
            ["bash", str(script_path)],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, universal_newlines=True
        )
        for line in process.stdout:
            yield line
        process.wait()
        yield f"\n{'All tests passed!' if process.returncode == 0 else 'Some tests failed.'}\n"

    return StreamingResponse(run_tests(), media_type="text/plain")


@router.post("/api/chat")
async def chat(request: ChatRequest, api_key: str = Depends(verify_api_key)):
    """Simple chat endpoint for the setup wizard QuickWin step."""
    system_prompt = request.system or get_active_persona_prompt()

    _llm = SERVICES.get("llama-server", {})
    llm_url = os.environ.get("OLLAMA_URL", f"http://{_llm.get('host', 'llama-server')}:{_llm.get('port', 0)}")
    model = os.environ.get("LLM_MODEL", "qwen3-coder-next")

    payload = {
        "model": model,
        "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": request.message}],
        "max_tokens": 256, "temperature": 0.7
    }

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
            async with session.post(f"{llm_url}/v1/chat/completions", json=payload, headers={"Content-Type": "application/json"}) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    response_text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                    return {"response": response_text, "success": True}
                else:
                    error_text = await resp.text()
                    raise HTTPException(status_code=resp.status, detail=f"LLM error: {error_text}")
    except aiohttp.ClientError:
        logger.exception("Cannot reach LLM backend")
        raise HTTPException(status_code=503, detail="Cannot reach LLM backend")
