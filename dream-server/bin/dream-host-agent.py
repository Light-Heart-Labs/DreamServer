#!/usr/bin/env python3
"""DreamServer Host Agent — manages extension containers from the host."""

import argparse
import atexit
import collections
import json
import logging
import os
import platform
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from socketserver import ThreadingMixIn

VERSION = "1.0.0"
SERVICE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
MAX_BODY = 4096
SUBPROCESS_TIMEOUT_START = 600  # 10 min — image pulls can be slow
SUBPROCESS_TIMEOUT_STOP = 120   # 2 min — stop should be fast
logger = logging.getLogger("dream-host-agent")

# Hardcoded fallback — used when core-service-ids.json is missing or unreadable.
# Prevents fail-open: without this, a missing JSON file would allow anyone with
# the API key to stop core services like llama-server or dashboard-api.
_FALLBACK_CORE_IDS = frozenset({
    "dashboard-api", "dashboard", "llama-server", "open-webui",
    "litellm", "langfuse", "n8n", "openclaw", "opencode",
    "perplexica", "searxng", "qdrant", "tts", "whisper",
    "embeddings", "token-spy", "comfyui", "ape", "privacy-shield",
})

INSTALL_DIR: Path = Path()
AGENT_API_KEY: str = ""
GPU_BACKEND: str = "nvidia"
TIER: str = "1"
CORE_SERVICE_IDS: set = set()
USER_EXTENSIONS_DIR: Path = Path()

# Per-service locks to prevent concurrent start+stop races on the same service
_service_locks: dict[str, threading.Lock] = collections.defaultdict(threading.Lock)

# Model download state — only one download at a time
_model_download_lock = threading.Lock()
_model_download_thread: threading.Thread | None = None
_model_download_proc: subprocess.Popen | None = None
_model_download_cancel = threading.Event()
# Model activation lock — prevent concurrent .env writes and Docker restarts
_model_activate_lock = threading.Lock()


def load_env(env_path: Path) -> dict:
    """Parse .env file, return dict of key=value pairs."""
    env = {}
    if not env_path.exists():
        return env
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, val = line.partition("=")
            env[key.strip()] = val.strip().strip("'\"")
    return env


def load_core_service_ids(config_path: Path) -> set:
    if not config_path.exists():
        logger.warning("core-service-ids.json not found at %s — using hardcoded fallback", config_path)
        return set(_FALLBACK_CORE_IDS)
    try:
        with open(config_path, encoding="utf-8") as f:
            ids = json.load(f)
        return set(ids) if isinstance(ids, list) else set(_FALLBACK_CORE_IDS)
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to read core-service-ids.json: %s — using fallback", e)
        return set(_FALLBACK_CORE_IDS)


def resolve_compose_flags() -> list:
    script = INSTALL_DIR / "scripts" / "resolve-compose-stack.sh"
    if not script.exists():
        raise RuntimeError(f"resolve-compose-stack.sh not found at {script}")
    result = subprocess.run(
        ["bash", str(script), "--script-dir", str(INSTALL_DIR),
         "--tier", TIER, "--gpu-backend", GPU_BACKEND],
        capture_output=True, text=True, check=True,
        cwd=str(INSTALL_DIR), timeout=30,
    )
    return result.stdout.strip().split()


def _precreate_data_dirs(service_id: str):
    """Pre-create data directories for an extension with correct ownership."""
    ext_dir = USER_EXTENSIONS_DIR / service_id
    compose_path = ext_dir / "compose.yaml"
    if not compose_path.exists():
        return
    try:
        import yaml
        data = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
    except ImportError:
        # PyYAML not available — skip pre-creation
        logger.debug("PyYAML not available, skipping data dir pre-creation for %s", service_id)
        return
    except Exception as e:
        logger.debug("Failed to parse compose.yaml for %s: %s", service_id, e)
        return
    if not isinstance(data, dict):
        return
    for svc_name, svc_def in data.get("services", {}).items():
        if not isinstance(svc_def, dict):
            continue
        uid = None
        user_field = svc_def.get("user")
        if user_field:
            user_str = str(user_field).split(":")[0]
            m = re.match(r'\$\{[^:}]+:-(\d+)\}', user_str)
            if m:
                uid = int(m.group(1))
            elif user_str.isdigit():
                uid = int(user_str)
        volumes = svc_def.get("volumes", [])
        if not isinstance(volumes, list):
            continue
        for vol in volumes:
            vol_str = str(vol).split(":")[0]
            if vol_str.startswith("./data/") or vol_str.startswith("data/"):
                dir_path = (INSTALL_DIR / vol_str.lstrip("./")).resolve()
                try:
                    dir_path.relative_to(INSTALL_DIR.resolve())
                except ValueError:
                    logger.warning("Skipping out-of-tree volume path in %s: %s", service_id, vol_str)
                    continue
                try:
                    dir_path.mkdir(parents=True, exist_ok=True)
                    if uid is not None and os.getuid() == 0:
                        os.chown(str(dir_path), uid, uid)
                except OSError as e:
                    logger.warning("Failed to pre-create %s: %s", dir_path, e)


def docker_compose_action(service_id: str, action: str) -> tuple:
    flags = resolve_compose_flags()
    if action == "start":
        _precreate_data_dirs(service_id)
        cmd = ["docker", "compose"] + flags + ["up", "-d", service_id]
    elif action == "stop":
        cmd = ["docker", "compose"] + flags + ["stop", service_id]
    else:
        return False, f"Unknown action: {action}"
    timeout = SUBPROCESS_TIMEOUT_START if action == "start" else SUBPROCESS_TIMEOUT_STOP
    try:
        result = subprocess.run(
            cmd, cwd=str(INSTALL_DIR),
            capture_output=True, text=True, timeout=timeout,
        )
        return (True, "") if result.returncode == 0 else (False, result.stderr[:500])
    except subprocess.TimeoutExpired:
        return False, f"Docker compose operation timed out ({timeout}s)"


def _parse_mem_value(s: str) -> float:
    """Parse Docker memory string like '256MiB' or '4GiB' to MB."""
    s = s.strip()
    multipliers = {"TiB": 1024*1024, "GiB": 1024, "MiB": 1, "KiB": 1/1024, "B": 1/(1024*1024)}
    for suffix, mult in multipliers.items():
        if s.endswith(suffix):
            try:
                return float(s[:-len(suffix)].strip()) * mult
            except ValueError:
                return 0.0
    return 0.0


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_response(handler, code: int, body: dict):
    payload = json.dumps(body).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def check_auth(handler) -> bool:
    auth = handler.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        json_response(handler, 401, {"error": "Authorization header required"})
        return False
    if not secrets.compare_digest(auth[7:], AGENT_API_KEY):
        json_response(handler, 403, {"error": "Invalid API key"})
        return False
    return True


def read_json_body(handler) -> dict | None:
    try:
        length = int(handler.headers.get("Content-Length", 0))
    except (ValueError, TypeError):
        json_response(handler, 400, {"error": "Invalid Content-Length"})
        return None
    if length <= 0:
        json_response(handler, 400, {"error": "Request body required"})
        return None
    try:
        return json.loads(handler.rfile.read(min(length, MAX_BODY)))
    except (json.JSONDecodeError, UnicodeDecodeError):
        json_response(handler, 400, {"error": "Invalid JSON"})
        return None


def validate_service_id(handler, body: dict) -> str | None:
    sid = body.get("service_id", "")
    if not isinstance(sid, str) or not SERVICE_ID_RE.match(sid):
        json_response(handler, 400, {"error": "Invalid service_id"})
        return None
    if sid in CORE_SERVICE_IDS:
        json_response(handler, 403, {"error": f"Cannot manage core service: {sid}"})
        return None
    # Verify the service_id maps to an actual installed extension
    ext_dir = USER_EXTENSIONS_DIR / sid
    manifest_exists = any((ext_dir / n).exists() for n in ("manifest.yaml", "manifest.yml", "manifest.json"))
    if not ext_dir.is_dir() or not manifest_exists:
        json_response(handler, 404, {"error": f"Extension not found: {sid}"})
        return None
    return sid


def _resolve_container_name(service_id: str) -> str:
    """Resolve actual container name via Docker Compose labels.

    Falls back to dream-{service_id} convention if label lookup fails.
    """
    try:
        result = subprocess.run(
            ["docker", "ps", "--filter",
             f"label=com.docker.compose.service={service_id}",
             "--filter", "label=com.docker.compose.project=dream-server",
             "--format", "{{.Names}}"],
            capture_output=True, text=True, timeout=5,
        )
        names = result.stdout.strip().splitlines()
        if names:
            return names[0]
    except (subprocess.TimeoutExpired, OSError):
        pass
    return f"dream-{service_id}"


class AgentHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        logger.info(fmt, *args)

    def do_GET(self):
        if self.path == "/health":
            json_response(self, 200, {"status": "ok", "version": VERSION})
        elif self.path == "/v1/service/stats":
            self._handle_service_stats()
        elif self.path == "/v1/model/list":
            self._handle_model_list()
        elif self.path == "/v1/model/status":
            self._handle_model_status()
        else:
            json_response(self, 404, {"error": "Not found"})

    def _handle_service_stats(self):
        """Return CPU/memory stats for all Dream-managed containers."""
        if not check_auth(self):
            return

        try:
            result = subprocess.run(
                ["docker", "stats", "--no-stream",
                 "--format", '{"name":"{{.Name}}","cpu":"{{.CPUPerc}}","mem_usage":"{{.MemUsage}}","mem_percent":"{{.MemPerc}}","pids":"{{.PIDs}}"}'],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 0:
                logger.warning("docker stats returned non-zero: %s", result.stderr[:200] if result.stderr else "")

            containers = []
            for line in result.stdout.strip().splitlines():
                if not line.strip():
                    continue
                try:
                    raw = json.loads(line)
                except json.JSONDecodeError:
                    continue

                name = raw.get("name", "")
                if not name.startswith("dream-"):
                    continue

                cpu_str = raw.get("cpu", "0%").rstrip("%")
                try:
                    cpu_percent = float(cpu_str)
                except ValueError:
                    cpu_percent = 0.0

                mem_parts = raw.get("mem_usage", "0B / 0B").split("/")
                mem_used_mb = _parse_mem_value(mem_parts[0].strip()) if len(mem_parts) >= 1 else 0
                mem_limit_mb = _parse_mem_value(mem_parts[1].strip()) if len(mem_parts) >= 2 else 0

                mem_pct_str = raw.get("mem_percent", "0%").rstrip("%")
                try:
                    mem_percent = float(mem_pct_str)
                except ValueError:
                    mem_percent = 0.0

                service_id = name.removeprefix("dream-")

                try:
                    pids = int(raw.get("pids", "0") or "0")
                except (ValueError, TypeError):
                    pids = 0

                containers.append({
                    "service_id": service_id,
                    "container_name": name,
                    "cpu_percent": round(cpu_percent, 1),
                    "memory_used_mb": round(mem_used_mb),
                    "memory_limit_mb": round(mem_limit_mb),
                    "memory_percent": round(mem_percent, 1),
                    "pids": pids,
                })

            json_response(self, 200, {
                "containers": containers,
                "timestamp": _iso_now(),
            })
        except subprocess.TimeoutExpired:
            json_response(self, 503, {"error": "docker stats timed out"})
        except Exception as exc:
            json_response(self, 500, {"error": f"Failed to fetch stats: {exc}"})

    def do_POST(self):
        if self.path in ("/v1/extension/start", "/v1/extension/stop"):
            action = "start" if self.path.endswith("/start") else "stop"
            self._handle_extension(action)
        elif self.path == "/v1/extension/logs":
            self._handle_logs()
        elif self.path == "/v1/extension/setup-hook":
            self._handle_setup_hook()
        elif self.path == "/v1/service/logs":
            self._handle_service_logs()
        elif self.path == "/v1/model/download":
            self._handle_model_download()
        elif self.path == "/v1/model/download/cancel":
            self._handle_model_download_cancel()
        elif self.path == "/v1/model/activate":
            self._handle_model_activate()
        elif self.path == "/v1/model/delete":
            self._handle_model_delete()
        else:
            json_response(self, 404, {"error": "Not found"})

    def _handle_extension(self, action: str):
        if not check_auth(self):
            return
        body = read_json_body(self)
        if body is None:
            return
        service_id = validate_service_id(self, body)
        if service_id is None:
            return
        logger.info("%s extension: %s", action, service_id)
        lock = _service_locks[service_id]
        if not lock.acquire(blocking=False):
            json_response(self, 409, {"error": f"Operation already in progress for {service_id}"})
            return
        try:
            ok, err = docker_compose_action(service_id, action)
        except RuntimeError as exc:
            json_response(self, 500, {"error": str(exc)})
            return
        except subprocess.CalledProcessError as exc:
            json_response(self, 500, {"error": f"Compose resolution failed: {exc.stderr[:300]}"})
            return
        finally:
            lock.release()
        if ok:
            json_response(self, 200, {"status": "ok", "service_id": service_id, "action": action})
        else:
            json_response(self, 503 if "timed out" in err else 500, {"error": err})


    def _handle_logs(self):
        if not check_auth(self):
            return
        body = read_json_body(self)
        if body is None:
            return
        service_id = validate_service_id(self, body)
        if service_id is None:
            return
        try:
            tail = min(max(int(body.get("tail", 100)), 1), 500)
        except (ValueError, TypeError):
            tail = 100
        try:
            # Use docker logs directly (faster than docker compose logs, no flag resolution needed)
            container_name = f"dream-{service_id}"
            cmd = ["docker", "logs", "--tail", str(tail), container_name]
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=5,
            )
            # Handle container not yet created (e.g. during image pull)
            if result.returncode != 0 and "no such container" in (result.stderr or "").lower():
                json_response(self, 200, {
                    "service_id": service_id,
                    "logs": "Container is starting up — logs will appear once it is running.",
                    "lines": 0,
                })
                return
            # docker logs writes to stderr for some containers
            output = result.stdout or result.stderr or ""
            json_response(self, 200, {
                "service_id": service_id,
                "logs": output[-50000:],
                "lines": tail,
            })
        except subprocess.TimeoutExpired:
            json_response(self, 503, {"error": "Log fetch timed out"})
        except Exception as exc:
            json_response(self, 500, {"error": f"Failed to fetch logs: {exc}"})


    def _handle_service_logs(self):
        """Read-only log access for ANY service (core + extensions).

        Unlike _handle_logs() which uses validate_service_id() and blocks
        core services, this endpoint only validates the service_id format.
        """
        if not check_auth(self):
            return
        body = read_json_body(self)
        if body is None:
            return

        sid = body.get("service_id", "")
        if not isinstance(sid, str) or not SERVICE_ID_RE.match(sid):
            json_response(self, 400, {"error": "Invalid service_id"})
            return

        try:
            tail = min(max(int(body.get("tail", 100)), 1), 500)
        except (ValueError, TypeError):
            tail = 100

        container_name = _resolve_container_name(sid)

        try:
            result = subprocess.run(
                ["docker", "logs", "--tail", str(tail), container_name],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode != 0 and "no such container" in (result.stderr or "").lower():
                json_response(self, 200, {
                    "service_id": sid,
                    "container_name": container_name,
                    "logs": "Container is not running.",
                    "lines": 0,
                })
                return
            if result.returncode != 0:
                json_response(self, 500, {"error": f"docker logs failed: {(result.stderr or '')[:500]}"})
                return
            output = result.stdout or result.stderr or ""
            json_response(self, 200, {
                "service_id": sid,
                "container_name": container_name,
                "logs": output[-50000:],
                "lines": tail,
            })
        except subprocess.TimeoutExpired:
            json_response(self, 503, {"error": "Log fetch timed out"})
        except Exception as exc:
            json_response(self, 500, {"error": f"Failed to fetch logs: {exc}"})


    def _handle_setup_hook(self):
        if not check_auth(self):
            return
        body = read_json_body(self)
        if body is None:
            return
        service_id = validate_service_id(self, body)
        if service_id is None:
            return

        # Read manifest to find setup_hook field
        ext_dir = USER_EXTENSIONS_DIR / service_id
        manifest_path = None
        for name in ("manifest.yaml", "manifest.yml"):
            candidate = ext_dir / name
            if candidate.exists():
                manifest_path = candidate
                break
        if manifest_path is None:
            json_response(self, 404, {"error": f"No manifest found for {service_id}"})
            return

        try:
            import yaml
            manifest = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))
        except ImportError:
            json_response(self, 500, {"error": "PyYAML not available on host"})
            return
        except (OSError, yaml.YAMLError) as exc:
            json_response(self, 500, {"error": f"Failed to read manifest: {exc}"})
            return

        if not isinstance(manifest, dict):
            json_response(self, 404, {"error": "Invalid manifest format"})
            return
        service_def = manifest.get("service", {})
        if not isinstance(service_def, dict):
            json_response(self, 404, {"error": "Invalid manifest: missing service section"})
            return
        setup_hook = service_def.get("setup_hook", "")
        if not isinstance(setup_hook, str) or not setup_hook:
            json_response(self, 404, {"error": f"No setup_hook defined for {service_id}"})
            return

        # Security: resolve hook path and verify it stays inside ext_dir
        hook_path = (ext_dir / setup_hook).resolve()
        try:
            hook_path.relative_to(ext_dir.resolve())
        except ValueError:
            logger.warning("Path traversal attempt in setup_hook for %s: %s", service_id, setup_hook)
            json_response(self, 400, {"error": "setup_hook path escapes extension directory"})
            return
        if not hook_path.is_file():
            json_response(self, 404, {"error": f"setup_hook file not found: {setup_hook}"})
            return

        logger.info("Running setup_hook for %s: %s", service_id, hook_path)
        try:
            result = subprocess.run(
                ["bash", str(hook_path), str(INSTALL_DIR), GPU_BACKEND],
                cwd=str(ext_dir),
                capture_output=True, text=True, timeout=SUBPROCESS_TIMEOUT_STOP,
            )
            if result.returncode != 0:
                logger.error("setup_hook failed for %s (exit %d): %s",
                             service_id, result.returncode, result.stderr[:500])
                json_response(self, 500, {
                    "error": f"setup_hook exited with code {result.returncode}",
                    "stderr": result.stderr[:500],
                })
                return
        except subprocess.TimeoutExpired:
            json_response(self, 500, {"error": "setup_hook timed out (120s)"})
            return

        logger.info("setup_hook completed for %s", service_id)
        json_response(self, 200, {"status": "ok", "service_id": service_id})


    # ── Model management handlers ──

    def _handle_model_list(self):
        """Return model library catalog + on-disk GGUFs + active model."""
        if not check_auth(self):
            return
        try:
            models_dir = INSTALL_DIR / "data" / "models"
            library_path = INSTALL_DIR / "config" / "model-library.json"
            env_path = INSTALL_DIR / ".env"

            # Load library
            library = []
            if library_path.exists():
                try:
                    library = json.loads(library_path.read_text(encoding="utf-8")).get("models", [])
                except (json.JSONDecodeError, OSError):
                    pass

            # Scan downloaded GGUFs
            downloaded = {}
            if models_dir.is_dir():
                for f in models_dir.iterdir():
                    if f.is_file() and f.suffix == ".gguf" and not f.name.endswith(".part"):
                        try:
                            downloaded[f.name] = f.stat().st_size
                        except OSError:
                            pass

            # Active model from .env
            active_gguf = ""
            if env_path.exists():
                env = load_env(env_path)
                active_gguf = env.get("GGUF_FILE", "")

            json_response(self, 200, {
                "library": library,
                "downloaded": downloaded,
                "active_gguf": active_gguf,
            })
        except Exception as exc:
            json_response(self, 500, {"error": f"Failed to list models: {exc}"})

    def _handle_model_status(self):
        """Return current model download progress."""
        if not check_auth(self):
            return
        status_path = INSTALL_DIR / "data" / "model-download-status.json"
        if not status_path.exists():
            json_response(self, 200, {"status": "idle"})
            return
        try:
            data = json.loads(status_path.read_text(encoding="utf-8"))
            json_response(self, 200, data)
        except (json.JSONDecodeError, OSError):
            json_response(self, 200, {"status": "idle"})

    def _handle_model_download(self):
        """Start async model download. Only one download at a time."""
        global _model_download_thread
        if not check_auth(self):
            return
        body = read_json_body(self)
        if body is None:
            return

        gguf_file = body.get("gguf_file", "")
        gguf_url = body.get("gguf_url", "")
        gguf_sha256 = body.get("gguf_sha256", "")

        if not gguf_file or not gguf_url:
            json_response(self, 400, {"error": "gguf_file and gguf_url are required"})
            return

        # Validate against library (prevent arbitrary URL downloads)
        library_path = INSTALL_DIR / "config" / "model-library.json"
        allowed = False
        if library_path.exists():
            try:
                lib = json.loads(library_path.read_text(encoding="utf-8"))
                for m in lib.get("models", []):
                    if m.get("gguf_file") == gguf_file and m.get("gguf_url") == gguf_url:
                        allowed = True
                        break
            except (json.JSONDecodeError, OSError):
                pass
        if not allowed:
            json_response(self, 403, {"error": "Model not in library catalog"})
            return

        models_dir = INSTALL_DIR / "data" / "models"
        target = (models_dir / gguf_file).resolve()
        if not target.is_relative_to(models_dir.resolve()):
            json_response(self, 400, {"error": "Invalid file path"})
            return
        if target.exists():
            json_response(self, 200, {"status": "already_downloaded"})
            return

        # Check for concurrent download
        with _model_download_lock:
            if _model_download_thread is not None and _model_download_thread.is_alive():
                json_response(self, 409, {"error": "Another download is in progress"})
                return

            _model_download_cancel.clear()

            def _download():
                global _model_download_proc
                status_path = INSTALL_DIR / "data" / "model-download-status.json"
                part_file = models_dir / f"{gguf_file}.part"
                started_at = ""
                try:
                    models_dir.mkdir(parents=True, exist_ok=True)
                    # Write initial status with startedAt
                    started_at = _iso_now()
                    _write_model_status(status_path, "downloading", gguf_file, 0, 0, started_at=started_at)

                    # Get total size — take the LAST Content-Length header (HuggingFace redirects)
                    total_bytes = 0
                    try:
                        head_result = subprocess.run(
                            ["curl", "-sI", "-L", "--connect-timeout", "10", gguf_url],
                            capture_output=True, text=True, timeout=30,
                        )
                        for line in head_result.stdout.splitlines():
                            if line.lower().startswith("content-length:"):
                                total_bytes = int(line.split(":", 1)[1].strip())
                    except (subprocess.TimeoutExpired, ValueError):
                        pass

                    # Download with retry + cancel support
                    success = False
                    for attempt in range(1, 4):
                        if _model_download_cancel.is_set():
                            break
                        if attempt > 1:
                            logger.info("Model download retry %d/3", attempt)
                            import time
                            time.sleep(5)
                        proc = subprocess.Popen(
                            ["curl", "-fSL", "-C", "-", "--connect-timeout", "30",
                             "-o", str(part_file), gguf_url],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                        )
                        _model_download_proc = proc
                        # Poll part file size for real-time progress updates
                        while proc.poll() is None:
                            if _model_download_cancel.is_set():
                                proc.kill()
                                proc.wait(timeout=5)
                                break
                            import time
                            time.sleep(2)
                            try:
                                current_bytes = part_file.stat().st_size if part_file.exists() else 0
                            except OSError:
                                current_bytes = 0
                            _write_model_status(status_path, "downloading", gguf_file, current_bytes, total_bytes, started_at=started_at)
                        _model_download_proc = None
                        if _model_download_cancel.is_set():
                            part_file.unlink(missing_ok=True)
                            _write_model_status(status_path, "cancelled", gguf_file, 0, 0, "Download cancelled by user", started_at=started_at)
                            logger.info("Model download cancelled: %s", gguf_file)
                            return
                        proc.communicate(timeout=10)
                        if proc.returncode == 0:
                            part_file.rename(target)
                            success = True
                            break
                        current = part_file.stat().st_size if part_file.exists() else 0
                        _write_model_status(status_path, "downloading", gguf_file, current, total_bytes, f"Retry {attempt}/3", started_at=started_at)

                    if not success and not _model_download_cancel.is_set():
                        part_file.unlink(missing_ok=True)
                        _write_model_status(status_path, "failed", gguf_file, 0, total_bytes, "Download failed after 3 attempts", started_at=started_at)
                        return

                    # Verify SHA256 if provided
                    if gguf_sha256:
                        _write_model_status(status_path, "verifying", gguf_file, total_bytes, total_bytes, started_at=started_at)
                        import hashlib
                        sha = hashlib.sha256()
                        with open(target, "rb") as f:
                            for chunk in iter(lambda: f.read(1048576), b""):  # 1MB chunks
                                sha.update(chunk)
                        actual = sha.hexdigest()
                        if actual != gguf_sha256:
                            target.unlink(missing_ok=True)
                            _write_model_status(status_path, "failed", gguf_file, 0, 0, f"SHA256 mismatch: expected {gguf_sha256[:12]}..., got {actual[:12]}...", started_at=started_at)
                            return

                    _write_model_status(status_path, "complete", gguf_file, total_bytes, total_bytes, started_at=started_at)
                    logger.info("Model download complete: %s", gguf_file)
                except Exception as exc:
                    logger.error("Model download failed: %s", exc)
                    _write_model_status(status_path, "failed", gguf_file, 0, 0, str(exc), started_at=started_at)

            _model_download_thread = threading.Thread(target=_download, daemon=True)
            _model_download_thread.start()

        json_response(self, 200, {"status": "started"})

    def _handle_model_download_cancel(self):
        """Cancel an in-progress model download."""
        if not check_auth(self):
            return
        with _model_download_lock:
            if _model_download_thread is None or not _model_download_thread.is_alive():
                json_response(self, 200, {"status": "no_download"})
                return
        _model_download_cancel.set()
        # Capture local reference to avoid TOCTOU race — the download thread
        # may null out _model_download_proc between the check and kill.
        proc_ref = _model_download_proc
        if proc_ref is not None:
            try:
                proc_ref.kill()
            except (OSError, AttributeError):
                pass
        json_response(self, 200, {"status": "cancelling"})

    def _handle_model_activate(self):
        """Swap active model: update .env + models.ini + restart llama-server."""
        if not check_auth(self):
            return
        body = read_json_body(self)
        if body is None:
            return

        model_id = body.get("model_id", "")
        if not model_id:
            json_response(self, 400, {"error": "model_id is required"})
            return

        if not _model_activate_lock.acquire(blocking=False):
            json_response(self, 409, {"error": "Another model activation is in progress"})
            return

        try:
            self._do_model_activate(model_id)
        finally:
            _model_activate_lock.release()

    def _do_model_activate(self, model_id: str):
        """Inner activate logic — called with _model_activate_lock held."""
        # Look up model in library
        library_path = INSTALL_DIR / "config" / "model-library.json"
        model = None
        if library_path.exists():
            try:
                lib = json.loads(library_path.read_text(encoding="utf-8"))
                for m in lib.get("models", []):
                    if m.get("id") == model_id:
                        model = m
                        break
            except (json.JSONDecodeError, OSError):
                pass
        if model is None:
            json_response(self, 404, {"error": f"Model '{model_id}' not found in library"})
            return

        gguf_file = model.get("gguf_file", "")
        llm_model_name = model.get("llm_model_name", model_id)
        context_length = model.get("context_length", 32768)
        llama_server_image = model.get("llama_server_image")

        # Verify GGUF exists on disk (with path traversal protection)
        models_dir = INSTALL_DIR / "data" / "models"
        target = (models_dir / gguf_file).resolve()
        if not target.is_relative_to(models_dir.resolve()):
            json_response(self, 400, {"error": "Invalid model file path"})
            return
        if not target.exists():
            json_response(self, 400, {"error": f"Model file not downloaded: {gguf_file}"})
            return

        env_path = INSTALL_DIR / ".env"
        models_ini = INSTALL_DIR / "config" / "llama-server" / "models.ini"

        try:
            # Read current env BEFORE modification (needed for LLAMA_SERVER_IMAGE diff + gpu_backend)
            env = load_env(env_path)
            gpu_backend = env.get("GPU_BACKEND", "nvidia")

            # Save rollback snapshot
            env_backup = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
            ini_backup = models_ini.read_text(encoding="utf-8") if models_ini.exists() else ""

            # Update .env
            if env_path.exists():
                lines = env_path.read_text(encoding="utf-8").splitlines()
                updates = {
                    "GGUF_FILE": gguf_file,
                    "LLM_MODEL": llm_model_name,
                    "CTX_SIZE": str(context_length),
                    "MAX_CONTEXT": str(context_length),
                }
                # Only update LLAMA_SERVER_IMAGE on Docker backends (macOS runs native)
                if llama_server_image and gpu_backend != "apple":
                    updates["LLAMA_SERVER_IMAGE"] = llama_server_image
                new_lines = []
                seen = set()
                for line in lines:
                    key = line.split("=", 1)[0] if "=" in line and not line.startswith("#") else None
                    if key and key in updates:
                        new_lines.append(f"{key}={updates[key]}")
                        seen.add(key)
                    else:
                        new_lines.append(line)
                for key, val in updates.items():
                    if key not in seen:
                        new_lines.append(f"{key}={val}")
                env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")

            # Update models.ini
            models_ini.parent.mkdir(parents=True, exist_ok=True)
            models_ini.write_text(
                f"[{llm_model_name}]\n"
                f"filename = {gguf_file}\n"
                f"load-on-startup = true\n"
                f"n-ctx = {context_length}\n",
                encoding="utf-8",
            )

            # Restart llama-server (platform-aware)
            if gpu_backend == "apple":
                # macOS: llama-server runs natively on host (not Docker)
                pid_file = INSTALL_DIR / "data" / ".llama-server.pid"
                llama_bin = INSTALL_DIR / "bin" / "llama-server"
                llama_log = INSTALL_DIR / "data" / "llama-server.log"

                if not llama_bin.exists():
                    # Roll back .env/models.ini — can't restart
                    env_path.write_text(env_backup, encoding="utf-8")
                    models_ini.write_text(ini_backup, encoding="utf-8")
                    json_response(self, 500, {"error": "llama-server binary not found — re-run installer"})
                    return

                # Stop existing native process
                if pid_file.exists():
                    try:
                        old_pid = int(pid_file.read_text(encoding="utf-8").strip())
                        # Verify PID is llama-server before killing (prevent PID reuse accidents)
                        try:
                            ps_result = subprocess.run(
                                ["ps", "-p", str(old_pid), "-o", "comm="],
                                capture_output=True, text=True, timeout=5,
                            )
                            if "llama" not in ps_result.stdout.lower():
                                raise OSError("PID is not llama-server")
                        except (subprocess.TimeoutExpired, OSError):
                            pid_file.unlink(missing_ok=True)
                            raise OSError("stale PID")
                        os.kill(old_pid, signal.SIGTERM)
                        for _ in range(20):
                            try:
                                os.kill(old_pid, 0)
                                import time
                                time.sleep(0.5)
                            except OSError:
                                break
                        else:
                            os.kill(old_pid, signal.SIGKILL)
                    except (ValueError, OSError):
                        pass
                    pid_file.unlink(missing_ok=True)

                # Re-launch native llama-server with new model
                updated_env = load_env(env_path)
                new_gguf = updated_env.get("GGUF_FILE", gguf_file)
                new_ctx = updated_env.get("CTX_SIZE", str(context_length))
                model_path = INSTALL_DIR / "data" / "models" / new_gguf
                reasoning = updated_env.get("LLAMA_REASONING", "off")
                reasoning_fmt_map = {"off": "none", "on": "deepseek"}
                reasoning_fmt = reasoning_fmt_map.get(reasoning, reasoning)

                with open(llama_log, "a") as log_f:
                    proc = subprocess.Popen(
                        [str(llama_bin),
                         "--host", "0.0.0.0", "--port", "8080",
                         "--model", str(model_path),
                         "--ctx-size", new_ctx,
                         "--n-gpu-layers", "999",
                         "--reasoning-format", reasoning_fmt,
                         "--metrics"],
                        stdout=log_f, stderr=log_f,
                    )
                pid_file.write_text(str(proc.pid), encoding="utf-8")
            else:
                # Docker backends — resolve compose flags dynamically
                compose_flags = resolve_compose_flags()

                # Pull new llama-server image if it changed (Gemma4 requires a specific version)
                old_image = env.get("LLAMA_SERVER_IMAGE", "")
                if llama_server_image and llama_server_image != old_image:
                    try:
                        subprocess.run(
                            ["docker", "compose"] + compose_flags + ["pull", "llama-server"],
                            cwd=str(INSTALL_DIR), capture_output=True, timeout=600,
                        )
                    except (subprocess.TimeoutExpired, OSError):
                        pass  # Continue — image may be cached locally

                # Stop + up -d re-reads .env (restart does not)
                subprocess.run(["docker", "compose"] + compose_flags + ["stop", "llama-server"],
                               cwd=str(INSTALL_DIR), capture_output=True, timeout=120)
                subprocess.run(["docker", "compose"] + compose_flags + ["up", "-d", "llama-server"],
                               cwd=str(INSTALL_DIR), capture_output=True, timeout=300)

            # Health check (up to 5 min) — use 127.0.0.1 to avoid IPv6 resolution issues
            import time
            health_url = f"http://127.0.0.1:{env.get('OLLAMA_PORT', '8080')}"
            health_url += "/api/v1/health" if gpu_backend == "amd" else "/health"
            healthy = False
            for _ in range(60):
                try:
                    result = subprocess.run(
                        ["curl", "-sf", "--max-time", "5", health_url],
                        capture_output=True, timeout=10,
                    )
                    if result.returncode == 0:
                        healthy = True
                        break
                except subprocess.TimeoutExpired:
                    pass
                time.sleep(5)

            if healthy:
                json_response(self, 200, {"status": "activated", "model_id": model_id})
            else:
                # Rollback
                logger.warning("Model activation failed — rolling back")
                env_path.write_text(env_backup, encoding="utf-8")
                models_ini.write_text(ini_backup, encoding="utf-8")
                if gpu_backend == "apple":
                    # Stop newly launched native process, re-launch with old params
                    if pid_file.exists():
                        try:
                            new_pid = int(pid_file.read_text(encoding="utf-8").strip())
                            # Verify PID is llama-server before killing (consistency with forward path)
                            try:
                                ps_result = subprocess.run(
                                    ["ps", "-p", str(new_pid), "-o", "comm="],
                                    capture_output=True, text=True, timeout=5,
                                )
                                if "llama" not in ps_result.stdout.lower():
                                    raise OSError("PID is not llama-server")
                            except (subprocess.TimeoutExpired, OSError):
                                pid_file.unlink(missing_ok=True)
                                raise OSError("stale PID")
                            os.kill(new_pid, signal.SIGTERM)
                            for _ in range(20):
                                try:
                                    os.kill(new_pid, 0)
                                    import time
                                    time.sleep(0.5)
                                except OSError:
                                    break
                            else:
                                os.kill(new_pid, signal.SIGKILL)
                        except (ValueError, OSError):
                            pass
                        pid_file.unlink(missing_ok=True)
                    rollback_env = load_env(env_path)
                    rb_gguf = rollback_env.get("GGUF_FILE", gguf_file)
                    rb_ctx = rollback_env.get("CTX_SIZE", str(context_length))
                    rb_model_path = INSTALL_DIR / "data" / "models" / rb_gguf
                    rb_reasoning = rollback_env.get("LLAMA_REASONING", "off")
                    rb_reasoning_fmt = reasoning_fmt_map.get(rb_reasoning, rb_reasoning)
                    with open(llama_log, "a") as log_f:
                        rb_proc = subprocess.Popen(
                            [str(llama_bin),
                             "--host", "0.0.0.0", "--port", "8080",
                             "--model", str(rb_model_path),
                             "--ctx-size", rb_ctx,
                             "--n-gpu-layers", "999",
                             "--reasoning-format", rb_reasoning_fmt,
                             "--metrics"],
                            stdout=log_f, stderr=log_f,
                        )
                    pid_file.write_text(str(rb_proc.pid), encoding="utf-8")
                else:
                    subprocess.run(["docker", "compose"] + compose_flags + ["stop", "llama-server"],
                                   cwd=str(INSTALL_DIR), capture_output=True, timeout=120)
                    subprocess.run(["docker", "compose"] + compose_flags + ["up", "-d", "llama-server"],
                                   cwd=str(INSTALL_DIR), capture_output=True, timeout=300)
                json_response(self, 500, {"error": "Health check failed — rolled back to previous model", "rolled_back": True})

        except Exception as exc:
            json_response(self, 500, {"error": f"Model activation failed: {exc}"})

    def _handle_model_delete(self):
        """Delete a downloaded GGUF model file."""
        if not check_auth(self):
            return
        body = read_json_body(self)
        if body is None:
            return

        gguf_file = body.get("gguf_file", "")
        if not gguf_file:
            json_response(self, 400, {"error": "gguf_file is required"})
            return

        models_dir = INSTALL_DIR / "data" / "models"
        target = (models_dir / gguf_file).resolve()

        # Path traversal prevention
        if not target.is_relative_to(models_dir.resolve()):
            json_response(self, 400, {"error": "Invalid file path"})
            return

        if not target.exists():
            json_response(self, 404, {"error": f"File not found: {gguf_file}"})
            return

        # Refuse to delete the active model
        env = load_env(INSTALL_DIR / ".env")
        if env.get("GGUF_FILE", "") == gguf_file:
            json_response(self, 409, {"error": "Cannot delete the currently active model"})
            return

        try:
            target.unlink()
            json_response(self, 200, {"status": "deleted", "gguf_file": gguf_file})
        except OSError as exc:
            json_response(self, 500, {"error": f"Failed to delete: {exc}"})


def _write_model_status(path: Path, status: str, model: str, downloaded: int, total: int, error: str = "", started_at: str = ""):
    """Write model download status JSON atomically."""
    data = {
        "status": status,
        "model": model,
        "bytesDownloaded": downloaded,
        "bytesTotal": total,
        "updatedAt": _iso_now(),
    }
    if started_at:
        data["startedAt"] = started_at
    if error:
        data["error"] = error
    tmp = path.with_suffix(".tmp")
    try:
        tmp.write_text(json.dumps(data), encoding="utf-8")
        tmp.rename(path)
    except OSError:
        pass


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


def main():
    global INSTALL_DIR, AGENT_API_KEY, GPU_BACKEND, TIER, CORE_SERVICE_IDS, USER_EXTENSIONS_DIR

    parser = argparse.ArgumentParser(description="DreamServer Host Agent")
    parser.add_argument("--port", type=int, default=7710, help="Listen port (default: 7710)")
    parser.add_argument("--pid-file", type=str, default="", help="Write PID to this file")
    parser.add_argument("--install-dir", type=str, default="", help="DreamServer install directory")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, stream=sys.stderr,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    if not shutil.which("docker"):
        logger.error("docker not found in PATH")
        sys.exit(1)

    INSTALL_DIR = Path(args.install_dir).resolve() if args.install_dir else Path(__file__).resolve().parent.parent
    if not INSTALL_DIR.is_dir():
        logger.error("Install directory not found: %s", INSTALL_DIR)
        sys.exit(1)

    env = load_env(INSTALL_DIR / ".env")
    # Prefer dedicated DREAM_AGENT_KEY; fall back to DASHBOARD_API_KEY for
    # existing installs that haven't generated a separate key yet.
    AGENT_API_KEY = env.get("DREAM_AGENT_KEY", "") or env.get("DASHBOARD_API_KEY", "")
    if not AGENT_API_KEY:
        logger.error("Neither DREAM_AGENT_KEY nor DASHBOARD_API_KEY set in .env")
        sys.exit(1)
    GPU_BACKEND = env.get("GPU_BACKEND", "nvidia")
    TIER = env.get("TIER", "1")

    data_dir = Path(env.get("DREAM_DATA_DIR", str(INSTALL_DIR / "data")))
    USER_EXTENSIONS_DIR = Path(env.get(
        "DREAM_USER_EXTENSIONS_DIR",
        str(data_dir / "user-extensions"),
    ))

    port = args.port
    env_port = env.get("DREAM_AGENT_PORT", "")
    if port == 7710 and env_port:
        try:
            port = int(env_port)
        except ValueError:
            logger.warning("Invalid DREAM_AGENT_PORT in .env: %s", env_port)

    CORE_SERVICE_IDS = load_core_service_ids(INSTALL_DIR / "config" / "core-service-ids.json")

    if args.pid_file:
        pid_path = Path(args.pid_file)
        pid_path.write_text(str(os.getpid()), encoding="utf-8")
        atexit.register(lambda: pid_path.unlink(missing_ok=True))

    # Determine bind address: env var override, or platform-aware default.
    # macOS/Windows: 127.0.0.1 (Docker Desktop routes host.docker.internal to loopback)
    # Linux: 0.0.0.0 (host.docker.internal resolves to Docker bridge gateway, not loopback)
    bind_addr = env.get("DREAM_AGENT_BIND", "")
    if not bind_addr:
        bind_addr = "127.0.0.1" if platform.system() in ("Darwin", "Windows") else "0.0.0.0"

    server = ThreadedHTTPServer((bind_addr, port), AgentHandler)
    signal.signal(signal.SIGTERM, lambda *_: server.shutdown())
    logger.info("Dream Host Agent v%s listening on %s:%d", VERSION, bind_addr, port)
    if bind_addr == "0.0.0.0":
        logger.warning(
            "Agent is listening on all interfaces. Set DREAM_AGENT_BIND=127.0.0.1 in .env to restrict."
        )
    logger.info("Install dir: %s | GPU: %s | Tier: %s", INSTALL_DIR, GPU_BACKEND, TIER)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("Shutting down")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
