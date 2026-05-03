# Drivers

The panel has a portable `web-shell` driver and an optional `real-ios` driver.

## web-shell

Runs on macOS, Linux, and Windows with Node.js. It owns:

- phone frame and SpringBoard UI
- Safari-like shell and proxy
- scenario recording and replay
- DOM/accessibility-style hierarchy snapshots
- console/network event capture
- scenario bundle export

## real-ios

Requires macOS with Xcode, or a remote macOS host. Use `xcodebuildmcp.mcp.json` as the MCP server config for the real simulator driver. The server endpoint `/api/sim/drivers/real-ios` reports whether the current host can run that driver locally.
