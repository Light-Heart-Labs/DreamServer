---
name: ios-panel
description: Start and use the Hermes iOS Panel plugin for iPhone-style side-panel debugging, Safari proxy browsing, scenario recording/replay, UI hierarchy snapshots, runtime logs, and bundle export.
---

# Hermes iOS Panel

Use this skill when the user wants to open the iPhone side panel, debug a UI flow in the Safari-like shell, record/replay a scenario, export a scenario bundle, or check real-iOS driver availability.

## Start

From the plugin root:

```sh
npm start
```

Open:

- `http://127.0.0.1:8420/`
- `http://127.0.0.1:8420/api/sim/browser`

If port `8420` is busy:

```sh
PORT=8421 npm start
```

PowerShell:

```powershell
$env:PORT=8421; npm start
```

## Core URLs

- `/api/sim/ui`: full panel with controls
- `/api/sim/browser`: browser-only side panel
- `/api/sim/devices`: available web-shell devices
- `/api/sim/capabilities`: cross-platform capability report
- `/api/sim/drivers/real-ios`: optional macOS/Xcode driver status
- `/api/sim/bundles`: scenario bundle export endpoint

## Workflow

1. Open the panel.
2. Use Safari in the iPhone home screen to open a local or external URL.
3. Click `Record` in Scenario Lab.
4. Reproduce the bug with taps, scrolls, inputs, and keys.
5. Click `Stop`.
6. Click `Snapshot` for a DOM/accessibility-style hierarchy.
7. Click `Bundle` to export `scenario.json`, `hierarchy.json`, `runtime-events.json`, `visual.html`, and `screen.png` when available.
8. Use `Replay` to re-run the captured path.

## Drivers

- `web-shell`: default on macOS, Linux, and Windows.
- `real-ios`: optional macOS driver. Requires Xcode and XcodeBuildMCP. See `drivers/xcodebuildmcp.mcp.json`.

On Windows/Linux, real iOS requires delegating to a remote macOS host.
