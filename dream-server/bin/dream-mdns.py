#!/usr/bin/env python3
"""Dream Server mDNS announcer.

Publishes the device on the local network as `<DREAM_DEVICE_NAME>.local`
(default `dream.local`) plus per-service `_http._tcp` records so any device
on the same LAN can find the dashboard and chat UI without knowing the IP.

This makes the "open `dream.local` from any phone" UX work out of the box —
the device boots, joins WiFi, and starts announcing itself within seconds.

Reads `DREAM_DEVICE_NAME` and the service ports from `.env`. Re-publishes
when the file changes (poll-based, 30s cadence) so renaming the device or
changing a port doesn't require a service restart.

Linux-first: relies on `avahi-daemon` being installed and running (already
standard on Ubuntu / Debian / Fedora / Arch desktop installs). macOS has
built-in mDNS via mDNSResponder and announces hostname.local automatically;
this script is a no-op on Darwin (logs and exits 0). Windows mDNS support
varies — see BRANDING.md / docs/MDNS.md for follow-up.

Run via:
  python3 /opt/dream-server/bin/dream-mdns.py
or via the dream-mdns.service systemd unit.
"""

from __future__ import annotations

import logging
import os
import platform
import re
import signal
import socket
import sys
import time
from pathlib import Path

try:
    from zeroconf import IPVersion, ServiceInfo, Zeroconf
except ImportError:
    print(
        "ERROR: `zeroconf` Python package not installed. "
        "On Debian/Ubuntu: sudo apt install python3-zeroconf. "
        "On Fedora: sudo dnf install python3-zeroconf. "
        "On Arch: sudo pacman -S python-zeroconf.",
        file=sys.stderr,
    )
    sys.exit(1)

logging.basicConfig(
    level=os.environ.get("DREAM_MDNS_LOG_LEVEL", "INFO"),
    format="%(asctime)s [dream-mdns] %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

INSTALL_DIR = Path(os.environ.get("DREAM_INSTALL_DIR", "/opt/dream-server"))
ENV_FILE = INSTALL_DIR / ".env"
POLL_INTERVAL = int(os.environ.get("DREAM_MDNS_POLL_INTERVAL", "30"))

# Hostname-safe pattern matches DREAM_DEVICE_NAME schema in .env.schema.json.
_HOSTNAME_RE = re.compile(r"^[a-zA-Z0-9]([a-zA-Z0-9-]{0,30}[a-zA-Z0-9])?$")


def _read_env() -> dict[str, str]:
    """Return current .env values, ignoring comments and blank lines."""
    if not ENV_FILE.is_file():
        return {}
    env: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def _get_local_ip() -> str:
    """Best-effort local IPv4 address for the LAN-facing interface.

    Opens a UDP socket to a non-routable address — the kernel picks the
    interface it would use to reach the public internet, which is the same
    interface we want to announce on. Never actually sends a packet.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        ip: str = s.getsockname()[0]
    except OSError:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


def _build_services(env: dict[str, str], device_name: str, ip: str) -> list[ServiceInfo]:
    """Build the ServiceInfo records to publish.

    Each entry advertises a port on the host (the external port the user
    actually browses to), not the container-internal port. We only publish
    services whose port is configured — if the dashboard isn't running on
    this device, we don't announce it.
    """
    addresses = [socket.inet_aton(ip)]
    services: list[tuple[str, int, str, dict[str, str]]] = [
        # (service_type_prefix, port, label, extra_txt)
        ("dashboard",   int(env.get("DASHBOARD_PORT", "3001")), "Dream Dashboard", {"path": "/"}),
        ("chat",        int(env.get("WEBUI_PORT", "3000")),     "Dream Chat",      {"path": "/"}),
        ("dashboard-api", int(env.get("DASHBOARD_API_PORT", "3002")), "Dream API", {"path": "/health"}),
    ]
    infos: list[ServiceInfo] = []
    for suffix, port, label, txt in services:
        if port <= 0:
            continue
        full_name = f"{device_name}-{suffix}._http._tcp.local."
        info = ServiceInfo(
            type_="_http._tcp.local.",
            name=full_name,
            addresses=addresses,
            port=port,
            properties={**txt, "label": label, "device": device_name},
            server=f"{device_name}.local.",
        )
        infos.append(info)
    return infos


class Announcer:
    """Manages the lifecycle of mDNS service publications.

    Holds onto the active Zeroconf handle and the currently-registered
    services so a config change can re-register cleanly.
    """

    def __init__(self) -> None:
        self.zc: Zeroconf | None = None
        self.registered: list[ServiceInfo] = []
        self.last_signature: tuple[str, str, int, int, int] | None = None

    def _config_signature(self, device_name: str, ip: str, env: dict[str, str]) -> tuple[str, str, int, int, int]:
        """Compact summary of what we'd publish — re-announce on change."""
        return (
            device_name,
            ip,
            int(env.get("DASHBOARD_PORT", "3001")),
            int(env.get("WEBUI_PORT", "3000")),
            int(env.get("DASHBOARD_API_PORT", "3002")),
        )

    def refresh(self) -> None:
        env = _read_env()
        device_name = env.get("DREAM_DEVICE_NAME", "dream") or "dream"
        if not _HOSTNAME_RE.match(device_name):
            logger.warning(
                "DREAM_DEVICE_NAME %r is not hostname-safe; falling back to 'dream'",
                device_name,
            )
            device_name = "dream"
        ip = _get_local_ip()
        signature = self._config_signature(device_name, ip, env)
        if signature == self.last_signature and self.zc is not None:
            return

        if self.zc is not None:
            logger.info("Config changed — re-registering mDNS services")
            self._teardown()

        self.zc = Zeroconf(ip_version=IPVersion.V4Only)
        services = _build_services(env, device_name, ip)
        for info in services:
            self.zc.register_service(info)
            self.registered.append(info)
            logger.info(
                "Published %s -> %s:%d (server %s)",
                info.name, ip, info.port, info.server,
            )
        self.last_signature = signature

    def _teardown(self) -> None:
        if self.zc is None:
            return
        for info in self.registered:
            try:
                self.zc.unregister_service(info)
            except (OSError, RuntimeError) as exc:
                logger.warning("Failed to unregister %s: %s", info.name, exc)
        self.zc.close()
        self.zc = None
        self.registered = []

    def shutdown(self) -> None:
        logger.info("Shutting down mDNS announcer")
        self._teardown()


def main() -> int:
    if platform.system() == "Darwin":
        logger.info(
            "Darwin host detected — macOS mDNSResponder already announces hostname.local; "
            "this script is a no-op on macOS. Exiting cleanly."
        )
        return 0
    if platform.system() == "Windows":
        logger.info(
            "Windows host detected — mDNS support varies; this script is not yet supported on Windows. "
            "See docs for follow-up. Exiting cleanly."
        )
        return 0
    if not ENV_FILE.is_file():
        logger.error("Env file not found at %s — cannot determine device config.", ENV_FILE)
        return 1

    announcer = Announcer()

    def _on_signal(signum: int, _frame: object) -> None:
        logger.info("Received signal %d", signum)
        announcer.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    logger.info("Starting Dream mDNS announcer (poll every %ds)", POLL_INTERVAL)
    while True:
        try:
            announcer.refresh()
        except (OSError, RuntimeError) as exc:
            logger.exception("Refresh failed: %s", exc)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    sys.exit(main())
