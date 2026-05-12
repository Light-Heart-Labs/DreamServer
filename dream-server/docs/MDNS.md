# Dream Server mDNS — `dream.local` from any device on your network

Dream Server announces itself on your local network so you can browse to it from any phone, tablet, or laptop without knowing the IP. The URL is `http://dream.local` (or `http://<your-name>.local` if you renamed the device during setup).

## What gets announced

| mDNS name | Points to | What it serves |
|---|---|---|
| `<device>.local` | the device's LAN IP | base hostname — works as a bare URL in any browser |
| `<device>-chat._http._tcp.local` | port 3000 | Open WebUI chat |
| `<device>-dashboard._http._tcp.local` | port 3001 | Dashboard / settings |
| `<device>-dashboard-api._http._tcp.local` | port 3002 | Dashboard API (health endpoint) |

The first one is what users actually type. The `_http._tcp` records exist so MCP clients, service-discovery tools, and the eventual Dream Server mobile app can enumerate available services without hard-coded ports.

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

Once `dream.local` resolves on your network, the Phase 1 onboarding UX works end to end:

1. User installs Dream Server (today: by running `install.sh`)
2. Device joins WiFi and starts announcing
3. User opens any browser on any device, types `dream.local`
4. Chat UI loads
5. User adds it to their phone's home screen (PWA) — the icon appears next to ChatGPT

No IP-typing, no router-config-page-diving, no DNS setup. The same UX as Sonos / Apple TV / any other consumer device on a home network.
