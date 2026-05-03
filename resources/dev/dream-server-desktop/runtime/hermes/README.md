# Hermes Runtime Bridge

This folder connects Dream Server Desktop to the vendored Hermes Agent Python
runtime in `vendor/hermes-agent`.

The integration intentionally does not port Hermes into JavaScript.  The desktop
shell launches `bridge_runner.py`, which imports Hermes' own `AIAgent` and
streams structured JSON events back to Node:

- `text_delta`
- `thinking`
- `tool_start`
- `tool_complete`
- `step`
- `status`
- `final`
- `error`

Default local execution uses:

```text
.venv-hermes/Scripts/python.exe
```

Fallback Python commands are tried after that.  Set `DREAM_HERMES_PYTHON` to
override the interpreter explicitly.

The current split is:

- Dream Server Electron/Node: UI, local Windows bridge, state, desktop shell.
- Hermes Agent Python: agent loop, tools, toolsets, callbacks, provider logic.

Cloud Manus remains supported separately because it has a different task
lifecycle and is not an OpenAI-compatible Hermes provider.
