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
FORCE_PULL=0
VERBOSE=0
AUTO_RESTART=0
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
    --force-pull)
      PULL=1
      FORCE_PULL=1
      shift
      ;;
    --verbose|-v)
      VERBOSE=1
      shift
      ;;
    --auto-restart)
      AUTO_RESTART=1
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
Usage: $(basename "$0") [--dry-run] [--prune] [--pull] [--verbose] [--auto-restart] [--restart svc1 svc2 ...]

Sync the repo working copy into the installed runtime directory.
Default mode is ADDITIVE (no deletes) to preserve local state.

Options:
  --dry-run, -n         Preview changes without writing
  --prune, --delete     Mirror mode: delete files in DST that are not in SRC
                        (DANGEROUS — combine with --dry-run first!)
  --pull                Run 'git pull --ff-only' in the repo first
                        (refuses to run if the working tree is dirty)
  --force-pull          Like --pull but 'git reset --hard origin/<branch>' first.
                        DESTRUCTIVE — discards uncommitted local changes.
  --verbose, -v         Show every file rsync visits (not just changes)
  --auto-restart        Auto-detect changed services and restart them via dream-cli
  --restart svc...      Restart given services after sync via dream-cli
                        (combinable with --auto-restart; explicit names always restart)

Environment overrides:
  DREAM_REPO_DIR        (default: \$HOME/DreamServer/dream-server)
  DREAM_INSTALL_DIR     (default: \$HOME/dream-server)

Always preserved (excluded from sync, even with --prune):
  Local env:      .env  .env.local  .env.bak.*
  Runtime data:   data/  logs/  cache/  tmp/  (top-level AND nested, e.g.
                  extensions/services/qdrant/data/)
  Models/media:   models/  workspace/  images/
  Backups:        *.bak  *.bak.*  *.bak2  *.broken
  Logs:           *.log  *-import.log
  Installer:      .compose-flags  .install-state*
  Enabled state:  *.disabled  (so --prune does not delete enabled compose.yaml)
  Build/VCS:      .git/  node_modules/  __pycache__/  *.pyc

Examples:
  $(basename "$0") --dry-run
  $(basename "$0") --pull --auto-restart
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

# Optional git pull in the repo before sync.
# The .git/ may be in SRC itself (monorepo dir == repo root) or one level up
# (e.g. SRC=~/DreamServer/dream-server, .git lives in ~/DreamServer).
if [[ "$PULL" -eq 1 ]]; then
  git_top=$(git -C "${SRC%/}" rev-parse --show-toplevel 2>/dev/null || true)
  if [[ -z "$git_top" ]]; then
    echo "WARN: --pull requested but $SRC is not inside a git repo — skipping" >&2
  else
    # Check for uncommitted changes (porcelain output is empty for clean trees).
    dirty=$(git -C "$git_top" status --porcelain 2>/dev/null || true)
    if [[ -n "$dirty" && "$FORCE_PULL" -ne 1 ]]; then
      echo "ERROR: Repo has uncommitted changes — refusing to pull." >&2
      echo "       Repo: $git_top" >&2
      echo >&2
      echo "$dirty" | sed 's/^/         /' >&2
      echo >&2
      echo "       Options:" >&2
      echo "         1) Commit/stash your changes:  git -C $git_top stash" >&2
      echo "         2) Discard them and pull:      $0 --force-pull ..." >&2
      echo "         3) Skip --pull entirely and just sync the working copy as-is." >&2
      exit 1
    fi

    if [[ "$FORCE_PULL" -eq 1 && -n "$dirty" ]]; then
      branch=$(git -C "$git_top" rev-parse --abbrev-ref HEAD)
      remote=$(git -C "$git_top" config "branch.${branch}.remote" 2>/dev/null || echo origin)
      echo "→ --force-pull: discarding local changes in $git_top"
      git -C "$git_top" fetch "$remote" "$branch" || {
        echo "ERROR: git fetch failed" >&2
        exit 1
      }
      git -C "$git_top" reset --hard "${remote}/${branch}" || {
        echo "ERROR: git reset --hard failed" >&2
        exit 1
      }
    else
      echo "→ git pull --ff-only in $git_top"
      git -C "$git_top" pull --ff-only || {
        echo "ERROR: git pull failed" >&2
        exit 1
      }
    fi
    echo
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
  # Runtime data — exclude at any depth (top-level + nested service dirs like
  # extensions/services/qdrant/data/, extensions/services/n8n/data/, etc.)
  --exclude='data/'
  --exclude='**/data/'
  --exclude='logs/'
  --exclude='**/logs/'
  --exclude='cache/'
  --exclude='**/cache/'
  --exclude='tmp/'
  --exclude='**/tmp/'
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

# ─────────────────────────────────────────────────────────────────────────────
# Auto-restart helper (defined early so dry-run preview can call it).
# Detects which services were touched by the sync and prints them, one per line.
# Mapping:
#   extensions/services/<name>/...   → service <name>
#   config/<name>/...                → service <name> (if a manifest exists)
#   docker-compose.*.yml             → all services (warn instead, too broad)
#   .env / install-core.sh / etc.    → ignored (no service mapping)
# ─────────────────────────────────────────────────────────────────────────────
detect_changed_services() {
  local body="$1"
  local svc_dir="${DST}extensions/services"
  local stack_wide=0

  # Collect service names first, then sort/dedup, then emit warning at end.
  local names=()
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ $NOISE_REGEX ]] && continue
    local code path
    code="${line:0:11}"
    path="${line:12}"

    case "$code" in
      \>f*|cd+++++++++*) : ;;
      *) continue ;;
    esac

    if [[ "$path" =~ ^docker-compose\..+\.yml$ ]]; then
      stack_wide=1
      continue
    fi

    if [[ "$path" =~ ^extensions/services/([^/]+)/ ]]; then
      names+=("${BASH_REMATCH[1]}")
      continue
    fi

    if [[ "$path" =~ ^config/([^/]+)/ ]]; then
      local name="${BASH_REMATCH[1]}"
      if [[ -f "$svc_dir/$name/manifest.yaml" ]]; then
        names+=("$name")
      fi
      continue
    fi
  done <<< "$body"

  if [[ ${#names[@]} -gt 0 ]]; then
    printf '%s\n' "${names[@]}" | sort -u
  fi

  if [[ "$stack_wide" -eq 1 ]]; then
    echo "WARN: docker-compose.*.yml changed — restart the full stack manually:" >&2
    echo "      $DST/dream-cli down && $DST/dream-cli up" >&2
  fi
}

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
# rsync itemize lines look like:  ">f..t......  path/to/file"
# (11-char code, then whitespace, then filename). Don't anchor with $ — match
# the code followed by whitespace.
NOISE_REGEX='^[>.][fd]\.\.t\.\.\.\.\.\.[[:space:]]'

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
  # Still preview which services WOULD be auto-restarted
  if [[ "$AUTO_RESTART" -eq 1 ]]; then
    echo
    echo "→ Auto-restart preview (--auto-restart):"
    detect_changed_services "$OUTPUT_BODY" | while read -r svc; do
      [[ -n "$svc" ]] && echo "    would restart: $svc"
    done
  fi
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Combine explicit + auto-detected restart targets (dedup, preserve order).
# detect_changed_services() is defined near the top of this file.
# ─────────────────────────────────────────────────────────────────────────────
ALL_RESTARTS=("${RESTART_SERVICES[@]}")
if [[ "$AUTO_RESTART" -eq 1 ]]; then
  while IFS= read -r svc; do
    [[ -z "$svc" ]] && continue
    # Skip if already in the list
    skip=0
    for existing in "${ALL_RESTARTS[@]}"; do
      [[ "$existing" == "$svc" ]] && skip=1 && break
    done
    [[ "$skip" -eq 0 ]] && ALL_RESTARTS+=("$svc")
  done < <(detect_changed_services "$OUTPUT_BODY")
fi

if [[ ${#ALL_RESTARTS[@]} -gt 0 ]]; then
  CLI="$DST/dream-cli"
  if [[ ! -x "$CLI" ]]; then
    echo "WARN: dream-cli not found or not executable at $CLI — skipping restart." >&2
    exit 0
  fi
  echo
  echo "→ Restarting ${#ALL_RESTARTS[@]} service(s): ${ALL_RESTARTS[*]}"
  for svc in "${ALL_RESTARTS[@]}"; do
    echo "  · $svc"
    "$CLI" restart "$svc" || echo "    WARN: restart $svc failed (non-fatal)"
  done
fi

