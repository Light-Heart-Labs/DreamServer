# Dream Server DESKTOP Service

This extension adapts the packaged `dream-server-hermes` Electron app into a Dream Server web service. The original `win-unpacked` directory is not modified; the service payload was copied from `resources/app.asar` and `resources/app.asar.unpacked`.

Dream Server DESKTOP runs at `http://localhost:3011` by default and uses Dream Server's LiteLLM gateway at `http://litellm:4000/v1` unless `HERMES_LOCAL_BASE_URL` is overridden. Runtime state, uploads, and generated workspaces live in the `hermes-data` Docker volume under `/data/hermes`.

The home telemetry panel reads Dream Server's Dashboard API through `DREAM_DASHBOARD_API_URL` and `DASHBOARD_API_KEY` when available, then falls back to direct Node host metrics. This keeps CPU, RAM, GPU, model, and token fields wired to Dream Server instead of the original desktop defaults.

Key files:

- `app/server.js` replaces Electron IPC with HTTP and SSE endpoints.
- `app/src/web-bridge.js` provides the browser-side `window.dreamDesktop` API used by the renderer.
- `compose.yaml.disabled` registers the opt-in service in the Dream Server stack after the installer or `dream enable hermes` enables it.
- `APP_ASAR_SOURCE.txt` records the source app.asar checksum used for this vendored payload.
- `THIRD_PARTY.md` records the upstream Hermes Agent repository and commit fetched during Docker builds.
