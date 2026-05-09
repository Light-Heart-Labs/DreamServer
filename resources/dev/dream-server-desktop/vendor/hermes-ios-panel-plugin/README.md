# Codex iOS Panel

Cross-platform local bridge for a Codex side-panel phone preview.

This repository is also a Codex plugin named `hermes-ios-panel`. The plugin manifest is in `.codex-plugin/plugin.json`, and the usage skill is in `skills/ios-panel/SKILL.md`.

It exposes:

- `http://localhost:8420/`
- `http://localhost:8420/api/sim/ui`
- `http://localhost:8420/api/sim/browser`
- `http://localhost:8420/api/sim/devices`
- `http://localhost:8420/api/sim/health`
- `http://localhost:8420/api/sim/capabilities`
- `http://localhost:8420/api/sim/drivers/real-ios`
- `POST http://localhost:8420/api/sim/bundles`

The core is plain Node.js and browser UI, so it runs on macOS, Linux, and Windows. It is not Apple iOS Simulator by itself; it is the portable web-shell driver. Real iOS Simulator support should be added as an optional macOS driver using Xcode/XcodeBuildMCP or a remote macOS host.

Visual references:

- Icon size list from `SamVerschueren/ios-icon-list` (MIT).
- Apple-style app icon SVGs from `aroundsketch/Apple-App-Icons`, used locally for this personal simulator mockup.

Current panel states:

- lock screen
- SpringBoard home screen with Apple-style SVG icons, dock, widgets, and custom prism wallpaper
- Notification Center shade from top pull gesture
- app view with mobile iframe
- Safari-like app shell with an external-site proxy and Google Search fallback
- app switcher
- Control Center from top-right pull gesture
- Siri overlay
- dark browser-only side-panel view
- portrait and landscape rotation
- frame toggle, theme toggle, gestures, text input, sensors, and UI snapshot log
- Scenario Lab for recording tap, scroll, form input, and key paths
- replay runner for recorded scenarios
- DOM/accessibility-style view hierarchy snapshots for the shell and accessible iframe content
- console, runtime error, fetch, and XHR event capture
- scenario bundle export to `bundles/<timestamp>-<name>/`

Run:

```sh
npm start
```

Windows helper:

```powershell
.\scripts\start-ios-panel.ps1
```

macOS/Linux helper:

```sh
sh ./scripts/start-ios-panel.sh
```

Driver model:

- `web-shell`: default on every OS; renders the iPhone panel, Safari shell, screenshots, gestures, and proxy.
- `real-ios`: optional driver; available only on macOS with Xcode or through a remote macOS machine. The MCP config lives at `drivers/xcodebuildmcp.mcp.json`.

Scenario bundles include:

- `bundle.json`
- `scenario.json`
- `hierarchy.json`
- `runtime-events.json`
- `visual.html`
- `screen.png` when the browser can serialize the current phone view

`screen.png` is generated client-side when possible. If that fails, the server attempts a Playwright replay screenshot when the `playwright` package and Chromium browser are available in the runtime.

Optional screenshot setup:

```sh
npm install
npx playwright install chromium
```
