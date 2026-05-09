#!/usr/bin/env python3
"""Dream Server desktop tools exposed through the Hermes Agent registry."""

import json
import os
import subprocess
from pathlib import Path

from tools.registry import registry

GATEWAY_PLATFORMS = [
    "whatsapp",
    "discord",
    "telegram",
    "slack",
    "matrix",
    "mattermost",
    "signal",
    "homeassistant",
    "email",
    "sms",
    "api_server",
    "webhook",
    "dingtalk",
    "feishu",
    "wecom",
    "weixin",
    "bluebubbles",
    "qqbot",
    "yuanbao",
]


def _project_root() -> Path:
    configured = os.environ.get("DREAM_DESKTOP_ROOT")
    if configured:
        return Path(configured).resolve()
    return Path(__file__).resolve().parents[3]


def _node_command() -> str:
    return os.environ.get("DREAM_DESKTOP_NODE") or "node"


def _run_dream_action(action: dict) -> str:
    if os.environ.get("DREAM_DESKTOP_INTEGRATION_ENABLED", "").strip().lower() not in {"1", "true", "yes", "on"}:
        return json.dumps({
            "ok": False,
            "error": "Dream Desktop integration is disabled. Enable it in Dream Server settings to use Windows desktop/workbench tools."
        }, ensure_ascii=False)

    root = _project_root()
    script = root / "bin" / "dream-desktop-tool.js"
    if not script.exists():
        return json.dumps({
            "ok": False,
            "error": f"Dream desktop bridge not found: {script}"
        })

    env = os.environ.copy()
    env.setdefault("PYTHONUTF8", "1")
    if env.get("DREAM_DESKTOP_NODE_RUN_AS_NODE") == "1":
        env["ELECTRON_RUN_AS_NODE"] = "1"

    workspace_root = (
        os.environ.get("DREAM_WORKSPACE_ROOT")
        or os.environ.get("HERMES_WORKSPACE_ROOT")
        or str(root)
    )

    payload = json.dumps({
        "action": action,
        "workspaceRoot": workspace_root
    }, ensure_ascii=False)

    action_timeout_ms = 0
    try:
        action_timeout_ms = int(action.get("timeoutMs") or 0)
    except (TypeError, ValueError):
        action_timeout_ms = 0
    bridge_timeout_seconds = max(90, min(150, int(action_timeout_ms / 1000) + 20))

    completed = subprocess.run(
        [_node_command(), str(script)],
        input=payload,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(root),
        env=env,
        timeout=bridge_timeout_seconds,
    )

    stdout = (completed.stdout or "").strip()
    stderr = (completed.stderr or "").strip()
    try:
        result = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError:
        result = {"ok": completed.returncode == 0, "stdout": stdout}
    if stderr:
        result["stderr"] = stderr
    if completed.returncode != 0:
        result["ok"] = False
        result.setdefault("error", f"Dream desktop bridge exited with code {completed.returncode}.")
    return json.dumps(result, ensure_ascii=False)


def _is_http_url(url: str | None) -> bool:
    value = (url or "").strip().lower()
    return value.startswith("http://") or value.startswith("https://")


def _open_url_action(url: str | None) -> dict:
    if _is_http_url(url):
        return {
            "type": "browser_harness",
            "command": "goto",
            "url": url,
            "screenshot": False,
        }
    return {"type": "open_url", "url": url}


def _schema(name: str, description: str, properties: dict, required: list[str] | None = None) -> dict:
    return {
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required or [],
            "additionalProperties": False,
        },
    }


def _browser_control_action(args: dict) -> dict:
    steps = args.get("steps") or []
    url = (args.get("url") or "").strip()
    command = "sequence" if steps else ("goto" if url else "snapshot")
    return {
        "type": "browser_harness",
        "command": command,
        "url": url,
        "steps": steps,
        "screenshot": bool(args.get("screenshot", False)),
        "timeoutMs": args.get("timeoutMs"),
    }


def _gateway_action(args: dict) -> dict:
    command = str(args.get("command") or args.get("operation") or "status").strip().lower()
    platform = str(args.get("platform") or args.get("gateway") or "").strip().lower()
    timeout_ms = args.get("timeoutMs")
    if timeout_ms is None and command in {"start", "restart"} and platform == "whatsapp":
        timeout_ms = 90000
    return {
        "type": "gateway_control",
        "command": command,
        "platform": platform,
        "timeoutMs": timeout_ms or 30000,
        "token": args.get("token"),
        "botToken": args.get("botToken") or args.get("bot_token"),
        "secretField": args.get("secretField") or args.get("secret_field"),
        "secretValue": args.get("secretValue") or args.get("secret_value"),
        "secrets": args.get("secrets"),
        "chatId": args.get("chatId") or args.get("chat_id") or args.get("id"),
        "target": args.get("target"),
        "threadId": args.get("threadId") or args.get("thread_id"),
        "guildId": args.get("guildId") or args.get("guild_id") or args.get("serverId") or args.get("server_id"),
        "message": args.get("message") or args.get("text"),
        "messageId": args.get("messageId") or args.get("message_id"),
        "filePath": args.get("filePath") or args.get("file_path"),
        "mediaType": args.get("mediaType") or args.get("media_type"),
        "caption": args.get("caption"),
        "fileName": args.get("fileName") or args.get("file_name"),
        "replyTo": args.get("replyTo") or args.get("reply_to"),
        "code": args.get("code") or args.get("pairingCode") or args.get("approvalCode") or args.get("pairing_code") or args.get("approval_code"),
        "pairingCode": args.get("pairingCode") or args.get("pairing_code"),
        "approvalCode": args.get("approvalCode") or args.get("approval_code"),
        "userId": args.get("userId") or args.get("user_id"),
        "limit": args.get("limit"),
    }


registry.register(
    name="dream_launch_app",
    toolset="dream-desktop",
    schema=_schema(
        "dream_launch_app",
        "Open a native desktop application or executable. Do not use this for HTTP/HTTPS web browsing; web pages must stay in the Dream Server Workbench browser.",
        {
            "app": {"type": "string", "description": "App name such as notepad, powershell, spotify, discord, or a native app shortcut."},
            "path": {"type": "string", "description": "Optional executable path."},
            "args": {"type": "array", "items": {"type": "string"}, "description": "Optional process arguments."},
        },
    ),
    handler=lambda args, **kw: _run_dream_action({
        "type": "launch_app",
        "app": args.get("app"),
        "path": args.get("path"),
        "args": args.get("args") or [],
    }),
    description="Open Windows applications through the Dream Server desktop bridge.",
)

registry.register(
    name="dream_gateway",
    toolset="dream-desktop",
    schema=_schema(
        "dream_gateway",
        (
            "Control the real Dream Server Hermes Gateway through the running Electron runtime. "
            "Use this for WhatsApp QR pairing, Telegram/Discord Hermes pairing approval, "
            "Discord/Telegram/Slack/Matrix/Signal/email/SMS/webhook gateway start/stop/restart/status/logs. "
            "Do not use terminal, delegate_task, browser tools, "
            "or WhatsApp Web for gateway lifecycle."
        ),
        {
            "command": {
                "type": "string",
                "enum": [
                    "start",
                    "stop",
                    "restart",
                    "status",
                    "configure",
                    "configure_secret",
                    "set_secret",
                    "capabilities",
                    "identity",
                    "groups",
                    "guilds",
                    "channels",
                    "chats",
                    "recent_messages",
                    "pairing_status",
                    "approve_pairing",
                    "revoke_pairing",
                    "clear_pairing",
                    "chat",
                    "send",
                    "edit",
                    "send_media",
                    "typing",
                ],
                "description": "Gateway operation to execute in Dream Server. Use configure/configure_secret/set_secret to save gateway credentials through Electron safe storage; never use terminal or browser tools for gateway credentials. Messaging operations include capabilities, identity, groups/guilds/channels/chats, pairing_status, approve_pairing, revoke_pairing, chat, send, edit, send_media, typing, and recent_messages where supported. Telegram and Discord do not use QR; 8-character codes are Hermes pairing approvals.",
            },
            "platform": {
                "type": "string",
                "enum": GATEWAY_PLATFORMS,
                "description": "Gateway platform. Omit only for global gateway status/start/stop.",
            },
            "timeoutMs": {
                "type": "integer",
                "description": "Optional timeout in milliseconds; WhatsApp QR pairing may wait up to 90000 by default.",
            },
            "token": {"type": "string", "description": "Token credential to save for configure/configure_secret. For Telegram/Discord this maps to botToken unless secretField is provided."},
            "botToken": {"type": "string", "description": "Bot token credential for Telegram or Discord."},
            "secretField": {"type": "string", "description": "Optional secret field name, such as botToken."},
            "secretValue": {"type": "string", "description": "Optional secret value for secretField."},
            "secrets": {"type": "object", "description": "Optional map of secret field names to values."},
            "chatId": {"type": "string", "description": "Platform chat/channel/group ID for chat, send, edit, send_media, or typing. Telegram topics may use chatId:threadId."},
            "target": {"type": "string", "description": "Optional Hermes-style target, such as telegram, telegram:chat_id, telegram:chat_id:thread_id, discord:#channel, or DiscordGuild/channel."},
            "threadId": {"type": "string", "description": "Optional Telegram topic ID or Discord thread/channel ID."},
            "guildId": {"type": "string", "description": "Optional Discord server/guild ID for channels."},
            "message": {"type": "string", "description": "Text body for send/edit."},
            "messageId": {"type": "string", "description": "Message ID for edit."},
            "filePath": {"type": "string", "description": "Local file path for send_media."},
            "mediaType": {"type": "string", "description": "Optional media type: image, video, audio, or document."},
            "caption": {"type": "string", "description": "Optional media caption."},
            "fileName": {"type": "string", "description": "Optional document filename."},
            "replyTo": {"type": "string", "description": "Optional message ID to reply to when supported."},
            "code": {"type": "string", "description": "Hermes 8-character pairing approval code for approve_pairing."},
            "pairingCode": {"type": "string", "description": "Alias for code."},
            "approvalCode": {"type": "string", "description": "Alias for code."},
            "userId": {"type": "string", "description": "Platform user ID for revoke_pairing."},
            "limit": {"type": "integer", "description": "Limit for recent_messages."},
        },
        ["command"],
    ),
    handler=lambda args, **kw: _run_dream_action(_gateway_action(args)),
    description="Start, stop, restart, inspect, or list groups through the real Dream Server Hermes Gateway process.",
)

registry.register(
    name="dream_open_url",
    toolset="dream-desktop",
    schema=_schema(
        "dream_open_url",
        "Navigate HTTP/HTTPS URLs inside the live Dream Server Workbench browser. Only non-web app schemes fall back to the OS.",
        {"url": {"type": "string", "description": "HTTP/HTTPS Workbench URL, or a non-web app URL such as spotify://."}},
        ["url"],
    ),
    handler=lambda args, **kw: _run_dream_action(_open_url_action(args.get("url"))),
    description="Navigate URLs through the Dream Server Workbench browser instead of opening the user's desktop browser.",
)

registry.register(
    name="dream_browser_control",
    toolset="dream-desktop",
    schema=_schema(
        "dream_browser_control",
        "Control the live browser page inside Dream Server Workbench. Use url only for first navigation or a different page; omit url for click, type, scroll, snapshot and chess actions on the active preview.",
        {
            "url": {"type": "string", "description": "Optional HTTP/HTTPS URL. Omit this after navigation so actions operate on the active Workbench page without reload."},
            "steps": {
                "type": "array",
                "description": "Browser steps to run on the active Workbench page. Do not include a URL unless you intentionally need to navigate first.",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": [
                                "wait_for_selector",
                                "wait_for_text",
                                "click",
                                "fill",
                                "type_text",
                                "press",
                                "press_key",
                                "scroll",
                                "screenshot",
                                "snapshot",
                                "chess_state",
                                "board_state",
                                "chess_wait_turn",
                                "wait_chess_turn",
                                "chess_move",
                                "click_square",
                                "js",
                            ],
                        },
                        "ref": {"type": "string"},
                        "selector": {"type": "string"},
                        "label": {"type": "string"},
                        "accessibleName": {"type": "string"},
                        "name": {"type": "string"},
                        "ariaLabel": {"type": "string"},
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "fromSquare": {"type": "string"},
                        "toSquare": {"type": "string"},
                        "from_square": {"type": "string"},
                        "to_square": {"type": "string"},
                        "square": {"type": "string"},
                        "promotion": {"type": "string"},
                        "text": {"type": "string"},
                        "key": {"type": "string"},
                        "direction": {"type": "string"},
                        "pixels": {"type": "integer"},
                        "deltaX": {"type": "number"},
                        "deltaY": {"type": "number"},
                        "expression": {"type": "string"},
                        "timeoutMs": {"type": "integer"},
                    },
                    "additionalProperties": False,
                },
            },
            "screenshot": {"type": "boolean", "description": "Capture a screenshot artifact only when the user explicitly asks for one. Defaults to false; normal interaction uses DOM/text snapshots."},
            "headless": {"type": "boolean", "description": "Run browser headless. Defaults to true."},
            "timeoutMs": {"type": "integer", "description": "Navigation/step timeout in milliseconds."},
        },
        [],
    ),
    handler=lambda args, **kw: _run_dream_action(_browser_control_action(args)),
    description="Use the Dream Server Workbench-controlled browser for navigation and live page interaction without opening the user's OS browser.",
)

registry.register(
    name="dream_open_path",
    toolset="dream-desktop",
    schema=_schema(
        "dream_open_path",
        "Open a local file or folder in Windows Explorer.",
        {"path": {"type": "string", "description": "Absolute path, known folder name, or project path."}},
        ["path"],
    ),
    handler=lambda args, **kw: _run_dream_action({"type": "open_path", "path": args.get("path")}),
    description="Open local files and folders through the Dream Server desktop bridge.",
)

registry.register(
    name="dream_reveal_path",
    toolset="dream-desktop",
    schema=_schema(
        "dream_reveal_path",
        "Reveal a local file or folder in Windows Explorer.",
        {"path": {"type": "string", "description": "Absolute path to reveal."}},
        ["path"],
    ),
    handler=lambda args, **kw: _run_dream_action({"type": "reveal_path", "path": args.get("path")}),
    description="Reveal files through the Dream Server desktop bridge.",
)

registry.register(
    name="dream_set_volume",
    toolset="dream-desktop",
    schema=_schema(
        "dream_set_volume",
        "Set, adjust, mute, or unmute the Windows master output volume.",
        {
            "level": {"type": "integer", "description": "Absolute target volume from 0 to 100."},
            "delta": {"type": "integer", "description": "Relative volume change from -100 to 100."},
            "muted": {"type": "boolean", "description": "Mute or unmute the main output device."},
        },
    ),
    handler=lambda args, **kw: _run_dream_action({
        "type": "set_volume",
        "level": args.get("level"),
        "delta": args.get("delta"),
        "muted": args.get("muted"),
    }),
    description="Control Windows system volume through the Dream Server desktop bridge.",
)

registry.register(
    name="dream_media_control",
    toolset="dream-desktop",
    schema=_schema(
        "dream_media_control",
        "Send a global Windows media command to the active player, such as Spotify.",
        {
            "action": {
                "type": "string",
                "enum": ["play", "pause", "play_pause", "next", "previous", "stop"],
                "description": "Media command.",
            }
        },
        ["action"],
    ),
    handler=lambda args, **kw: _run_dream_action({"type": "media_control", "action": args.get("action")}),
    description="Control active media playback through the Dream Server desktop bridge.",
)

registry.register(
    name="dream_set_preview_device",
    toolset="dream-desktop",
    schema=_schema(
        "dream_set_preview_device",
        "Switch the Dream Server Workbench preview between desktop and mobile iPhone/Safari mode.",
        {
            "mode": {
                "type": "string",
                "enum": ["desktop", "mobile"],
                "description": "Preview surface to use in the Workbench.",
            }
        },
        ["mode"],
    ),
    handler=lambda args, **kw: _run_dream_action({
        "type": "set_preview_device",
        "mode": args.get("mode"),
        "source": "hermes",
    }),
    description="Switch the Dream Server Workbench preview device.",
)
