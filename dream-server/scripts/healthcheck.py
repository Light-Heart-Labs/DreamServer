#!/usr/bin/env python3
"""
Universal health check script for Dream Server offline mode.

Works across container images without requiring curl or wget.
"""

from __future__ import annotations

import argparse
import socket
import sys
import urllib.error
import urllib.request


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check an HTTP endpoint or TCP host:port target."
    )
    parser.add_argument(
        "target",
        help="Health target. Use http(s)://... for HTTP or host:port for TCP.",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=5.0,
        help="Request/connect timeout in seconds (default: 5).",
    )
    parser.add_argument(
        "--expect-status",
        type=int,
        default=200,
        help="Expected HTTP status for URL checks (default: 200).",
    )
    return parser.parse_args(argv)


def is_http_target(target: str) -> bool:
    return target.startswith(("http://", "https://"))


def parse_tcp_target(target: str) -> tuple[str, int]:
    host, separator, port_text = target.rpartition(":")
    if not separator or not host:
        raise ValueError(f"invalid TCP target: {target!r}")

    try:
        port = int(port_text)
    except ValueError as exc:
        raise ValueError(f"invalid TCP port: {port_text!r}") from exc

    if port <= 0 or port > 65535:
        raise ValueError(f"TCP port out of range: {port}")

    return host, port


def http_request(url: str, timeout: float, method: str) -> int:
    request = urllib.request.Request(url, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.status


def check_http(url: str, timeout: float, expected_status: int) -> bool:
    try:
        status = http_request(url, timeout, "HEAD")
    except urllib.error.HTTPError as exc:
        if exc.code in {405, 501}:
            try:
                status = http_request(url, timeout, "GET")
            except (urllib.error.HTTPError, urllib.error.URLError, socket.timeout):
                return False
        else:
            return False
    except (urllib.error.URLError, socket.timeout):
        return False

    return status == expected_status


def check_tcp(host: str, port: int, timeout: float) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.timeout <= 0:
        print("timeout must be greater than zero", file=sys.stderr)
        return 2

    if is_http_target(args.target):
        ok = check_http(args.target, args.timeout, args.expect_status)
        return 0 if ok else 1

    try:
        host, port = parse_tcp_target(args.target)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    ok = check_tcp(host, port, args.timeout)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
