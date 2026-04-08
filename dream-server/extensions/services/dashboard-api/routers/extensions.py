"""Extensions portal endpoints."""

import contextlib
import json
import logging
import os
import re
import shutil
import stat
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

import yaml
from fastapi import APIRouter, Depends, HTTPException

from config import (
    AGENT_URL, CORE_SERVICE_IDS, DATA_DIR,
    DREAM_AGENT_KEY, EXTENSION_CATALOG, EXTENSIONS_DIR,
    EXTENSIONS_LIBRARY_DIR, GPU_BACKEND, SERVICES, USER_EXTENSIONS_DIR,
)
from security import verify_api_key

try:
    import fcntl
except ImportError:  # pragma: no cover - only hit on Windows hosts
    fcntl = None
    import msvcrt
else:  # pragma: no cover - platform branch
    msvcrt = None

logger = logging.getLogger(__name__)

router = APIRouter(tags=["extensions"])

_SERVICE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
_MAX_EXTENSION_BYTES = 50 * 1024 * 1024  # 50 MB


def _compute_extension_status(ext: dict, services_by_id: dict) -> str:
    """Compute the runtime status of an extension."""
    ext_id = ext["id"]

    # Core service loaded from manifests
    if ext_id in SERVICES:
        svc = services_by_id.get(ext_id)
        if svc and svc.status == "healthy":
            return "enabled"
        return "disabled"

    # User-installed extension (file-based status — compose.yaml = enabled)
    user_dir = USER_EXTENSIONS_DIR / ext_id
    if user_dir.is_dir():
        if (user_dir / "compose.yaml").exists():
            return "enabled"
        if (user_dir / "compose.yaml.disabled").exists():
            return "disabled"

    # GPU incompatibility
    gpu_backends = ext.get("gpu_backends", [])
    if gpu_backends and "all" not in gpu_backends and GPU_BACKEND not in gpu_backends:
        return "incompatible"

    return "not_installed"


def _is_installable(ext_id: str) -> bool:
    """Check if an extension is available in the extensions library."""
    return (EXTENSIONS_LIBRARY_DIR / ext_id).is_dir()


def _validate_service_id(service_id: str) -> None:
    """Validate service_id format, raising 404 if invalid."""
    if not _SERVICE_ID_RE.match(service_id):
        raise HTTPException(status_code=404, detail=f"Invalid service_id: {service_id}")


def _assert_not_core(service_id: str) -> None:
    """Raise 403 if the service_id belongs to a core service."""
    if service_id in CORE_SERVICE_IDS:
        raise HTTPException(
            status_code=403, detail=f"Cannot modify core service: {service_id}",
        )


def _scan_compose_content(compose_path: Path, *, trusted: bool = False) -> None:
    """Reject compose files containing dangerous directives."""
    try:
        data = yaml.safe_load(compose_path.read_text(encoding="utf-8"))
    except (yaml.YAMLError, OSError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid compose file: {e}")

    if not isinstance(data, dict):
        raise HTTPException(
            status_code=400, detail="Compose file must be a YAML mapping",
        )

    services = data.get("services", {})
    if not isinstance(services, dict):
        return

    for svc_name in services:
        if svc_name in CORE_SERVICE_IDS:
            raise HTTPException(
                status_code=400,
                detail=f"Extension rejected: service name '{svc_name}' conflicts with core service",
            )

    for svc_name, svc_def in services.items():
        if not isinstance(svc_def, dict):
            continue
        if svc_def.get("privileged") is True:
            raise HTTPException(
                status_code=400,
                detail=f"Service '{svc_name}' uses privileged mode",
            )
        # Block Docker Compose internal label spoofing
        labels = svc_def.get("labels", [])
        if isinstance(labels, dict):
            label_keys = labels.keys()
        elif isinstance(labels, list):
            label_keys = [lbl.split("=", 1)[0] for lbl in labels if isinstance(lbl, str)]
        else:
            label_keys = []
        for lk in label_keys:
            if lk.startswith("com.docker.compose."):
                raise HTTPException(
                    status_code=400,
                    detail=f"Extension rejected: reserved Docker Compose label '{lk}' in service '{svc_name}'",
                )
        volumes = svc_def.get("volumes", [])
        if isinstance(volumes, list):
            for vol in volumes:
                vol_str = str(vol)
                if "docker.sock" in vol_str:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Extension rejected: Docker socket mount in {svc_name}",
                    )
                vol_parts = vol_str.split(":")
                if len(vol_parts) >= 2 and vol_parts[0].startswith("/"):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Extension rejected: absolute host path mount '{vol_parts[0]}' in {svc_name}",
                    )
        cap_add = svc_def.get("cap_add", [])
        if isinstance(cap_add, list):
            for cap in cap_add:
                if str(cap).upper() in {
                    "SYS_ADMIN", "NET_ADMIN", "SYS_PTRACE", "NET_RAW",
                    "DAC_OVERRIDE", "SETUID", "SETGID", "SYS_MODULE",
                    "SYS_RAWIO", "ALL",
                }:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Service '{svc_name}' adds dangerous capability: {cap}",
                    )
        if svc_def.get("pid") == "host":
            raise HTTPException(
                status_code=400,
                detail=f"Service '{svc_name}' uses host PID namespace",
            )
        if svc_def.get("network_mode") == "host":
            raise HTTPException(
                status_code=400,
                detail=f"Service '{svc_name}' uses host network mode",
            )
        if svc_def.get("ipc") == "host":
            raise HTTPException(
                status_code=400,
                detail=f"Service '{svc_name}' uses host IPC namespace",
            )
        if svc_def.get("userns_mode") == "host":
            raise HTTPException(
                status_code=400,
                detail=f"Service '{svc_name}' uses host user namespace",
            )
        user = svc_def.get("user")
        if user is not None and str(user).split(":")[0] in ("root", "0"):
            raise HTTPException(
                status_code=400,
                detail=f"Service '{svc_name}' runs as root",
            )
        if not trusted and "build" in svc_def:
            raise HTTPException(
                status_code=400,
                detail=f"Service '{svc_name}' uses a local build — only pre-built images are allowed for user extensions",
            )
        if svc_def.get("extra_hosts"):
            raise HTTPException(
                status_code=400,
                detail=f"Extension rejected: extra_hosts in {svc_name}",
            )
        if svc_def.get("sysctls"):
            raise HTTPException(
                status_code=400,
                detail=f"Extension rejected: sysctls in {svc_name}",
            )
        security_opt = svc_def.get("security_opt", [])
        if isinstance(security_opt, list):
            for opt in security_opt:
                opt_str = str(opt).lower().replace("=", ":")
                if opt_str in ("seccomp:unconfined", "apparmor:unconfined", "label:disable"):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Extension rejected: dangerous security_opt '{opt}' in {svc_name}",
                    )
        if svc_def.get("devices"):
            raise HTTPException(
                status_code=400,
                detail=f"Extension rejected: devices in {svc_name}",
            )
        ports = svc_def.get("ports", [])
        for port in ports:
            if isinstance(port, dict):
                # Dict-form: {target: 80, published: 8080, host_ip: ...}
                host_ip = port.get("host_ip", "")
                if port.get("published") and host_ip != "127.0.0.1":
                    raise HTTPException(
                        status_code=400,
                        detail=f"Extension rejected: dict port binding in {svc_name} must use host_ip: 127.0.0.1",
                    )
            else:
                port_str = str(port)
                if ":" in port_str:
                    parts = port_str.split(":")
                    if len(parts) >= 3:
                        if parts[0] != "127.0.0.1":
                            raise HTTPException(
                                status_code=400,
                                detail=f"Extension rejected: port binding '{port_str}' in {svc_name} must use 127.0.0.1",
                            )
                    elif len(parts) == 2:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Extension rejected: port binding '{port_str}' in {svc_name} must specify 127.0.0.1 prefix",
                        )
                else:
                    # Bare port (e.g. "8080") — Docker binds 0.0.0.0
                    raise HTTPException(
                        status_code=400,
                        detail=f"Extension rejected: bare port '{port_str}' in {svc_name} must use 127.0.0.1:host:container format",
                    )

    # Scan top-level named volumes for bind-mount backdoors via driver_opts
    top_volumes = data.get("volumes", {})
    if isinstance(top_volumes, dict):
        for vol_name, vol_def in top_volumes.items():
            if not isinstance(vol_def, dict):
                continue
            driver_opts = vol_def.get("driver_opts", {})
            if not isinstance(driver_opts, dict):
                continue
            vol_type = str(driver_opts.get("type", "")).lower()
            device = str(driver_opts.get("device", ""))
            if vol_type in ("none", "bind") and device.startswith("/"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Extension rejected: named volume '{vol_name}' uses driver_opts to bind-mount host path '{device}'",
                )


def _ignore_special(directory: str, files: list[str]) -> list[str]:
    """Return files that should be skipped during copytree (symlinks, special)."""
    ignored = []
    for f in files:
        full = os.path.join(directory, f)
        try:
            st = os.lstat(full)
            if (stat.S_ISLNK(st.st_mode) or stat.S_ISFIFO(st.st_mode)
                    or stat.S_ISBLK(st.st_mode) or stat.S_ISCHR(st.st_mode)
                    or stat.S_ISSOCK(st.st_mode)):
                ignored.append(f)
        except OSError:
            ignored.append(f)
    return ignored


def _copytree_safe(src: Path, dst: Path) -> None:
    """Copy directory tree, skipping symlinks and special files."""
    shutil.copytree(src, dst, ignore=_ignore_special)


# --- Host Agent Helpers ---

_AGENT_TIMEOUT = 300  # seconds — image pulls can take several minutes on first install
_AGENT_LOG_TIMEOUT = 30  # seconds — log fetches should be fast


def _call_agent(action: str, service_id: str) -> bool:
    """Call host agent to start/stop a service. Returns True on success."""
    url = f"{AGENT_URL}/v1/extension/{action}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DREAM_AGENT_KEY}",
    }
    data = json.dumps({"service_id": service_id}).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=_AGENT_TIMEOUT) as resp:
            return resp.status == 200
    except Exception:
        logger.warning("Host agent unreachable at %s — fallback to restart_required", AGENT_URL)
        return False


def _call_agent_setup_hook(service_id: str) -> bool:
    """Call host agent to run setup_hook for an extension. Returns True on success."""
    url = f"{AGENT_URL}/v1/extension/setup-hook"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DREAM_AGENT_KEY}",
    }
    data = json.dumps({"service_id": service_id}).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=_AGENT_TIMEOUT) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            # No setup_hook defined — not an error
            return True
        logger.warning("setup_hook failed for %s (HTTP %d)", service_id, exc.code)
        return False
    except Exception:
        logger.warning("Host agent unreachable for setup_hook at %s", AGENT_URL)
        return False


_agent_cache_lock = threading.Lock()
_agent_cache = {"available": False, "checked_at": 0.0}


def _check_agent_health() -> bool:
    """Check if host agent is available. Cached for 30s, thread-safe."""
    with _agent_cache_lock:
        now = time.monotonic()
        if now - _agent_cache["checked_at"] < 30:
            return _agent_cache["available"]
    # Check outside lock to avoid holding it during network I/O
    try:
        req = urllib.request.Request(f"{AGENT_URL}/health")
        with urllib.request.urlopen(req, timeout=3) as resp:
            available = resp.status == 200
    except Exception:
        available = False
    with _agent_cache_lock:
        _agent_cache.update(available=available, checked_at=time.monotonic())
    return available


@contextlib.contextmanager
def _extensions_lock():
    """Acquire an exclusive file lock for extension mutations."""
    lock_path = Path(DATA_DIR) / ".extensions-lock"
    lock_path.touch(exist_ok=True)
    lockfile = open(lock_path, "a+b")
    try:
        if fcntl is not None:
            fcntl.flock(lockfile, fcntl.LOCK_EX)
        elif msvcrt is not None:
            lockfile.seek(0, os.SEEK_END)
            if lockfile.tell() == 0:
                lockfile.write(b"\0")
                lockfile.flush()
            lockfile.seek(0)
            msvcrt.locking(lockfile.fileno(), msvcrt.LK_LOCK, 1)
        yield
    finally:
        try:
            if fcntl is not None:
                fcntl.flock(lockfile, fcntl.LOCK_UN)
            elif msvcrt is not None:
                lockfile.seek(0)
                msvcrt.locking(lockfile.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            lockfile.close()


@router.get("/api/extensions/catalog")
async def extensions_catalog(
    category: Optional[str] = None,
    gpu_compatible: Optional[bool] = None,
    api_key: str = Depends(verify_api_key),
):
    """Get the extensions catalog with computed status."""
    from helpers import get_cached_services, get_all_services

    service_list = get_cached_services()
    if service_list is None:
        service_list = await get_all_services()
    services_by_id = {s.id: s for s in service_list}

    extensions = []
    for ext in EXTENSION_CATALOG:
        status = _compute_extension_status(ext, services_by_id)
        installable = _is_installable(ext["id"])
        ext_id = ext["id"]
        user_dir = USER_EXTENSIONS_DIR / ext_id
        source = "user" if user_dir.is_dir() else ("core" if ext_id in SERVICES else "library")
        enriched = {**ext, "status": status, "installable": installable, "source": source}

        if category and ext.get("category") != category:
            continue
        if gpu_compatible is not None:
            is_compatible = status != "incompatible"
            if gpu_compatible != is_compatible:
                continue

        extensions.append(enriched)

    summary = {
        "total": len(extensions),
        "installed": sum(1 for e in extensions if e["status"] in ("enabled", "disabled")),
        "enabled": sum(1 for e in extensions if e["status"] == "enabled"),
        "disabled": sum(1 for e in extensions if e["status"] == "disabled"),
        "not_installed": sum(1 for e in extensions if e["status"] == "not_installed"),
        "incompatible": sum(1 for e in extensions if e["status"] == "incompatible"),
    }

    try:
        lib_available = (
            EXTENSIONS_LIBRARY_DIR.is_dir()
            and any(EXTENSIONS_LIBRARY_DIR.iterdir())
        )
    except OSError:
        lib_available = False

    return {
        "extensions": extensions,
        "summary": summary,
        "gpu_backend": GPU_BACKEND,
        "library_available": lib_available,
        "agent_available": _check_agent_health(),
    }


@router.get("/api/extensions/{service_id}")
async def extension_detail(
    service_id: str,
    api_key: str = Depends(verify_api_key),
):
    """Get detailed information for a single extension."""
    if not _SERVICE_ID_RE.match(service_id):
        raise HTTPException(status_code=404, detail=f"Invalid service_id: {service_id}")

    ext = next((e for e in EXTENSION_CATALOG if e["id"] == service_id), None)
    if not ext:
        raise HTTPException(status_code=404, detail=f"Extension not found: {service_id}")

    from helpers import get_all_services

    service_list = await get_all_services()
    services_by_id = {s.id: s for s in service_list}
    status = _compute_extension_status(ext, services_by_id)
    installable = _is_installable(service_id)

    user_dir = USER_EXTENSIONS_DIR / service_id
    source = "user" if user_dir.is_dir() else ("core" if service_id in SERVICES else "library")

    return {
        "id": ext["id"],
        "name": ext["name"],
        "description": ext.get("description", ""),
        "status": status,
        "source": source,
        "installable": installable,
        "manifest": ext,
        "env_vars": ext.get("env_vars", []),
        "features": ext.get("features", []),
        "setup_instructions": {
            "steps": [
                f"Run 'dream enable {service_id}' to install and start the service",
                f"Run 'dream disable {service_id}' to stop the service",
            ],
            "cli_enable": f"dream enable {service_id}",
            "cli_disable": f"dream disable {service_id}",
        },
    }


# --- Mutation endpoints ---


@router.post("/api/extensions/{service_id}/logs")
async def extension_logs(
    service_id: str,
    api_key: str = Depends(verify_api_key),
):
    """Get container logs for any service via the host agent."""
    if not _SERVICE_ID_RE.match(service_id):
        raise HTTPException(status_code=404, detail=f"Invalid service_id: {service_id}")

    url = f"{AGENT_URL}/v1/service/logs"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DREAM_AGENT_KEY}",
    }
    data = json.dumps({"service_id": service_id, "tail": 100}).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=_AGENT_LOG_TIMEOUT) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        try:
            err_body = json.loads(exc.read().decode())
            detail = err_body.get("error", f"Host agent error: HTTP {exc.code}")
        except (json.JSONDecodeError, OSError):
            detail = f"Host agent returned HTTP {exc.code}"
        raise HTTPException(status_code=502, detail=detail)
    except (urllib.error.URLError, OSError):
        raise HTTPException(
            status_code=503,
            detail=f"Host agent unavailable. Use 'docker logs dream-{service_id}' in terminal.",
        )


@router.post("/api/extensions/{service_id}/install")
def install_extension(service_id: str, api_key: str = Depends(verify_api_key)):
    """Install an extension from the library."""
    _validate_service_id(service_id)
    _assert_not_core(service_id)

    # Verify library is accessible
    try:
        lib_available = EXTENSIONS_LIBRARY_DIR.is_dir()
    except OSError:
        lib_available = False
    if not lib_available:
        raise HTTPException(
            status_code=503, detail="Extensions library is unavailable",
        )

    source = (EXTENSIONS_LIBRARY_DIR / service_id).resolve()
    if not source.is_relative_to(EXTENSIONS_LIBRARY_DIR.resolve()):
        raise HTTPException(
            status_code=404, detail=f"Extension not found: {service_id}",
        )
    if not source.is_dir():
        raise HTTPException(
            status_code=404, detail=f"Extension not found: {service_id}",
        )

    dest = USER_EXTENSIONS_DIR / service_id

    # Early check (non-authoritative, rechecked under lock)
    if dest.exists():
        has_compose = (dest / "compose.yaml").exists()
        has_disabled = (dest / "compose.yaml.disabled").exists()
        if has_compose or has_disabled:
            raise HTTPException(
                status_code=409, detail=f"Extension already installed: {service_id}",
            )
        # Broken directory (no compose file) — clean up before reinstall
        logger.warning("Cleaning up broken extension directory: %s", dest)
        shutil.rmtree(dest)

    # Size check
    total_size = 0
    for root, _dirs, files in os.walk(source):
        for f in files:
            total_size += os.path.getsize(os.path.join(root, f))
            if total_size > _MAX_EXTENSION_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail="Extension exceeds maximum size of 50MB",
                )

    # Atomic install via temp directory on same filesystem
    with _extensions_lock():
        # Re-check under lock to prevent double-install race
        if dest.exists():
            has_compose = (dest / "compose.yaml").exists()
            has_disabled = (dest / "compose.yaml.disabled").exists()
            if has_compose or has_disabled:
                raise HTTPException(
                    status_code=409,
                    detail=f"Extension already installed: {service_id}",
                )
            # Broken directory (no compose file) — clean up before reinstall
            logger.warning("Cleaning up broken extension directory under lock: %s", dest)
            shutil.rmtree(dest)

        USER_EXTENSIONS_DIR.mkdir(parents=True, exist_ok=True)
        tmpdir = tempfile.mkdtemp(dir=str(USER_EXTENSIONS_DIR.parent))
        try:
            staged = Path(tmpdir) / service_id
            _copytree_safe(source, staged)
            # Security scan the staged copy (prevents TOCTOU)
            staged_compose = staged / "compose.yaml"
            if staged_compose.exists():
                _scan_compose_content(staged_compose, trusted=True)
            os.rename(str(staged), str(dest))
        finally:
            if Path(tmpdir).exists():
                shutil.rmtree(tmpdir, ignore_errors=True)

    # Run setup hook if extension has one (generates required env vars)
    _call_agent_setup_hook(service_id)

    # Call agent to start the container (outside lock)
    agent_ok = _call_agent("start", service_id)

    logger.info("Installed extension: %s", service_id)
    return {
        "id": service_id,
        "action": "installed",
        "restart_required": not agent_ok,
        "message": (
            "Extension installed and started." if agent_ok
            else "Extension installed. Run 'dream restart' to start."
        ),
    }


@router.post("/api/extensions/{service_id}/enable")
def enable_extension(service_id: str, api_key: str = Depends(verify_api_key)):
    """Enable an installed extension."""
    _validate_service_id(service_id)
    _assert_not_core(service_id)

    ext_dir = (USER_EXTENSIONS_DIR / service_id).resolve()
    if not ext_dir.is_relative_to(USER_EXTENSIONS_DIR.resolve()):
        raise HTTPException(
            status_code=404, detail=f"Extension not found: {service_id}",
        )
    if not ext_dir.is_dir():
        raise HTTPException(
            status_code=404, detail=f"Extension not installed: {service_id}",
        )

    disabled_compose = ext_dir / "compose.yaml.disabled"
    enabled_compose = ext_dir / "compose.yaml"

    if enabled_compose.exists():
        raise HTTPException(
            status_code=409, detail=f"Extension already enabled: {service_id}",
        )
    if not disabled_compose.exists():
        raise HTTPException(
            status_code=404, detail=f"Extension has no compose file: {service_id}",
        )

    # Check dependencies from manifest
    manifest_path = ext_dir / "manifest.yaml"
    if manifest_path.exists():
        try:
            manifest = yaml.safe_load(
                manifest_path.read_text(encoding="utf-8"),
            )
        except (yaml.YAMLError, OSError) as e:
            logger.warning("Could not read manifest for %s: %s", service_id, e)
            manifest = {}
        depends_on = []
        if isinstance(manifest, dict):
            svc = manifest.get("service", {})
            depends_on = svc.get("depends_on", []) if isinstance(svc, dict) else []
            if not isinstance(depends_on, list):
                depends_on = []
        missing_deps = []
        for dep in depends_on:
            if not isinstance(dep, str) or not _SERVICE_ID_RE.match(dep):
                continue
            # Core services have compose in docker-compose.base.yml, not individual files
            if dep in CORE_SERVICE_IDS:
                continue
            # Check built-in extensions
            if (EXTENSIONS_DIR / dep / "compose.yaml").exists():
                continue
            # Check user extensions
            if (USER_EXTENSIONS_DIR / dep / "compose.yaml").exists():
                continue
            missing_deps.append(dep)
        if missing_deps:
            raise HTTPException(
                status_code=400,
                detail=f"Missing dependencies: {', '.join(missing_deps)}",
            )

    with _extensions_lock():
        # Re-scan compose content inside lock (TOCTOU prevention —
        # file contents could be modified between scan and rename)
        compose_path = ext_dir / "compose.yaml.disabled"
        if compose_path.exists():
            _scan_compose_content(compose_path)

        # Reject symlinks (checked under lock to prevent TOCTOU)
        st = os.lstat(disabled_compose)
        if stat.S_ISLNK(st.st_mode):
            raise HTTPException(
                status_code=400, detail="Compose file is a symlink",
            )

        os.rename(str(disabled_compose), str(enabled_compose))

    agent_ok = _call_agent("start", service_id)

    logger.info("Enabled extension: %s", service_id)
    return {
        "id": service_id,
        "action": "enabled",
        "restart_required": not agent_ok,
        "message": (
            "Extension enabled and started." if agent_ok
            else "Extension enabled. Run 'dream restart' to start."
        ),
    }


@router.post("/api/extensions/{service_id}/disable")
def disable_extension(service_id: str, api_key: str = Depends(verify_api_key)):
    """Disable an enabled extension."""
    _validate_service_id(service_id)
    _assert_not_core(service_id)

    ext_dir = (USER_EXTENSIONS_DIR / service_id).resolve()
    if not ext_dir.is_relative_to(USER_EXTENSIONS_DIR.resolve()):
        raise HTTPException(
            status_code=404, detail=f"Extension not found: {service_id}",
        )
    if not ext_dir.is_dir():
        raise HTTPException(
            status_code=404, detail=f"Extension not installed: {service_id}",
        )

    enabled_compose = ext_dir / "compose.yaml"
    disabled_compose = ext_dir / "compose.yaml.disabled"

    if not enabled_compose.exists():
        raise HTTPException(
            status_code=409, detail=f"Extension already disabled: {service_id}",
        )

    # Check reverse dependents (warn, don't block)
    dependents_warning = []
    try:
        if USER_EXTENSIONS_DIR.is_dir():
            for peer_dir in USER_EXTENSIONS_DIR.iterdir():
                if not peer_dir.is_dir() or peer_dir.name == service_id:
                    continue
                peer_manifest = peer_dir / "manifest.yaml"
                if not peer_manifest.exists():
                    continue
                try:
                    peer_data = yaml.safe_load(
                        peer_manifest.read_text(encoding="utf-8"),
                    )
                    if isinstance(peer_data, dict):
                        peer_svc = peer_data.get("service", {})
                        deps = peer_svc.get("depends_on", []) if isinstance(peer_svc, dict) else []
                        if isinstance(deps, list) and service_id in deps:
                            dependents_warning.append(peer_dir.name)
                except (yaml.YAMLError, OSError) as e:
                    logger.debug("Could not read peer manifest %s: %s", peer_manifest, e)
    except OSError:
        pass

    # Call agent to stop BEFORE renaming (prevents zombie containers)
    agent_ok = _call_agent("stop", service_id)
    if not agent_ok:
        logger.warning("Could not stop %s via agent — container may still be running", service_id)

    with _extensions_lock():
        # lstat check inside lock (TOCTOU prevention)
        st = os.lstat(enabled_compose)
        if stat.S_ISLNK(st.st_mode):
            raise HTTPException(
                status_code=400, detail="Compose file is a symlink",
            )

        os.rename(str(enabled_compose), str(disabled_compose))

    logger.info("Disabled extension: %s", service_id)

    message = (
        "Extension disabled and stopped." if agent_ok
        else "Extension disabled. Run 'dream restart' to apply changes."
    )
    if dependents_warning:
        message = (
            f"Warning: {', '.join(dependents_warning)} depend on {service_id}. "
            + message
        )

    return {
        "id": service_id,
        "action": "disabled",
        "restart_required": not agent_ok,
        "dependents_warning": dependents_warning,
        "message": message,
    }


@router.delete("/api/extensions/{service_id}")
def uninstall_extension(service_id: str, api_key: str = Depends(verify_api_key)):
    """Uninstall a disabled extension."""
    _validate_service_id(service_id)
    _assert_not_core(service_id)

    ext_dir = (USER_EXTENSIONS_DIR / service_id).resolve()
    if not ext_dir.is_relative_to(USER_EXTENSIONS_DIR.resolve()):
        raise HTTPException(
            status_code=404, detail=f"Extension not found: {service_id}",
        )
    if not ext_dir.is_dir():
        raise HTTPException(
            status_code=404, detail=f"Extension not installed: {service_id}",
        )

    # Must be disabled before uninstall
    if (ext_dir / "compose.yaml").exists():
        raise HTTPException(
            status_code=400,
            detail=f"Disable extension before uninstalling. Run 'dream disable {service_id}' first.",
        )

    with _extensions_lock():
        # Reject symlinks (checked under lock to prevent TOCTOU)
        st = os.lstat(ext_dir)
        if stat.S_ISLNK(st.st_mode):
            raise HTTPException(
                status_code=400, detail="Extension directory is a symlink",
            )

        try:
            shutil.rmtree(ext_dir)
        except OSError as e:
            logger.error("Failed to remove extension %s: %s", service_id, e)
            raise HTTPException(status_code=500, detail=f"Failed to remove extension files: {e}")

    logger.info("Uninstalled extension: %s", service_id)
    return {
        "id": service_id,
        "action": "uninstalled",
        "message": "Extension uninstalled. Docker volumes may remain — run 'docker volume ls' to check.",
        "cleanup_hint": f"To remove orphaned volumes: docker volume ls --filter 'name={service_id}' -q | xargs docker volume rm",
    }
