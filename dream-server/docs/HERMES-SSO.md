# Hermes SSO — magic-link gating in front of the Hermes Agent

Dream Server's `hermes-proxy` extension is a Caddy reverse proxy that fronts the [Hermes Agent container](HERMES.md) and gates access on Dream Server's magic-link auth.

When this extension is enabled:

- Hermes itself binds **internal-only** (no host port).
- The proxy binds the LAN-facing port (default `9120`) — that's what users browse to.
- Every request to the proxy is inspected for the `dream-session` cookie that magic-link redemption (PR-4) sets in the user's browser.
- No cookie → 303 redirect to a static "you need an invite" page.
- Cookie present → traffic is forwarded to `dream-hermes:9119`. Hermes's own [per-process session token model](HERMES.md#security-posture) then handles per-request `/api/` auth.

## Why this design

After reading [upstream's web_server.py at our pinned SHA](https://github.com/NousResearch/hermes-agent/blob/dd0923bb89ed2dd56f82cb63656a1323f6f42e6f/hermes_cli/web_server.py), Hermes's auth is **per-PROCESS, not per-user**. The session token is `secrets.token_urlsafe(32)` generated at server start and baked into the SPA HTML — no env-var to pre-seed, no login flow, no user concept.

Hermes **does** support per-user isolation via [profiles](https://github.com/NousResearch/hermes-agent/blob/dd0923bb89ed2dd56f82cb63656a1323f6f42e6f/hermes_cli/profiles.py) (separate `HERMES_HOME/profiles/<name>/`), but a profile is bound at process launch — one Hermes process = one profile. There's no in-process profile switching.

This extension does NOT try to give you real multi-user. It gives you:

| Property | Achieved? |
|---|---|
| Magic-link-authed gateway | ✅ |
| Anyone with a valid invite can reach Hermes | ✅ |
| Anyone without a valid invite gets bounced | ✅ |
| Mom's memories / skills / sessions isolated from Dad's | ❌ — shared |
| The proxy knows WHO is logged in | ❌ — only that *someone* has a valid invite |

If you need per-user isolation, the path is to run **one Hermes container per user** (each with its own profile), and have the proxy route based on the redeemed user's identity. That's [Option B](#future-option-b--per-user-hermes) below — out of scope for v1.

## Setup

```bash
# 1. Enable Hermes (the agent itself)
dream enable hermes

# 2. Enable the auth proxy (this extension)
dream enable hermes-proxy

# 3. Generate an invite from the dashboard
#    → Browse to http://<device>:3001/invites
#    → "New invite" → scope: chat or all → Generate
#    → Save the QR / URL

# 4. Recipient scans the QR on their phone
#    → Lands on dashboard-api's /auth/magic-link/<token>
#    → Redemption sets the dream-session cookie
#    → 302 redirect to chat (or wherever the scope says)
#    → They now have a valid cookie for any Hermes proxy access too

# 5. Recipient browses to http://hermes.<device>.local:9120
#    → Proxy sees the dream-session cookie → forward
#    → Hermes serves the SPA → they chat
```

If the recipient hasn't yet redeemed an invite, step 5 lands them on the "you need an invite" page with instructions.

## Architecture

```
Phone / laptop
   │
   ▼  http://hermes.<device>.local:9120
┌──────────────────────────────────────────┐
│  dream-hermes-proxy  (Caddy, ~50MB)      │
│                                          │
│  Caddyfile match rules:                  │
│    /health, /favicon.ico → respond       │
│    /auth/required*       → static files  │
│    cookie has dream-session → reverse_   │
│                                 proxy    │
│    everything else        → 303 redirect │
│                                          │
│  Listens on :9120, forwards to           │
│  dream-hermes:9119                       │
└──────────┬───────────────────────────────┘
           │
           ▼  internal Docker bridge network only
┌──────────────────────────────────────────┐
│  dream-hermes  (NousResearch image)      │
│  - exposes :9119 internally              │
│  - DOES NOT bind a host port             │
│  - serves its React SPA + /api/*         │
│  - its own X-Hermes-Session-Token gates  │
│    /api/* requests per-request           │
└──────────────────────────────────────────┘
           │
           ▼  OpenAI-compatible API
       llama-server (existing)
```

## What "cookie present" actually means

The `dream-session` cookie is set by the dashboard-api's magic-link redemption (`routers/magic_link.py`). The cookie:

- Is `HttpOnly` (JS can't read it)
- Has `SameSite=Lax` (sent on top-level navigation cross-origin GETs, blocked on background cross-site POSTs)
- Is `Secure` when the dashboard-api was reached over HTTPS
- Has `Max-Age = 12h` from redemption
- Contains a random `secrets.token_urlsafe(24)` value (NOT the magic-link token itself)

The proxy checks **presence and non-emptiness**. It does NOT:

- Cross-check the cookie value against any server-side store (PR-4 doesn't keep one — see [Limitations](#known-limitations))
- Validate the user identity carried by the cookie (there is none)
- Verify the cookie's signature (it's not signed today)

In effect: anyone who can read another user's `dream-session` cookie value can pass the proxy gate. The cookie's `HttpOnly` and same-origin properties make casual sharing hard but not impossible (a malicious browser extension on the redeemed user's device could exfiltrate it; a screenshot of devtools could leak it).

For the Dream Server trust model (single home, trusted LAN, family-scale users), this is the v1 trade-off. The proxy explicitly says "**gating**, not identification."

## Known limitations

1. **No real multi-user.** All authed users share one Hermes — same memories, skills, persona, sessions. Mom can see Dad's chats and vice-versa. Treat Hermes as "the family's agent."

2. **No server-side cookie validation.** Today's PR-4 redemption sets the cookie but doesn't store the issued session in a server-side store. Anyone with the raw cookie value can use it. A future PR could add a sessions table that the proxy validates against, but that's not this extension.

3. **No per-request user identification.** The proxy doesn't add an `X-Dream-User` header to forwarded requests. Hermes can't know "this request is from Alice" — only "this request is from someone with a valid invite."

4. **The cookie's `dream-target-user` field is ignored by the proxy.** Magic-link redemption sets a second cookie naming the target username, but the proxy doesn't surface it to Hermes (there's no Hermes-side hook to consume it).

5. **Direct access to Hermes is now blocked.** Anyone who was reaching Hermes at `:9119` before this extension lands needs to switch to `:9120` (the proxy port). If they want raw direct access for testing, they can `docker exec dream-hermes` or temporarily re-add a `ports:` binding to the Hermes compose.

6. **Caddy's auth check is `header_regexp` on the `Cookie` header.** That's text-based — it doesn't parse cookie semantics. The match anchor `(?:^|;\s*)dream-session=[^;]+` covers the common cases but a deliberately-malformed `Cookie` header could in theory slip past. In practice browsers never send malformed Cookie headers, and an attacker who can set arbitrary HTTP headers already has bigger leverage.

## Future: Option B — per-user Hermes

If/when real multi-user becomes a felt need, the path is:

1. dashboard-api dynamically spawns a Hermes container per magic-link `target_username` (each with `HERMES_HOME=/opt/data/profiles/<username>`)
2. The Hermes auth proxy gains a routing layer — reads the `dream-target-user` cookie set during redemption, maps it to the per-user container's address, forwards there.
3. Lifecycle management: idle-timeout to stop unused containers; cold-start when a user returns.

Roughly 2-3 PRs of work and meaningful resource cost (each Hermes container is ~3GB image + ~1GB idle RAM with chromium / playwright loaded). Not worth it until a family member specifically asks for "my own Hermes."

## Disabling the proxy

```bash
dream disable hermes-proxy

# To restore direct Hermes access, re-add a ports binding to
# extensions/services/hermes/compose.yaml:
#   ports:
#     - "${BIND_ADDRESS:-127.0.0.1}:${HERMES_PORT:-9119}:9119"
# (then `dream restart hermes`)
```

## Bump history

| Date | Pinned Caddy | Notes |
|---|---|---|
| 2026-05-12 | `caddy:2.8.4-alpine` | Initial integration. |
