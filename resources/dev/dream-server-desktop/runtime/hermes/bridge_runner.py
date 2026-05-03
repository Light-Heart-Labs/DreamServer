#!/usr/bin/env python3
"""JSON bridge for running the vendored Hermes Agent runtime.

The Electron/Node shell talks to this script over stdio.  The script imports the
vendored Hermes Python runtime and emits newline-delimited JSON events so the
desktop app can consume Hermes without reimplementing its agent loop in JS.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Any, Dict, Iterable, List


def _json_default(value: Any) -> str:
    try:
        return str(value)
    except Exception:
        return "<unprintable>"


def emit(payload: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=_json_default) + "\n")
    sys.stdout.flush()


def read_request() -> Dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def add_hermes_to_path(hermes_root: str | None) -> Path:
    root = Path(hermes_root or os.environ.get("DREAM_HERMES_ROOT", "")).expanduser()
    if not root:
        raise RuntimeError("DREAM_HERMES_ROOT nao foi informado.")
    root = root.resolve()
    if not (root / "run_agent.py").exists():
        raise RuntimeError(f"Hermes vendorizado nao encontrado em {root}")
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    return root


def normalize_list(value: Any) -> List[str] | None:
    if value is None:
        return None
    if isinstance(value, str):
        items = [item.strip() for item in value.split(",")]
    elif isinstance(value, Iterable):
        items = [str(item).strip() for item in value]
    else:
        items = []
    return [item for item in items if item] or None


def copy_missing_tree(source: Path, destination: Path) -> int:
    copied = 0
    if not source.exists():
        return copied
    for item in source.rglob("*"):
        relative = item.relative_to(source)
        target = destination / relative
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            continue
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)
        copied += 1
    return copied


def ensure_bundled_skills(root: Path) -> Dict[str, Any]:
    hermes_home = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes")).expanduser()
    active_skills_dir = hermes_home / "skills"
    bundled_skills_dir = root / "skills"
    optional_skills_dir = root / "optional-skills"
    active_skills_dir.mkdir(parents=True, exist_ok=True)
    if optional_skills_dir.exists() and not os.environ.get("HERMES_OPTIONAL_SKILLS"):
        os.environ["HERMES_OPTIONAL_SKILLS"] = str(optional_skills_dir)
    copied = copy_missing_tree(bundled_skills_dir, active_skills_dir)
    return {
        "home": str(hermes_home),
        "activeSkillsDir": str(active_skills_dir),
        "bundledSkillsDir": str(bundled_skills_dir),
        "optionalSkillsDir": str(optional_skills_dir) if optional_skills_dir.exists() else "",
        "copied": copied,
    }


def maybe_expand_skill_command(input_text: str, task_id: str | None = None) -> str:
    stripped = str(input_text or "").strip()
    if not stripped.startswith("/") or stripped.startswith("//"):
        return input_text
    first, _, rest = stripped.partition(" ")
    command = first[1:].strip()
    if not command:
        return input_text
    try:
        from agent.skill_commands import build_skill_invocation_message, resolve_skill_command_key

        key = resolve_skill_command_key(command)
        if not key:
            return input_text
        user_instruction = rest.strip() or f"Execute the {key} skill."
        return build_skill_invocation_message(
            key,
            user_instruction,
            task_id=task_id,
            runtime_note="DreamServer desktop slash command routed through Hermes Agent.",
        )
    except Exception as exc:
        emit({
            "type": "status",
            "kind": "slash_skill",
            "message": f"Skill slash fallback: {type(exc).__name__}: {exc}",
        })
        return input_text


def run_local_terminal_doctor() -> Dict[str, Any]:
    workspace = Path(tempfile.mkdtemp(prefix="dream-hermes-doctor-"))
    env = None
    try:
        from tools.environments.local import LocalEnvironment

        env = LocalEnvironment(cwd=str(workspace), timeout=15)
        result = env.execute(
            'pwd; printf "ok" > hermes-doctor.txt; test -f hermes-doctor.txt && echo HERMES_DOCTOR_OK',
            timeout=15,
        )
        output = str(result.get("output") or "")
        ok = (
            int(result.get("returncode") or 0) == 0
            and (workspace / "hermes-doctor.txt").exists()
            and "HERMES_DOCTOR_OK" in output
        )
        return {
            "ok": ok,
            "workspace": str(workspace),
            "cwd": str(getattr(env, "cwd", "")),
            "returncode": result.get("returncode"),
            "output": output[-500:],
            "error": None if ok else "Local terminal did not execute inside the requested workspace.",
        }
    except Exception as exc:
        return {
            "ok": False,
            "workspace": str(workspace),
            "cwd": str(getattr(env, "cwd", "")) if env is not None else "",
            "returncode": None,
            "output": "",
            "error": f"{type(exc).__name__}: {exc}",
        }
    finally:
        try:
            if env is not None:
                env.cleanup()
        except Exception:
            pass
        shutil.rmtree(workspace, ignore_errors=True)


def run_doctor(hermes_root: str | None) -> None:
    payload: Dict[str, Any] = {
        "type": "doctor",
        "ok": False,
        "python": sys.executable,
        "version": sys.version.split()[0],
        "hermesRoot": None,
        "importable": False,
        "localTerminal": None,
        "error": None,
    }
    try:
        root = add_hermes_to_path(hermes_root)
        payload["hermesRoot"] = str(root)
        payload["skills"] = ensure_bundled_skills(root)
        from run_agent import AIAgent  # noqa: F401

        payload["importable"] = True
        payload["localTerminal"] = run_local_terminal_doctor()
        payload["ok"] = bool(payload["localTerminal"].get("ok"))
    except Exception as exc:
        payload["error"] = f"{type(exc).__name__}: {exc}"
    emit(payload)


def run_turn(request: Dict[str, Any]) -> None:
    root = add_hermes_to_path(request.get("hermesRoot"))
    skills_state = ensure_bundled_skills(root)
    emit({"type": "status", "kind": "skills", "message": json.dumps(skills_state, ensure_ascii=False)})

    workspace_root = request.get("workspaceRoot")
    if workspace_root:
        Path(workspace_root).mkdir(parents=True, exist_ok=True)
        os.chdir(workspace_root)

    try:
        from run_agent import AIAgent
    except Exception as exc:
        emit({
            "type": "error",
            "stage": "import",
            "message": f"Nao foi possivel importar Hermes Agent: {type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(limit=8),
        })
        emit({
            "type": "final",
            "ok": False,
            "finalResponse": "Hermes Agent esta vendorizado, mas o ambiente Python/dependencias ainda nao esta instalado.",
        })
        return

    def on_text_delta(delta: Any) -> None:
        if delta is None:
            emit({"type": "text_done"})
        elif str(delta):
            emit({"type": "text_delta", "delta": str(delta)})

    def on_status(kind: Any, message: Any = "") -> None:
        emit({"type": "status", "kind": str(kind), "message": str(message or "")})

    def on_thinking(message: Any = "") -> None:
        emit({"type": "thinking", "message": str(message or "")})

    def on_reasoning(delta: Any = "") -> None:
        emit({"type": "reasoning_delta", "delta": str(delta or "")})

    def on_step(iteration: Any, tools: Any = None) -> None:
        emit({"type": "step", "iteration": iteration, "tools": tools or []})

    def on_tool_start(tool_call_id: Any, name: Any, args: Any = None) -> None:
        emit({
            "type": "tool_start",
            "id": str(tool_call_id or ""),
            "name": str(name or ""),
            "args": args or {},
        })

    def on_tool_complete(tool_call_id: Any, name: Any, args: Any = None, result: Any = None) -> None:
        emit({
            "type": "tool_complete",
            "id": str(tool_call_id or ""),
            "name": str(name or ""),
            "args": args or {},
            "result": result,
        })

    try:
        agent = AIAgent(
            base_url=str(request.get("baseUrl") or ""),
            model=str(request.get("model") or ""),
            api_key=request.get("apiKey") or None,
            provider=request.get("provider") or None,
            api_mode=request.get("apiMode") or None,
            max_iterations=int(request.get("maxIterations") or 12),
            max_tokens=int(request.get("maxTokens") or 0) or None,
            reasoning_config=request.get("reasoningConfig") or None,
            request_overrides=request.get("requestOverrides") or None,
            ephemeral_system_prompt=request.get("ephemeralSystemPrompt") or None,
            enabled_toolsets=normalize_list(request.get("enabledToolsets")),
            disabled_toolsets=normalize_list(request.get("disabledToolsets")),
            providers_allowed=normalize_list(request.get("providersAllowed")),
            providers_ignored=normalize_list(request.get("providersIgnored")),
            providers_order=normalize_list(request.get("providersOrder")),
            provider_sort=request.get("providerSort") or None,
            provider_require_parameters=bool(request.get("providerRequireParameters", False)),
            provider_data_collection=request.get("providerDataCollection") or None,
            quiet_mode=True,
            platform=str(request.get("platform") or ("desktop" if request.get("desktopIntegrationEnabled") else "cli")),
            session_id=request.get("sessionId") or None,
            tool_start_callback=on_tool_start,
            tool_complete_callback=on_tool_complete,
            thinking_callback=on_thinking,
            reasoning_callback=on_reasoning,
            step_callback=on_step,
            stream_delta_callback=on_text_delta,
            status_callback=on_status,
            skip_context_files=bool(request.get("skipContextFiles", False)),
        )
        input_text = maybe_expand_skill_command(
            str(request.get("inputText") or ""),
            task_id=request.get("taskId") or None,
        )
        result = agent.run_conversation(
            user_message=input_text,
            conversation_history=request.get("conversationHistory") or None,
            task_id=request.get("taskId") or None,
            stream_callback=None,
        )
        final_response = result.get("final_response", "") if isinstance(result, dict) else str(result)
        final_response = final_response or ""
        failed = bool(result.get("failed")) if isinstance(result, dict) else False
        error_message = result.get("error", "") if isinstance(result, dict) else ""
        if failed and not final_response.strip():
            final_response = f"Hermes Agent nao conseguiu concluir a chamada ao modelo: {error_message or 'sem detalhe de erro retornado.'}"
        emit({
            "type": "final",
            "ok": not failed and bool(final_response.strip()),
            "finalResponse": final_response,
            "result": result,
        })
    except KeyboardInterrupt:
        emit({"type": "stopped", "reason": "interrupted"})
    except Exception as exc:
        emit({
            "type": "error",
            "stage": "run",
            "message": f"{type(exc).__name__}: {exc}",
            "traceback": traceback.format_exc(limit=12),
        })
        emit({
            "type": "final",
            "ok": False,
            "finalResponse": f"Hermes Agent falhou durante a execucao: {type(exc).__name__}: {exc}",
        })


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--doctor", action="store_true")
    parser.add_argument("--hermes-root", default=os.environ.get("DREAM_HERMES_ROOT", ""))
    args = parser.parse_args()

    if args.doctor:
        run_doctor(args.hermes_root)
        return

    request = read_request()
    request.setdefault("hermesRoot", args.hermes_root)
    run_turn(request)


if __name__ == "__main__":
    main()
