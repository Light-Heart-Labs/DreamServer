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
PULL=0
VERBOSE=0
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
    --pull)
      PULL=1
      shift
      ;;
    --verbose|-v)
      VERBOSE=1
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
Usage: $(basename "$0") [--dry-run] [--prune] [--pull] [--verbose] [--restart svc1 svc2 ...]

Sync the repo working copy into the installed runtime directory.
Default mode is ADDITIVE (no deletes) to preserve local state.

Options:
  --dry-run, -n         Preview changes without writing
  --prune, --delete     Mirror mode: delete files in DST that are not in SRC
                        (DANGEROUS — combine with --dry-run first!)
  --pull                Run 'git pull --ff-only' in the repo first
  --verbose, -v         Show every file rsync visits (not just changes)
  --restart svc...      Restart given services after sync via dream-cli

Environment overrides:
  DREAM_REPO_DIR        (default: \$HOME/DreamServer/dream-server)
  DREAM_INSTALL_DIR     (default: \$HOME/dream-server)

Always preserved (excluded from sync, even with --prune):
  Local env:      .env  .env.local  .env.bak.*
  Runtime data:   data/  logs/  models/  workspace/  images/
  Backups:        *.bak  *.bak.*  *.bak2  *.broken
  Logs:           *.log  *-import.log
  Installer:      .compose-flags  .install-state*
  Enabled state:  *.disabled  (so --prune does not delete enabled compose.yaml)
  Build/VCS:      .git/  node_modules/  __pycache__/  *.pyc

Examples:
  $(basename "$0") --dry-run
  $(basename "$0") --pull --restart n8n
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

# Optional git pull in the repo before sync
if [[ "$PULL" -eq 1 ]]; then
  if [[ -d "${SRC}.git" ]]; then
    echo "→ git pull --ff-only in $SRC"
    git -C "${SRC%/}" pull --ff-only || {
      echo "ERROR: git pull failed" >&2
      exit 1
    }
    echo
  else
    echo "WARN: --pull requested but $SRC is not a git repo (no .git/) — skipping" >&2
  fi
fi

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
  --exclude='.env'
  --exclude='.env.local'
  --exclude='.env.bak.*'
  --exclude='data/'
  --exclude='logs/'
  --exclude='models/'
  --exclude='workspace/'
  --exclude='images/'
  --exclude='.compose-flags'
  --exclude='.install-state'
  --exclude='.install-state.*'
  --exclude='*-import.log'
  --exclude='*.log'
  --exclude='*.bak'
  --exclude='*.bak.*'
  --exclude='*.bak2'
  --exclude='*.broken'
  --exclude='*.disabled'
  --exclude='.git/'
  --exclude='node_modules/'
  --exclude='__pycache__/'
  --exclude='*.pyc'
)

# Output mode:
#   default → -i (itemize): only changed files, with status codes
#   --verbose → -av (full file list, like before)
RSYNC_FLAGS=(-a --human-readable --itemize-changes)
[[ "$VERBOSE" -eq 1 ]] && RSYNC_FLAGS+=(-v)

# Capture itemize output to compute summary
OUTPUT=$(rsync "${RSYNC_FLAGS[@]}" "${DRY_RUN[@]}" "${PRUNE[@]}" \
  "${EXCLUDES[@]}" \
  "$SRC" "$DST")

# Strip rsync's stats footer (everything after the first blank line)
OUTPUT_BODY=$(echo "$OUTPUT" | sed '/^$/,$d')

# Itemize-code legend (each code is 11 chars: YXcstpoguax):
#   >f.st......  content changed (size+time differ) → real change
#   >f+++++++++  new file
#   cd+++++++++  new directory
#   >f..tp.....  permission bit changed (e.g. exec bit) → real change
#   >f..t......  ONLY mtime differs (content identical) → noise from clone-time vs install-time
#   .d..t......  ONLY directory mtime differs           → noise
#   *deleting    file removed (only with --prune)
#
# Filter: hide pure-mtime noise unless --verbose was passed.
NOISE_REGEX='^[>.][fd]\.\.t\.\.\.\.\.\.$'

if [[ "$VERBOSE" -eq 1 ]]; then
    DISPLAY="$OUTPUT_BODY"
    noise_count=0
else
    DISPLAY=$(echo "$OUTPUT_BODY" | grep -Ev "$NOISE_REGEX" || true)
    noise_count=$(echo "$OUTPUT_BODY" | grep -Ec "$NOISE_REGEX" || true)
fi

if [[ -n "$DISPLAY" ]]; then
    echo "$DISPLAY"
else
    echo "  (no real content/permission changes)"
fi

# Counts
created=0
updated=0
deleted=0
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  case "$line" in
    \>f+++++++++*|cd+++++++++*) created=$((created+1)) ;;
    \*deleting*)  deleted=$((deleted+1)) ;;
    \>f*)
        # any file change other than pure-mtime noise counts as updated
        if [[ ! "$line" =~ $NOISE_REGEX ]]; then
            updated=$((updated+1))
        fi
        ;;
  esac
done <<< "$OUTPUT_BODY"

echo
echo "✓ Summary:  created=$created  updated=$updated  deleted=$deleted  mtime-only=$noise_count"
if [[ "$noise_count" -gt 0 && "$VERBOSE" -ne 1 ]]; then
    echo "  ($noise_count files have identical content, only timestamp differs — pass --verbose to see them)"
fi
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

