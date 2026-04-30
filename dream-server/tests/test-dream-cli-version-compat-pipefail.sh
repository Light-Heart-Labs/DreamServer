#!/usr/bin/env bash
# ============================================================================
# Regression: `_check_version_compat` must tolerate missing DREAM_VERSION
# under `set -euo pipefail`.
# ============================================================================
# Maintainer audit on PR #998 (Lightheartdevs, 2026-04-28):
#
#   "_check_version_compat must tolerate a `.env` without `DREAM_VERSION`
#    and fall back to `.version`/`manifest.json` instead of exiting under
#    pipefail."
#
# The bug pattern: piping `grep '^DREAM_VERSION='` (which exits 1 when
# the line is absent) into `cut`/`tr` under `set -euo pipefail`
# propagates the failure as the pipeline's exit status. Without `|| true`
# at the end, a fresh-install `.env` would short-circuit the surrounding
# command-substitution and abort the script before the .version /
# manifest.json fallback branches run.
#
# This test locks in the canonical `|| true` form. Behavioural coverage
# is covered by the dream-cli BATS suite (#1018) which sources the full
# CLI; here we use source-pattern to keep the test isolated and fast.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DREAM_CLI="$ROOT_DIR/dream-cli"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() { echo -e "  ${GREEN}✓ PASS${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC} $1"; FAILED=$((FAILED + 1)); }

echo ""
echo "╔═══════════════════════════════════════════════╗"
echo "║   _check_version_compat — pipefail tolerance  ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""

if [[ ! -x "$DREAM_CLI" ]]; then
    fail "dream-cli not found at $DREAM_CLI"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; exit 1
fi

# 1. dream-cli has `set -euo pipefail` (or `set -e` + pipefail) at the
#    top, so the audit precondition holds.
if grep -qE '^set -euo? pipefail' "$DREAM_CLI" || grep -qE '^set -o pipefail' "$DREAM_CLI" || grep -qE '^set -e' "$DREAM_CLI"; then
    pass "dream-cli runs under strict mode (set -e or stricter)"
else
    fail "dream-cli is not under strict mode — audit precondition is moot"
fi

# 2. Extract the _check_version_compat() body and strip comments so
#    grep matches active code, not the rationale comment block.
fn_block=$(awk '
    /^_check_version_compat\(\)/ { in_block=1 }
    in_block { print }
    in_block && /^}$/ { exit }
' "$DREAM_CLI")

if [[ -z "$fn_block" ]]; then
    fail "could not extract _check_version_compat() body"
    echo ""; echo "Result: $PASSED passed, $FAILED failed"; exit 1
fi

fn_code=$(grep -v '^[[:space:]]*#' <<<"$fn_block")

# 3. The DREAM_VERSION grep pipeline must end with `|| true` so a
#    missing match (grep exit 1) does not abort under pipefail.
#
# The canonical pipeline shape (broken across two lines via `\`):
#   _COMPAT_INSTALLED_VER=$(grep '^DREAM_VERSION=' "$INSTALL_DIR/.env" 2>/dev/null \
#       | sed -n '1p' | cut -d= -f2 | tr -d '[:space:]' || true)
#
# We require:
#   - the grep -DREAM_VERSION-= line is present (the bug-prone pipeline source),
#   - `|| true` literal appears on the next non-blank line (the audit-required tolerance).
if grep -A1 "grep '\^DREAM_VERSION=' \"\$INSTALL_DIR/\.env\"" <<<"$fn_code" \
        | grep -q '|| true'; then
    pass "DREAM_VERSION grep pipeline ends with '|| true' tolerance"
else
    fail "DREAM_VERSION grep pipeline missing '|| true' (audit blocker)"
    echo "  --- function code (comments stripped) ---"
    awk '{print "  " $0}' <<<"$fn_code"
fi

# 4. The .version and manifest.json fallback branches must still exist.
#    The whole point of `|| true` is to let execution reach these.
if grep -q '\.version' <<<"$fn_code" && grep -q 'manifest\.json' <<<"$fn_code"; then
    pass ".version and manifest.json fallback branches present"
else
    fail "missing fallback branches (would defeat the '|| true' fix)"
fi

# 5. Anti-regression: the bare-pipe form
#       _COMPAT_INSTALLED_VER=$(... | tr -d '[:space:]')
#    (no trailing `|| true`) MUST NOT appear. This catches a future
#    PR that "cleans up" the `|| true` thinking it's redundant.
#
# We grep for the pipeline source line followed by a closing `)` on
# the next line WITHOUT a `|| true` between them.
if grep -A1 "grep '\^DREAM_VERSION=' \"\$INSTALL_DIR/\.env\"" <<<"$fn_code" \
        | grep -qE "tr -d '\[:space:\]'\\)$"; then
    fail "DREAM_VERSION pipeline regressed to bare-close (no '|| true')"
else
    pass "no bare-close regression in DREAM_VERSION pipeline"
fi

echo ""
echo "Result: $PASSED passed, $FAILED failed"
[[ $FAILED -eq 0 ]]
