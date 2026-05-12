"""ape-policy — Dream Server's APE policy engine integration.

Plugs into Hermes's `pre_tool_call` hook so every tool call (file_ops,
shell, web_fetch, MCP, etc.) hits APE's /verify endpoint before
execution. APE evaluates the call against configured policy (tool
allowlists, command guards, rate limits) and returns allowed / denied
with a reason.

Denied → the plugin returns a block directive in Hermes's documented
shape (``{"action": "block", "message": "..."}``). Hermes skips the
tool, surfaces the denial back to the LLM, and the agent learns from
it like any other tool error.

Allowed → the plugin returns None, Hermes proceeds normally.

Failure handling: if APE is unreachable, default to `fail_open`
(allow + warn). For stricter deployments set APE_FAIL_OPEN=false to
fail closed instead. Dream Server's default trusts the local-LAN
posture; operators who run Hermes-exposed-via-Tailscale to the public
internet should flip this to fail_closed.

Env vars consumed:
  * APE_URL          — APE service URL (default http://ape:7890)
  * APE_API_KEY      — APE API key sent as X-API-Key header (default
                       empty; APE auto-generates a per-process key when
                       unset, so callers MUST set this on both services
                       for /verify to succeed)
  * APE_TIMEOUT      — per-request timeout in seconds (default 5)
  * APE_FAIL_OPEN    — true/false (default true). Applies to network
                       outages only; 401 (auth misconfigured) always
                       fails closed.

Discovery: mounted by extensions/services/hermes/compose.yaml at
/opt/data/plugins/ape-policy/, which is the user-plugins path
(~/.hermes/plugins/<name>/) per Hermes's discovery rules. Read-only
mount — the plugin code lives in this repo, not in user state.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

APE_URL = os.environ.get("APE_URL", "http://ape:7890").rstrip("/")
APE_API_KEY = os.environ.get("APE_API_KEY", "")
APE_TIMEOUT = float(os.environ.get("APE_TIMEOUT", "5"))
APE_FAIL_OPEN = os.environ.get("APE_FAIL_OPEN", "true").lower() in ("1", "true", "yes")


def _ape_verify(
    tool_name: str,
    args: Optional[Dict[str, Any]],
    session_id: str,
    agent_id: str,
) -> tuple[bool, str]:
    """POST APE /verify. Returns (allowed, reason).

    On unreachable APE: returns (APE_FAIL_OPEN, "ape-unreachable-fail-open|closed").
    On 403 from APE in STRICT_MODE: returns (False, <reason-from-body>).
    """
    payload = json.dumps({
        "tool_name": tool_name,
        "args": args or {},
        "session_id": session_id,
        "agent_id": agent_id or "hermes",
    }).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if APE_API_KEY:
        headers["X-API-Key"] = APE_API_KEY

    request = urllib.request.Request(
        f"{APE_URL}/verify",
        data=payload,
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=APE_TIMEOUT) as response:
            data = json.loads(response.read().decode("utf-8"))
            return bool(data.get("allowed", False)), str(data.get("reason", "no reason"))
    except urllib.error.HTTPError as exc:
        # APE in STRICT_MODE returns 403 for denials. Parse the body to
        # surface the reason; if parsing fails, use a generic message.
        if exc.code == 403:
            try:
                err = json.loads(exc.read().decode("utf-8"))
                return False, str(err.get("detail", "denied by APE policy"))
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                return False, "denied by APE policy"
        if exc.code == 401:
            # Auth misconfigured: APE requires X-API-Key but the plugin
            # either sent nothing (APE_API_KEY unset on hermes) or the
            # value doesn't match APE's. This is a deployment bug, not
            # a network outage — always fail closed regardless of
            # APE_FAIL_OPEN so it surfaces loudly instead of silently
            # whitelisting every tool call.
            logger.error(
                "APE returned 401 for tool=%s — set APE_API_KEY on both "
                "the 'ape' and 'hermes' services to the same value",
                tool_name,
            )
            return False, "ape-auth-misconfigured"
        logger.warning("APE returned HTTP %d for tool=%s", exc.code, tool_name)
        return _fail()
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        logger.warning("APE unreachable for tool=%s: %s", tool_name, exc)
        return _fail()


def _fail() -> tuple[bool, str]:
    """Apply the fail-open / fail-closed policy when APE itself is broken."""
    if APE_FAIL_OPEN:
        return True, "ape-unreachable-fail-open"
    return False, "ape-unreachable-fail-closed"


def _on_pre_tool_call(
    tool_name: str = "",
    args: Optional[Dict[str, Any]] = None,
    session_id: str = "",
    task_id: str = "",
    tool_call_id: str = "",
    **kwargs: Any,
) -> Optional[Dict[str, str]]:
    """Hermes `pre_tool_call` hook.

    Return ``None`` to allow the tool call. Return
    ``{"action": "block", "message": "..."}`` to deny.
    """
    agent_id = str(kwargs.get("agent_id", "")) or "hermes"
    allowed, reason = _ape_verify(tool_name, args, session_id, agent_id)
    if not allowed:
        logger.info(
            "APE blocked tool=%s reason=%s session=%s tool_call_id=%s",
            tool_name, reason, session_id, tool_call_id,
        )
        return {
            "action": "block",
            "message": (
                f"Tool '{tool_name}' was blocked by APE policy: {reason}"
            ),
        }
    return None


def register(ctx) -> None:
    """Plugin entry point. Wires the pre_tool_call hook."""
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    logger.info(
        "ape-policy plugin registered (APE_URL=%s, fail_open=%s, timeout=%.1fs)",
        APE_URL, APE_FAIL_OPEN, APE_TIMEOUT,
    )
