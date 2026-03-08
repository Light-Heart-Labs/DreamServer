# Dream Server Audit Punch List
**Auditor:** Claude Opus 4.6 | **Date:** 2026-02-17 | **Revision:** 2 (re-audit with fresh eyes)
**Scope:** Full codebase audit — V0 ship-readiness + architecture for scale (per MISSIONS.md)
**Method:** Architecture mapping → docker-compose/Dockerfile analysis → entrypoint audit → parallel deep-dive (5 agents) → security sweep → consolidation
**Files read:** 40+ source files across all subsystems | **Agents:** 6 parallel deep-dive audits

---

## Summary

| Severity | Count | Description |
|----------|-------|-------------|
| **Critical** | 27 | Blocks V0 launch — crashes, security holes, broken wiring |
| **High** | 32 | Should fix before V0 — reliability, correctness, hardening |
| **Medium** | 32 | Polish — UX, consistency, code quality |
| **Architecture** | 16 | Beyond V0 — scale readiness, plugin system, multi-tier |
| **Integration** | 8 | Product integration opportunities |
| **Total** | **115** | |

---

## Critical (Blocks V0)

### C1 — `dashboard-api/main.py:48` — Logger used before definition
`logger.warning(...)` is called at line 48 during module load, but `logger = logging.getLogger(__name__)` isn't defined until line 54. **Crashes on startup** if `DASHBOARD_API_KEY` env var is not set.
**Fix:** Move `logger = logging.getLogger(__name__)` above line 40, before the DASHBOARD_API_KEY block.

### C2 — `docker-compose.yml:634` — Hardcoded "default" password in TOKEN_MONITOR_DB
`TOKEN_MONITOR_DB` defaults to `postgresql://tokenspy:default@token-spy-db:5432/tokenspy`. The password `default` is a trivially-guessable credential that ships in the compose file.
**Fix:** Change to `${TOKEN_MONITOR_DB:?TOKEN_MONITOR_DB must be set in .env}` with no default, matching the pattern used for LIVEKIT keys.

### C3 — `privacy-shield-offline/pii_scrubber.py:48` — `id(self)` breaks token stability
Offline scrubber uses `id(self)` in token generation hash. `id()` changes between restarts and even between requests if the object is garbage-collected. PII tokens generated in one request will never match on restore, causing **PII to leak into responses as unresolved tokens**.
**Fix:** Use `secrets.token_hex(16)` stored as a session field (as done in the online version at `privacy-shield/pii_scrubber.py:27`). Add `import secrets`.

### C4 — `privacy-shield/requirements.txt` — Missing `cachetools` dependency
Both `privacy-shield/proxy.py:19` and `privacy-shield-offline/proxy.py:19` import `cachetools.TTLCache`, but neither `requirements.txt` includes `cachetools`. **Container will crash on startup** with `ModuleNotFoundError`.
**Fix:** Add `cachetools>=5.3.0` to both `privacy-shield/requirements.txt` and `privacy-shield-offline/requirements.txt`.

### C5 — `privacy-shield-offline/proxy.py:143-144` — Route ordering blocks health check
The catch-all `/{path:path}` route (lines 143-144) is defined **before** `/health` (line 239), `/stats` (line 254), and `/config` (line 271). FastAPI matches routes in definition order, so health checks hit the proxy handler (which requires auth), causing compose health checks to fail and the container to restart-loop.
**Fix:** Move `/health`, `/stats`, and `/config` route definitions above the catch-all `/{path:path}` routes.

### C6 — `privacy-shield/proxy.py:27` — API key logged in plaintext
When `SHIELD_API_KEY` is not set, the generated key is logged: `logging.warning("SHIELD_API_KEY not set. Generated temporary key: %s", SHIELD_API_KEY)`. This prints the full secret to stdout/container logs.
**Fix:** Remove the key value from the log message. Log only that a key was generated.

### C7 — `privacy-shield-offline/proxy.py:29` — Default API key is "not-needed"
When `SHIELD_API_KEY` is not set, the offline proxy defaults to `"not-needed"` — a fixed, guessable string. Any attacker who knows this default can authenticate.
**Fix:** Generate a random key with `secrets.token_urlsafe(32)` as the online version does, or require the env var.

### C8 — `agents/voice/agent_m4.py:303` — `agent.on("before_llm")` is not a valid SDK pattern
LiveKit Agents SDK `Agent` class does not have an `.on()` event emitter. This call silently fails (or throws `AttributeError`), so the M4 deterministic routing hook **never fires**. All utterances go to LLM, defeating the entire M4 layer.
**Fix:** LiveKit Agents SDK v1.x uses `AgentSession(before_llm_cb=...)` or method override. Override `before_llm` as a method on the Agent subclass (it already is at line 116), and pass it via the `AgentSession` constructor or use the correct SDK callback registration.

### C9 — `agents/voice/agent_m4.py:63 vs 228` — FLOWS_DIR shadowed with different defaults
Line 63: `FLOWS_DIR = os.getenv("FLOWS_DIR", os.path.join(os.path.dirname(__file__), "flows"))`
Line 228: `flows_dir = os.getenv("FLOWS_DIR", "/app/flows")`
The second definition shadows the module-level constant with a different default path. In Docker, `os.path.dirname(__file__)` resolves to `/app`, making them equivalent, but outside Docker they diverge. The real problem: the Dockerfile copies `flows/` but deterministic flow JSONs are in `deterministic/flows/`.
**Fix:** Use the module-level `FLOWS_DIR` constant consistently. Verify the Dockerfile copies flows to the expected path.

### C10 — `agents/voice/entrypoint.sh` vs `agent_m4.py` — LLM_URL vs LLM_BASE_URL mismatch
`entrypoint.sh` sets `LLM_URL` but `agent_m4.py:54` reads `LLM_BASE_URL`. The voice agent will silently fall back to `http://localhost:8000/v1` which doesn't exist inside Docker, causing **all LLM calls to fail**.
**Fix:** Align the env var names. Either the entrypoint should set `LLM_BASE_URL` or the agent should read `LLM_URL`.

### C11 — `dashboard/app.py:264` — `html.escape` shadowed by local variable
`html = []` at line 264 shadows the `html` module's `html.escape()` function. Any subsequent call to `html.escape()` in this scope will raise `AttributeError: 'list' object has no attribute 'escape'`, creating an **XSS vulnerability** in HTML rendering.
**Fix:** Rename the local variable to `html_parts` or `fragments`.

### C12 — `docker-compose.yml:558` — Unpinned TimescaleDB image
`timescale/timescaledb:latest-pg15` is unpinned. A breaking upstream change will silently enter production. TimescaleDB has had breaking changes between minor versions.
**Fix:** Pin to a specific version, e.g., `timescale/timescaledb:2.17.2-pg15`.

### C13 — `config/openclaw/openclaw-m1-sandbox.json` — Malformed JSON
File has duplicate nested `"agent"` key (lines 13-14) and duplicate `"gateway"` key (lines 10, 87). JSON parsers silently use the last value, meaning earlier config is lost.
**Fix:** Merge the duplicate keys into single definitions.

### C14 — `products/token-spy/schema/000_create_tokenspy.sql` — Shell variable in SQL
Uses `${POSTGRES_PASSWORD}` which PostgreSQL `docker-entrypoint-initdb.d` does NOT substitute in `.sql` files. The `CREATE ROLE` statement will fail or create a user with the literal string `${POSTGRES_PASSWORD}` as the password.
**Fix:** Rename to `.sh` extension and wrap SQL in `psql -v` calls, or use `POSTGRES_USER`/`POSTGRES_PASSWORD` env vars which are handled automatically by the entrypoint.

### C15 — `.env.example:73` — Variable interpolation doesn't work in Docker .env
`TOKEN_MONITOR_DB=postgresql://tokenspy:${TOKEN_SPY_DB_PASSWORD}@...` uses shell-style interpolation which Docker Compose `.env` files do NOT support. The literal string `${TOKEN_SPY_DB_PASSWORD}` becomes the password.
**Fix:** Instruct users to fill in the actual password value, or construct the connection string in the compose file using separate env vars.

### C16 — `dashboard/Dockerfile` — Builds wrong application
The Dockerfile builds the Python/FastAPI htmx dashboard (`app.py`), not the React SPA in `dashboard/src/`. The React app has no build step, no `npm install`, no bundling. The deployed "dashboard" is the legacy htmx prototype.
**Fix:** Either build the React SPA (add `npm ci && npm run build`) or remove the React source if the htmx version is intended for V0.

### C17 — `dashboard-api/main.py:927` — `api_key` parameter shadowed in voice_token
The `voice_token` endpoint parameter `api_key` shadows the security dependency's `api_key`, potentially allowing unauthenticated access or using wrong credentials for LiveKit token generation.
**Fix:** Rename the endpoint parameter to `livekit_api_key` or similar.

### C18 — Shell scripts — `dream-cli` chat has shell injection
User input from `dream-cli chat` is interpolated directly into a curl command without escaping. A user typing `"; rm -rf / #` as a chat message could execute arbitrary commands.
**Fix:** Use `--data-binary @-` with stdin piping or proper JSON escaping via `jq`.

### C19 — Shell scripts — `curl | sh` installer without checksum verification
`install.sh` downloads and executes scripts from the internet without verifying checksums or signatures. MITM attacks can inject arbitrary code.
**Fix:** Add SHA256 checksum verification after download, before execution.

### C20 — Shell scripts — Unsafe `.env` sourcing
Scripts source `.env` files directly with `source .env` or `. .env`. Malicious values in `.env` (e.g., `FOO=$(rm -rf /)`) execute as shell commands.
**Fix:** Parse `.env` with `grep -E '^[A-Z_]+=` and `export` individually, or use `env $(cat .env | grep -v '^#' | xargs)`.

### C21 — Shell scripts — `eval` in `validate.sh`
`validate.sh` uses `eval` on constructed strings. If any variable contains shell metacharacters, arbitrary code can execute.
**Fix:** Replace `eval` with direct command execution or arrays.

### C22 — `dashboard-api/agent_monitor.py` — Three `except: pass` blocks
Lines with bare `except: pass` silently swallow ALL exceptions including `KeyboardInterrupt` and `SystemExit`. If the database connection fails, metrics silently stop collecting with no indication.
**Fix:** Catch specific exceptions (`except (ConnectionError, TimeoutError) as e:`) and log them.

### C23 — `dashboard-api/agent_monitor.py:11,92` — Token Spy reads SQLite but Token Spy writes to TimescaleDB (PostgreSQL)
`agent_monitor.py` imports `sqlite3` and connects to `/data/token-spy/usage.db`. But `docker-compose.yml:506-569` wires Token Spy to TimescaleDB (PostgreSQL) on `token-spy-db:5432`. These are completely incompatible databases. **Token Spy metrics in the dashboard will always show zero** because the SQLite file doesn't exist.
**Fix:** Change `agent_monitor.py` to use `asyncpg` or `psycopg2` and connect to the TimescaleDB instance using the `TOKEN_MONITOR_DB` environment variable (which is already set as a PostgreSQL connection string in compose).

### C24 — `install.sh:791` — Image tags don't match docker-compose.yml
`install.sh` pulls `vllm/vllm-openai:latest` and `ghcr.io/open-webui/open-webui:main`, but `docker-compose.yml` pins `vllm/vllm-openai:v0.15.1` and `ghcr.io/open-webui/open-webui:v0.7.2`. The installer downloads wrong image tags; compose will re-pull the correct pinned versions, wasting bandwidth and time.
**Fix:** Use the same pinned tags in install.sh as in docker-compose.yml, or extract versions into variables shared between both files.

### C25 — `privacy-shield/proxy.py:67-83` — LRU cache uses raw PII text as cache keys
`CachedPrivacyShield` wraps `_scrub_impl` with `lru_cache(maxsize=CACHE_SIZE)` which stores **the raw PII text as dictionary keys in memory**. This directly undermines the privacy guarantee. The cache retains exact copies of PII strings (names, SSNs, emails) in process memory indefinitely.
**Fix:** Remove the LRU cache on PII scrubbing entirely, or hash the input before using as key and cache only the scrubbed output.

### C26 — `privacy-shield/proxy.py:133-213` — No SSE/streaming proxy support
The proxy reads the entire response body (`resp.content.decode('utf-8')`) before returning. LLM chat completions use SSE streaming by default. **Users will see no output until the entire response is generated**, defeating real-time chat UX. This is a fundamental V0 UX blocker.
**Fix:** Detect `text/event-stream` content-type and use `StreamingResponse` with per-chunk PII scrubbing.

### C27 — `install.sh:751` — LIVEKIT_API_KEY is hardcoded static string "dreamserver"
Every Dream Server installation gets the same LiveKit API key: `dreamserver`. If LiveKit is exposed on the network (it is — port 7880 is mapped), anyone who knows this default can join voice rooms.
**Fix:** Generate a random key like the other secrets: `LIVEKIT_API_KEY=$(openssl rand -hex 16)`.

---

## High (Should Fix Before V0)

### H1 — `dashboard/src/lib/api.ts` — Frontend sends no auth headers
The React dashboard API client doesn't include `Authorization: Bearer <token>` headers. All requests to dashboard-api will return 401 in production.
**Fix:** Add auth header injection from a stored API key or session token.

### H2 — `dashboard/app.py` — Hardcoded `localhost` URLs break in Docker
The htmx dashboard uses `http://localhost:3002` for API calls. Inside Docker, `localhost` refers to the container itself, not the host.
**Fix:** Use Docker service names or configure via environment variables.

### H3 — `privacy-shield/pii_scrubber.py:31` — Email regex includes literal pipe
`[A-Z|a-z]` matches uppercase, lowercase, AND the literal `|` character. This means `user@example.|om` would match as a valid email.
**Fix:** Change to `[A-Za-z]` (remove the pipe).

### H4 — `privacy-shield/pii_scrubber.py:34-44` — IPv4 regex matches invalid addresses
Pattern `\b(?:\d{1,3}\.){3}\d{1,3}\b` matches `999.999.999.999`. No octet range validation.
**Fix:** Add octet range validation: `(?:25[0-5]|2[0-4]\d|[01]?\d\d?)`.

### H5 — `privacy-shield/pii_scrubber.py:33` — SSN regex matches any 9-digit pattern
`\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b` matches phone numbers, zip+4 codes, dates, and other 9-digit sequences. Very high false positive rate.
**Fix:** Add context awareness (look for "SSN", "social security", "tax ID" nearby) or tighten the pattern.

### H6 — `privacy-shield/pii_scrubber.py:46` — Credit card has no Luhn validation
Pattern matches any 16-digit number. Order numbers, tracking numbers, and timestamps will be incorrectly flagged as credit cards.
**Fix:** Add Luhn checksum validation after regex match.

### H7 — `privacy-shield-offline/proxy.py:116-140` — `is_local_endpoint()` DNS bypass
Patterns like `^https?://10\.\d+\.\d+\.\d+` can be bypassed with DNS tricks. For example, `http://10.0.0.1.evil.com` matches the regex but resolves to an attacker-controlled server.
**Fix:** Parse the URL with `urllib.parse.urlparse()` and validate the resolved hostname, not the string pattern.

### H8 — `docker-compose.local.yml` / `docker-compose.hybrid.yml` — `network_mode: host` everywhere
All services use `network_mode: host`, exposing every port to the network. WebUI, n8n, and other services have no authentication.
**Fix:** Remove `network_mode: host` and use Docker bridge networking with explicit port mappings.

### H9 — `docker-compose.offline.yml` — Missing dashboard services
The offline compose file doesn't include dashboard or dashboard-api services. Users in offline mode have no management UI.
**Fix:** Add dashboard services to the offline compose file.

### H10 — `docker-compose.offline.yml` — Ollama health check uses unavailable binary
Health check runs `python3 -c "import urllib.request; ..."` but the Ollama image doesn't include Python. Health check always fails.
**Fix:** Use `curl` or a simple shell-based health check.

### H11 — `agents/voice/Dockerfile` — Copies wrong flows directory
`COPY flows/ /app/flows/` copies a top-level `flows/` dir, but deterministic flow JSONs live in `deterministic/flows/`. The FSM executor finds no flows and falls back to the hardcoded example.
**Fix:** Copy `deterministic/flows/` to `/app/flows/` or adjust `FLOWS_DIR`.

### H12 — `agents/voice/Dockerfile` — Missing ONNX model files
The DistilBERT ONNX classifier referenced by `QwenClassifier` requires model files that aren't included in the Docker image and aren't downloaded at build time.
**Fix:** Add model download step to Dockerfile or document the requirement.

### H13 — Multiple compose files — GPU resource conflicts
`vllm`, `whisper`, `tts`, and `voice-agent` all request GPU resources. On a single-GPU system (V0 Personal tier), they'll contend for the device. No GPU scheduling or allocation strategy.
**Fix:** Define GPU allocation strategy. Consider `NVIDIA_VISIBLE_DEVICES` per-service or sequential startup.

### H14 — `dashboard-api/main.py` — Model catalog mismatch
Hardcoded model catalog references models that may not match what vLLM is actually serving. No runtime validation.
**Fix:** Query the vLLM `/v1/models` endpoint at startup and validate against catalog.

### H15 — `dashboard-api/agent_monitor.py:200` — Dimensionally wrong throughput calc
Throughput calculation divides token count by elapsed time but the units don't match the label (claims tok/s but calculates incorrectly).
**Fix:** Review and correct the formula: `throughput = tokens / elapsed_seconds`.

### H16 — `dashboard/app.py` — Returns hardcoded mock agent data
Agent status endpoints return static mock data instead of querying actual agent state. Dashboard shows fabricated metrics.
**Fix:** Wire up to real agent monitoring or clearly label as "demo mode".

### H17 — Shell scripts — Orphan background processes on failure
Scripts launch background processes (downloads, health checks) that aren't cleaned up on script exit or error.
**Fix:** Add `trap cleanup EXIT` handlers that kill background PIDs.

### H18 — Shell scripts — Unquoted variable expansions
Multiple scripts use `$VAR` instead of `"$VAR"` in contexts where spaces or special characters in paths would cause word splitting and glob expansion.
**Fix:** Double-quote all variable expansions: `"$VAR"`.

### H19 — Shell scripts — `rm -rf` without safeguards
Backup/restore scripts use `rm -rf $DIR` with unquoted variables. If `$DIR` is empty or unset, this becomes `rm -rf /`.
**Fix:** Always use `"${DIR:?}"` to fail if unset, and quote the variable.

### H20 — Shell scripts — Non-atomic file writes
Config and state files are written directly (`echo > file`). A crash mid-write leaves corrupt files.
**Fix:** Write to a temp file and `mv` atomically: `echo > "$file.tmp" && mv "$file.tmp" "$file"`.

### H21 — `docker-compose.yml` — Voice agent health check will fail
Voice agent health check (line ~411) uses HTTP but the LiveKit agent doesn't expose an HTTP health server in the non-offline M4 agent.
**Fix:** Add a health endpoint to the voice agent or change to a process-based health check.

### H22 — `privacy-shield/proxy.py` + `pii_scrubber.py` — Not thread-safe
`pii_map` dict is mutated during `scrub()` and read during `restore()`. In async FastAPI with multiple concurrent requests sharing a session, this is a data race.
**Fix:** Use a `threading.Lock` around `pii_map` access or use session-level isolation.

### H23 — Multiple compose files — Deprecated `version` field
Several compose files use the `version: "3.x"` field which is deprecated in modern Docker Compose and ignored.
**Fix:** Remove the `version` field from all compose files.

### H24 — `dashboard-api/main.py` — Fuzzy model matching
Model matching uses substring/fuzzy logic that could match wrong models (e.g., "llama" matching "llama-guard" instead of "llama-3.1").
**Fix:** Use exact model ID matching or structured model registry.

### H25 — Privacy shield (both) — No name/address PII detection
The scrubber detects emails, phones, SSNs, IPs, API keys, and credit cards, but **not names or physical addresses** — arguably the most common PII in conversational AI.
**Fix:** Add name/address detection patterns or integrate a NER model (spaCy, Presidio) for V1.

### H26 — `dashboard-api/main.py` — Two competing dashboard implementations
Both `dashboard/` (htmx/FastAPI) and `dashboard/src/` (React/Vite) exist. Neither is fully functional. The Dockerfile builds the wrong one (htmx instead of React).
**Fix:** Choose one implementation for V0 and remove the other. Update Dockerfile accordingly.

### H27 — Shell scripts — Unsafe `xargs` usage
Scripts pipe to `xargs` without `-0` flag or `--no-run-if-empty`. Filenames with spaces or special characters will break. Empty input runs the command with no arguments.
**Fix:** Use `xargs -0` with `find -print0` or `xargs --no-run-if-empty`.

### H28 — Shell scripts — Missing `set -u` (nounset)
Most scripts don't use `set -u`, so unset variables silently expand to empty strings rather than failing. Combined with `rm -rf`, this is dangerous.
**Fix:** Add `set -euo pipefail` to all scripts.

### H29 — `agents/voice/deterministic/classifier.py:205-218` — Blocking I/O in async context
`QwenClassifier.predict()` uses synchronous `requests.Session().post()` with a 10-second timeout. This is called from the async LiveKit voice agent event loop via `adapter.handle_utterance()`. **Every utterance classification blocks the entire event loop** — voice latency spikes to 250ms+ per classification.
**Fix:** Make `predict()` async using `httpx.AsyncClient` or wrap with `asyncio.to_thread()`.

### H30 — `agents/voice/deterministic/classifier.py:151-158` — `requests` not in requirements.txt
`QwenClassifier` imports `requests` but it's not listed in `agents/voice/requirements.txt`. Works only if pulled in as a transitive dependency.
**Fix:** Add `requests>=2.31.0` to requirements.txt.

### H31 — `dashboard/templates/index.html:7-9` — External CDN resources without Subresource Integrity
htmx, Chart.js, and PicoCSS are loaded from CDNs (unpkg.com, jsdelivr.net) with no `integrity=` attribute. A CDN compromise can inject malicious code into the dashboard.
**Fix:** Add SRI hashes (`integrity="sha384-..."`) or self-host the assets.

### H32 — `docker-compose.offline.yml:447` — LiveKit API key defaults to "devkey"
`LIVEKIT_API_KEY=${LIVEKIT_API_KEY:-devkey}` uses a trivially guessable default. Combined with `network_mode: host`, anyone on the network can connect to LiveKit.
**Fix:** Use `:?` syntax to require the variable be set: `${LIVEKIT_API_KEY:?LIVEKIT_API_KEY must be set in .env}`.

---

## Medium (Polish)

### M1 — Privacy shield code duplication
`privacy-shield/` and `privacy-shield-offline/` share 90%+ of code (`pii_scrubber.py` is nearly identical). Bug fixes must be applied twice.
**Fix:** Extract shared code into a common package. Have online/offline variants import from it.

### M2 — `docker-compose.yml` — Token Spy uses `:latest` tag
Token Spy image uses `:latest` which is unpinned and non-reproducible.
**Fix:** Pin to a specific version tag.

### M3 — `docker-compose.offline.yml` — Missing dashboard entirely
Offline users get voice + LLM but no dashboard UI for management.
**Fix:** Include dashboard services in offline compose.

### M4 — Volume mount inconsistencies across compose files
Different compose files mount different paths for the same logical data. E.g., `./data` vs `dream-data` named volume.
**Fix:** Standardize volume mounts across all compose files.

### M5 — `dashboard-api/main.py` — Svelte references in React project
Code or comments reference Svelte components but the dashboard is React/Vite.
**Fix:** Remove stale Svelte references.

### M6 — `docker-compose.*.yml` — No auth on WebUI and n8n
Open WebUI and n8n have no authentication configured in local/hybrid compose files. Anyone on the network can access.
**Fix:** Configure authentication for all user-facing services.

### M7 — `privacy-shield-offline/proxy.py:170` — Error response leaks blocked URL
`"blocked_url": target_url` in the 403 response could reveal internal network topology.
**Fix:** Remove `blocked_url` from the response or make it opt-in via env var.

### M8 — `privacy-shield/proxy.py:200-213` — Error sanitization only covers two PII types
Error handler strips PII tokens and emails but not phone numbers, SSNs, IPs, credit cards, or API keys.
**Fix:** Apply the full PII scrubber to error messages before logging.

### M9 — `dashboard-api/main.py` — Silent `except` blocks in multiple endpoints
Several endpoints catch all exceptions and return generic errors, making debugging impossible.
**Fix:** Log exceptions with `logger.exception()` before returning generic responses.

### M10 — `agents/voice/agent_m4.py` — Deterministic flow-intent mismatch
Flow JSONs reference intents not in the classifier's taxonomy, and the classifier taxonomy includes intents with no corresponding flow. Causes silent fallback to LLM for "supported" intents.
**Fix:** Validate intent taxonomy against available flows at startup. Warn on mismatches.

### M11 — `agents/voice/deterministic/` — Entity extractors reference unregistered types
Extractors reference entity types not in the type registry. Extraction silently returns empty results.
**Fix:** Validate entity type references at load time.

### M12 — `docker-compose.yml` — Parent directory reference in Token Spy schema mount
`../products/token-spy/schema:/docker-entrypoint-initdb.d:ro` references outside the build context. Breaks if the compose file is used from a different working directory.
**Fix:** Copy schema into the dream-server directory or use a Dockerfile COPY step.

### M13 — `dashboard/Dockerfile` — Health check uses `wget` but image lacks it
Compose health check uses `wget` but `python:slim` doesn't include `wget`.
**Fix:** Use `curl` or Python-based health check (`python -c "import urllib.request; ..."`).

### M14 — `privacy-shield/proxy.py:149` — Authorization header forwarded to target
The proxy forwards all headers except `host` and `content-length`, including the original `Authorization` header. This leaks the shield's API key to the backend.
**Fix:** Also strip the original `Authorization` header before forwarding.

### M15 — All services — No structured logging
Services use unstructured text logging. No JSON output, no correlation IDs, no log levels in machine-readable format.
**Fix:** Add structured JSON logging for production use.

### M16 — `docker-compose.yml` — Missing `depends_on` for service startup order
Some services don't declare dependencies on their backends (e.g., dashboard-api doesn't depend_on vllm).
**Fix:** Add `depends_on` with `condition: service_healthy` where appropriate.

### M17 — Multiple services — Deprecated `@app.on_event("shutdown")`
FastAPI deprecated `on_event()` in favor of lifespan context managers.
**Fix:** Migrate to `@asynccontextmanager` lifespan pattern.

### M18 — Shell scripts — Hardcoded model names
Scripts reference specific model names (e.g., `Qwen/Qwen2.5-32B-Instruct-AWQ`) instead of using env vars.
**Fix:** Use `$LLM_MODEL` env var consistently.

### M19 — Shell scripts — Missing download timeouts
`curl` and `wget` calls don't specify `--max-time` or `--connect-timeout`, risking indefinite hangs.
**Fix:** Add `--connect-timeout 10 --max-time 300` to all download commands.

### M20 — Shell scripts — Race conditions in status checks
Scripts check service status and then act on it non-atomically. Service state can change between check and action.
**Fix:** Use retry loops with exponential backoff instead of check-then-act.

### M21 — Shell scripts — tar extraction without path validation
`tar xf` without `--strip-components` or path filtering allows path traversal attacks in archives.
**Fix:** Add `--strip-components=1` or validate extracted paths.

### M22 — `privacy-shield/proxy.py:81` — Cache only works for small texts
Cache threshold `len(text) < 1000` means most real prompts (which are typically >1000 chars) bypass the cache entirely. Cache is effectively useless.
**Fix:** Increase threshold or cache based on hash rather than full text.

### M23 — `dashboard-api/main.py` — Feature discovery returns static capabilities
Feature endpoints return hardcoded capability lists instead of checking what's actually deployed.
**Fix:** Probe running services and return real capabilities.

### M24 — `.env.example` — `N8N_USER` defaults to "admin"
Weak default credentials for n8n.
**Fix:** Require user to set credentials or generate random ones.

### M25 — `agents/voice/` — Two different deterministic routing implementations
Both `deterministic/` package and inline routing code exist. Different class signatures, different flow formats.
**Fix:** Consolidate to one implementation with one flow format.

### M26 — `dashboard-api/main.py` — Version check hits external URL
Version checking code calls out to an external endpoint. In offline mode, this blocks or errors.
**Fix:** Make version check conditional on network mode or use local-only version info.

### M27 — Privacy shield — No PII persistence across restarts
`pii_map` is in-memory only. On container restart, all PII mappings are lost. Any in-flight conversations will have unresolvable tokens in responses.
**Fix:** Persist `pii_map` to disk or a shared store for session continuity.

### M28 — `privacy-shield-offline/proxy.py:135-136` — Private subnet regex too broad
`^https?://192\.168\.` and `^https?://10\.` match any URL starting with these strings, including DNS names like `http://10.evil.com`. Same issue as H7 but for private subnets specifically.
**Fix:** Parse URL hostname and validate against CIDR ranges, not regex.

### M29 — `agents/voice/agent_m4.py:267` — Empty API key string
`api_key=os.environ.get("VLLM_API_KEY", "")` passes empty string. Some OpenAI-compatible APIs reject empty auth headers.
**Fix:** Use `"not-needed"` as default or omit the header when empty.

### M30 — `docker-compose.yml` — `read_only: true` may break services
Several services are marked `read_only: true` but may need to write temp files, logs, or PID files.
**Fix:** Add `tmpfs` mounts for `/tmp` and `/var/run` where needed.

### M31 — `privacy-shield/proxy.py:86-100` — Session key collision for NAT'd users
Session keys are derived from `request.client.host` when no `Authorization` header is present. All users behind the same NAT/VPN/proxy share one session, causing PII restoration to cross-contaminate between unrelated users.
**Fix:** Add a per-request session ID header (`X-Session-ID`) or use a cookie-based session identifier.

### M32 — `privacy-shield/proxy.py:103-113` — Health endpoint leaks internal config
`/health` is unauthenticated and returns `target_api`, `active_sessions`, and `cache_enabled`. Reveals backend topology.
**Fix:** Remove `target_api` from the health response, or restrict to basic `{"status": "ok"}`.

---

## Architecture & Scale (Beyond V0)

### A1 — No plugin/extension architecture
MISSIONS.md describes an extensible system with community plugins, but there's no plugin loading mechanism, no API versioning, no plugin manifest format.
**Recommendation:** Design plugin SDK with lifecycle hooks (init, health, shutdown), capability registration, and sandboxed execution.

### A2 — No hardware auto-detection
System doesn't detect available GPUs, RAM, CPU cores, or storage to automatically configure services. Users must manually edit env vars.
**Recommendation:** Add a hardware probe script that generates optimal `.env` values based on detected hardware. Map to MISSIONS.md scale tiers (Edge/Personal/Team/Enterprise).

### A3 — Single-GPU contention
V0 Personal tier targets single-GPU but vLLM, Whisper, TTS, and voice agent all claim GPU resources. No scheduler or time-sharing.
**Recommendation:** Implement GPU arbitration — either sequential service activation or model multiplexing in vLLM.

### A4 — No multi-node support
All compose files assume single-host. No service discovery, no distributed state, no cross-node networking.
**Recommendation:** Design overlay network config and service mesh for Team/Enterprise tiers.

### A5 — No model management lifecycle
Models are referenced by hardcoded strings. No download, validation, versioning, or garbage collection.
**Recommendation:** Build model registry with download tracking, checksum validation, and disk management.

### A6 — No backup/restore for all state
Backup scripts only handle some data. PII maps, agent state, flow contexts, and Token Spy data aren't covered.
**Recommendation:** Implement comprehensive backup covering all stateful services.

### A7 — No config validation layer
Configuration is spread across `.env`, compose files, JSON configs, and hardcoded values. No schema validation, no conflict detection.
**Recommendation:** Add a config validator that checks all sources for consistency at startup.

### A8 — No observability stack
No centralized logging, no metrics collection (beyond Token Spy), no distributed tracing, no alerting.
**Recommendation:** Add Prometheus metrics endpoints to all services. Consider Loki for logs.

### A9 — No graceful degradation
If vLLM is down, the entire system is unusable. No fallback to smaller models, no degraded-mode operation.
**Recommendation:** Implement health-based routing with fallback chains (vLLM → Ollama → cached responses).

### A10 — Privacy shield — No NER-based detection
Regex-only PII detection misses names, addresses, and contextual PII. For production privacy compliance, need ML-based NER.
**Recommendation:** Integrate spaCy or Microsoft Presidio for comprehensive PII detection.

### A11 — No rate limiting or abuse prevention
No rate limits on any service. A single client can monopolize GPU resources.
**Recommendation:** Add per-session rate limiting, at minimum for the voice and LLM proxy endpoints.

### A12 — No TLS/mTLS between services
All inter-service communication is unencrypted HTTP. On shared networks, traffic can be sniffed.
**Recommendation:** Add mTLS for inter-service communication, at minimum for services handling PII.

### A13 — No upgrade/migration path
No database migration tooling, no config migration between versions, no backwards compatibility guarantees.
**Recommendation:** Add Alembic/Flyway for DB migrations. Version all configs.

### A14 — Shell script ecosystem lacks shared library
30+ scripts with duplicated functions (logging, error handling, Docker checks). Bug fixes must be replicated across all.
**Recommendation:** Create `lib/common.sh` with shared functions and source it from all scripts.

### A15 — No CI/CD pipeline
No automated testing, no build pipeline, no deployment automation. All quality assurance is manual.
**Recommendation:** Add GitHub Actions for linting, testing, and Docker image builds.

### A16 — No Content-Security-Policy headers
Neither the nginx config nor the FastAPI backends set CSP headers. XSS attacks are not mitigated by browser policy. The dashboard loads scripts from external CDNs, making CSP especially important.
**Recommendation:** Add strict CSP headers to nginx and all FastAPI apps. Start with `default-src 'self'; script-src 'self' https://unpkg.com https://cdn.jsdelivr.net`.

---

## Product Integration Opportunities

### I1 — Token Spy ↔ Privacy Shield integration
Token Spy could monitor PII scrub rates and alert on anomalies (sudden spike in PII = possible data leak).

### I2 — Token Spy ↔ M4 Deterministic Layer metrics
Track deterministic hit rate, intent classification accuracy, and FSM execution latency in Token Spy for optimization.

### I3 — Dashboard ↔ Privacy Shield status
Dashboard should show real-time PII scrub statistics, active sessions, and cache hit rates.

### I4 — Hardware probe ↔ Compose profile selection
Auto-detect hardware and generate the optimal compose profile (edge/personal/team/enterprise).

### I5 — Model registry ↔ Bootstrap system
Bootstrap should use the model registry to download, verify, and manage models as a unified workflow.

### I6 — Voice agent ↔ Dashboard real-time metrics
Stream voice session metrics (latency, deterministic rate, active calls) to dashboard via WebSocket.

### I7 — n8n ↔ Dream Server API
Pre-built n8n workflow templates for common Dream Server tasks (model switching, backup, health alerts).

### I8 — Privacy Shield ↔ Compliance reporting
Generate PII handling reports for regulatory compliance (GDPR Article 30, CCPA).

---

## Estimated Effort

| Category | Items | Effort | Notes |
|----------|-------|--------|-------|
| **Critical fixes** | C1-C27 | **4-6 days** | Mostly one-line to one-file fixes. C8 (SDK callback), C16 (Dockerfile), C18-C21 (shell security), C23 (SQLite→Postgres), C26 (streaming proxy) need more care. |
| **High priority** | H1-H32 | **6-9 days** | H7 (URL validation), H13 (GPU strategy), H25 (NER), H26 (dashboard consolidation), H29 (async classifier) are the largest. |
| **Medium polish** | M1-M32 | **5-7 days** | M1 (code dedup), M15 (structured logging), M25 (routing consolidation) dominate. |
| **Architecture** | A1-A16 | **4-8 weeks** | These are V1+ features. A2 (auto-detect), A5 (model mgmt), A7 (config validation), A16 (CSP) should start first. |
| **Integration** | I1-I8 | **2-4 weeks** | Can be prioritized based on product roadmap. I1-I3 have the most immediate value. |

**Critical + High combined: ~10-15 developer-days.**
**Architecture & Scale: ~4-8 weeks (ongoing V1 work).**

### Recommended V0 Fix Order
1. **Crashers first:** C1, C4, C5, C23 (services won't start or data pipeline is broken)
2. **Security blockers:** C2, C6, C7, C25, C27, C18-C21, H8, H32 (exploitable in production)
3. **Broken wiring:** C8, C10, C16, C24, C26 (features that don't work at all)
4. **Data integrity:** C3, C14, C15 (data corruption/loss)
5. **Correctness:** C11, C12, C13, C17, C22, H1-H6, H29 (wrong behavior)
6. **Everything else:** remaining High → Medium in order

---

*End of audit. 115 items total. Prioritize crashers and security blockers for V0 gate.*
