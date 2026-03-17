# Contributing to Dream Server

Dream Server is how we prove that AI doesn't need to be rented from a corporation. Every PR that lands here puts sovereign AI into someone's hands who didn't have it yesterday. That's the mission. If you're here, you're part of it.

## Getting Started

Fork, branch, build, PR. That's it.

```bash
git checkout -b my-change
```

No CLA. No committee. No waiting for permission. If it makes Dream Server better, send it.

If you're adding or extending services, read these first:
- [docs/EXTENSIONS.md](docs/EXTENSIONS.md) — how to add a new service in 30 minutes
- [docs/INSTALLER-ARCHITECTURE.md](docs/INSTALLER-ARCHITECTURE.md) — how the installer works under the hood

## What We Care About Right Now

We have a lot of contributors and limited review bandwidth. These are the areas where your work will have the most impact — and where PRs get merged fastest.

### 1. Runs on anything

A student with a $200 laptop and no GPU should be able to run Dream Server. So should someone with a 96GB Strix Halo laptop. We're not building for the lucky few with 4090s — we're building for everyone.

Where to help:
- **New hardware tiers** — we have Tier 0 (4GB, no GPU) through Tier 4 (48GB+ VRAM) plus Strix Halo and Intel Arc. If your hardware isn't supported, make it supported.
- **CPU-only inference** — llama.cpp does the heavy lifting, but the installer, memory limits, and model selection all need to work without a GPU.
- **Low-RAM environments** — compose overlays that reduce memory reservations so services fit on constrained machines. See `docker-compose.tier0.yml` for how we did it.
- **ARM, Chromebooks, older GPUs** — if it runs Docker and has 4GB of RAM, we want to support it.

### 2. Clean installs

If someone runs the installer and it doesn't work first try, we failed. Not them — us. Every install failure is a person who might not come back.

Where to help:
- **Idempotent re-runs** — running the installer twice shouldn't break anything. Secrets, configs, and data should survive.
- **Error messages that actually help** — "what went wrong" and "what to do about it." No stack traces. No silent failures.
- **Preflight checks** — catch bad Docker versions, insufficient disk, port conflicts *before* the install starts.
- **The weird edge cases** — WSL2 memory limits, macOS Homebrew paths, Windows Defender, Secure Boot blocking NVIDIA. These are what actually break installs in the real world.
- **Offline installs** — pre-downloaded models, air-gapped environments, corporate firewalls. Real people deal with this.

### 3. Extensions and integrations

A bare LLM running in a terminal is cool for about ten minutes. Dream Server becomes something people rely on when it plugs into everything else they already use. This is where the ecosystem gets built.

Where to help:
- **New services** — wrap any Docker-based tool as a Dream Server extension. Manifest, compose file, health check — that's it. Look at `extensions/services/` for examples.
- **API bridges** — connect Dream Server to Slack, Discord, email, calendars, CRMs. n8n workflows are the fastest path.
- **Workflow templates** — pre-built n8n workflows that solve actual problems people have.
- **Manifest quality** — health checks, dependency declarations, port contracts, GPU compatibility. Run `dream audit` to validate yours.
- **Reliability between services** — correct startup ordering, graceful handling of dependencies being temporarily down. The `compose.local.yaml` pattern handles this.

### 4. Tests that catch real bugs

We want tests for code that exists. Not tests for features we haven't built. Not test suites that skip() everything and report "all passed."

Where to help:
- **Installer integration tests** — actually run installer phases in a container and verify the output.
- **Tier map validation** — every tier resolves to the right model, GGUF, URL, and context. See `tests/test-tier-map.sh`.
- **Health checks that verify real behavior** — not just "is a port open" but "does the service actually respond correctly."
- **Extension contract tests** — manifests parse, compose files are valid, ports don't conflict.
- **Platform smoke tests** — scripts parse and core functions work on Linux, macOS, Windows, and WSL2.

### 5. Installer portability

macOS, Linux (Ubuntu, Debian, Arch, Fedora, NixOS), Windows (PowerShell + WSL2). Every platform bug you fix unblocks hundreds of people you'll never meet.

Where to help:
- **POSIX compliance** — BSD sed is not GNU sed. BSD date is not GNU date. If it runs on macOS, don't use GNU-only flags. Use `_sed_i` and `_now_ms`.
- **Package managers** — apt, dnf, pacman, brew, xbps. If your distro isn't supported, add it.
- **Bash compatibility** — macOS ships Bash 3.2. No associative arrays unless you guard for Bash 4+.
- **Path handling** — Windows vs Unix, spaces, symlinks, external drives. Use `path-utils.sh`.
- **Docker flavors** — Docker Desktop, Docker Engine, Podman, Colima. Different sockets, different compose plugins, different permission models.

## Before You Submit

Run validation locally:

```bash
make gate    # lint + test + smoke + simulate
```

Or individual steps:

```bash
make lint    # shell syntax + Python compile
make test    # tier map + installer contracts
make smoke   # platform smoke tests
```

If you touched the dashboard:
```bash
cd dashboard && npm install && npm run lint && npm run build
```

## What Gets Merged Fast

- Bug fixes with clear reproduction
- Tests for existing untested code
- Focused PRs that do one thing well
- New platform or hardware support
- Security fixes with a clear explanation

## What Gets Sent Back

We review a lot of PRs. These patterns waste everyone's time — yours and ours:

- **Bundled PRs.** One PR, one concern. A bug fix + a feature + a refactor = three PRs. Every time.
- **Code that was never run.** If your function is referenced but never defined, or your shell variable won't expand in exec form — we'll catch it. Please catch it first.
- **Breaking changes with no migration path.** Changing port defaults, tightening schemas, broadening volume mounts — these need an issue and a discussion *before* the PR. Existing installs matter.
- **Tests for imaginary features.** A test suite that skip()'s every assertion because the feature doesn't exist yet is worse than no tests — it creates false confidence.
- **Formatting-only PRs.** Running black or prettier across the whole codebase creates merge conflicts for every other contributor and ships zero functionality.
- **Over-engineering.** If the fix is three lines, don't build a framework. We value simple code that works over clever code that impresses.

## Style

- Bash: `set -euo pipefail`, quote your variables, `shellcheck` your scripts
- Python: match the file you're editing, don't reformat code you didn't change
- YAML/JSON: stable keys, no tabs, minimal noise
- Commits: imperative subject line, explain *why* in the body

## Questions?

Open an issue or start a [GitHub Discussion](https://github.com/Light-Heart-Labs/DreamServer/discussions). We'd rather help you get the approach right before you write code than review a PR that needs a redesign.

## Reporting Bugs

Open an issue with:
- Hardware (GPU, RAM, OS)
- What you expected
- What actually happened
- Logs (`docker compose logs`)

## License

By contributing, your work is licensed under [Apache 2.0](LICENSE) — same as the rest of the project.
