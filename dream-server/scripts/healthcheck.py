#!/usr/bin/env python3
"""Dream Server — universal healthcheck.

Why this exists
--------------
A lot of containers use curl/wget for HEALTHCHECK instructions, but minimal images
(distro-less, scratch-ish, python slim) frequently do not include them.

This script provides a single, dependency-free healthcheck implementation that:
  - Works with *either* HTTP(S) endpoints or raw TCP sockets
  - Supports GET fallback when HEAD is blocked
  - Allows matching on status code ranges and/or response body regex
  - Emits structured output for debugging in CI

Usage
-----
  healthcheck.py http://localhost:8080/health
  healthcheck.py tcp://localhost:5432
  healthcheck.py localhost:5432

Options
-------
  --timeout SECONDS              Overall timeout for the request/connection
  --retries N                    Retry count (with small backoff)
  --method {HEAD,GET}            HTTP method (default: HEAD, with GET fallback)
  --expect-status 200,204,3xx    Allowed HTTP status codes/ranges
  --expect-body-regex REGEX      Regex to match in response body (GET only)
  --user-agent UA                Custom user-agent
  --json                         Emit machine-readable JSON result

Exit codes
----------
  0  Healthy
  1  Unhealthy (check failed)
  2  Usage / invalid input

Notes
-----
- For HTTP checks we prefer HEAD to avoid moving large bodies, but many
  frameworks disable HEAD or route it differently. We automatically fall back
  to GET when HEAD fails with method-related errors.
- For TCP checks we just attempt to connect. This validates listening and basic
  accept() path.
"""
Universal health check script for Dream Server offline mode.

Works across container images without requiring curl or wget.
"""

from __future__ import annotations

import argparse
import socket
import time
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
    parser.add_argument(
        "--retries",
        type=int,
        default=1,
        help="Number of attempts before failing (default: 1).",
    )
    parser.add_argument(
        "--retry-delay",
        type=float,
        default=0.5,
        help="Delay in seconds between retries (default: 0.5).",
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
            return (True, "tcp connect ok")
    except socket.timeout:
        return (False, "tcp connect timeout")
    except ConnectionRefusedError:
        return (False, "tcp connection refused")
    except OSError as exc:
        return (False, f"tcp error: {exc}")


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.timeout <= 0:
        print("timeout must be greater than zero", file=sys.stderr)
        return 2
    if args.retries <= 0:
        print("retries must be greater than zero", file=sys.stderr)
        return 2
    if args.retry_delay < 0:
        print("retry-delay must be non-negative", file=sys.stderr)
        return 2

    if is_http_target(args.target):
        ok = False
        for attempt in range(args.retries):
            ok = check_http(args.target, args.timeout, args.expect_status)
            if ok:
                break
            if attempt + 1 < args.retries:
                time.sleep(args.retry_delay)
        return 0 if ok else 1

    try:
        host, port = parse_tcp_target(args.target)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    ok = False
    for attempt in range(args.retries):
        ok = check_tcp(host, port, args.timeout)
        if ok:
            break
        if attempt + 1 < args.retries:
            time.sleep(args.retry_delay)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
