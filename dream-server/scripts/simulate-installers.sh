#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-${ROOT_DIR}/artifacts/installer-sim}"
mkdir -p "$OUT_DIR"

LINUX_LOG="${OUT_DIR}/linux-dryrun.log"
LINUX_SUMMARY_JSON="${OUT_DIR}/linux-install-summary.json"
MACOS_LOG="${OUT_DIR}/macos-installer.log"
WINDOWS_SIM_JSON="${OUT_DIR}/windows-preflight-sim.json"
MACOS_PREFLIGHT_JSON="${OUT_DIR}/macos-preflight.json"
MACOS_DOCTOR_JSON="${OUT_DIR}/macos-doctor.json"
DOCTOR_JSON="${OUT_DIR}/doctor.json"
SUMMARY_JSON="${OUT_DIR}/summary.json"
SUMMARY_MD="${OUT_DIR}/SUMMARY.md"

FAKEBIN="$(mktemp -d)"
trap 'rm -rf "$FAKEBIN"' EXIT
cat > "${FAKEBIN}/curl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "${FAKEBIN}/curl"

cd "$ROOT_DIR"

# 1) Linux installer dry-run simulation
LINUX_EXIT=0
if ! PATH="${FAKEBIN}:$PATH" bash install-core.sh --dry-run --non-interactive --skip-docker --force --summary-json "$LINUX_SUMMARY_JSON" >"$LINUX_LOG" 2>&1; then
  LINUX_EXIT=$?
fi

# 2) macOS installer MVP simulation
MACOS_EXIT=0
if ! bash installers/macos.sh --no-delegate --report "$MACOS_PREFLIGHT_JSON" --doctor-report "$MACOS_DOCTOR_JSON" >"$MACOS_LOG" 2>&1; then
  MACOS_EXIT=$?
fi

# 3) Windows scenario simulation via preflight engine (since pwsh may be unavailable in CI/sandbox)
scripts/preflight-engine.sh \
  --report "$WINDOWS_SIM_JSON" \
  --tier T1 \
  --ram-gb 16 \
  --disk-gb 120 \
  --gpu-backend nvidia \
  --gpu-vram-mb 12288 \
  --gpu-name "RTX 3060" \
  --platform-id windows \
  --compose-overlays docker-compose.base.yml,docker-compose.nvidia.yml \
  --script-dir "$ROOT_DIR" \
  --env >/dev/null

# 4) Doctor snapshot for current machine context
DOCTOR_EXIT=0
if ! scripts/dream-doctor.sh "$DOCTOR_JSON" >/dev/null 2>&1; then
  DOCTOR_EXIT=$?
fi

PYTHON_CMD="python3"
if [[ -f "$ROOT_DIR/lib/python-cmd.sh" ]]; then
  . "$ROOT_DIR/lib/python-cmd.sh"
  PYTHON_CMD="$(ds_detect_python_cmd)"
elif command -v python >/dev/null 2>&1; then
  PYTHON_CMD="python"
fi

"$PYTHON_CMD" - "$SUMMARY_JSON" "$SUMMARY_MD" "$LINUX_LOG" "$MACOS_LOG" "$WINDOWS_SIM_JSON" "$MACOS_PREFLIGHT_JSON" "$MACOS_DOCTOR_JSON" "$DOCTOR_JSON" "$LINUX_SUMMARY_JSON" "$LINUX_EXIT" "$MACOS_EXIT" "$DOCTOR_EXIT" <<'PY'
import json
import pathlib
import re
import sys
from datetime import datetime, timezone

(
    summary_json_path,
    summary_md_path,
    linux_log,
    macos_log,
    windows_sim_json,
    macos_preflight_json,
    macos_doctor_json,
    doctor_json,
    linux_install_summary_json,
    linux_exit,
    macos_exit,
    doctor_exit,
) = sys.argv[1:]

def load_json(path):
    p = pathlib.Path(path)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None

linux_text = pathlib.Path(linux_log).read_text(encoding="utf-8", errors="replace") if pathlib.Path(linux_log).exists() else ""
macos_text = pathlib.Path(macos_log).read_text(encoding="utf-8", errors="replace") if pathlib.Path(macos_log).exists() else ""

linux_signals = {
    "capability_loaded": bool(re.search(r"Capability profile loaded", linux_text)),
    "hardware_class_logged": bool(re.search(r"Hardware class:", linux_text)),
    "backend_contract_loaded": bool(re.search(r"Backend contract loaded", linux_text)),
    "preflight_report_logged": bool(re.search(r"Preflight report:", linux_text)),
    "compose_selection_logged": bool(re.search(r"Compose selection:", linux_text)),
}

summary = {
    "version": "1",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "runs": {
        "linux_dryrun": {
            "exit_code": int(linux_exit),
            "signals": linux_signals,
            "log": linux_log,
            "install_summary": load_json(linux_install_summary_json) or {},
        },
        "macos_installer_mvp": {
            "exit_code": int(macos_exit),
            "log": macos_log,
            "preflight": load_json(macos_preflight_json),
            "doctor": load_json(macos_doctor_json),
        },
        "windows_scenario_preflight": {
            "report": load_json(windows_sim_json),
        },
        "doctor_snapshot": {
            "exit_code": int(doctor_exit),
            "report": load_json(doctor_json),
        },
    },
}

pathlib.Path(summary_json_path).write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")

lines = []
lines.append("# Installer Simulation Summary")
lines.append("")
lines.append(f"Generated: {summary['generated_at']}")
lines.append("")
lines.append("## Linux Dry-Run")
lines.append(f"- Exit code: {linux_exit}")
for k, v in linux_signals.items():
    lines.append(f"- {k}: {'yes' if v else 'no'}")
lines.append(f"- Log: `{linux_log}`")
lines.append("")

mp = summary["runs"]["macos_installer_mvp"].get("preflight") or {}
ms = (mp.get("summary") or {})
lines.append("## macOS Installer MVP")
lines.append(f"- Exit code: {macos_exit}")
lines.append(f"- Preflight blockers: {ms.get('blockers', 'n/a')}")
lines.append(f"- Preflight warnings: {ms.get('warnings', 'n/a')}")
lines.append(f"- Log: `{macos_log}`")
lines.append(f"- Preflight JSON: `{macos_preflight_json}`")
lines.append(f"- Doctor JSON: `{macos_doctor_json}`")
lines.append("")

wp = summary["runs"]["windows_scenario_preflight"].get("report") or {}
ws = (wp.get("summary") or {})
lines.append("## Windows Scenario (Simulated)")
lines.append(f"- Preflight blockers: {ws.get('blockers', 'n/a')}")
lines.append(f"- Preflight warnings: {ws.get('warnings', 'n/a')}")
lines.append(f"- Report: `{windows_sim_json}`")
lines.append("")

dr = summary["runs"]["doctor_snapshot"].get("report") or {}
dsum = dr.get("summary") or {}
lines.append("## Doctor Snapshot")
lines.append(f"- Exit code: {doctor_exit}")
lines.append(f"- Runtime ready: {dsum.get('runtime_ready', 'n/a')}")
lines.append(f"- Report: `{doctor_json}`")

pathlib.Path(summary_md_path).write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

if [[ -x "${ROOT_DIR}/scripts/validate-sim-summary.py" ]]; then
  "${ROOT_DIR}/scripts/validate-sim-summary.py" "$SUMMARY_JSON"
fi

echo "Installer simulation complete."
echo "  JSON: $SUMMARY_JSON"
echo "  MD:   $SUMMARY_MD"
