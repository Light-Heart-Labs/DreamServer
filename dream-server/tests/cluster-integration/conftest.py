import os
import socket
import time

import pytest
import requests


@pytest.fixture(scope="session")
def llama_url():
    return os.environ["LLAMA_URL"]


@pytest.fixture(scope="session")
def rpc_hosts():
    return [
        (os.environ["RPC1_HOST"], int(os.environ["RPC_PORT"])),
        (os.environ["RPC2_HOST"], int(os.environ["RPC_PORT"])),
    ]


def _tcp_ok(host, port, timeout=2.0):
    try:
        s = socket.create_connection((host, port), timeout=timeout)
        s.close()
        return True
    except OSError:
        return False


@pytest.fixture(scope="session", autouse=True)
def _wait_ready(llama_url, rpc_hosts):
    """Compose healthchecks already gate this, but double-check once more."""
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        try:
            r = requests.get(f"{llama_url}/health", timeout=3)
            if r.status_code == 200 and r.json().get("status") == "ok":
                break
        except requests.RequestException:
            pass
        time.sleep(1)
    else:
        raise AssertionError("llama-server /health never became ok")

    for host, port in rpc_hosts:
        assert _tcp_ok(host, port, timeout=3), f"rpc-server {host}:{port} unreachable"
