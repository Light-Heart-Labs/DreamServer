#!/usr/bin/env bash
set -euo pipefail
REPO_URL="https://github.com/Light-Heart-Labs/DreamServer.git"
REPO_TAG="v2.3.2"
REPO_COMMIT="3aa21e658a1cfdf8e7574b6654335454058e3443"
DRY_RUN=false
INSTALL_DIR=""
SUMMARY_JSON_PATH=""
FORWARD_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; FORWARD_ARGS+=("$1"); shift ;;
    --non-interactive|--cloud|--hybrid|--voice|--rag|--workflows|--agents|--image|--no-bootstrap) FORWARD_ARGS+=("$1"); shift ;;
    --tier|--summary-json-path|--install-dir)
      key="$1"; value="${2:-}"
      if [[ -z "$value" ]]; then echo "[ERROR] Missing value for $key" >&2; exit 2; fi
      if [[ "$key" == "--install-dir" ]]; then INSTALL_DIR="$value"; else FORWARD_ARGS+=("$key" "$value"); fi
      if [[ "$key" == "--summary-json-path" ]]; then SUMMARY_JSON_PATH="$value"; fi
      shift 2 ;;
    *) echo "[ERROR] Unsupported installer argument: $1" >&2; exit 2 ;;
  esac
done
if [[ -z "$INSTALL_DIR" ]]; then INSTALL_DIR="${HOME}/.dream-server-hermes/dreamserver"; fi
DREAM_ROOT="${INSTALL_DIR}/DreamServer"
INSTALLER="${DREAM_ROOT}/dream-server/install.sh"
echo "[INFO] DreamServer wrapper linux tag=${REPO_TAG} dry_run=${DRY_RUN}"
mkdir -p "$INSTALL_DIR"
if [[ ! -d "$DREAM_ROOT/.git" ]]; then
  echo "[INFO] Cloning pinned DreamServer ${REPO_TAG}"
  git clone --depth 1 --branch "$REPO_TAG" "$REPO_URL" "$DREAM_ROOT"
fi
actual_commit="$(git -C "$DREAM_ROOT" rev-parse HEAD)"
if [[ "$actual_commit" != "$REPO_COMMIT" ]]; then echo "[ERROR] DreamServer commit mismatch: expected $REPO_COMMIT got $actual_commit" >&2; exit 3; fi
if [[ ! -f "$INSTALLER" ]]; then echo "[ERROR] DreamServer installer not found: $INSTALLER" >&2; exit 4; fi
chmod +x "$INSTALLER"
echo "[INFO] Running DreamServer installer safely via bash"
bash "$INSTALLER" "${FORWARD_ARGS[@]}" --install-dir "$INSTALL_DIR"
if [[ -n "$SUMMARY_JSON_PATH" && ! -f "$SUMMARY_JSON_PATH" ]]; then
  mkdir -p "$(dirname "$SUMMARY_JSON_PATH")"
  printf '{"ok":true,"dryRun":%s,"installDir":"%s","dreamServerCommit":"%s"}\n' "$DRY_RUN" "$INSTALL_DIR" "$actual_commit" > "$SUMMARY_JSON_PATH"
fi
