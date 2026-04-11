#!/usr/bin/env python3
"""
Cluster supervisor for llama-server.

Wraps llama-server with pre-flight checks, auto-restart on crash, and a
watchdog that monitors worker reachability. Key behaviors:

  - On crash: checks which workers are alive, restarts with only live
    workers (strips dead ones from --rpc to avoid 20-75s connect timeout).
  - Degraded mode: if some workers are down but remaining devices can hold
    the model, inference continues on fewer nodes.
  - Recovery: watchdog detects when a dead worker comes back online and
    triggers a restart to re-add it (full --rpc restored).
  - Hung detection: if a worker is unreachable AND llama-server stops
    responding to /health, the watchdog kills the hung process so the
    restart loop can proceed.

llama.cpp RPC has zero fault tolerance — when a worker disconnects, the
controller calls ggml_abort() and terminates with exit 134 (SIGABRT).
Network partitions cause indefinite hangs (no SO_KEEPALIVE or timeouts).

Env vars:
  CLUSTER_WORKERS         — comma-separated host:port list (required)
  CLUSTER_RESTART_POLICY  — always | on-worker-recovery | manual (default: always)

If CLUSTER_WORKERS is empty, the supervisor execs llama-server directly
(transparent passthrough for non-cluster setups).
"""
import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time

PREFLIGHT_TIMEOUT = 5       # seconds per worker TCP check
POLL_INTERVAL = 2           # health poll interval during recovery wait
RESTART_DELAY = 3           # seconds between crash and restart attempt
MAX_WORKER_WAIT = 15        # seconds to wait for offline workers before degraded restart
WATCHDOG_INTERVAL = 5       # seconds between watchdog TCP pings
WATCHDOG_TCP_TIMEOUT = 3    # seconds per watchdog TCP check
HEALTH_CHECK_TIMEOUT = 5    # seconds for llama-server /health check
LLAMA_HEALTH_URL = "http://127.0.0.1:8080/health"
EVENTS_FILE = "/tmp/cluster-events/events.json"

# Module-level ref so the SIGTERM handler and watchdog can reach the child.
_child_proc = None
_child_lock = threading.Lock()


def _handle_term(signum, frame):
    """Forward SIGTERM to child llama-server, then exit cleanly."""
    with _child_lock:
        if _child_proc and _child_proc.poll() is None:
            _child_proc.terminate()
    sys.exit(0)


def parse_workers(rpc_flag):
    """Parse comma-separated host:port list into list of (host, port) tuples."""
    workers = []
    for addr in rpc_flag.split(","):
        addr = addr.strip()
        if ":" in addr:
            host, port = addr.rsplit(":", 1)
            workers.append((host, int(port)))
    return workers


def workers_to_rpc(workers):
    """Convert list of (host, port) tuples back to --rpc flag value."""
    return ",".join(f"{h}:{p}" for h, p in workers)


def check_worker(host, port, timeout=PREFLIGHT_TIMEOUT):
    """TCP connect check. Returns True if reachable."""
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
        sock.close()
        return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def partition_workers(workers):
    """Split workers into (live, dead) lists based on TCP reachability."""
    live, dead = [], []
    for host, port in workers:
        if check_worker(host, port):
            live.append((host, port))
        else:
            dead.append((host, port))
    return live, dead


def log_event(event_type, detail=""):
    """Append event to JSON file for dashboard consumption."""
    os.makedirs(os.path.dirname(EVENTS_FILE), exist_ok=True)
    events = []
    if os.path.exists(EVENTS_FILE):
        with open(EVENTS_FILE) as f:
            events = json.load(f)
    events.append({
        "type": event_type,
        "detail": detail,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    events = events[-100:]
    tmp = EVENTS_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(events, f)
    os.replace(tmp, EVENTS_FILE)


def run_server(cmd):
    """Launch llama-server and wait for it to exit. Returns exit code."""
    global _child_proc
    with _child_lock:
        _child_proc = subprocess.Popen(cmd)
    try:
        return _child_proc.wait()
    except KeyboardInterrupt:
        _child_proc.terminate()
        _child_proc.wait()
        return 0
    finally:
        with _child_lock:
            _child_proc = None


def check_llama_health():
    """HTTP health check on llama-server. Returns True if responding."""
    import urllib.request
    try:
        req = urllib.request.urlopen(LLAMA_HEALTH_URL, timeout=HEALTH_CHECK_TIMEOUT)
        return req.status == 200
    except Exception:
        return False


def build_cmd(base_args, active_workers):
    """Build llama-server command, replacing --rpc with active workers only."""
    cmd = ["llama-server"]
    skip_next = False
    for i, arg in enumerate(base_args):
        if skip_next:
            skip_next = False
            continue
        if arg == "--rpc":
            cmd.append("--rpc")
            cmd.append(workers_to_rpc(active_workers))
            skip_next = True  # skip original --rpc value
        else:
            cmd.append(arg)
    return cmd


def watchdog(all_workers, active_workers, stop_event, restart_reason):
    """Background thread: monitors worker health while llama-server runs.

    Two jobs:
    1. If an active worker goes down AND llama-server is hung (not
       responding to /health), kill it so supervisor can restart with
       remaining workers. Never kills a responsive llama-server.
    2. If a previously-dead worker comes back online, signal the main
       loop to restart with the full worker set.
    """
    worker_was_offline = set()
    dead_workers = set(f"{h}:{p}" for h, p in all_workers) - set(f"{h}:{p}" for h, p in active_workers)

    while not stop_event.is_set():
        stop_event.wait(WATCHDOG_INTERVAL)
        if stop_event.is_set():
            break

        # Check active workers
        for host, port in active_workers:
            key = f"{host}:{port}"
            if not check_worker(host, port, timeout=WATCHDOG_TCP_TIMEOUT):
                if key not in worker_was_offline:
                    print(f"[WATCHDOG] Active worker {key} unreachable")
                    log_event("worker_unreachable", f"Worker {key} unreachable")
                    worker_was_offline.add(key)
                # Worker down — check if llama-server is hung
                if not check_llama_health():
                    print(f"[WATCHDOG] llama-server not responding (worker {key} down) — restarting")
                    log_event("watchdog_restart", f"llama-server hung, worker {key} unreachable")
                    restart_reason.append("hung")
                    with _child_lock:
                        if _child_proc and _child_proc.poll() is None:
                            _child_proc.kill()
                    return
            else:
                if key in worker_was_offline:
                    print(f"[WATCHDOG] Worker {key} back online")
                    log_event("worker_recovered", f"Worker {key} back online")
                    worker_was_offline.discard(key)

        # Check dead workers — did any come back?
        if dead_workers:
            recovered = set()
            for key in dead_workers:
                host, port_s = key.rsplit(":", 1)
                if check_worker(host, int(port_s), timeout=WATCHDOG_TCP_TIMEOUT):
                    recovered.add(key)
            if recovered:
                print(f"[WATCHDOG] Dead workers recovered: {', '.join(recovered)} — restarting to re-add")
                log_event("workers_recovered", f"Recovered: {', '.join(recovered)}")
                restart_reason.append("recovery")
                with _child_lock:
                    if _child_proc and _child_proc.poll() is None:
                        _child_proc.terminate()
                return


def main():
    cluster_workers = os.environ.get("CLUSTER_WORKERS", "")
    if not cluster_workers:
        os.execvp("llama-server", ["llama-server"] + sys.argv[1:])

    restart_policy = os.environ.get("CLUSTER_RESTART_POLICY", "always")
    all_workers = parse_workers(cluster_workers)
    base_args = sys.argv[1:]

    print(f"[SUPERVISOR] Cluster mode enabled. Workers: {cluster_workers}")
    print(f"[SUPERVISOR] Restart policy: {restart_policy}")
    print(f"[SUPERVISOR] Watchdog: ping every {WATCHDOG_INTERVAL}s, degraded mode enabled")

    degraded = False  # True when running with fewer workers than configured

    while True:
        # Check which workers are alive
        live, dead = partition_workers(all_workers)

        if dead:
            dead_str = ", ".join(f"{h}:{p}" for h, p in dead)

            if not live:
                # No workers at all — wait and retry
                log_event("all_workers_offline", f"All offline: {dead_str}")
                print(f"[SUPERVISOR] All workers offline: {dead_str}")

                if restart_policy == "manual":
                    print("[SUPERVISOR] Restart policy is 'manual'. Exiting.")
                    break

                print(f"[SUPERVISOR] Waiting up to {MAX_WORKER_WAIT}s for any worker...")
                deadline = time.time() + MAX_WORKER_WAIT
                while time.time() < deadline:
                    live, dead = partition_workers(all_workers)
                    if live:
                        break
                    time.sleep(POLL_INTERVAL)

                if not live:
                    if restart_policy == "on-worker-recovery":
                        print("[SUPERVISOR] No workers recovered. Exiting.")
                        break
                    # "always" — start with just controller GPU (no --rpc workers)
                    print("[SUPERVISOR] No workers recovered. Starting with controller GPU only...")
                    live = []

            if dead:
                dead_str = ", ".join(f"{h}:{p}" for h, p in dead)
                if live:
                    live_str = ", ".join(f"{h}:{p}" for h, p in live)
                    print(f"[SUPERVISOR] Degraded mode: using {live_str} (offline: {dead_str})")
                    log_event("degraded_start", f"Live: {live_str}, offline: {dead_str}")
                    degraded = True
                else:
                    print(f"[SUPERVISOR] Controller-only mode (all workers offline: {dead_str})")
                    log_event("controller_only_start", f"All workers offline: {dead_str}")
                    degraded = True
        else:
            if degraded:
                print("[SUPERVISOR] All workers back — full cluster restored")
                log_event("full_cluster_restored", f"Workers: {cluster_workers}")
                degraded = False

        # Build command with only live workers
        if live:
            cmd = build_cmd(base_args, live)
            active_str = workers_to_rpc(live)
        else:
            # No live workers — remove --rpc entirely, run on controller GPU only
            cmd = ["llama-server"]
            skip_next = False
            for arg in base_args:
                if skip_next:
                    skip_next = False
                    continue
                if arg == "--rpc":
                    skip_next = True
                    continue
                cmd.append(arg)
            active_str = "(controller only)"

        log_event("server_starting", f"Active workers: {active_str}")
        print(f"[SUPERVISOR] Starting llama-server with: {active_str}")

        # Start watchdog
        stop_watchdog = threading.Event()
        restart_reason = []  # watchdog writes reason here: "hung" or "recovery"
        wd_thread = threading.Thread(
            target=watchdog,
            args=(all_workers, live, stop_watchdog, restart_reason),
            daemon=True,
        )
        wd_thread.start()

        exit_code = run_server(cmd)

        stop_watchdog.set()
        wd_thread.join(timeout=5)

        if exit_code == 0 and not restart_reason:
            log_event("server_stopped", "Clean shutdown (exit 0)")
            print("[SUPERVISOR] llama-server exited cleanly.")
            break

        # Log what happened
        if restart_reason and restart_reason[0] == "recovery":
            detail = "Restarting to re-add recovered workers"
        elif restart_reason and restart_reason[0] == "hung":
            detail = "Killed hung llama-server (network partition)"
        else:
            detail = f"Exit code: {exit_code}"
            if exit_code == 134:
                detail += " (SIGABRT — RPC worker disconnected)"

        log_event("server_crashed", detail)
        print(f"[SUPERVISOR] llama-server exited: {detail}")

        if restart_policy == "manual" and not restart_reason:
            log_event("manual_intervention_required", detail)
            print("[SUPERVISOR] Restart policy is 'manual'. Exiting.")
            break

        time.sleep(RESTART_DELAY)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, _handle_term)
    main()
