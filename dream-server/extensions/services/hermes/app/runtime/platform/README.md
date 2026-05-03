# Runtime Platform

This directory is the JavaScript adaptation layer for the Hermes-style runtime
inside Dream Server.

The goal is not to add phrase triggers or one-off templates. The model still
decides what to do. This layer owns the operational contract around those
decisions:

- tool availability and execution gateway
- structured tool results and repair hints
- large result persistence instead of context flooding
- internal transcript for plan/act/observe/repair/final loops
- callback hooks for CLI, desktop, headless and future TUI surfaces

Reference source:

- `vendor/hermes-agent/tools/registry.py`
- `vendor/hermes-agent/tools/tool_result_storage.py`
- `vendor/hermes-agent/tools/process_registry.py`
- `vendor/hermes-agent/tools/terminal_tool.py`

Current ported modules:

- `tool-runtime.js`: central tool execution boundary.
- `transcript.js`: compact internal runtime transcript.
- `callbacks.js`: safe runtime callback bus.

Next migrations should target process/job tracking, terminal sessions, browser
control, memory/session search and skills as platform modules instead of UI
logic.
