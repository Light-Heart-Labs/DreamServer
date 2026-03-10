# Production Readiness Review — Dream Server CLI Installer

## Project Context

Dream Server is a local AI management platform that orchestrates a multi-container Docker stack (LLM inference via llama-server, Open WebUI chat, SearXNG search, ComfyUI image gen, n8n workflows, Qdrant vector DB, etc.). This CLI installer is the primary user-facing tool for installing, configuring, updating, and diagnosing the entire stack.

**Runtime**: Bun (TypeScript), distributed as a single static binary for Linux x64/arm64.
**Privilege model**: Runs as a regular user or via `sudo`. Detects `SUDO_USER` to resolve the real user's home directory. Docker socket access is required.
**Target users**: Non-technical users running bare-metal GPU servers (NVIDIA/AMD). The installer must be robust to partial failures, network interruptions, and misconfigurations.
**Threat model**: The binary self-updates from GitHub Releases with SHA256 verification. Secrets are generated with `crypto.getRandomValues()`. The installer runs `docker compose up` on the user's system, so command injection via .env values is a risk surface.

## Review Scope

This is a **production readiness** review before merging into `main`. The codebase is feature-complete (Phases 1-3 done, 138 tests passing). We need to identify:

1. Bugs or crash vectors that would break the installer for end users
2. Security issues in secret handling, self-update, or command execution
3. Error handling gaps — any situation where the installer would hang, crash silently, or leave the system in a broken state
4. Robustness issues — race conditions, timeouts, unhandled edge cases
5. Test coverage gaps — critical paths that are not tested

## Attached Context Packs

| File | Contents | Token Estimate |
|------|----------|---------------|
| `context_source.md` | All source code: commands, lib, phases, entry point | ~28K |
| `context_tests.md` | All 21 test files covering 138 tests | ~20K |

## Focus Areas

### 1. Command Injection & Input Sanitization
- Can malicious `.env` values inject shell commands? The env parser reads user-edited files and values end up in `exec()` calls via Docker compose.
- Are user-supplied paths (`--dir`) sanitized before use in `exec()`, `Bun.write()`, `join()`?
- Is the `SUDO_USER` environment variable trusted safely in `getUserHome()` (used in `execSync(getent passwd $SUDO_USER)`)?

### 2. Self-Update Security
- Is the SHA256 verification in `update.ts` correct? Check for TOCTOU between download and verification, partial download corruption, and checksum file format parsing.
- Can the rollback mechanism leave the binary in a broken state?
- Is the binary URL construction safe from path traversal?

### 3. Error Handling & Graceful Degradation
- Are there any `await` calls without timeout or error handling that could hang forever?
- Do all `process.exit()` calls have appropriate cleanup (dangling Docker containers, partial file writes)?
- What happens if Docker daemon crashes mid-install? Is the state recoverable on re-run?
- Are all `catch {}` blocks handling errors appropriately, or are some silently swallowing important failures?

### 4. Concurrency & Race Conditions
- Are there any TOCTOU issues (checking file existence then reading/writing)?
- Can concurrent installer runs corrupt the `.env` file or data directories?
- Is the health check retry loop safe against resource exhaustion?

### 5. Secret Generation & Handling
- Are secrets generated with sufficient entropy? Check `crypto.getRandomValues()` usage.
- Are secrets accidentally logged or printed to stdout?
- Could `.env` merge logic accidentally expose or duplicate secrets?

### 6. Docker & System Interaction
- Is the compose command detection (`docker compose` vs `docker-compose` vs `sudo docker compose`) robust?
- Are there timeout values that are too short for slow systems (e.g., model download, large image pulls)?
- Does `nvidia-smi` parsing handle all real-world output formats?
- Is port checking via `ss`/`netstat` reliable? Does the regex catch IPv6 bindings?

### 7. Test Coverage Gaps
- Are there critical paths in the source code that have NO corresponding test?
- Are mock setups realistic? (e.g., do they mock at the right level, or do they allow real system calls to leak through?)
- Are edge cases tested? (empty .env, corrupt .env, Docker daemon unreachable, no network, disk full)

### 8. Code Quality & Maintainability
- Dead code, unused imports, or unreachable branches
- Functions with too many responsibilities
- Magic strings or numbers that should be constants
- Inconsistent error message formatting

## Output Format

For each finding, provide:

- **Severity**: CRITICAL / HIGH / MEDIUM / LOW
- **File**: path and line numbers
- **Category**: which focus area (1-8 above)
- **Description**: what the issue is
- **Impact**: what happens in production
- **Suggested Fix**: concrete code-level recommendation

Group findings by severity (CRITICAL first). End with:
- Total counts per severity
- Top 3 highest-priority fixes
- Overall production readiness assessment (READY / READY WITH CAVEATS / NOT READY)
