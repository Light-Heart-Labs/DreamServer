# OpenClaw Agent Infrastructure — Golden Build

**Servers:** 192.168.0.122 (lightheartworker), 192.168.0.143 (Tower2)  
**Date:** 2026-02-09  
**Built by:** Claude Code (remote session via Michael's desktop)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Anthropic API                         │
│              (Claude Opus 4.5 / Sonnet)                  │
└──────────────────────┬──────────────────────────────────┘
                       │ Primary agent model
        ┌──────────────┴──────────────┐
        │                             │
┌───────▼────────┐          ┌─────────▼──────────┐
│  .122 Gateway  │          │   .143 Gateway     │
│  (Android-17)  │◄──SSH───►│   (Todd)           │
│  openclaw-gw   │          │   todd-gateway     │
└───────┬────────┘          └─────────┬──────────┘
        │ subagents                   │ subagents
        ▼                             ▼
┌────────────────┐          ┌────────────────────┐
│  Proxy :8003   │          │   Proxy :8003      │
│  (tool fix)    │          │   (tool fix)       │
└───────┬────────┘          └─────────┬──────────┘
        │                             │
        ▼                             ▼
┌────────────────┐          ┌────────────────────┐
│  vLLM :8000    │          │   vLLM :8000       │
│  Qwen2.5-32B   │          │   Qwen2.5-32B      │
│  Coder AWQ     │          │   (Sage)           │
└────────────────┘          └────────────────────┘
```

---

## 1. Docker Compose — Gateway Containers

Both gateways run from docker-compose.yml with these critical environment variables:

- **.122** — `/home/michael/openclaw-portal/docker-compose.yml`
- **.143** — `/home/michael/todd-gateway/docker-compose.yml`

### Required environment block:

```yaml
environment:
  - HOME=/home/node
  - TERM=xterm-256color
  - OPENCLAW_GATEWAY_TOKEN=openclaw2026
  - NODE_ENV=production
  - ANTHROPIC_API_KEY=<your-key>
  - PATH=/home/node/.openclaw/node_modules/.bin:/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
```

The PATH line adds the persistent Claude Code install directory. The ANTHROPIC_API_KEY is required for Claude Code inside the container.

### Required volume mount:

```yaml
volumes:
  - /home/michael/.openclaw:/home/node/.openclaw
```

This bind mount is what makes Claude Code and session files persist across container restarts.

---

## 2. Claude Code — Persistent Install

Claude Code is installed into the bind-mounted volume, not the container image:

```bash
# From host (one-time setup, persists across restarts)
docker exec -u root <container> npm install -g @anthropic-ai/claude-code --cache /tmp/npm-cache

# Also install into persistent path for PATH resolution
docker exec <container> npm install --prefix /home/node/.openclaw @anthropic-ai/claude-code
```

**Why the PATH trick:** The container's `/usr/local/lib/node_modules` gets wiped on recreate. Installing into `/home/node/.openclaw/node_modules` (bind-mounted) survives. The custom PATH in docker-compose makes it findable.

**Verify:** `docker exec <container> claude --version` should return `2.1.37 (Claude Code)`

---

## 3. OpenClaw Config — openclaw.json

Located at `/home/michael/.openclaw/openclaw.json` on each server.

### Critical settings:

```json
{
  "commands": {
    "native": "auto",
    "nativeSkills": "auto",
    "restart": true
  }
}
```

`"restart": true` — Allows agents to restart the gateway from inside the sandbox via `openclaw gateway restart`. Without this, every config change requires human intervention.

### Model providers — all must route through the proxy on port 8003:

```json
{
  "models": {
    "providers": {
      "local-vllm": {
        "baseUrl": "http://192.168.0.122:8003/v1",
        "apiKey": "none",
        "api": "openai-completions"
      },
      "local-coder": {
        "baseUrl": "http://192.168.0.122:8003/v1",
        "apiKey": "none",
        "api": "openai-completions"
      },
      "local-sage": {
        "baseUrl": "http://192.168.0.143:8003/v1",
        "apiKey": "none",
        "api": "openai-completions"
      }
    }
  }
}
```

**⚠️ Never point directly at vLLM port 8000 or 9107** — tool calls will come back as raw JSON text instead of structured tool_calls.

---

## 4. vLLM Tool Proxy v2

**Location:** `/home/michael/vllm-tool-proxy.py` on both servers  
**Port:** 8003 on each server  
**Upstream:** `http://localhost:8000` (vLLM)

### What it does:

- Qwen2.5-Coder outputs tool calls as `<tools>{"name": "write", ...}</tools>` in the content field
- vLLM's hermes parser doesn't match this format
- The proxy intercepts responses, extracts tool JSON from `<tools>` tags, and converts them to proper OpenAI-format `tool_calls`
- Works for both streaming (SSE) and non-streaming responses
- **Does NOT force `tool_choice=required`** (the v1 proxy did this and it caused `terminated` / 0 token errors)

### Start command:

```bash
nohup python3 /home/michael/vllm-tool-proxy.py \
  --port 8003 \
  --vllm-url http://localhost:8000 \
  > /home/michael/vllm-proxy.log 2>&1 &
```

**Health check:** `curl http://localhost:8003/health`

**TODO:** This should also be a systemd service for persistence across reboots. Currently started manually via nohup.

---

## 5. vLLM — GPU Model Server

**Container:** vllm-coder  
**Version:** 0.14.0  
**Port:** 8000 (Docker-mapped), 9107 (secondary/direct — do not use for OpenClaw)

### Launch args:

```bash
vllm serve \
  --model Qwen/Qwen2.5-Coder-32B-Instruct-AWQ \
  --port 8000 \
  --gpu-memory-utilization 0.90 \
  --max-model-len 32768 \
  --enable-chunked-prefill \
  --max-num-batched-tokens 8192 \
  --enable-auto-tool-choice \
  --tool-call-parser hermes
```

**Note:** `--enable-auto-tool-choice --tool-call-parser hermes` is set but doesn't work for Qwen2.5-Coder (hermes parser expects `<tool_call>` tags, Qwen outputs `<tools>` tags). The proxy on 8003 handles the translation. These flags don't hurt but don't help either.

---

## 6. Session Cleanup Service

**Problem it solves:** Session `.jsonl` files grow until agents hit 32K context limit and crash with "prompt too large" errors. Agents can't trigger `/new` themselves.

**Script:** `/home/michael/.openclaw/session-cleanup.sh` on both servers

### What it does every 60 minutes:

1. Deletes `.deleted.*` and `.bak*` debris files
2. Removes `.jsonl` files for sessions not referenced in `sessions.json`
3. Deletes any active session file over 250KB and removes its reference from `sessions.json`, forcing the gateway to create a fresh session

### Systemd units (auto-start on boot):

- `/etc/systemd/system/openclaw-session-cleanup.service` (Type=oneshot)
- `/etc/systemd/system/openclaw-session-cleanup.timer` (60min interval)

### Key timer settings:

```ini
OnBootSec=5min      # first run 5 minutes after boot
OnUnitActiveSec=60min  # then every hour
Persistent=true     # catches up missed runs after downtime
```

### Useful commands:

```bash
systemctl status openclaw-session-cleanup.timer    # Check next run
journalctl -u openclaw-session-cleanup.service     # View logs
sudo systemctl start openclaw-session-cleanup.service  # Force run now
```

---

## 7. SSH Cross-Server Access

Todd's container (.143) can SSH to .122 as michael:

```bash
ssh michael@192.168.0.122
```

### How it works:

- Todd's container has an ed25519 keypair at `/home/node/.ssh/id_ed25519`
- The public key (`todd@openclaw`) is in .122's `/home/michael/.ssh/authorized_keys`
- No Docker config changes needed — SSH works from inside the container via host networking

17 (.122) runs directly on the host, so no SSH key setup was needed.

---

## 8. API Key Configuration

The Anthropic API key is set in three places per server:

| Location | Purpose |
|----------|---------|
| docker-compose.yml (ANTHROPIC_API_KEY env) | Inside container for Claude Code |
| /home/michael/.bashrc | Interactive SSH sessions on host |
| /etc/environment | Cron, systemd, non-interactive shells |

---

## 9. Known Limitations

- **No sudo in containers** — by design (`cap_drop: ALL`). Use `docker exec -u root` from host for admin tasks
- **No pip3, rsync, nano in containers** — minimal image. Install with `docker exec -u root <container> apt-get update && apt-get install -y <package>` if needed (won't persist across recreates)
- **Proxy is not yet a systemd service** — the `vllm-tool-proxy.py` runs via nohup. If the server reboots, it needs manual restart (or add a systemd unit)
- **Port 9107 exists but should not be used** — it goes directly to vLLM without the tool extraction proxy. All OpenClaw model providers must use port 8003

---

## 10. Troubleshooting Checklist

| Symptom | Cause | Fix |
|---------|-------|-----|
| `terminated`, 0 tokens | Hitting vLLM directly (port 8000/9107) without proxy | Point provider to port 8003 |
| Tool calls as JSON text in content | Same — proxy not in path | Point provider to port 8003 |
| `InvalidChunkLength` | Using `openai-responses` API mode | Use `openai-completions` |
| `prompt too large` | Session file bloated | Run `sudo systemctl start openclaw-session-cleanup.service` |
| Claude Code not found | Container recreated | Reinstall: `npm install --prefix /home/node/.openclaw @anthropic-ai/claude-code` |
| Config changes not applying | Gateway needs restart | `openclaw gateway restart` (from agent) or `docker restart <container>` |
| SSH permission denied (.143→.122) | Key not in authorized_keys | Add Todd's pubkey to `.122:/home/michael/.ssh/authorized_keys` |

---

*This document represents the working state as of 2026-02-09. Do not modify infrastructure without updating this file.*
