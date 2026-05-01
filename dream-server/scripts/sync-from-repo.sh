#!/usr/bin/env bash
# Purpose: Sync the Dream Server repo working copy into the installed runtime
#          directory (~/dream-server by default), preserving local state
#          (.env, data/, logs/, models/, workspace/, images/, backups,
#          enabled-state of services, user-added config dirs).
# Expects: rsync available; SRC and DST directories exist.
# Provides: Idempotent file sync from repo -> install dir.
#
# Modder notes:
#   - Override paths via env: DREAM_REPO_DIR, DREAM_INSTALL_DIR
#   - --dry-run / -n          Preview changes
#   - --prune                 Enable --delete (mirror mode). DEFAULT IS OFF.
#   - --restart svc1 svc2 ... Restart services via dream-cli after sync
#
# Why no delete by default?
#   The install dir contains state that doesn't exist in the repo:
#     - Installer-created backup files (*.bak, *.bak.*, *.broken, *.bak2)
#     - Runtime state (.compose-flags, *.log, *-import.log)
#     - User-enabled services (e.g. extensions/services/langfuse/compose.yaml,
#       which lives as compose.yaml.disabled in the repo)
#     - User-added config dirs (config/sillytavern/, custom backends, etc.)
#   Even with excludes we cannot enumerate every user state — default = additive.
set -euo pipefail

SRC="${DREAM_REPO_DIR:-$HOME/DreamServer/dream-server}"
DST="${DREAM_INSTALL_DIR:-$HOME/dream-server}"

# Trailing slash matters for rsync semantics
SRC="${SRC%/}/"
DST="${DST%/}/"

DRY_RUN=()
PRUNE=()
RESTART_SERVICES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|-n)
      DRY_RUN=(--dry-run)
      shift
      ;;
    --prune|--delete)
      PRUNE=(--delete)
      shift
      ;;
    --restart)
      shift
      while [[ $# -gt 0 && "$1" != --* ]]; do
        RESTART_SERVICES+=("$1")
        shift
      done
      ;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--dry-run] [--prune] [--restart svc1 svc2 ...]

Sync the repo working copy into the installed runtime directory.
Default mode is ADDITIVE (no deletes) to preserve local state.

Options:
  --dry-run, -n         Preview changes without writing
  --prune, --delete     Mirror mode: delete files in DST that are not in SRC
                        (DANGEROUS — may delete user-enabled services and
                        installer backups; combine with --dry-run first!)
  --restart svc...      Restart given services after sync via dream-cli

Environment overrides:
  DREAM_REPO_DIR        (default: \$HOME/DreamServer/dream-server)
  DREAM_INSTALL_DIR     (default: \$HOME/dream-server)

Always preserved (excluded from sync, even with --prune):
  Local env:      .env  .env.local  .env.bak.*
  Runtime data:   data/  logs/  models/  workspace/  images/
  Backups:        *.bak  *.bak.*  *.bak2  *.broken
  Logs:           *.log  *-import.log
  Installer:     .compose-flags  .install-state*
  Enabled state:  *.disabled  (so --prune does not delete enabled compose.yaml)
  Build/VCS:      .git/  node_modules/  __pycache__/  *.pyc

Examples:
  $(basename "$0") --dry-run
  $(basename "$0")
  $(basename "$0") --restart n8n dashboard
  $(basename "$0") --prune --dry-run        # preview mirror-mode deletions
EOF
      exit 0
      ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

if [[ ! -d "$SRC" ]]; then
  echo "ERROR: Source repo directory not found: $SRC" >&2
  exit 1
fi
if [[ ! -d "$DST" ]]; then
  echo "ERROR: Install directory not found: $DST" >&2
  exit 1
fi

command -v rsync >/dev/null 2>&1 || {
  echo "ERROR: rsync is required but not installed." >&2
  exit 1
}

echo "→ Syncing"
echo "  from:  $SRC"
echo "  to:    $DST"
if [[ ${#PRUNE[@]} -gt 0 ]]; then
  echo "  mode:  MIRROR (--prune: deletes extra files in destination)"
else
  echo "  mode:  ADDITIVE (no deletes — pass --prune to enable mirror mode)"
fi
[[ ${#DRY_RUN[@]} -gt 0 ]] && echo "  dry:   yes (no changes written)"
echo

# Excludes apply to BOTH the source-side traversal AND deletion logic,
# so excluded files in DST are never touched.
EXCLUDES=(
  # Local environment
  --exclude='.env'
  --exclude='.env.local'
  --exclude='.env.bak.*'

  # Runtime data dirs
  --exclude='data/'
  --exclude='logs/'
  --exclude='models/'
  --exclude='workspace/'
  --exclude='images/'

  # Installer / runtime state
  --exclude='.compose-flags'
  --exclude='.install-state'
  --exclude='.install-state.*'
  --exclude='*-import.log'
  --exclude='*.log'

  # Backup files (created by installer/migrations/dream-cli)
  --exclude='*.bak'
  --exclude='*.bak.*'
  --exclude='*.bak2'
  --exclude='*.broken'

  # Enabled-state markers — if a user enabled a service, repo has
  # compose.yaml.disabled but install has compose.yaml. Excluding
  # *.disabled prevents pushing the marker over and pruning the active file.
  --exclude='*.disabled'

  # VCS / build artifacts
  --exclude='.git/'
  --exclude='node_modules/'
  --exclude='__pycache__/'
  --exclude='*.pyc'
)

rsync -av "${DRY_RUN[@]}" "${PRUNE[@]}" \
  "${EXCLUDES[@]}" \
  "$SRC" "$DST"

echo
echo "✓ Sync complete."

if [[ ${#DRY_RUN[@]} -gt 0 ]]; then
  echo "  (dry-run only — re-run without --dry-run to apply)"
  exit 0
fi

if [[ ${#RESTART_SERVICES[@]} -gt 0 ]]; then
  CLI="$DST/dream-cli"
  if [[ ! -x "$CLI" ]]; then
    echo "WARN: dream-cli not found or not executable at $CLI — skipping restart." >&2
    exit 0
  fi
  for svc in "${RESTART_SERVICES[@]}"; do
    echo "→ Restarting $svc"
    "$CLI" restart "$svc" || echo "WARN: restart $svc failed (non-fatal)"
  done
fi

