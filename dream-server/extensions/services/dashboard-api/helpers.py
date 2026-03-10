"""Shared helper functions for service health checking, metrics, and system info."""

import asyncio
import json
import logging
import os
import platform
import shutil
import time
from pathlib import Path
from typing import Optional

import aiohttp
import httpx

from config import SERVICES, INSTALL_DIR, DATA_DIR
from models import ServiceStatus, DiskUsage, ModelInfo, BootstrapStatus

logger = logging.getLogger(__name__)

# --- Shared HTTP session (connection pooling) ---
# Re-using a single ClientSession avoids creating/destroying 17+ TCP
# connections every poll cycle and prevents file-descriptor exhaustion.

_aio_session: Optional[aiohttp.ClientSession] = None
_HEALTH_TIMEOUT = aiohttp.ClientTimeout(total=5)   # match Docker's own 5 s timeout


async def _get_aio_session() -> aiohttp.ClientSession:
    """Return (and lazily create) a module-level aiohttp session."""
    global _aio_session
    if _aio_session is None or _aio_session.closed:
        _aio_session = aiohttp.ClientSession(timeout=_HEALTH_TIMEOUT)
    return _aio_session


# --- Token Tracking ---

_TOKEN_FILE = Path(DATA_DIR) / "token_counter.json"
_prev_tokens = {"count": 0, "time": 0.0, "tps": 0.0}


def _update_lifetime_tokens(server_counter: float) -> int:
    """Accumulate tokens across server restarts using a persistent file."""
    data = {"lifetime": 0, "last_server_counter": 0}
    try:
        if _TOKEN_FILE.exists():
            data = json.loads(_TOKEN_FILE.read_text())
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("Failed to read token counter file %s: %s", _TOKEN_FILE, e)

    prev = data.get("last_server_counter", 0)
    delta = server_counter if server_counter < prev else server_counter - prev

    data["lifetime"] = int(data.get("lifetime", 0) + delta)
    data["last_server_counter"] = server_counter

    try:
        _TOKEN_FILE.write_text(json.dumps(data))
    except OSError as e:
        logger.warning("Failed to write token counter file %s: %s", _TOKEN_FILE, e)

    return data["lifetime"]


def _get_lifetime_tokens() -> int:
    try:
        return json.loads(_TOKEN_FILE.read_text()).get("lifetime", 0)
    except (json.JSONDecodeError, OSError):
        return 0


# --- LLM Metrics ---

async def get_llama_metrics(model_hint: Optional[str] = None) -> dict:
    """Get inference metrics from llama-server Prometheus /metrics endpoint.

    Accepts an optional *model_hint* so callers that already resolved the
    loaded model name can avoid a redundant HTTP round-trip.
    """
    try:
        host = SERVICES["llama-server"]["host"]
        port = SERVICES["llama-server"]["port"]
        model_name = model_hint if model_hint is not None else (await get_loaded_model() or "")
        url = f"http://{host}:{port}/metrics"
        params = {"model": model_name} if model_name else {}
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url, params=params)

        metrics = {}
        for line in resp.text.split("\n"):
            if line.startswith("#"):
                continue
            if "tokens_predicted_total" in line:
                metrics["tokens_predicted_total"] = float(line.split()[-1])
            if "tokens_predicted_seconds_total" in line:
                metrics["tokens_predicted_seconds_total"] = float(line.split()[-1])

        now = time.time()
        curr = metrics.get("tokens_predicted_total", 0)
        gen_secs = metrics.get("tokens_predicted_seconds_total", 0)
        if _prev_tokens["time"] > 0 and curr > _prev_tokens["count"]:
            delta_secs = gen_secs - _prev_tokens.get("gen_secs", 0)
            if delta_secs > 0:
                _prev_tokens["tps"] = round((curr - _prev_tokens["count"]) / delta_secs, 1)
        _prev_tokens["count"] = curr
        _prev_tokens["time"] = now
        _prev_tokens["gen_secs"] = gen_secs

        lifetime = _update_lifetime_tokens(curr)
        return {"tokens_per_second": _prev_tokens["tps"], "lifetime_tokens": lifetime}
    except Exception as e:
        logger.warning(f"get_llama_metrics failed: {e}")
        return {"tokens_per_second": 0, "lifetime_tokens": _get_lifetime_tokens()}


async def get_loaded_model() -> Optional[str]:
    """Query llama-server /v1/models for actually loaded model name."""
    try:
        host = SERVICES["llama-server"]["host"]
        port = SERVICES["llama-server"]["port"]
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"http://{host}:{port}/v1/models")
        models = resp.json().get("data", [])
        for m in models:
            status = m.get("status", {})
            if isinstance(status, dict) and status.get("value") == "loaded":
                return m.get("id")
        if models:
            return models[0].get("id")
    except Exception as e:
        logger.debug("get_loaded_model failed: %s", e)
    return None


async def get_llama_context_size(model_hint: Optional[str] = None) -> Optional[int]:
    """Query llama-server /props for the actual n_ctx.

    Accepts an optional *model_hint* to skip the redundant
    ``get_loaded_model()`` call when the caller already has it.
    """
    try:
        host = SERVICES["llama-server"]["host"]
        port = SERVICES["llama-server"]["port"]
        loaded = model_hint if model_hint is not None else await get_loaded_model()
        url = f"http://{host}:{port}/props"
        if loaded:
            url += f"?model={loaded}"
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(url)
        n_ctx = resp.json().get("default_generation_settings", {}).get("n_ctx")
        return int(n_ctx) if n_ctx else None
    except Exception as e:
        logger.debug("get_llama_context_size failed: %s", e)
        return None


# --- Service Health ---

async def check_service_health(service_id: str, config: dict) -> ServiceStatus:
    """Check if a service is healthy by hitting its health endpoint."""
    if config.get("type") == "host-systemd":
        return await _check_host_service_health(service_id, config)

    host = config.get('host', 'localhost')
    url = f"http://{host}:{config['port']}{config['health']}"
    status = "unknown"
    response_time = None

    try:
        session = await _get_aio_session()
        start = asyncio.get_event_loop().time()
        async with session.get(url) as resp:
            response_time = (asyncio.get_event_loop().time() - start) * 1000
            status = "healthy" if resp.status < 500 else "unhealthy"
    except asyncio.TimeoutError:
        # Service is reachable but slow — report degraded rather than down
        # to avoid false "offline" flashes during startup or heavy load.
        status = "degraded"
    except aiohttp.ClientConnectorError as e:
        if "Name or service not known" in str(e) or "nodename nor servname" in str(e):
            status = "not_deployed"
        else:
            status = "down"
    except Exception as e:
        logger.debug(f"Health check failed for {service_id} at {url}: {e}")
        status = "down"

    return ServiceStatus(
        id=service_id, name=config["name"], port=config["port"],
        external_port=config.get("external_port", config["port"]),
        status=status, response_time_ms=round(response_time, 1) if response_time else None
    )


async def _check_host_service_health(service_id: str, config: dict) -> ServiceStatus:
    """Check health of a host-level service via HTTP."""
    port = config.get("external_port", config["port"])
    host = os.environ.get("HOST_GATEWAY", "host.docker.internal")
    url = f"http://{host}:{port}{config['health']}"
    status = "down"
    response_time = None
    try:
        session = await _get_aio_session()
        start = asyncio.get_event_loop().time()
        async with session.get(url) as resp:
            response_time = (asyncio.get_event_loop().time() - start) * 1000
            status = "healthy" if resp.status < 500 else "unhealthy"
    except aiohttp.ClientConnectorError:
        status = "down"
    except Exception as e:
        logger.debug(f"Host health check failed for {service_id} at {url}: {e}")
        status = "down"
    return ServiceStatus(
        id=service_id, name=config["name"], port=config["port"],
        external_port=config.get("external_port", config["port"]),
        status=status, response_time_ms=round(response_time, 1) if response_time else None,
    )


async def get_all_services() -> list[ServiceStatus]:
    """Get all service health statuses.

    Uses ``return_exceptions=True`` so that one misbehaving service
    cannot take down the entire status response.
    """
    tasks = [check_service_health(sid, cfg) for sid, cfg in SERVICES.items()]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    statuses: list[ServiceStatus] = []
    for (sid, cfg), result in zip(SERVICES.items(), results):
        if isinstance(result, BaseException):
            logger.warning("Health check for %s raised %s: %s", sid, type(result).__name__, result)
            statuses.append(ServiceStatus(
                id=sid, name=cfg["name"], port=cfg["port"],
                external_port=cfg.get("external_port", cfg["port"]),
                status="down", response_time_ms=None,
            ))
        else:
            statuses.append(result)
    return statuses


# --- System Metrics ---

def get_disk_usage() -> DiskUsage:
    """Get disk usage for the Dream Server install directory."""
    path = INSTALL_DIR if os.path.exists(INSTALL_DIR) else os.path.expanduser("~")
    total, used, free = shutil.disk_usage(path)
    return DiskUsage(path=path, used_gb=round(used / (1024**3), 2), total_gb=round(total / (1024**3), 2), percent=round(used / total * 100, 1))


def get_model_info() -> Optional[ModelInfo]:
    """Get current model info from .env config."""
    env_path = Path(INSTALL_DIR) / ".env"
    if env_path.exists():
        try:
            with open(env_path) as f:
                for line in f:
                    if line.startswith("LLM_MODEL="):
                        model_name = line.split("=", 1)[1].strip().strip('"\'')
                        size_gb, context, quant = 15.0, 32768, None
                        import re as _re
                        name_lower = model_name.lower()
                        if _re.search(r'\b7b\b', name_lower): size_gb = 4.0
                        elif _re.search(r'\b14b\b', name_lower): size_gb = 8.0
                        elif _re.search(r'\b32b\b', name_lower): size_gb = 16.0
                        elif _re.search(r'\b70b\b', name_lower): size_gb = 35.0
                        if "awq" in name_lower: quant = "AWQ"
                        elif "gptq" in name_lower: quant = "GPTQ"
                        elif "gguf" in name_lower: quant = "GGUF"
                        return ModelInfo(name=model_name, size_gb=size_gb, context_length=context, quantization=quant)
        except OSError as e:
            logger.warning("Failed to read .env for model info: %s", e)
    return None


def get_bootstrap_status() -> BootstrapStatus:
    """Get bootstrap download progress if active."""
    status_file = Path(DATA_DIR) / "bootstrap-status.json"
    if not status_file.exists():
        return BootstrapStatus(active=False)

    try:
        with open(status_file) as f:
            data = json.load(f)

        status = data.get("status", "")
        if status == "complete":
            return BootstrapStatus(active=False)
        if status == "" and not data.get("bytesDownloaded") and not data.get("percent"):
            return BootstrapStatus(active=False)

        eta_str = data.get("eta", "")
        eta_seconds = None
        if eta_str and eta_str.strip() and eta_str.strip() != "calculating...":
            try:
                parts = [p.strip() for p in eta_str.replace("m", "").replace("s", "").split() if p.strip()]
                if len(parts) == 2:
                    eta_seconds = int(parts[0]) * 60 + int(parts[1])
                elif len(parts) == 1:
                    eta_seconds = int(parts[0])
            except (ValueError, IndexError):
                pass

        bytes_downloaded = data.get("bytesDownloaded", 0)
        bytes_total = data.get("bytesTotal", 0)
        speed_bps = data.get("speedBytesPerSec", 0)

        percent_raw = data.get("percent")
        percent = None
        if percent_raw is not None:
            try:
                percent = float(percent_raw)
            except (ValueError, TypeError):
                pass

        return BootstrapStatus(
            active=True, model_name=data.get("model"), percent=percent,
            downloaded_gb=bytes_downloaded / (1024**3) if bytes_downloaded else None,
            total_gb=bytes_total / (1024**3) if bytes_total else None,
            speed_mbps=speed_bps / (1024**2) if speed_bps else None,
            eta_seconds=eta_seconds
        )
    except (json.JSONDecodeError, OSError, KeyError) as e:
        logger.warning("Failed to parse bootstrap status: %s", e)
        return BootstrapStatus(active=False)


def get_uptime() -> int:
    """Get system uptime in seconds (cross-platform)."""
    _system = platform.system()
    try:
        if _system == "Linux":
            with open("/proc/uptime") as f:
                return int(float(f.read().split()[0]))
        elif _system == "Darwin":
            import subprocess
            result = subprocess.run(
                ["sysctl", "-n", "kern.boottime"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                # Output: "{ sec = 1234567890, usec = 0 } ..."
                import re
                match = re.search(r"sec\s*=\s*(\d+)", result.stdout)
                if match:
                    import time as _time
                    return int(_time.time()) - int(match.group(1))
        elif _system == "Windows":
            import ctypes
            return ctypes.windll.kernel32.GetTickCount64() // 1000
    except Exception as e:
        logger.debug("get_uptime failed on %s: %s", _system, e)
    return 0


def _get_cpu_metrics_linux() -> dict:
    """Get CPU usage from /proc/stat (Linux only)."""
    result = {"percent": 0, "temp_c": None}
    try:
        with open("/proc/stat") as f:
            line = f.readline()
        parts = line.split()
        if len(parts) >= 8:
            idle = int(parts[4]) + int(parts[5])
            total = sum(int(p) for p in parts[1:8])
            if not hasattr(get_cpu_metrics, "_prev"):
                get_cpu_metrics._prev = (idle, total)
            prev_idle, prev_total = get_cpu_metrics._prev
            d_idle, d_total = idle - prev_idle, total - prev_total
            get_cpu_metrics._prev = (idle, total)
            if d_total > 0:
                result["percent"] = round((1 - d_idle / d_total) * 100, 1)
    except OSError as e:
        logger.debug("Failed to read /proc/stat: %s", e)

    try:
        import glob
        for tz in sorted(glob.glob("/sys/class/thermal/thermal_zone*/type")):
            with open(tz) as f:
                zone_type = f.read().strip()
            if any(k in zone_type.lower() for k in ("k10temp", "coretemp", "cpu", "soc", "tctl")):
                with open(tz.replace("/type", "/temp")) as f:
                    result["temp_c"] = int(f.read().strip()) // 1000
                break
        if result["temp_c"] is None:
            for hwmon in sorted(glob.glob("/sys/class/hwmon/hwmon*/name")):
                with open(hwmon) as f:
                    name = f.read().strip()
                if name in ("k10temp", "coretemp", "zenpower"):
                    with open(hwmon.replace("/name", "/temp1_input")) as f:
                        result["temp_c"] = int(f.read().strip()) // 1000
                    break
    except OSError as e:
        logger.debug("Failed to read CPU temperature: %s", e)
    return result


def _get_cpu_metrics_darwin() -> dict:
    """Get CPU usage on macOS via host_processor_info."""
    result = {"percent": 0, "temp_c": None}
    try:
        import subprocess
        out = subprocess.run(
            ["top", "-l", "1", "-n", "0", "-stats", "cpu"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0:
            import re
            match = re.search(r"CPU usage:\s+([\d.]+)%\s+user.*?([\d.]+)%\s+sys", out.stdout)
            if match:
                result["percent"] = round(float(match.group(1)) + float(match.group(2)), 1)
    except Exception as e:
        logger.debug("macOS CPU metrics failed: %s", e)
    return result


def get_cpu_metrics() -> dict:
    """Get CPU usage percentage and temperature (cross-platform)."""
    _system = platform.system()
    if _system == "Linux":
        return _get_cpu_metrics_linux()
    elif _system == "Darwin":
        return _get_cpu_metrics_darwin()
    return {"percent": 0, "temp_c": None}


def _get_ram_metrics_linux() -> dict:
    """Get RAM usage from /proc/meminfo (Linux only)."""
    result = {"used_gb": 0, "total_gb": 0, "percent": 0}
    try:
        meminfo = {}
        with open("/proc/meminfo") as f:
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    meminfo[parts[0].rstrip(":")] = int(parts[1])
        total = meminfo.get("MemTotal", 0)
        available = meminfo.get("MemAvailable", 0)
        used = total - available
        result["total_gb"] = round(total / (1024 * 1024), 1)
        result["used_gb"] = round(used / (1024 * 1024), 1)
        if total > 0:
            result["percent"] = round(used / total * 100, 1)
    except OSError as e:
        logger.debug("Failed to read /proc/meminfo: %s", e)
    return result


def _get_ram_metrics_sysctl() -> dict:
    """Get RAM usage on macOS via sysctl."""
    result = {"used_gb": 0, "total_gb": 0, "percent": 0}
    try:
        import subprocess
        out = subprocess.run(
            ["sysctl", "-n", "hw.memsize"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode == 0:
            total_bytes = int(out.stdout.strip())
            total_gb = total_bytes / (1024 ** 3)
            result["total_gb"] = round(total_gb, 1)
            # vm_stat for used memory
            vm = subprocess.run(
                ["vm_stat"], capture_output=True, text=True, timeout=5,
            )
            if vm.returncode == 0:
                import re
                pages = {}
                for line in vm.stdout.splitlines():
                    match = re.match(r"(.+?):\s+(\d+)", line)
                    if match:
                        pages[match.group(1).strip()] = int(match.group(2))
                page_size = 16384  # default on Apple Silicon
                ps_match = re.search(r"page size of (\d+) bytes", vm.stdout)
                if ps_match:
                    page_size = int(ps_match.group(1))
                active = pages.get("Pages active", 0)
                wired = pages.get("Pages wired down", 0)
                compressed = pages.get("Pages occupied by compressor", 0)
                used_bytes = (active + wired + compressed) * page_size
                result["used_gb"] = round(used_bytes / (1024 ** 3), 1)
                if total_bytes > 0:
                    result["percent"] = round(used_bytes / total_bytes * 100, 1)
    except Exception as e:
        logger.debug("macOS RAM metrics failed: %s", e)
    return result


def get_ram_metrics() -> dict:
    """Get RAM usage (cross-platform)."""
    _system = platform.system()
    if _system == "Linux":
        return _get_ram_metrics_linux()
    elif _system == "Darwin":
        return _get_ram_metrics_sysctl()
    return {"used_gb": 0, "total_gb": 0, "percent": 0}
