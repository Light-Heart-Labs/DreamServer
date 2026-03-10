# Contributing to Dream Server

First off, thanks for wanting to contribute! Dream Server is an open source project and we welcome help from everyone — whether you're fixing a typo, adding a cookbook recipe, or tackling a full feature.

---

## Quick Start

1. **Fork** this repository and **clone** your fork locally.
2. Create a **branch** for your work:
   ```bash
   git checkout -b fix/describe-your-change
   ```
3. Make your changes, run the validation checklist (below), and commit.
4. Open a **pull request** against `main`.

That's it. No CLA, no hoops.

---

## What We're Looking For

All kinds of contributions are valuable. Here are great places to start:

| Type | Examples |
|------|-----------|
| **Bug fixes** | Something broken? Fix it and send a PR. |
| **Documentation** | Clearer install instructions, troubleshooting guides, typo fixes. |
| **Cookbook recipes** | Workflows, prompt templates, integration examples. |
| **Test coverage** | Unit tests, integration tests, smoke tests. |
| **Feature work** | Check the issue tracker or propose your own. |
| **Security** | Path traversal fixes, auth hardening, input validation. |

If you're new here, look for issues labeled **`good first issue`** — scoped, well-defined tasks to get familiar with the codebase.

---

## Code Style & Conventions

| Language | Guidelines |
|----------|------------|
| **Bash** | Use `bash -n` for syntax check. Run `shellcheck` when possible. Follow the [installer header convention](dream-server/docs/INSTALLER-ARCHITECTURE.md#file-header-convention). |
| **Python** | Type hints and Pydantic models where appropriate. Use `pytest` for tests. Avoid silent exception swallowing — log or re-raise. |
| **React/JSX** | Functional components, hooks. Keep components focused. |
| **YAML** | Use `dream.services.v1` schema for extension manifests. |

Keep things readable. Comments are welcome where intent isn't obvious.

---

## Validation Checklist (Before Submitting)

Run these before opening a PR:

### Shell Scripts

```bash
# Syntax check all installer files
for f in dream-server/installers/lib/*.sh dream-server/installers/phases/*.sh dream-server/install-core.sh; do
  bash -n "$f"
done
```

### Python (Dashboard API)

```bash
cd dream-server/extensions/services/dashboard-api
python -m pytest  # if tests exist
```

### Dry-Run Installer (No Actual Installs)

```bash
cd dream-server
bash install-core.sh --dry-run --non-interactive --skip-docker --force
```

### Smoke Tests (if available)

```bash
bash tests/smoke/linux-nvidia.sh
bash tests/smoke/linux-amd.sh
```

---

## Architecture References

Before modifying core systems, review:

| Document | Scope |
|----------|-------|
| [TECHNOLOGY.md](TECHNOLOGY.md) | Full tech stack, patterns, metrics |
| [System Architecture](dream-server/docs/SYSTEM-ARCHITECTURE.md) | Service layout, data flow |
| [Installer Architecture](dream-server/docs/INSTALLER-ARCHITECTURE.md) | 6 libs + 13 phases, mod recipes |
| [Extensions](dream-server/docs/EXTENSIONS.md) | Adding services, manifest schema |

---

## Pull Request Process

1. **Describe your changes** in the PR description. A sentence or two for small changes; more detail for larger ones.
2. **Link related issues** (e.g. "Fixes #42").
3. **Run the validation checklist** — ensure existing functionality isn't broken.
4. A maintainer will review and may suggest changes. We try to be responsive.

---

## Mod Recipes (Common Customizations)

| Goal | Where to Edit |
|------|---------------|
| Add a hardware tier | `lib/tier-map.sh` + `lib/detection.sh` |
| Add a service | `extensions/services/<id>/` with manifest + compose |
| Swap default model | `lib/tier-map.sh` |
| Add installer phase | `installers/phases/` + `install-core.sh` |
| Change CRT theme | `lib/constants.sh` |

See [Installer Architecture](dream-server/docs/INSTALLER-ARCHITECTURE.md#mod-recipes) for the full table.

---

## Where to Ask Questions

Not sure about something? Open a thread in [GitHub Discussions](https://github.com/Light-Heart-Labs/DreamServer/discussions). We're happy to help you figure out the best approach before you write any code.

---

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE), the same license that covers this project.

---

Thanks for helping make local AI infrastructure better for everyone.
