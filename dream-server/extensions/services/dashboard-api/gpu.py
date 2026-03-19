"""GPU detection and metrics for NVIDIA, AMD, and Apple Silicon GPUs."""

import logging
import os
import platform
import subprocess
from typing import Optional

from models import GPUInfo

logger = logging.getLogger(__name__)


def run_command(cmd: list[str], timeout: int = 5) -> tuple[bool, str]:
    """Run a shell command and return (success, output)."""
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.returncode == 0, result.stdout.strip()
    except subprocess.TimeoutExpired:
        return False, "timeout"
    except (subprocess.SubprocessError, OSError) as e:
        return False, str(e)


def _read_sysfs(path: str) -> Optional[str]:
    """Read a sysfs file, returning None on failure."""
    try:
        with open(path, "r") as f:
            return f.read().strip()
    except (OSError, IOError):
        return None


def _find_amd_gpu_sysfs() -> Optional[str]:
    """Find the sysfs base path for an AMD GPU device."""
    import glob
    for card_dir in sorted(glob.glob("/sys/class/drm/card*/device")):
        vendor = _read_sysfs(f"{card_dir}/vendor")
        if vendor == "0x1002":
            return card_dir
    return None


def _find_hwmon_dir(device_path: str) -> Optional[str]:
    """Find the hwmon directory for an AMD GPU device."""
    import glob
    hwmon_dirs = sorted(glob.glob(f"{device_path}/hwmon/hwmon*"))
    return hwmon_dirs[0] if hwmon_dirs else None


def get_gpu_info_amd() -> Optional[GPUInfo]:
    """Get GPU metrics from amdgpu sysfs."""
    base = _find_amd_gpu_sysfs()
    if not base:
        return None

    hwmon = _find_hwmon_dir(base)

    try:
        vram_total_str = _read_sysfs(f"{base}/mem_info_vram_total")
        vram_used_str = _read_sysfs(f"{base}/mem_info_vram_used")
        gtt_total_str = _read_sysfs(f"{base}/mem_info_gtt_total")
        gtt_used_str = _read_sysfs(f"{base}/mem_info_gtt_used")
        gpu_busy_str = _read_sysfs(f"{base}/gpu_busy_percent")

        if not vram_total_str or not vram_used_str:
            return None

        vram_total = int(vram_total_str)
        vram_used = int(vram_used_str)
        gtt_total = int(gtt_total_str) if gtt_total_str else 0
        gtt_used = int(gtt_used_str) if gtt_used_str else 0
        gpu_busy = int(gpu_busy_str) if gpu_busy_str else 0

        is_unified = gtt_total > vram_total * 4

        if is_unified:
            mem_total = gtt_total
            mem_used = gtt_used
        else:
            mem_total = vram_total
            mem_used = vram_used

        temp = 0
        power_w = None
        if hwmon:
            temp_str = _read_sysfs(f"{hwmon}/temp1_input")
            if temp_str:
                temp = int(temp_str) // 1000

            power_str = _read_sysfs(f"{hwmon}/power1_average")
            if power_str:
                power_w = round(int(power_str) / 1e6, 1)

        gpu_name = _read_sysfs(f"{base}/product_name") or "AMD Radeon (Strix Halo)"
        memory_type = "unified" if is_unified else "discrete"

        mem_used_mb = mem_used // (1024 * 1024)
        mem_total_mb = mem_total // (1024 * 1024)

        return GPUInfo(
            name=gpu_name,
            memory_used_mb=mem_used_mb,
            memory_total_mb=mem_total_mb,
            memory_percent=round(mem_used_mb / mem_total_mb * 100, 1) if mem_total_mb > 0 else 0,
            utilization_percent=gpu_busy,
            temperature_c=temp,
            power_w=power_w,
            memory_type=memory_type,
            gpu_backend="amd",
        )
    except (ValueError, TypeError):
        return None


def get_gpu_info_nvidia() -> Optional[GPUInfo]:
    """Get GPU metrics from nvidia-smi.

    Handles multi-GPU systems by summing VRAM across all GPUs and
    reporting aggregate utilization and peak temperature.
    """
    success, output = run_command([
        "nvidia-smi",
        "--query-gpu=name,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw",
        "--format=csv,noheader,nounits"
    ])

    if not success or not output:
        return None

    # nvidia-smi returns one line per GPU; split before parsing
    lines = [l.strip() for l in output.strip().splitlines() if l.strip()]
    if not lines:
        return None

    try:
        gpus = []
        for line in lines:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 5:
                continue
            power_w = None
            if len(parts) >= 6 and parts[5] not in ("[N/A]", "[Not Supported]", "N/A", "Not Supported", ""):
                try:
                    power_w = round(float(parts[5]), 1)
                except (ValueError, TypeError):
                    pass
            gpus.append({
                "name": parts[0],
                "mem_used": int(parts[1]),
                "mem_total": int(parts[2]),
                "util": int(parts[3]),
                "temp": int(parts[4]),
                "power_w": power_w,
            })

        if not gpus:
            return None

        if len(gpus) == 1:
            g = gpus[0]
            mem_used, mem_total = g["mem_used"], g["mem_total"]
            return GPUInfo(
                name=g["name"],
                memory_used_mb=mem_used,
                memory_total_mb=mem_total,
                memory_percent=round(mem_used / mem_total * 100, 1) if mem_total > 0 else 0,
                utilization_percent=g["util"],
                temperature_c=g["temp"],
                power_w=g["power_w"],
                gpu_backend="nvidia",
            )

        # Multi-GPU: aggregate across all GPUs
        mem_used = sum(g["mem_used"] for g in gpus)
        mem_total = sum(g["mem_total"] for g in gpus)
        avg_util = round(sum(g["util"] for g in gpus) / len(gpus))
        max_temp = max(g["temp"] for g in gpus)
        total_power: Optional[float] = None
        power_values = [g["power_w"] for g in gpus if g["power_w"] is not None]
        if power_values:
            total_power = round(sum(power_values), 1)

        # Build a display name: "RTX 4090 × 2" or "RTX 3090 + RTX 4090"
        names = [g["name"] for g in gpus]
        if len(set(names)) == 1:
            display_name = f"{names[0]} \u00d7 {len(gpus)}"
        else:
            display_name = " + ".join(names[:2])
            if len(names) > 2:
                display_name += f" + {len(names) - 2} more"

        return GPUInfo(
            name=display_name,
            memory_used_mb=mem_used,
            memory_total_mb=mem_total,
            memory_percent=round(mem_used / mem_total * 100, 1) if mem_total > 0 else 0,
            utilization_percent=avg_util,
            temperature_c=max_temp,
            power_w=total_power,
            gpu_backend="nvidia",
        )
    except (ValueError, IndexError):
        pass

    return None


def get_gpu_info_apple() -> Optional[GPUInfo]:
    """Get GPU metrics for Apple Silicon via system_profiler (native) or env vars (container)."""
    gpu_backend = os.environ.get("GPU_BACKEND", "").lower()

    if platform.system() == "Darwin":
        try:
            # Get chip name
            success, chip_output = run_command(["sysctl", "-n", "machdep.cpu.brand_string"])
            chip_name = chip_output.strip() if success else "Apple Silicon"

            # Get total memory (unified memory on Apple Silicon)
            success, mem_output = run_command(["sysctl", "-n", "hw.memsize"])
            if not success:
                return None

            total_bytes = int(mem_output.strip())
            total_mb = total_bytes // (1024 * 1024)

            # Estimate used memory from vm_stat
            used_mb = 0
            success, vm_output = run_command(["vm_stat"])
            if success:
                import re
                pages = {}
                for line in vm_output.splitlines():
                    match = re.match(r"(.+?):\s+(\d+)", line)
                    if match:
                        pages[match.group(1).strip()] = int(match.group(2))
                page_size = 16384
                ps_match = re.search(r"page size of (\d+) bytes", vm_output)
                if ps_match:
                    page_size = int(ps_match.group(1))
                active = pages.get("Pages active", 0)
                wired = pages.get("Pages wired down", 0)
                compressed = pages.get("Pages occupied by compressor", 0)
                used_mb = (active + wired + compressed) * page_size // (1024 * 1024)

            return GPUInfo(
                name=chip_name,
                memory_used_mb=used_mb,
                memory_total_mb=total_mb,
                memory_percent=round(used_mb / total_mb * 100, 1) if total_mb > 0 else 0,
                utilization_percent=0,  # not easily available without IOKit
                temperature_c=0,
                power_w=None,
                memory_type="unified",
                gpu_backend="apple",
            )
        except (ValueError, TypeError) as e:
            logger.debug("Apple Silicon GPU detection failed: %s", e)
            return None

    elif gpu_backend == "apple":
        # Linux container path (Docker Desktop on macOS): use HOST_RAM_GB env var
        host_ram_gb_str = os.environ.get("HOST_RAM_GB", "")
        if not host_ram_gb_str:
            return None
        try:
            host_ram_gb_float = float(host_ram_gb_str)
        except ValueError:
            return None
        if host_ram_gb_float <= 0:
            return None
        total_mb = int(host_ram_gb_float * 1024)
        # Use /proc/meminfo for used memory (best available proxy inside container)
        # Note: used_mb reflects Docker Desktop VM memory pressure, not the host Mac's.
        # Total is correctly overridden by HOST_RAM_GB. See issue #102 for a future
        # host-metrics collector that would fix used_mb.
        used_mb = 0
        try:
            with open("/proc/meminfo") as f:
                meminfo = {}
                for line in f:
                    parts = line.split()
                    if len(parts) >= 2:
                        meminfo[parts[0].rstrip(":")] = int(parts[1])
            avail = meminfo.get("MemAvailable", 0)
            total_kb = meminfo.get("MemTotal", 0)
            used_mb = (total_kb - avail) // 1024
        except OSError:
            pass
        return GPUInfo(
            name=f"Apple M-Series ({int(host_ram_gb_float)} GB Unified)",
            memory_used_mb=used_mb,
            memory_total_mb=total_mb,
            memory_percent=round(used_mb / total_mb * 100, 1) if total_mb > 0 else 0,
            utilization_percent=0,
            temperature_c=0,
            power_w=None,
            memory_type="unified",
            gpu_backend="apple",
        )

    return None


def get_gpu_info() -> Optional[GPUInfo]:
    """Get GPU metrics. Tries the configured backend first, then auto-detects."""
    gpu_backend = os.environ.get("GPU_BACKEND", "").lower()

    if gpu_backend == "amd":
        info = get_gpu_info_amd()
        if info:
            return info

    if gpu_backend == "apple":
        info = get_gpu_info_apple()
        if info:
            return info

    info = get_gpu_info_nvidia()
    if info:
        return info

    if gpu_backend != "amd":
        info = get_gpu_info_amd()
        if info:
            return info

    # Auto-detect Apple Silicon if no backend specified and nothing else found
    if platform.system() == "Darwin":
        return get_gpu_info_apple()

    return None


def get_gpu_tier(vram_gb: float, memory_type: str = "discrete") -> str:
    """Get tier name based on VRAM."""
    if memory_type == "unified":
        if vram_gb >= 90:
            return "Strix Halo 90+"
        else:
            return "Strix Halo Compact"
    if vram_gb >= 80:
        return "Professional"
    elif vram_gb >= 24:
        return "Prosumer"
    elif vram_gb >= 16:
        return "Standard"
    elif vram_gb >= 8:
        return "Entry"
    else:
        return "Minimal"
