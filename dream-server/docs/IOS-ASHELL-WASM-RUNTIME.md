# iOS a-Shell WASM Runtime

Last updated: 2026-04-11

## Goal

Use the same `dream-mobile.sh` CLI on iOS with a real local `Qwen3-0.6B` backend by placing a `llama-cli.wasm` runtime at:

```text
mobile-runtime/ios-ashell/bin/llama-cli.wasm
```

## What exists now

The repo now includes a working host-side build chain:

```sh
bash dream-server/installers/mobile/build-ios-ashell-wasm-sdk.sh
bash dream-server/installers/mobile/build-ios-ashell-wasm-runtime.sh
```

That build chain:

- bootstraps a custom `wasi-sdk` sysroot with `WASI_SDK_EXCEPTIONS=ON`
- clones a pinned `llama.cpp` checkout
- generates a tiny prompt-only WASI runner
- drives the official `wasi-sdk` Docker image plus the custom exported sysroot
- now injects an explicit `__cpp_exception` wasm tag object into the runner link
- now stubs `dlopen` / `dlsym` / `dlclose` for the WASI path
- copies the output into the exact path that the iOS preview already checks

## Published-image blocker

If you try to skip the custom sysroot helper and use only a published `wasi-sdk` image, the link still fails for the `a-Shell` path because the required C++ exception runtime support is incomplete without an exceptions-enabled sysroot.

The first blocker we hit on published images was:

- `__cxa_allocate_exception`
- `__cxa_throw`
- `__wasm_lpad_context`
- `_Unwind_CallPersonality`

The successful host build now pairs the runner with:

- `wasm32-wasip1`
- `-fwasm-exceptions`
- `-lunwind`
- an explicit `__cpp_exception` tag object
- a custom sysroot built with `WASI_SDK_EXCEPTIONS=ON`
- WASI-safe dynamic loading stubs for the static CPU backend path

This is why the iPhone can already:

- download `Qwen3-0.6B-Q4_0.gguf`
- report `Downloaded:true`
- keep a stable `prompt` / `chat` shell contract

## What success looks like

Once `mobile-runtime/ios-ashell/bin/llama-cli.wasm` is present in the repo state that the iPhone pulls, the iOS flow does not need a new interface. The existing commands can switch over:

```sh
sh ./dream-mobile.sh status
sh ./dream-mobile.sh prompt "oi"
sh ./dream-mobile.sh chat
```

And `status` should move from:

```text
Engine:    rules
Wasm ready:false
```

to:

```text
Engine:    wasm
Wasm ready:true
```

## Practical note

These builders are meant to run on a desktop host with Docker, not inside `a-Shell`.
