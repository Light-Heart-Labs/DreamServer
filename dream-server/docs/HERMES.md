# Hermes Agent

Dream Server ships an optional **Hermes Agent** extension — the [Nous Research open-source agent](https://github.com/nousresearch/hermes-agent) packaged as a Dream Server service. Hermes is a self-improving generalist agent with persistent memory, autonomous skill creation, and 70+ tools built in.

When enabled, Hermes runs in a container alongside the rest of the stack, exposes its own browser dashboard at port 9119, and talks to the local LLM (llama-server) via its OpenAI-compatible API.

## What you get

Hermes ships its own complete web UI — Dream Server is just packaging it. After `dream enable hermes`, you can browse to `http://<device>:9119` (or `hermes.<device>.local:9119` once mDNS announcement lands — see "Roadmap" below) and find pages for:

- **Chat** — conversational interface with streaming responses + inline tool calls
- **Sessions** — list, switch between, prune past conversations
- **Skills** — view skills Hermes has autonomously created from your interactions; edit or delete
- **Memories** — persistent facts Hermes has learned about you
- **Profiles** — per-user agent contexts (a built-in alternative to running multiple Hermes containers)
- **Cron** — schedule recurring agent tasks
- **Models** — pick which LLM Hermes uses (defaults to your llama-server)
- **Config / Env** — Hermes's own settings
- **Logs / Analytics** — operational visibility

## Architecture

```
  Browser
     │  http://<device>:9119
     ▼
  ┌─────────────────────────────────────┐
  │  dream-hermes container             │
  │                                     │
  │   hermes gateway run                │
  │     - HERMES_DASHBOARD=1 →          │
  │         React SPA + /api endpoints  │
  │     - scheduler tick() every 60s →  │
  │         fires cron jobs             │
  │     - no messaging adapters         │
  │                                     │
  │   State: /opt/data (HERMES_HOME)    │
  │     mounted from data/hermes/       │
  │                                     │
  │   Tool sandbox: local (in-container)│
  └─────────────────────────────────────┘
                  │
                  │  OpenAI-compatible API
                  ▼
  ┌─────────────────────────────────────┐
  │  llama-server (existing)            │
  │     llama.cpp at :8080/v1           │
  └─────────────────────────────────────┘
```

State layout under `data/hermes/`:

```
data/hermes/
├── config.yaml      # Bootstrapped from our cli-config.yaml.template on first start
├── .env             # Bootstrapped from upstream's .env.example
├── SOUL.md          # Bootstrapped from our SOUL.md.template
├── sessions/        # Per-session chat history
├── memories/        # Persistent agent memories
├── skills/          # Agent-authored skills
├── cron/            # Scheduled tasks
├── plans/           # Active multi-step plans
├── workspace/       # Sandboxed workspace for file ops
├── hooks/           # Custom lifecycle hooks
├── home/            # Per-profile $HOME for subprocesses (git, ssh, npm…)
└── logs/            # Hermes's own logs (separate from Docker logs)
```

## Setup

```bash
# 1. (One-time) Verify Dream Server's llama-server is running:
dream status llama-server

# 2. Pull + start Hermes:
dream enable hermes

# 3. (Optional) Open the dashboard:
xdg-open http://localhost:9119
```

The first start takes a minute — image is ~3GB, Hermes runs its `skills_sync.py` bootstrap, and llama-server may cold-load the model on Hermes's first request. Subsequent starts are fast.

## Defaults Dream Server applies

- **Provider:** `custom` (OpenAI-compatible) pointing at `llama-server:8080/v1`
- **Model name:** `qwen3.5-9b` (Dream Server's default LLM — to switch models, edit `model.default` in `data/hermes/config.yaml` after first start; there is no env-var hook for this)
- **Persona (`SOUL.md`):** a generalist Dream-Server-aware persona (see `extensions/services/hermes/SOUL.md.template`)
- **Messaging gateways DISABLED:** Telegram / Discord / Slack / WhatsApp / Signal / Teams / Google Chat / Matrix / Mattermost / SMS — all off by default. Dream Server users reach Hermes via the web dashboard. To enable any platform, see [upstream messaging docs](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/).
- **Network exposure:** controlled by Dream Server's `BIND_ADDRESS` (default `127.0.0.1` = localhost only). Set `BIND_ADDRESS=0.0.0.0` to make Hermes reachable on the LAN at port 9119.
- **Resource caps:** 4 CPUs / 4GB RAM hard limit, 0.5 CPU / 1GB reservation. Hermes's playwright + ML deps can be hungry; adjust in `extensions/services/hermes/compose.yaml` if needed.

## Configuration

Three layers, highest to lowest precedence:

1. **Edit `data/hermes/config.yaml`** directly — Hermes's own config file, copied from our template on first start. Survives container restarts. Reset by deleting and restarting. **The model name lives here**, not in env.
2. **Set env vars in Dream Server's `.env`** — `HERMES_LLM_BASE_URL`, `HERMES_LLM_API_KEY`, `HERMES_PORT`, `HERMES_LANGUAGE`. These are the only Hermes settings the container actually reads from env. See `.env.example`.
3. **Fall back to Dream Server's defaults** — defined in `extensions/services/hermes/cli-config.yaml.template`.

To bring up Hermes pointing at a different LLM (e.g. OpenRouter, OpenAI, Anthropic), edit `data/hermes/config.yaml`'s `model.provider` and `model.base_url` and restart. The whole gamut of provider options is listed in the upstream config — Hermes supports OpenRouter / Anthropic / OpenAI / Hugging Face / NVIDIA NIM / z.ai / Kimi / Gemini / Ollama Cloud / LM Studio / etc. out of the box.

## Security posture

- **`--insecure` is enabled.** Hermes's dashboard refuses to bind to non-loopback addresses without it (the dashboard stores API keys, so binding 0.0.0.0 has a clear "you sure?" gate). Dream Server's trusted-LAN posture accepts this trade-off for v1. **Don't expose port 9119 to the public internet.** Use Tailscale (PR-12 from the onboarding plan) if you need remote access.
- **The container runs as a non-root user** (UID 10000 by default, remappable via `HERMES_UID`). The entrypoint drops privileges via `gosu` before any agent code runs.
- **The container has full network access** within Dream Server's bridge net — Hermes can make outbound HTTP requests for tools like `web_search`. If you want to restrict this, add an iptables firewall rule on the host or run Hermes behind a forward proxy.
- **APE policy enforcement is wired in.** Every Hermes tool call hits APE's `/verify` endpoint before execution (via Hermes's `pre_tool_call` plugin hook — see `extensions/services/hermes/plugins/ape-policy/`). Denied calls return as block messages to the agent, which surfaces them as tool errors in the conversation. Behavior when APE is unreachable is configurable via `APE_FAIL_OPEN` (default `true` for Dream's trusted-LAN posture). For tighter exposure (e.g. Hermes-over-Tailscale-to-public-internet), set `APE_FAIL_OPEN=false` so unreachable APE blocks instead of permitting.

## How to bump the SHA pin

Hermes is a young, fast-moving project (~3 months old as of v1 integration). The SHA pin in `compose.yaml` lets us audit upstream changes deliberately rather than auto-tracking `:latest`. Bumping is a 5-minute pass:

```bash
# 1. Pick the new SHA. Upstream publishes a sha-<full-sha> tag for every
#    main push, so any commit on NousResearch/hermes-agent's main is fair game.
gh api repos/NousResearch/hermes-agent/commits/main --jq '{sha,date:.commit.author.date,msg:.commit.message}'

# 2. Read the diff since our current pin. Skim breaking changes,
#    config-format migrations, removed env vars.
gh api repos/NousResearch/hermes-agent/compare/<old-sha>...<new-sha> --jq '.commits[].commit.message'

# 3. Update extensions/services/hermes/compose.yaml — the only place the
#    pin appears.

# 4. Smoke test:
#    dream restart hermes
#    curl http://localhost:9119/api/health  # should 200
#    open http://localhost:9119, send a chat, verify tool call

# 5. If it works, commit. If config.yaml format has changed, document the
#    migration in this file's "Bump history" section below.
```

## Roadmap (deferred from v1)

These were in the original integration plan but cut once we discovered Hermes ships a complete browser surface:

- **mDNS announcement** — register `hermes.<device>.local` in the Dream Server mDNS announcer (`bin/dream-mdns.py` lands in [#1152](https://github.com/Light-Heart-Labs/DreamServer/pull/1152)). One-line follow-up after that PR merges.
- **APE policy integration** — ✅ shipped via the `ape-policy` plugin under `extensions/services/hermes/plugins/`. Uses Hermes's native `pre_tool_call` hook to call APE's `/verify` endpoint before each tool execution. Configurable fail-open / fail-closed via `APE_FAIL_OPEN`.
- **Magic-link SSO** — hand off magic-link redemptions ([#1155](https://github.com/Light-Heart-Labs/DreamServer/pull/1155)) into a Hermes auth session so family members don't need separate Hermes credentials.
- **Voice in/out from Dream Server's whisper + kokoro** — Hermes has its own audio pipeline (the image bundles ffmpeg + playwright); verify whether it already proxies to local TTS/STT services or whether we need to wire that ourselves.
- **Dream-side status panel** — surface Hermes's session count + skill inventory in the Dream dashboard. Lower priority since Hermes has its own `AnalyticsPage`.

## Troubleshooting

### `curl localhost:9119/api/health` returns 502 / connection refused

Hermes hasn't finished bootstrapping. Watch the logs:

```bash
docker logs -f dream-hermes
```

First start does a ~30s skills sync; subsequent starts are fast.

### Hermes can't reach the LLM

Inside the container, `llama-server:8080` should resolve to the llama-server container. Test with:

```bash
docker exec dream-hermes curl -fs http://llama-server:8080/v1/models
```

If that fails, the most likely cause is that the Hermes container isn't on Dream Server's docker network. Check `docker network inspect dream-server_default`.

### Sessions / memories / skills disappeared after upgrade

The SHA pin protects you from accidental version drift, but if you DID bump and lose data, it's almost certainly because Hermes's config format changed. Check `data/hermes/config.yaml` against upstream's current `cli-config.yaml.example`. The container's first start regenerates `config.yaml` from our template only if it doesn't exist — your old config sticks around.

### "I don't want Hermes anymore"

```bash
dream disable hermes              # stops the container
rm -rf data/hermes                # wipes all sessions / memories / skills
```

The container image stays cached — `docker image prune` removes it.

## Upstream attribution

Hermes Agent is © 2026 Nous Research, MIT-licensed. Dream Server's contribution is the packaging layer (`extensions/services/hermes/`) — no code is forked from upstream. The pinned image is pulled directly from `docker.io/nousresearch/hermes-agent`.

When promoting / talking about this extension, the convention is: "Hermes Agent (from Nous Research) — packaged for Dream Server."

## Bump history

| Date | Pinned SHA | Notes |
|---|---|---|
| 2026-05-12 | `dd0923bb89ed2dd56f82cb63656a1323f6f42e6f` | Initial integration. |
