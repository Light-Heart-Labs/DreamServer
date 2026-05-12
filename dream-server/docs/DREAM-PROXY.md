# Dream Server reverse proxy (`dream-proxy`)

The single LAN-facing entry that makes `http://<device>.local` (no port) actually work.

Without this extension, Dream Server's services bind to `127.0.0.1` by default — they're reachable from the host but not from another device on the LAN. A phone scanning a "browse to `http://dream.local`" QR code hits port 80 on the device, finds nothing, gives up. The dashboard's promise of `<device>.local` as a one-tap entry was broken before this extension.

With it, port 80 becomes the single entry point. Caddy routes paths to the right backend:

```
/                       → Dream dashboard (port 3001)
/chat,  /chat/*         → Open WebUI       (port 3000)
/api/*, /auth/*         → Dream dashboard-api (port 3002)
/health                 → Caddy itself ("ok")
```

Other Dream services keep their loopback bindings. The proxy is the only thing that opens up to the LAN.

## When to enable it

- **Yes** if you want to reach Dream Server from a phone / laptop on the same network at `http://<device>.local`.
- **Yes** if you're using Tailscale (PR-12) — the proxy becomes the single endpoint exposed on the tailnet too.
- **No** if Dream Server is single-user / localhost-only — you save a small process and a port binding.

```bash
dream enable dream-proxy
# Test:
curl http://localhost/health        # → ok
curl http://<host-ip>/             # → dashboard SPA HTML
curl http://<host-ip>/chat         # → Open WebUI
```

## Security posture

**The proxy is the trusted gate.** Behind it, each service's own auth applies:

- Dashboard-api: API key (`DASHBOARD_API_KEY`)
- Open WebUI: its own auth (`WEBUI_AUTH=true` by default — users sign up / sign in)
- Dashboard SPA: the React app shows admin features only when the API call succeeds

The proxy itself adds NO auth layer. Adding one here would duplicate without strengthening — the user would have one set of credentials for the proxy and a separate set for the chat surface. We deliberately keep the auth in the backends.

**Trust model:**

- Trusted LAN: a home network where everyone on the network is in the household. Exposing the proxy on the LAN is fine.
- Tailscale: also fine — Tailscale's identity-based access is its own auth layer.
- Public internet: ❌ **NEVER**. Don't publish port 80 to the public internet without an additional auth/TLS layer in front. The dashboard API key being the only auth on a public surface is too thin.

## TLS

HTTP only in v1. Adding HTTPS needs one of:

1. **Tailscale-issued certs** — `tailscale cert <hostname>.<tailnet>.ts.net` produces a real Let's-Encrypt cert; Caddy can serve it directly. Documented as a follow-up.
2. **Self-signed cert + device trust** — operator generates a cert, distributes the CA to family devices.
3. **Caddy's auto-https for public domains** — only works if you have a real DNS name. Not the dream.local case.

For now, plain HTTP on the trusted LAN. The cookie-issuing flows that set `Secure=` honor the request scheme — they'll set the Secure flag once TLS is in front.

## How to bypass the proxy

`dream disable dream-proxy` stops the container. Each backend service goes back to being only reachable on its individual port (`<host-ip>:3000`, `<host-ip>:3001`, etc.) — and only if `BIND_ADDRESS=0.0.0.0` is set globally. Otherwise they stay loopback.

If you want LAN access to a single specific service without the proxy, add a `ports:` binding to that service's compose file (or set `BIND_ADDRESS=0.0.0.0` globally — but that exposes ALL services, the security tradeoff this whole extension was designed to avoid).

## Bump history

| Date | Pinned Caddy | Notes |
|---|---|---|
| 2026-05-12 | `caddy:2.8.4-alpine` | Initial integration. HTTP only; TLS deferred. |
