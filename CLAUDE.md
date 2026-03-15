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

# Design Philosophy

> **Instruction to Agent:** Consult the following principles before generating any new classes, functions, or error handling logic.

## Principle Priority (Conflict Resolution)

When principles conflict, follow this priority order:

1. **Let It Crash** (highest) - Visibility of errors trumps all
2. **KISS** - Simplicity over elegance
3. **Pure Functions** - Determinism over convenience
4. **SOLID** (lowest) - Architecture can flex for simplicity

**Example Conflicts:**
- **KISS vs Pure Functions**: If dependency injection adds excessive ceremony for a simple utility, prefer the simpler impure version with a comment.
- **SOLID vs KISS**: If an abstraction has only 1 use case, keep it inline even if it violates OCP.
- **Let It Crash vs KISS**: A visible crash is NEVER simplified away with a silent fallback.

---

## CRITICAL: Let It Crash (Primary Principle)

**This is the most important design principle in this codebase. Read this section first before writing ANY error handling code.**

**CORE PRINCIPLE**: Embrace controlled failure. NO defensive programming. NO exponential backoffs. NO complex fallback chains. Let errors propagate and crash visibly.

### The Golden Rule

**Do NOT write `try/except`. Period.**

The default for every function is zero error handling. Errors propagate, crash visibly, and give a full stack trace. This is the correct behavior in virtually all cases.

### Why No try/except

| What try/except does | Why it's harmful |
|----------------------|------------------|
| Hides the root cause | Stack trace is lost or obscured |
| Creates silent failures | Bugs survive in production undetected |
| Adds code complexity | More branches, harder to reason about |
| Encourages defensive coding | Treats symptoms instead of fixing sources |
| Makes debugging harder | "It returned None" tells you nothing |

### What to Do Instead

**Bash**: The codebase already enforces `set -euo pipefail` at the top of every script. Errors kill the process and the trap handler in `install-core.sh` reports which phase failed:

```bash
# GOOD - install-core.sh: trap handler gives context on crash
export INSTALL_PHASE="init"
cleanup_on_error() {
    local exit_code=$?
    echo -e "\033[0;31m[ERROR] Installation failed during phase: ${INSTALL_PHASE}\033[0m"
    echo -e "\033[0;33m        Log file: ${LOG_FILE:-/tmp/dream-server-install.log}\033[0m"
    exit "$exit_code"
}
trap cleanup_on_error ERR

# GOOD - logging.sh: error() logs AND exits (never silent)
error() { echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"; exit 1; }

# GOOD - install-core.sh: unknown args crash immediately
*) error "Unknown option: $1" ;;
```

**Python**: FastAPI routers should raise `HTTPException` at boundaries, not swallow errors. Internal functions should let exceptions propagate.

```python
# GOOD - Validate at boundary, raise on bad input (routers/setup.py)
@router.post("/api/setup/persona")
async def setup_persona(request: PersonaRequest, api_key: str = Depends(verify_api_key)):
    if request.persona not in PERSONAS:
        raise HTTPException(status_code=400, detail=f"Invalid persona. Choose from: {list(PERSONAS.keys())}")
    # Proceed knowing inputs are valid -- no defensive checks downstream

# GOOD - Let internal operations crash with full trace
def get_disk_usage() -> DiskUsage:
    path = INSTALL_DIR if os.path.exists(INSTALL_DIR) else os.path.expanduser("~")
    total, used, free = shutil.disk_usage(path)
    return DiskUsage(...)  # No try/except -- if path is bad, crash visibly

# GOOD - Differentiate specific exception types at I/O boundary (helpers.py)
async def check_service_health(service_id: str, config: dict) -> ServiceStatus:
    try:
        session = await _get_aio_session()
        async with session.get(url) as resp:
            status = "healthy" if resp.status < 500 else "unhealthy"
    except asyncio.TimeoutError:
        status = "degraded"           # Reachable but slow
    except aiohttp.ClientConnectorError as e:
        if "Name or service not known" in str(e):
            status = "not_deployed"   # DNS failure = not deployed
        else:
            status = "down"           # Connection refused = down
    # Each exception type maps to a distinct, meaningful status
```

### FORBIDDEN Patterns

```python
# FORBIDDEN - Silent swallowing
try:
    do_something()
except Exception:
    pass

# FORBIDDEN - Exception as control flow
try:
    result = process_request(data)
except Exception:
    return None

# FORBIDDEN - Retry/backoff loops
for attempt in range(MAX_RETRIES):
    try:
        result = call_api()
        break
    except Exception:
        time.sleep(2 ** attempt)

# FORBIDDEN - Fallback chains
try:
    result = primary_method()
except Exception:
    try:
        result = fallback_method()
    except Exception:
        result = default_value
```

```bash
# FORBIDDEN - Silent error suppression in Bash
some_command || true          # Hides the failure -- why did it fail?
some_command 2>/dev/null      # Throws away the diagnostic

# GOOD - If you must tolerate failure, log it
some_command || warn "some_command failed (non-fatal), continuing"
```

### The ONLY Exception (Literally)

If a third-party library forces exception-based error handling (no error-return alternative exists), you may catch **one specific exception type** with a `# LET-IT-CRASH-EXCEPTION` annotation. This should be rare.

```python
# LET-IT-CRASH-EXCEPTION: IMPORT_GUARD - module may not be installed
try:
    import optional_module
except ImportError:
    optional_module = None
```

If you find yourself wanting to write more than this, **stop and redesign**. The function signature or the calling pattern is wrong.

### Code Review Rule

**Any `try/except` block in a PR requires explicit justification in the PR description.** The default review stance is: remove it.

### Testing Implications

Tests should crash on unexpected errors -- not swallow them. A test that catches exceptions to avoid failure is hiding bugs, not proving correctness.

- **Let assertions fail visibly.** A test that returns early on `None` instead of crashing tells you nothing about *why* the value was missing.
- **Don't mock away error conditions.** If a function crashes when given bad data, that crash IS the test result -- it reveals missing validation at the boundary.
- **Crash = signal.** An unexpected error in a test reveals integration issues, incorrect data assumptions, or missing upstream validation. Suppressing it delays the fix.

```python
# BAD - Test hides the real problem
def test_check_health():
    result = check_service_health("llama-server", config)
    if result is None:
        return  # Silently passes -- but WHY was result None?

# GOOD - Test crashes visibly, revealing the issue
def test_check_health():
    result = check_service_health("llama-server", config)
    assert result.status == "healthy"  # Crashes with clear message if wrong
```

---

## SOLID Principles

**CORE PRINCIPLE**: Design systems with high cohesion and low coupling for maintainability, testability, and extensibility.

### 1. Single Responsibility Principle (SRP)

> "A module should have one, and only one, reason to change"

Each component/function/class should do ONE thing well. Separate concerns: state management != business logic != data fetching.

**Bash — Installer phases**: Each of the 13 files in `installers/phases/` has a single responsibility (`01-preflight` checks prerequisites, `02-detection` detects GPU, `05-docker` installs Docker, etc.). Each lib module in `installers/lib/` is similarly focused: `logging.sh` only handles log output, `tier-map.sh` only maps tiers to models, `detection.sh` only detects hardware.

**Python — FastAPI routers**: Each router in `routers/` handles one domain: `setup.py` (wizard + personas), `features.py` (feature discovery), `privacy.py` (PII scrubbing), `agents.py` (agent management), `workflows.py` (n8n workflows), `updates.py` (version checks).

```python
# BAD - Function with multiple responsibilities
def handle_setup(request):
    validate_persona(request)      # Validation
    save_persona_to_disk(request)  # Persistence
    notify_dashboard(request)      # Side effect
    return format_response(request)# Formatting

# GOOD - Single responsibility per function (as in routers/setup.py)
# setup_persona() validates input then persists -- one reason to change
# get_active_persona_prompt() reads config -- one reason to change
# setup_status() checks state -- one reason to change
```

### 2. Open-Closed Principle (OCP)

> "Software entities should be open for extension, but closed for modification"

Add new features WITHOUT changing existing code. Use configuration and composition over modification.

**Extension manifest system**: To add a new service, create `extensions/services/<name>/manifest.yaml` + optional `compose.yaml`. The compose stack resolver (`scripts/resolve-compose-stack.sh`) auto-discovers and merges it. No registry code changes needed.

**Backend configs**: GPU backend behavior is driven by data in `config/backends/*.json` (nvidia.json, amd.json, apple.json, cpu.json). Adding a new backend means adding a new JSON file, not modifying existing code.

```bash
# BAD - Must modify code for each new tier
if [ "$TIER" = "1" ]; then model="qwen3-8b"
elif [ "$TIER" = "2" ]; then model="qwen3-8b"
elif [ "$TIER" = "NEW_THING" ]; then model="new-model"  # Code change every time!
fi

# GOOD - tier-map.sh: data-driven case statement, one place to extend
# To add a tier: add a new case branch in resolve_tier_config()
# All consumers (installer, CLI, dashboard) automatically pick it up
```

### 3. Liskov Substitution Principle (LSP)

> "Subtypes must be substitutable for their base types without altering correctness"

Implementations must honor the contract of the base type. Consumers shouldn't need to know the specific implementation.

**Contract violations to watch for:**
- **Strengthening preconditions**: Subtype rejects inputs the base type accepts
- **Weakening postconditions**: Subtype returns less or different data than the base type promises
- **Throwing unexpected errors**: Subtype crashes where the base type guarantees success

```python
# BAD - Subtype strengthens preconditions (violates LSP)
class ServiceChecker:
    def check(self, service_id: str, config: dict) -> ServiceStatus:
        """Check any service. Returns ServiceStatus with a status field."""
        ...

class RestrictedChecker(ServiceChecker):
    def check(self, service_id: str, config: dict) -> ServiceStatus:
        if service_id not in ("llama-server", "open-webui"):
            raise ValueError("Unsupported service")  # Caller didn't expect this!
        ...

# GOOD - Subtype honors the base contract
class RestrictedChecker(ServiceChecker):
    def check(self, service_id: str, config: dict) -> ServiceStatus:
        if service_id not in ("llama-server", "open-webui"):
            return ServiceStatus(id=service_id, status="unknown", ...)
        ...  # Same return shape, no surprise errors
```

### 4. Interface Segregation Principle (ISP)

> "Clients should not be forced to depend on interfaces they don't use"

Many specific interfaces > one general-purpose interface. Avoid "fat" interfaces that force implementing unused methods.

```python
# BAD - Function takes a god-object it barely uses
def format_service_summary(config: dict) -> str:
    # Only needs name and port -- but takes the entire config dict
    return f"{config['name']} on port {config['port']}"

# GOOD - Function takes only what it needs (minimal interface)
def format_service_summary(name: str, port: int) -> str:
    return f"{name} on port {port}"
```

**Modular routers vs monolithic API**: Each router in `routers/` exposes a focused interface. The features router doesn't know about setup logic; the privacy router doesn't know about workflows. Consumers import only the router they need.

### 5. Dependency Inversion Principle (DIP)

> "Depend on abstractions, not concretions"

High-level modules shouldn't depend on low-level implementation details. Enables testing and swapping implementations.

**Bash — Environment variable injection**: The installer reads `DREAM_MODE`, `OLLAMA_URL`, `LLM_MODEL` from the environment. CLI args (`--tier`, `--cloud`, `--offline`) override defaults. Nothing is hardcoded.

```bash
# install-core.sh: Dependencies injected via env + CLI args
DREAM_MODE="${DREAM_MODE:-local}"    # Overridable from environment
while [[ $# -gt 0 ]]; do
    case $1 in
        --tier) TIER="$2"; shift 2 ;;   # Injected at runtime
        --cloud) DREAM_MODE="cloud" ;;   # Swaps implementation
    esac
done
```

**Python — FastAPI `Depends()`**: Every protected endpoint uses `Depends(verify_api_key)` instead of inlining auth logic. The auth mechanism is swappable without touching any router.

```python
# routers/setup.py: auth injected via Depends(), not hardcoded
@router.get("/api/setup/status")
async def setup_status(api_key: str = Depends(verify_api_key)):
    ...

# routers/setup.py: LLM URL injected via environment
llm_url = os.environ.get("OLLAMA_URL", f"http://{_llm.get('host')}:{_llm.get('port')}")
model = os.environ.get("LLM_MODEL", "qwen3-coder-next")
```

### Code Review Checklist

- [ ] Does this component have a single, clear purpose? (SRP)
- [ ] Can I add new behavior without modifying existing code? (OCP)
- [ ] Can I substitute different implementations without breaking consumers? (LSP)
- [ ] Are interfaces minimal and focused? (ISP)
- [ ] Am I depending on abstractions, not concrete types? (DIP)

**BALANCE**: Don't over-engineer. For simple utilities, pragmatism > purity.

### SOLID and Testing

Each SOLID principle directly enables better testing:

| Principle | Testing Benefit |
|-----------|----------------|
| **SRP** | Small, focused units = small, focused tests. A function that does one thing needs one test suite, not a combinatorial explosion. |
| **OCP** | New behavior = new tests, not rewriting old ones. Existing tests stay green when you extend via configuration. |
| **LSP** | Write tests against the base contract, run them against every implementation. If a subtype passes the base tests, it's substitutable. |
| **ISP** | Narrow interfaces = fewer test doubles. A mock that implements 2 methods is easier to maintain than one that stubs 10. |
| **DIP** | Inject test doubles at construction. No monkey-patching, no test-only flags, no conditional imports. |

```python
# BAD - Hard dependency makes testing require real services
class HealthMonitor:
    def __init__(self):
        self.session = aiohttp.ClientSession()  # Can't swap in tests

    async def check(self, service_id: str) -> str:
        async with self.session.get(url) as resp:
            return "healthy" if resp.status < 500 else "unhealthy"

# GOOD - Injected dependency, trivially testable
class HealthMonitor:
    def __init__(self, session):  # Accept any session-like object
        self.session = session

    async def check(self, service_id: str) -> str:
        async with self.session.get(url) as resp:
            return "healthy" if resp.status < 500 else "unhealthy"

# In tests:
monitor = HealthMonitor(session=FakeSession(responses={"/health": 200}))
result = await monitor.check("llama-server")
assert result == "healthy"
```

---

## KISS Principle (Keep It Simple, Stupid)

**CORE PRINCIPLE**: Simplicity should be a key design goal; unnecessary complexity is the enemy of reliability and maintainability.

### Key Tenets

1. **Readable over Clever**: Code that any developer can understand beats elegant one-liners
2. **Explicit over Implicit**: Clear intentions trump magic behavior
3. **Do One Thing Well**: Avoid multi-purpose functions that try to handle every case
4. **Avoid Premature Abstraction**: Wait for 3+ use cases before abstracting
5. **Avoid Premature Optimization**: Simple first, optimize when proven necessary

### Decision Metric

> "Can the next engineer accurately predict behavior and modify it safely?"

### Objective KISS Metrics

| Metric | Threshold | Action |
|--------|-----------|--------|
| Function length | > 30 lines | Consider splitting |
| Cyclomatic complexity | > 15 | Refactor required |
| Nesting depth | > 3 levels | Flatten with early returns |
| Parameters | > 8 | Consider parameter object |
| File length | > 500 lines | Consider module split |

### Patterns

```bash
# BAD - Clever but fragile Bash one-liner
model=$(grep -oP '(?<=LLM_MODEL=).*' .env | sed 's/"//g' | tr '[:upper:]' '[:lower:]' | head -1)

# GOOD - KISS approach: clear steps
model_line=$(grep '^LLM_MODEL=' .env)
model="${model_line#LLM_MODEL=}"
model="${model//\"/}"
```

```python
# BAD - Clever but hard to understand
def process(d): return {k: v.strip().lower() for k, v in d.items() if v and isinstance(v, str) and not k.startswith('_')}

# GOOD - KISS approach
def normalize_config(data: dict[str, str]) -> dict[str, str]:
    result = {}
    for key, value in data.items():
        if key.startswith('_'):
            continue
        if not isinstance(value, str):
            continue
        result[key] = value.strip().lower()
    return result
```

### Anti-Patterns to Avoid

```python
# BAD - Unnecessary abstraction for single use case
class SingletonConfigManagerFactoryProvider:
    _instance = None
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

# GOOD - Just use the value directly (as in config.py)
SERVICES = {"llama-server": {"host": "llama-server", "port": 8080, ...}}

# BAD - Clever ternary chains
result = a if x else b if y else c if z else d

# GOOD - Clear conditionals
if x:
    result = a
elif y:
    result = b
elif z:
    result = c
else:
    result = d
```

---

## Pure Functions

**CORE PRINCIPLE**: Functions should be deterministic transformations with no side effects--output depends ONLY on inputs.

### Two Strict Requirements

1. **Deterministic**: Same inputs -> same output (always, every time)
2. **No Side Effects**: No mutation, no I/O, no external state modification

### What Makes a Function Impure

| Impurity | Example | How to Fix |
|----------|---------|------------|
| Global state | Reading/writing module-level variables | Pass as parameters |
| Mutation | Modifying input parameters | Return new objects |
| I/O operations | `print()`, file read/write, network | Push to boundaries |
| Non-determinism | `datetime.now()`, `random.random()` | Inject as parameters |
| External calls | Database queries, API calls | Push to boundaries |

### Pattern: Functional Core, Imperative Shell

The codebase already follows this. `installers/lib/` is the pure functional core (no side effects, no I/O). `installers/phases/` is the imperative shell (executes actions, calls external tools).

```bash
# PURE CORE - tier-map.sh: deterministic mapping, no side effects
tier_to_model() {
    local t="$1"
    case "$t" in
        CLOUD)      echo "anthropic/claude-sonnet-4-5-20250514" ;;
        NV_ULTRA)   echo "qwen3-coder-next" ;;
        SH_COMPACT) echo "qwen3-30b-a3b" ;;
        1|T1)       echo "qwen3-8b" ;;
        2|T2)       echo "qwen3-8b" ;;
        3|T3)       echo "qwen3-14b" ;;
        4|T4)       echo "qwen3-30b-a3b" ;;
        *)          echo "" ;;
    esac
}
# Same input -> same output, every time. No files read, no state changed.

# IMPERATIVE SHELL - phases/02-detection.sh uses the pure core
# detect_gpu()        → side effect: reads /proc, runs lspci
# resolve_tier_config  → pure core: maps tier to model config
```

```python
# PURE CORE - features.py: deterministic status calculation
def calculate_feature_status(feature: dict, services: list, gpu_info) -> dict:
    """Pure: takes data in, returns data out. No I/O, no state mutation."""
    gpu_vram_gb = (gpu_info.memory_total_mb / 1024) if gpu_info else 0
    vram_ok = gpu_vram_gb >= feature["requirements"].get("vram_gb", 0)
    # ... deterministic logic ...
    return {"id": feature["id"], "status": status, "enabled": is_enabled, ...}

# IMPERATIVE SHELL - features.py router endpoint
@router.get("/api/features")
async def api_features(api_key: str = Depends(verify_api_key)):
    """Impure shell: I/O at boundaries, pure core for logic."""
    gpu_info = get_gpu_info()                          # Side effect: reads GPU
    service_list = await get_all_services()             # Side effect: network
    # Pure core does the work:
    feature_statuses = [calculate_feature_status(f, service_list, gpu_info) for f in FEATURES]
    return {"features": feature_statuses, ...}
```

### Decision Rules

| Scenario | Recommendation |
|----------|----------------|
| Business logic / transformations | **Default to pure** |
| Validation rules | **Default to pure** |
| Data formatting / mapping | **Default to pure** |
| I/O operations (API calls, health checks) | Push to boundaries |
| Logging / metrics | Push to boundaries |
| Making it pure adds excessive wiring | Consider contained side effect |

### KISS + Pure Functions Synergy

Pure functions ARE KISS applied to function design--they eliminate the complexity of tracking state changes and side effects.

> **KISS is the goal (minimize complexity); pure functions are one of the best tools to achieve it--so long as the purity itself doesn't add more complexity than it removes.**

When purity increases ceremony (excessive parameter threading, complex type gymnastics), KISS may prefer a small, explicit side effect.

### Code Review Checklist

- [ ] Can this function be pure? (no external state needed?)
- [ ] Are side effects pushed to boundaries?
- [ ] Would making this pure add more complexity than it removes?
- [ ] Is the simplest solution also the correct one?
- [ ] Can the next engineer predict behavior and modify safely?

## Key File Paths

- Tier mapping logic: `dream-server/installers/lib/tier-map.sh`
- GPU detection: `dream-server/installers/lib/detection.sh`
- Service manifests: `dream-server/extensions/services/*/manifest.yaml`
- Compose stack resolver: `dream-server/scripts/resolve-compose-stack.sh`
- Environment schema: `dream-server/.env.schema.json`
- Environment example: `dream-server/.env.example`
