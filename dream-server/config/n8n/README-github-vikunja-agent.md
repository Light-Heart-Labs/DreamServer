# GitHub ↔ Vikunja ↔ Coding-Agent Workflows

Four importable n8n workflows that wire **GitHub Issues**, **Vikunja Tasks**, and
**Open Claw** together.

| File | Direction | Trigger |
|---|---|---|
| `github-issue-to-vikunja-task.json` | GitHub → Vikunja | GitHub `issues.opened` / `reopened` webhook |
| `github-issue-closed-to-vikunja-done.json` | GitHub → Vikunja | GitHub `issues.closed` webhook |
| `vikunja-done-to-github-close.json` | Vikunja → GitHub | Vikunja `task.updated` webhook (filtered: `done == true`) |
| `vikunja-task-to-coding-agent.json` | Vikunja → Open Claw → Vikunja | Vikunja `task.created` / `task.updated` (filtered: label `agent`) |

## One-time setup

### 1. Add tokens to `.env`

```bash
ssh sky-net@192.168.178.110
cd ~/dream-server

# Vikunja API token (already set up earlier)
# VIKUNJA_API_TOKEN=tk_…           ← already there

# GitHub fine-grained PAT (Issues: Read+Write on the relevant repos)
echo "GITHUB_TOKEN=ghp_…" >> .env

# Optional: which Vikunja project should new GitHub issues land in by default?
echo "VIKUNJA_DEFAULT_PROJECT_ID=1" >> .env
```

### 2. Restart n8n + Open Claw so they pick up the new env

```bash
docker restart dream-n8n dream-openclaw
```

Open Claw now exposes its OpenAI-compat shim on container port `18790`
(`OPENCLAW_HTTP_API=true` is the new default).

### 3. Import workflows

Open n8n at <http://192.168.178.110:5678>, then for each file:

* **Workflows → Import from File** → pick the `.json` from `~/dream-server/config/n8n/`
* Click **Active** in the top-right to enable the webhook

### 4. Wire GitHub

For every repo you want to sync:

* Repo → **Settings → Webhooks → Add webhook**
* Payload URL: `http://<your-public-host>:5678/webhook/github-vikunja-issue`
  *(if your Strix isn't internet-reachable, expose it via tailscale/cloudflared/nginx-proxy-manager — GitHub needs to reach n8n)*
* Content type: `application/json`
* Events: **Issues** only
* Add a **second** webhook with the same URL but path `/webhook/github-vikunja-close` for the close-flow
  *(or send both events to one URL and let n8n filter — both flows ignore non-matching `action`)*

### 5. Wire Vikunja

In each Vikunja project that should round-trip:

* **Settings → Webhooks → Add**
* URL for **close-back-to-github**: `http://n8n:5678/webhook/vikunja-task-done`
* URL for **dispatch-to-agent**: `http://n8n:5678/webhook/vikunja-to-agent`
* Events: **Task created** + **Task updated**

## Using the agent dispatch

1. In Vikunja, create a label called **`agent`** (Project → Labels → New).
2. Create a new task: clear title + detailed description (the description IS the prompt).
3. Attach the `agent` label.
4. Within ~10–60 s the agent reply appears as a comment on the task.

Example task:

> **Title:** Add CORS headers to the Vikunja proxy router
>
> **Description:** In `dashboard-api/routers/projects.py`, the proxy currently
> drops the `Origin` header. Allow `*` for now and ensure preflight `OPTIONS`
> returns 204. Show me the exact diff.

## Customising

Each workflow has a **Documentation sticky note** with all the env vars and
override hooks. Common tweaks:

| Variable | Default | Purpose |
|---|---|---|
| `VIKUNJA_DEFAULT_PROJECT_ID` | `1` | Project where unmapped GitHub issues land |
| `AGENT_TRIGGER_LABEL` | `agent` | Vikunja label name that triggers dispatch |
| `AGENT_MODEL` | `openclaw` | Model name passed to `/v1/chat/completions` |
| `AGENT_BASE_URL` | `http://openclaw:18790` | OpenAI-compat endpoint |
| `AGENT_SYSTEM_PROMPT` | (built-in coding-assistant prompt) | Override system prompt |

## Troubleshooting

* `401 Unauthorized` from Vikunja → check `VIKUNJA_API_TOKEN` is in `.env` *and* the n8n container was restarted afterwards.
* `connect ECONNREFUSED openclaw:18790` → `OPENCLAW_HTTP_API` not enabled or Open Claw not running. `docker logs dream-openclaw | grep -i http`.
* GitHub webhook not firing → in the repo Webhook page, click **Recent Deliveries** → look at the response payload.
* Vikunja webhook not firing → Vikunja stores them under Project → Settings → Webhooks; redeliver via the UI.

