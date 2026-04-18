# iOS a-Shell Preview

Last updated: 2026-04-13

## Goal

Keep the iOS shell path intentionally small and stable:

- install the local preview on `a-Shell`
- load the local `Qwen3-0.6B` runtime
- talk to the model with a fast interactive chat

This is a **lite beta** path for iPhone shell use. It is not the same experience as the full Dream Server desktop install on Windows, macOS, or Linux.

## Install on iPhone

First, install [a-Shell on the App Store](https://apps.apple.com/us/app/a-shell/id1473805438) on your iPhone.

Inside `a-Shell`:

```sh
lg2 clone https://github.com/Light-Heart-Labs/DreamServer.git
cd DreamServer
sh ./install.sh
sh ./dream-mobile.sh status
sh ./dream-mobile.sh chat
```

By default, `sh ./install.sh` downloads `Qwen3-0.6B-Q4_0.gguf` into `data/models/mobile/`.

If you want to skip the model download on a specific run:

```sh
sh ./install.sh --no-model-download
```

## Available commands

The iOS preview now exposes only these shell commands:

- `install`
- `status`
- `chat`

This keeps the `a-Shell` path focused on the part that is currently working well: local chat.

Out of scope for this lite beta:

- full Docker stack
- Dashboard / WebUI
- workflows, agents, and voice services
- desktop feature parity

## Runtime note

The iOS preview uses:

- the downloaded GGUF model file
- the linked `llama-cli.wasm` runtime under `mobile-runtime/ios-ashell/bin/`
- the `wasm` runner exposed by `a-Shell`

That is how Dream Server can chat locally on iPhone without needing a separate native app.
