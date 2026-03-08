# Changelog

All notable changes to Dream Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- M1 Sandbox Testing Framework for validating local Qwen agent capabilities
- M4 Deterministic Voice Classifier with 21ms inference (12× faster than LLM fallback)
- Config Migration Framework with `migrate-config.sh` for safe version updates
- Docker Compose Profiles documentation (`PROFILES.md`)
- Privacy Shield integration with dashboard toggle endpoints

### Fixed
- Dashboard service hostnames now match docker-compose.yml (#1)
- dream-update.sh path detection with fallback logic (#2)
- Environment variable mismatch for model detection (#3)
- Voice agent with error handling, reconnection, graceful degradation (#4)
- Functional test suite `dream-test-functional.sh` for real service validation (#5)
- Duplicate deterministic code consolidated (#6)
- Hardcoded IPs in classifier replaced with env vars (#7)
- Setup wizard for first-run experience (#8)
- Version system with VERSION file and API endpoints (#13)
- Dashboard API stub endpoints now functional (#11)
- Voice services properly profiled for optional enablement (#10)

### Changed
- Ship readiness: 40% → 90%
- All BLOCKERS (6/6) and HIGH priority (6/6) items complete

## [0.1.0] - 2026-02-11

### Added
- Initial Dream Server release
- Local LLM inference via vLLM (Qwen2.5-Coder-32B-AWQ)
- Open WebUI for chat interface
- n8n workflow automation
- Voice pipeline (Whisper STT, Kokoro TTS, LiveKit)
- Privacy Shield for PII protection
- Agent templates (5 validated)
- Dashboard with system monitoring
- Update system with backup/rollback
- Security hardening (container hardening, non-root users)
- Monitoring stack (Prometheus, Grafana)

### Security
- Container hardening on 22 services
- Non-root user execution
- Read-only filesystems
- No-new-privileges security option
- Network isolation

---

## Release Categories

### Added
- New features

### Changed
- Changes to existing functionality

### Deprecated
- Soon-to-be removed features

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Security improvements

---

## Generating Changelogs

### Manual Updates
Edit this file directly for each release. Follow the format above.

### Auto-Generate from Git
```bash
# Generate changelog from git commits since last tag
git log --pretty=format:"- %s" v0.1.0..HEAD

# Generate with categories (requires conventional commits)
git log --pretty=format:"%s" | grep -E "^(feat|fix|docs|security):"
```

### Dashboard Integration
The dashboard displays changelog via `/api/releases/manifest` endpoint which queries GitHub releases API.

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| 0.1.0 | 2026-02-11 | Initial release |
| 0.2.0 | TBD | Config migration, voice improvements |

