#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Logging & Lifecycle
# ============================================================================
# Part of: p2p-gpu/lib/
# Purpose: Log/warn/err/step functions, timestamp helper, cleanup trap,
#          flock-based lock acquisition
#
# Expects: LOGFILE, LOCKFILE, RED, GREEN, YELLOW, CYAN, BOLD, NC
# Provides: _ts(), log(), warn(), err(), step(), setup_cleanup_trap(),
#           acquire_lock()
#
# Modder notes:
#   Log writes use append-or-silent to avoid infinite recursion if the
#   logfile itself is unwritable. This is the ONE exception to the
#   "never || :" rule — logging infrastructure cannot warn about itself.
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

_ts() { date '+%Y-%m-%d %H:%M:%S'; }

log() {
  echo -e "${GREEN}[✓]${NC} $*"
  echo "$(_ts) [INFO]  $*" >> "$LOGFILE" || :
}

warn() {
  echo -e "${YELLOW}[!]${NC} $*"
  echo "$(_ts) [WARN]  $*" >> "$LOGFILE" || :
}

err() {
  echo -e "${RED}[✗]${NC} $*" >&2
  echo "$(_ts) [ERROR] $*" >> "$LOGFILE" || :
}

step() {
  echo -e "\n${CYAN}${BOLD}━━━ $* ━━━${NC}\n"
  echo "$(_ts) [STEP]  $*" >> "$LOGFILE" || :
}

# ── Cleanup trap ────────────────────────────────────────────────────────────
setup_cleanup_trap() {
  _vastai_cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
      err "Script failed at line ${BASH_LINENO[0]:-unknown} (exit code: ${exit_code})"
      err "Full log: ${LOGFILE}"
      err "Last 10 lines:"
      tail -10 "$LOGFILE" 2>&1 | sed 's/^/  /' || warn "could not read log tail"
      echo ""
      echo -e "${YELLOW}${BOLD}  What to try next:${NC}"
      echo -e "    ${BOLD}bash $0 --fix${NC}      Apply fixes and restart services"
      echo -e "    ${BOLD}bash $0 --resume${NC}   Quick restart (skip install phases)"
      echo -e "    ${BOLD}bash $0 --status${NC}   Check what's actually running"
      echo ""
    fi
    # Release flock (fd 9 auto-closes on exit)
    exit "$exit_code"
  }
  trap _vastai_cleanup EXIT
  trap 'err "Interrupted by signal"; exit 130' INT TERM HUP
}

# ── Flock-based lock ────────────────────────────────────────────────────────
acquire_lock() {
  exec 9>"$LOCKFILE"
  if ! flock -n 9; then
    err "Another instance is already running."
    echo -e "  ${YELLOW}Wait for it to finish, or force remove:${NC} rm ${LOCKFILE}"
    exit 1
  fi
}
