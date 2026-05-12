# Dream Server mDNS — `dream.local` from any device on your network

Dream Server announces itself on your local network so you can browse to it from any phone, tablet, or laptop without knowing the IP. The URL is `http://dream.local` (or `http://<your-name>.local` if you renamed the device during setup).

## Prerequisites

The mDNS announcement publishes the device's LAN IP under `<device>.local` (and per-service SRV records on the underlying ports). For `http://dream.local` to actually load chat from a phone, two more things have to be true:

1. **`BIND_ADDRESS=0.0.0.0`** in `.env` — without this, all Dream services bind to `127.0.0.1` and only loopback can reach them. The mDNS name still resolves, but the connection is refused.
2. **The `dream-proxy` extension is enabled** — that's the Caddy service that listens on port 80 and routes `/chat`, `/api/*`, `/auth/*`, etc. to the right backend. Without it, `http://dream.local` hits an empty port 80 and times out; users have to type the per-service port (`dream.local:3000`, `dream.local:3001`, etc.) directly.

Fresh installs without these two are loopback-only. The installer's first-boot wizard offers to enable both. See [`docs/DREAM-PROXY.md`](DREAM-PROXY.md) for how the proxy routes traffic.

## What gets announced

| mDNS name | Points to | What it serves |
|---|---|---|
| `<device>.local` | the device's LAN IP | base hostname — `http://<device>.local` hits the dream-proxy on :80 when enabled |
| `<device>-chat._http._tcp.local` | port 3000 | Open WebUI direct (bypasses proxy) |
| `<device>-dashboard._http._tcp.local` | port 3001 | Dashboard / settings (bypasses proxy) |
| `<device>-dashboard-api._http._tcp.local` | port 3002 | Dashboard API health endpoint (bypasses proxy) |
| `<device>-hermes._http._tcp.local` | port 9119 | Hermes Agent dashboard (when the `hermes` extension is enabled) |

The first row is what users normally type. The `_http._tcp` rows are SRV records primarily for MCP clients, service-discovery tools, and the eventual Dream Server mobile app — they expose the underlying ports so a client can talk directly to a service without going through the proxy (e.g. to scrape `/health`).

## Platform support

| Platform | Status | Notes |
|---|---|---|
| **Linux** | ✅ supported | Uses `python3-zeroconf` against the system's `avahi-daemon` (already installed on virtually all desktop Linux distros) |
| **macOS** | ✅ implicit | macOS announces `<hostname>.local` automatically via Bonjour / mDNSResponder. The Dream mDNS script is a no-op on macOS — if you want a name other than your Mac's, change the system hostname. |
| **Windows** | ⚠️ partial | mDNS support on Windows is fragmented (Bonjour Print Services, Microsoft's own mDNS responder, varying iOS/Android interop). Not yet covered by this script; follow-up planned. |

## Troubleshooting

### "Can't reach `dream.local`"

Some routers and corporate networks block mDNS / Bonjour multicast packets:

1. **Phone can't resolve it but laptop can** — your phone may be on a separate "guest" WiFi or a 5GHz radio that's segregated from the wired network. Try connecting both to the same SSID.
2. **Nothing on the network can resolve it** — your router has IGMP snooping enabled and isn't forwarding multicast. Either flip that setting off (usually in advanced/multimedia settings) or fall back to using the device's IP address (visible in the dashboard at any time).
3. **Resolves but slow** — some Android versions cache failed mDNS lookups aggressively. Toggle WiFi off and back on, or wait a few minutes.

### Renaming the device

Edit `.env` and change `DREAM_DEVICE_NAME` to whatever you want (letters, digits, hyphens; max 32 chars). The mDNS service polls `.env` every 30 seconds and re-announces automatically — no restart needed.

If you want to force immediate re-announcement: `sudo systemctl restart dream-mdns`.

### Running multiple Dream Servers on one network

Give each one a unique `DREAM_DEVICE_NAME`. Two devices both calling themselves `dream.local` is undefined behavior — the most recent announcement usually wins but it depends on the OS and the timing. The recommended pattern: `kitchen.local`, `office.local`, `studio.local`.

### Disabling mDNS entirely

```bash
sudo systemctl stop dream-mdns
sudo systemctl disable dream-mdns
```

The device still works — you just have to use the IP address directly. The dashboard always shows the current IP in the top-right.

## What this enables

Once `dream.local` resolves on your network **and the dream-proxy is up on port 80** (see [Prerequisites](#prerequisites)), the Phase 1 onboarding UX works end to end:

1. User installs Dream Server (today: by running `install.sh`)
2. Device joins WiFi, starts announcing, and dream-proxy comes up on :80
3. User opens any browser on any device, types `dream.local`
4. Caddy on :80 routes `/chat` to Open WebUI, chat UI loads
5. User adds it to their phone's home screen (PWA) — the icon appears next to ChatGPT

No IP-typing, no router-config-page-diving, no DNS setup. The same UX as Sonos / Apple TV / any other consumer device on a home network.
