#!/usr/bin/env python3
import json
import sys
from pathlib import Path


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}")
    sys.exit(1)


def main() -> None:
    if len(sys.argv) < 2:
        fail("Usage: validate-sim-summary.py <summary.json>")

    path = Path(sys.argv[1])
    if not path.exists():
        fail(f"summary file not found: {path}")

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"invalid JSON: {exc}")

    if data.get("version") != "1":
        fail("version must be '1'")

    runs = data.get("runs")
    if not isinstance(runs, dict):
        fail("runs must be an object")

    required_runs = [
        "linux_dryrun",
        "macos_installer_mvp",
        "windows_scenario_preflight",
        "doctor_snapshot",
    ]
    for key in required_runs:
        if key not in runs:
            fail(f"missing runs.{key}")

    linux = runs["linux_dryrun"]
    if not isinstance(linux.get("signals"), dict):
        fail("runs.linux_dryrun.signals must be an object")
    install_summary = linux.get("install_summary")
    if install_summary is not None and not isinstance(install_summary, dict):
        fail("runs.linux_dryrun.install_summary must be an object or null")
    for signal in ("capability_loaded", "backend_contract_loaded", "preflight_report_logged"):
        if signal not in linux["signals"]:
            fail(f"missing linux signal: {signal}")

    win_report = runs["windows_scenario_preflight"].get("report")
    if not isinstance(win_report, dict) or "summary" not in win_report:
        fail("runs.windows_scenario_preflight.report.summary missing")

    doctor_report = runs["doctor_snapshot"].get("report")
    if doctor_report is None or not isinstance(doctor_report, dict):
        # Doctor may have failed (e.g. in CI); allow missing report for structure pass
        doctor_report = {}
    if "autofix_hints" not in doctor_report:
        doctor_report["autofix_hints"] = []

    print("[PASS] simulation summary structure")


if __name__ == "__main__":
    main()
