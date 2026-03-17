# Contributing to Dream Server

Thanks for building with us.

## Fast Path

If you want to add or extend services, start here:
- [docs/EXTENSIONS.md](docs/EXTENSIONS.md) — extending services (Docker containers, dashboards)
- [docs/INSTALLER-ARCHITECTURE.md](docs/INSTALLER-ARCHITECTURE.md) — modding the installer itself

That guide includes a practical "add a service in 30 minutes" path with templates and checks.

## Reporting Issues

Open an issue with:
- hardware details (GPU, RAM, OS)
- expected behavior
- actual behavior
- relevant logs (`docker compose logs`)

## Pull Requests

1. Fork and create a branch (`git checkout -b feature/my-change`)
2. Keep PR scope focused (one milestone-sized change)
3. Run validation locally
4. Submit PR with clear description, impact, and test evidence

## Contributor Validation Checklist

The fastest way to validate everything:
```bash
make gate    # lint + test + smoke + simulate
```

Or run individual steps:
```bash
make lint    # Shell syntax + Python compile checks
make test    # Tier map unit tests + installer contracts
make smoke   # Platform smoke tests
```

Full manual checklist:
```bash
# Shell/API checks
bash -n install.sh install-core.sh installers/lib/*.sh installers/phases/*.sh scripts/*.sh tests/*.sh 2>/dev/null || true
python3 -m py_compile dashboard-api/main.py dashboard-api/agent_monitor.py

# Unit tests
bash tests/test-tier-map.sh

# Integration/smoke checks
bash tests/integration-test.sh
bash tests/smoke/linux-amd.sh
bash tests/smoke/linux-nvidia.sh
bash tests/smoke/wsl-logic.sh
bash tests/smoke/macos-dispatch.sh
```

If your change touches dashboard frontend and Node is available:
```bash
cd dashboard
npm install
npm run lint
npm run build
```

## Current Priorities

These are the things we most need help with, in order of impact:

1. **Clean installs** — the installer should work first try on every supported platform. Idempotent re-runs, clear error messages, no manual fixups. If someone hits a wall during install, that's a bug.
2. **Runs on anything** — Tier 0 (4GB RAM, no GPU) to Tier 4 (enterprise). Laptops, desktops, servers, WSL2, bare metal. If someone has a machine, Dream Server should run on it.
3. **Extensions and integrations** — Dream Server should work really well with other apps and services. New extension manifests, service integrations, API bridges, workflow templates. The ecosystem is what makes this useful beyond a demo.
4. **Installer portability** — macOS, Linux (Ubuntu/Debian/Arch/Fedora), Windows (native + WSL2). Every platform-specific bug fixed is hundreds of users unblocked.
5. **Test coverage for real code paths** — integration tests that exercise the actual installer, health checks, and service startup. Not theoretical tests for features that don't exist yet.

If you want to tackle any of these, open an issue first so we can align on approach.

## What We'll Merge Fast

- Bug fixes with reproduction steps
- Tests for existing untested code paths
- Focused, single-concern PRs that do one thing well
- Platform support (new OS, new GPU vendor, new hardware tier)
- Security fixes with clear explanation of the vulnerability

## What Will Get Bounced Back

We've learned these patterns the hard way. Save yourself a review cycle:

- **Mega-PRs that bundle unrelated changes.** One PR = one concern. A bug fix + a feature + a refactor = three PRs.
- **Code that wasn't run.** If your function is called but never defined, or your shell variable won't expand in that context, we'll catch it. Run your code locally before submitting.
- **Breaking changes without migration.** Changing port defaults, tightening schemas, broadening volume mounts — these all need migration notes and maintainer discussion first. Open an issue before the PR.
- **Tests for features that don't exist.** A test suite that skip()'s every check because the underlying feature isn't implemented gives false confidence. Write the tests alongside the feature.
- **Formatting-only PRs.** We appreciate clean code, but a PR that only runs black/prettier across the codebase creates merge conflicts for everyone else and adds no functionality.
- **Over-engineering.** If the problem is simple, the solution should be simple. Don't add configuration, abstraction layers, or feature flags for one-time operations.

## Style

- Bash: `set -euo pipefail`, quote your variables, use `shellcheck`
- Python: match the style of the file you're editing, no reformatting unrelated code
- YAML/JSON: stable keys, minimal noise, no tabs
- Docs: concrete commands and compatibility notes
- Commits: short imperative subject line, explain *why* not *what* in the body

## Questions

Open an issue or start a [GitHub Discussion](https://github.com/Light-Heart-Labs/DreamServer/discussions). Include enough context to reproduce the problem quickly. We're happy to help you figure out the right approach before you write code — it's much faster than reviewing a PR that needs a redesign.
