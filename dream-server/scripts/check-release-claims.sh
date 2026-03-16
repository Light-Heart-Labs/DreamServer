#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="${ROOT_DIR}/manifest.json"
MATRIX="${ROOT_DIR}/docs/SUPPORT-MATRIX.md"
TRUTH="${ROOT_DIR}/docs/PLATFORM-TRUTH-TABLE.md"

fail() { echo "[FAIL] $1"; exit 1; }
pass() { echo "[PASS] $1"; }

command -v jq >/dev/null 2>&1 || fail "jq is required"
test -f "$MANIFEST" || fail "manifest.json missing"
test -f "$MATRIX" || fail "docs/SUPPORT-MATRIX.md missing"
test -f "$TRUTH" || fail "docs/PLATFORM-TRUTH-TABLE.md missing"

# Manifest support expectations
linux_supported="$(jq -r '.compatibility.os.linux.supported' "$MANIFEST")"
wsl_supported="$(jq -r '.compatibility.os.windows_wsl2.supported' "$MANIFEST")"
macos_supported="$(jq -r '.compatibility.os.macos.supported' "$MANIFEST")"
windows_native_supported="$(jq -r '.compatibility.os.windows_native.supported' "$MANIFEST")"

[[ "$linux_supported" == "true" ]] || fail "manifest must mark linux supported"
[[ "$wsl_supported" == "true" ]] || fail "manifest must mark windows_wsl2 supported"
[[ "$macos_supported" == "false" ]] || fail "manifest must mark macos unsupported/preview"
[[ "$windows_native_supported" == "false" ]] || fail "manifest must mark windows_native unsupported"

# Support matrix wording expectations
grep -q "Windows native installer UX.*Tier B" "$MATRIX" || fail "support matrix missing Windows Tier B delegated claim"
grep -q "macOS (Apple Silicon).*Tier C" "$MATRIX" || fail "support matrix missing macOS Tier C claim"
grep -q "Windows delegated installer flow is available via WSL2" "$MATRIX" || fail "support matrix missing Windows delegated truth statement"

# Truth table consistency
grep -q "Windows via WSL2.*Tier B" "$TRUTH" || fail "truth table missing Windows via WSL2 Tier B"
grep -q "macOS Apple Silicon.*Tier C" "$TRUTH" || fail "truth table missing macOS Tier C"
grep -q "Not safe to claim now" "$TRUTH" || fail "truth table missing launch guardrails section"

pass "release claim gates"
