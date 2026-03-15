# Changelog

All notable changes to Dream Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2.0.0-strix-halo] - 2026-03-04

### Added
- AMD Strix Halo support with ROCm 7.2 and unified memory tiers (SH_LARGE, SH_COMPACT)
- NVIDIA ultra tier (NV_ULTRA) for 90GB+ multi-GPU configurations
- Qwen3 Coder Next (80B MoE) model support for high-memory systems
- Product landing page README with screenshots and YouTube demo
- Dashboard screenshots, installer GIF, and download sequence images
- Architecture Decision Record for Docker image tag pinning
- 55 pytest unit tests for dashboard-api (GPU, helpers, config, agent monitor, security)
- CI workflow for dashboard-api tests

### Changed
- README rewritten as product landing page (feature highlights, comparison table, screenshots)
- CONTRIBUTING.md updated from legacy "Lighthouse AI" branding to "Dream Server"
- Repository About section updated with new description, website, and topics

### Fixed
- Timing attack vulnerability in privacy-shield API key comparison (now uses `secrets.compare_digest`)
- `HTTPBearer(auto_error=False)` in privacy-shield silently passing `None` instead of returning 401
- Dependency version bounds added to privacy-shield and token-spy requirements.txt

## [2.0.0] - 2026-03-03

### Added
- Documentation index (`docs/README.md`) for navigating 30+ doc files
- `.env.example` with all required and optional variables documented
- `docker-compose.override.yml` auto-include for custom service extensions
- Real shell function tests for `resolve_tier_config()` (replaces tautological Python tests)
- Dry-run reporting for phases 06, 07, 09, 10, 12
- `Makefile` with `lint`, `test`, `smoke`, `gate` targets
- ShellCheck integration in CI
- `CHANGELOG.md`, `CODE_OF_CONDUCT.md`, issue/PR templates

### Changed
- Modular installer: 2591-line monolith split into 6 libraries + 13 phases
- All services now core in `docker-compose.base.yml` (profiles removed)
- Models switched from AWQ to GGUF Q4_K_M quantization

### Fixed
- Tier error message now auto-updates when new tiers are added
- Phase 12 (health) no longer crashes in dry-run mode
- n8n timezone default changed from `America/New_York` to `UTC`
- Stale variable names in INTEGRATION-GUIDE.md
- Embeddings port in INTEGRATION-GUIDE.md (9103 → 8090)
- Purged all stale `--profile` references across codebase (12+ files)
- Purged all stale `docker-compose.yml` references in docs
- AWQ references in QUICKSTART.md updated to GGUF Q4_K_M
- `make lint` no longer silently swallows errors
- Makefile now uses `find` to discover all .sh files instead of hardcoded globs

### Removed
- Token Spy (service, docs, installer refs, systemd units, dashboard-api integration)
- `docker-compose.strix-halo.yml` (deprecated, merged into base + amd overlay)
- Tautological Python test suite (`test_installer.py`)
- `asyncpg` dependency from dashboard-api (was only used by Token Spy)

## [0.3.0-dev] - 2025-05-01

Initial development release with modular installer architecture.
