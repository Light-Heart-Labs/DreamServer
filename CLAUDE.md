# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dream Server is a fully local AI stack (LLM inference, chat, voice, agents, workflows, RAG, image generation, privacy tools) deployed on user hardware with a single command. It supports Linux (NVIDIA + AMD), Windows (WSL2), and macOS (Apple Silicon). The project is primarily Bash (installer/CLI), Python (dashboard-api, services), and React/Vite (dashboard UI).

## Repository Structure

The repo has two layers:

- **Root level** — outer wrapper with top-level README, install scripts (`install.sh`, `install.ps1`), CI workflows (`.github/workflows/`), and `resources/` (cookbooks, blog, dev tools, frameworks)
- **`dream-server/`** — the core product containing all deployable code

Within `dream-server/`:

- **`install-core.sh`** — thin orchestrator (~184 lines) that sources libs then runs phases in order
- **`installers/lib/`** — pure function libraries (constants, logging, UI, GPU detection, tier mapping, packaging, compose selection)
- **`installers/phases/`** — 13 sequential install steps (`01-preflight` through `13-summary`), each sourced by install-core
- **`installers/macos/`**, **`installers/windows/`** — platform-specific installer variants
- **`extensions/services/`** — 17 service extensions, each a directory with `manifest.yaml` + optional `compose.yaml` and GPU overlays
- **`docker-compose.base.yml`** — core service definitions; `docker-compose.{amd,nvidia,apple}.yml` are GPU overlays
- **`dream-cli`** — main CLI tool (~45K lines Bash) for managing the stack
- **`config/`** — backend configs (`backends/amd.json`, `nvidia.json`, etc.), GPU database, LiteLLM config, hardware classes
- **`extensions/services/dashboard-api/`** — Python FastAPI backend (with `routers/`, `tests/`)
- **`extensions/services/dashboard/`** — React + Vite + Tailwind frontend (`src/`)
- **`scripts/`** — operational scripts (health checks, model management, compose stack resolution, doctor, preflight)
- **`tests/`** — shell-based tests (tier map, contracts, smoke tests, integration)
- **`lib/`** — shared Bash utilities (safe-env, service-registry, progress, QR code)

## Build & Development Commands

All commands run from `dream-server/` directory unless noted.

### Linting and Validation

```bash
make lint          # Shell syntax check (bash -n) + Python compile check
make test          # Tier map tests + installer contract tests + preflight fixtures
make smoke         # Platform smoke tests (linux-amd, linux-nvidia, wsl, macos)
make simulate      # Installer simulation harness
make gate          # Full pre-release: lint + test + smoke + simulate
make doctor        # Run diagnostic report
```

### Running a Single Test

```bash
bash tests/test-tier-map.sh                      # Tier mapping tests
bash tests/contracts/test-installer-contracts.sh  # Installer contracts
bash tests/contracts/test-preflight-fixtures.sh   # Preflight fixtures
bash tests/smoke/linux-nvidia.sh                  # Single smoke test
```

### Dashboard API (Python/FastAPI)

```bash
cd extensions/services/dashboard-api
pytest tests/                    # Run all dashboard-api tests
pytest tests/test_routers.py     # Run a specific test file
```

### Dashboard UI (React/Vite)

```bash
cd extensions/services/dashboard
npm install
npm run dev      # Dev server
npm run build    # Production build
npm run lint     # ESLint
```

### Pre-commit Hooks

The root `.pre-commit-config.yaml` runs gitleaks (secret scanning), private key detection, and large file checks. Install with:
```bash
pip install pre-commit && pre-commit install
```

## CI Workflows

GitHub Actions in `.github/workflows/`:
- **lint-shell.yml** — ShellCheck on all `.sh` files
- **lint-python.yml** — Python linting
- **type-check-python.yml** — Python type checking
- **dashboard.yml** — Dashboard build/lint
- **test-linux.yml** — Linux test suite + installer simulation (uploads artifacts)
- **matrix-smoke.yml** — Multi-distro smoke tests (6 distros)
- **validate-compose.yml** — Docker Compose validation
- **secret-scan.yml** — Secret scanning
- **lint-powershell.yml** — PowerShell linting for Windows installer

## Architecture Key Concepts

### Installer Architecture

The installer is modular with a strict separation: `installers/lib/` contains pure functions (no side effects), `installers/phases/` contain sequential steps that execute on `source`. Every module has a standardized header (Purpose, Expects, Provides, Modder notes). The orchestrator (`install-core.sh`) sets `INSTALL_PHASE` before each phase for error reporting.

### Extension System

Every service is an extension under `extensions/services/<name>/`. Each has a `manifest.yaml` defining metadata (id, port, health endpoint, container name, aliases, category, GPU backends, feature flags). Extensions with `compose.yaml` get auto-merged into the Docker Compose stack by `scripts/resolve-compose-stack.sh`. Core services (llama-server, open-webui, dashboard, dashboard-api) only have manifests — their compose lives in `docker-compose.base.yml`.

### GPU Backend / Tier System

GPU detection (`installers/lib/detection.sh`) identifies hardware and maps it to a tier via `installers/lib/tier-map.sh`. Backend configs in `config/backends/{amd,nvidia,apple,cpu}.json` define per-tier model selections. The compose stack is layered: `docker-compose.base.yml` + `docker-compose.{amd,nvidia,apple}.yml`.

### Docker Compose Layering

The stack uses compose file merging. `scripts/resolve-compose-stack.sh` dynamically discovers enabled extension compose files and merges them with base + GPU overlay. Services bind to `127.0.0.1` by default for security.

### Dashboard API

FastAPI app in `extensions/services/dashboard-api/` with modular routers (`routers/agents.py`, `features.py`, `privacy.py`, `setup.py`, `updates.py`, `workflows.py`). Uses API key auth (`security.py`), GPU detection (`gpu.py`), and service health monitoring (`helpers.py`).

## Code Style

- **Shell**: Bash with `set -euo pipefail`. Use `shellcheck` for linting. POSIX-compatible constructs preferred for macOS portability (avoid GNU-only date/grep).
- **Python**: Standard formatting, consistent with existing file style. FastAPI for APIs. Pytest for tests.
- **JavaScript/React**: ESLint with flat config. Vite for bundling. Tailwind CSS for styling.

## Design Philosophy

Priority order when principles conflict: **Let It Crash > KISS > Pure Functions > SOLID**.

### Error Handling Rules

1. **No broad or silent catches.** Never `except Exception: pass` or `except Exception: return None`. No retry/backoff loops. No fallback chains.
2. **Narrow exceptions at I/O boundaries are fine.** Health checks, network calls, and file I/O may catch *specific* exception types (e.g., `asyncio.TimeoutError`, `aiohttp.ClientConnectorError`) when each maps to a distinct, meaningful status.
3. **Internal functions: let exceptions propagate.** The default is zero error handling — errors crash visibly with a full stack trace.
4. **Bash: `set -euo pipefail` everywhere.** Errors kill the process. Use `trap` handlers for context (see `install-core.sh`). If you must tolerate a failure, log it: `some_command || warn "failed (non-fatal)"`. Never `|| true` or `2>/dev/null`.
5. **Python boundaries: raise, don't swallow.** FastAPI routers validate input and `raise HTTPException`. Never return `None` to signal an error.
6. **Tests: let assertions fail visibly.** Never catch exceptions in tests to avoid failure. A crash in a test is a signal, not a problem.

### KISS

- Readable over clever. Explicit over implicit.
- One function, one job. Flatten deep nesting with early returns.
- No premature abstraction — wait for 3+ use cases.
- Thresholds: functions > 30 lines, nesting > 3 levels, files > 500 lines → consider splitting.

### Pure Functions

- Default to pure for business logic, validation, data mapping (same inputs → same output, no side effects).
- Push I/O to boundaries. Follow **functional core, imperative shell** — `installers/lib/` is the pure core, `installers/phases/` is the imperative shell.
- If purity adds excessive wiring, prefer a simple impure function with a comment.

### SOLID (apply pragmatically)

- **SRP**: Each module/function has one reason to change (installer phases, FastAPI routers).
- **OCP**: Extend via config/data (extension manifests, backend JSON files), not code modification.
- **DIP**: Inject dependencies via env vars (Bash) and `Depends()` (FastAPI). Don't hardcode.
- Don't over-engineer. For simple utilities, pragmatism > purity.

## Key File Paths

- Tier mapping logic: `dream-server/installers/lib/tier-map.sh`
- GPU detection: `dream-server/installers/lib/detection.sh`
- Service manifests: `dream-server/extensions/services/*/manifest.yaml`
- Compose stack resolver: `dream-server/scripts/resolve-compose-stack.sh`
- Environment schema: `dream-server/.env.schema.json`
- Environment example: `dream-server/.env.example`

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **DreamServer** (12331 symbols, 25685 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/DreamServer/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/DreamServer/context` | Codebase overview, check index freshness |
| `gitnexus://repo/DreamServer/clusters` | All functional areas |
| `gitnexus://repo/DreamServer/processes` | All execution flows |
| `gitnexus://repo/DreamServer/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## Keeping the Index Fresh

After committing code changes, the GitNexus index becomes stale. Re-run analyze to update it:

```bash
npx gitnexus analyze
```

If the index previously included embeddings, preserve them by adding `--embeddings`:

```bash
npx gitnexus analyze --embeddings
```

To check whether embeddings exist, inspect `.gitnexus/meta.json` — the `stats.embeddings` field shows the count (0 means no embeddings). **Running analyze without `--embeddings` will delete any previously generated embeddings.**

> Claude Code users: A PostToolUse hook handles this automatically after `git commit` and `git merge`.

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
