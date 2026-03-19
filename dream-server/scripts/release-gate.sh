#!/usr/bin/env bash
# =============================================================================
# release-gate.sh — local equivalent of .github/workflows/release-gate.yml
#
# Run every P0 check sequentially before pushing a release tag.
# CI runs the same checks in parallel; this script is for local pre-flight.
#
# Usage:
#   cd dream-server && bash scripts/release-gate.sh
# =============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# ── Helpers ──────────────────────────────────────────────────────────────────

pass_count=0
fail_count=0
failed_checks=()

run_check() {
  local label="$1"
  shift
  echo ""
  echo "━━━ P0 · ${label} ━━━"
  if "$@"; then
    echo "  [PASS] ${label}"
    pass_count=$(( pass_count + 1 ))
  else
    echo "  [FAIL] ${label}"
    fail_count=$(( fail_count + 1 ))
    failed_checks+=("${label}")
    # Do not exit immediately — collect all failures for the summary
  fi
}

# ── P0 · Shell syntax ─────────────────────────────────────────────────────────

_check_shell_syntax() {
  mapfile -t sh_files < <(git ls-files '*.sh')
  if [[ "${#sh_files[@]}" -eq 0 ]]; then
    echo "  No .sh files found."
    return 0
  fi
  local inner_fail=0
  for f in "${sh_files[@]}"; do
    if ! bash -n "$f" 2>&1; then
      echo "  syntax error: $f"
      inner_fail=1
    fi
  done
  return "$inner_fail"
}

run_check "Shell syntax (bash -n)" _check_shell_syntax

# ── P0 · Manifest compatibility + release claims ─────────────────────────────

run_check "Compatibility check"   bash scripts/check-compatibility.sh
run_check "Release claims check"  bash scripts/check-release-claims.sh

# ── P0 · Installer contracts ──────────────────────────────────────────────────

run_check "Installer contracts"   bash tests/contracts/test-installer-contracts.sh
run_check "Preflight fixtures"    bash tests/contracts/test-preflight-fixtures.sh

# ── P0 · Smoke tests ──────────────────────────────────────────────────────────

run_check "Linux AMD smoke"       bash tests/smoke/linux-amd.sh
run_check "Linux NVIDIA smoke"    bash tests/smoke/linux-nvidia.sh
run_check "WSL logic smoke"       bash tests/smoke/wsl-logic.sh
run_check "macOS dispatch smoke"  bash tests/smoke/macos-dispatch.sh

# ── P0 · Installer simulation ─────────────────────────────────────────────────

_check_installer_sim() {
  bash scripts/simulate-installers.sh

  local PYTHON_CMD="python3"
  if [[ -f "${ROOT_DIR}/lib/python-cmd.sh" ]]; then
    . "${ROOT_DIR}/lib/python-cmd.sh"
    PYTHON_CMD="$(ds_detect_python_cmd)"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_CMD="python"
  fi

  "$PYTHON_CMD" scripts/validate-sim-summary.py artifacts/installer-sim/summary.json
}

run_check "Installer simulation"  _check_installer_sim

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════"
echo "  Release Gate Summary"
echo "════════════════════════════════════════════"
echo "  Passed : ${pass_count}"
echo "  Failed : ${fail_count}"

if [[ "$fail_count" -ne 0 ]]; then
  echo ""
  echo "  Blocking P0 failures:"
  for c in "${failed_checks[@]}"; do
    echo "    ✗ ${c}"
  done
  echo ""
  echo "  [BLOCKED] Release gate FAILED — fix the checks above before tagging."
  exit 1
fi

echo ""
echo "  [PASS] All P0 checks passed — safe to push the release tag."
