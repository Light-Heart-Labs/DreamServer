#!/usr/bin/env bash
# ============================================================================
# DreamServer — P2P GPU Permission System
# ============================================================================
# Part of: resources/p2p-gpu/lib/
# Purpose: POSIX ACLs, setgid, UID-specific ownership, data dir scaffolding
#
# Expects: DREAM_USER, DREAM_HOME, LOGFILE, log(), warn(), err()
# Provides: ensure_acl_tools(), apply_data_acl(), apply_multi_uid_perms(),
#           fix_known_uid_requirements(), precreate_extension_data_dirs(),
#           configure_dream_umask(), create_permission_fix_script()
#
# Modder notes:
#   Three-layer permission system:
#     1. POSIX ACLs with default entries on data/
#     2. Setgid bit (2775) on directories
#     3. Known UID overrides for services that check ownership at startup
#
#   [FIX: broad-chmod] Permission strategy:
#     - Primary: setgid (2775) + POSIX ACLs → group-based access
#     - Exception: multi-UID dirs (models/, searxng/) use a+rwX because
#       multiple unrelated UIDs write and ACLs can't express "any UID"
#     - setfacl is required; fail fast when unavailable
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

# Install ACL tools if missing
ensure_acl_tools() {
  if ! command -v setfacl &>/dev/null; then
    apt-get install -y -qq acl 2>>"$LOGFILE" || warn "could not install acl package (non-fatal)"
  fi
}

# Apply POSIX ACLs + setgid so every container UID can coexist.
# This is the PRIMARY permission mechanism — covers most services.
apply_data_acl() {
  local dir="$1"
  [[ ! -d "$dir" ]] && return 0

  chown -R "${DREAM_USER}:${DREAM_USER}" "$dir" || warn "chown failed on ${dir} (non-fatal)"
  find "$dir" -type d -exec chmod 2775 {} + || warn "chmod dirs failed on ${dir} (non-fatal)"
  find "$dir" -type f -exec chmod 0664 {} + || warn "chmod files failed on ${dir} (non-fatal)"

  if command -v setfacl &>/dev/null; then
    # dashboard-api runs as uid 1000 (dreamer) and needs write access to /data
    # for .extensions-lock and token_counter.json.
    setfacl -R -d -m "u::rwx,u:1000:rwx,g::rwx,o::rx" "$dir" || warn "setfacl default failed on ${dir} (non-fatal)"
    setfacl -R -m "u:1000:rwx,g::rwx" "$dir" || warn "setfacl current failed on ${dir} (non-fatal)"
    log "Applied POSIX ACLs on ${dir}"
  else
    err "setfacl unavailable — install with: apt-get install acl"
    exit 1
  fi
}

# [FIX: broad-chmod] Apply world-writable perms ONLY on directories where
# multiple unrelated container UIDs write and ACLs cannot express the access
# pattern. Each call is documented with the reason.
apply_multi_uid_perms() {
  local dir="$1" reason="$2"
  [[ ! -d "$dir" ]] && return 0
  chmod -R a+rwX "$dir" || warn "shared-dir chmod on ${dir} failed (non-fatal)"
  log "Applied shared permissions on ${dir} (reason: ${reason})"
}

# Extract numeric UID from a compose.yaml user: directive
_extract_compose_uid() {
  local compose_file="$1"
  [[ ! -f "$compose_file" ]] && return 0
  python3 -c "
import yaml, re, sys
try:
    data = yaml.safe_load(open(sys.argv[1]))
    services = data.get('services') or {}
    for sdef in services.values():
        user = str(sdef.get('user', ''))
        if not user: continue
        resolved = re.sub(r'\\\$\{[A-Za-z_]+:-(\d+)\}', r'\1', user)
        uid = resolved.split(':')[0].strip()
        if uid.isdigit():
            print(uid)
            break
except yaml.YAMLError as e:
    print(f'YAML parse error in {sys.argv[1]}: {e}', file=sys.stderr)
except OSError as e:
    print(f'File read error {sys.argv[1]}: {e}', file=sys.stderr)
" "$compose_file" || warn "UID extraction failed for ${compose_file} (non-fatal)"
}

# Fix UID-specific ownership that ACLs alone don't solve
fix_known_uid_requirements() {
  local data_dir="$1"
  local gpu_backend="${2:-nvidia}"
  local ds_dir
  ds_dir=$(dirname "$data_dir")

  _fix_dynamic_uids "$ds_dir" "$data_dir"
  _fix_uid_exceptions "$data_dir" "$gpu_backend"

  log "Fixed UID-specific ownership for services (dynamic + exceptions)"
}

_fix_dynamic_uids() {
  local ds_dir="$1" data_dir="$2"
  local ext_dirs=("${ds_dir}/extensions/services" "${ds_dir}/user-extensions")
  for ext_root in "${ext_dirs[@]}"; do
    [[ ! -d "$ext_root" ]] && continue
    for ext_path in "${ext_root}"/*/; do
      [[ ! -d "$ext_path" ]] && continue
      local ext_name
      ext_name=$(basename "$ext_path")
      local ext_data="${data_dir}/${ext_name}"
      local compose_file=""
      for candidate in "${ext_path}compose.yaml" "${ext_path}compose.yml"; do
        [[ -f "$candidate" ]] && compose_file="$candidate" && break
      done
      [[ -z "$compose_file" ]] && continue
      local uid
      uid=$(_extract_compose_uid "$compose_file")
      if [[ -n "$uid" && "$uid" != "0" ]]; then
        mkdir -p "$ext_data"
        chown -R "${uid}:${uid}" "$ext_data" || warn "chown ${ext_name} to uid ${uid} failed (non-fatal)"
      fi
    done
  done
}

_fix_uid_exceptions() {
  local data_dir="$1" gpu_backend="$2"

  # qdrant: uid 1000, no user: in compose.yaml — explicit chown required
  if [[ -d "${data_dir}/qdrant" ]]; then
    chown -R 1000:1000 "${data_dir}/qdrant" || warn "qdrant ownership fix failed (non-fatal)"
  fi

  # searxng: uid varies by image version (977 or 1000) — multi-UID, needs shared perms
  if [[ -d "${data_dir}/searxng" ]]; then
    apply_multi_uid_perms "${data_dir}/searxng" "uid varies by image version (977/1000)" # ACLs cannot encode cross-version UID drift on existing files.
  fi

  # comfyui: AMD vs NVIDIA layout
  fix_comfyui_permissions "$data_dir" "$gpu_backend"

  # open-webui: grant both root (container) and uid 1000 (dream/dashboard-api)
  if [[ -d "${data_dir}/open-webui" ]]; then
    setfacl -R -d -m "u::rwx,u:0:rwx,u:1000:rwx,g::rwx,o::rx" "${data_dir}/open-webui" || warn "open-webui default ACL fix failed (non-fatal)"
    setfacl -R -m "u:0:rwx,u:1000:rwx,g::rwx" "${data_dir}/open-webui" || warn "open-webui ACL fix failed (non-fatal)"
  fi

  # whisper: grant known writers uid 1000 + root for cache/bootstrap flows
  if [[ -d "${data_dir}/whisper" ]]; then
    chown -R 1000:1000 "${data_dir}/whisper" || warn "whisper chown failed (non-fatal)"
    setfacl -R -d -m "u::rwx,u:0:rwx,u:1000:rwx,g::rwx,o::rx" "${data_dir}/whisper" || warn "whisper default ACL fix failed (non-fatal)"
    setfacl -R -m "u:0:rwx,u:1000:rwx,g::rwx" "${data_dir}/whisper" || warn "whisper ACL fix failed (non-fatal)"
  fi

  # dashboard-api: uid 1000 (dreamer) — needs rw on data/ and .env
  local ds_dir
  ds_dir=$(dirname "$data_dir")
  if [[ -d "${data_dir}/dashboard-api" ]]; then
    chown -R 1000:1000 "${data_dir}/dashboard-api" || warn "dashboard-api chown failed (non-fatal)"
  fi
  if command -v setfacl &>/dev/null && [[ -f "${ds_dir}/.env" ]]; then
    setfacl -m u:1000:rw "${ds_dir}/.env" || warn ".env ACL for dashboard-api failed (non-fatal)"
  fi

  # models (shared): llama-server (root), comfyui, aria2c (root) all write here
  if [[ -d "${data_dir}/models" ]]; then
    apply_multi_uid_perms "${data_dir}/models" "multi-service write: llama-server, comfyui, aria2c" # ACLs cannot represent unbounded uploader/runtime UID combinations.
  fi
}

# Pre-create data directories for all known extensions
precreate_extension_data_dirs() {
  local ds_dir="$1"
  local data_dir="${ds_dir}/data"
  local ext_dirs=("${ds_dir}/extensions/services" "${ds_dir}/user-extensions")

  for ext_root in "${ext_dirs[@]}"; do
    [[ ! -d "$ext_root" ]] && continue
    for manifest in "${ext_root}"/*/manifest.yaml; do
      [[ ! -f "$manifest" ]] && continue
      local ext_name
      ext_name=$(basename "$(dirname "$manifest")")
      mkdir -p "${data_dir}/${ext_name}"
    done
  done

  # Pre-create ComfyUI bind-mount paths so Docker doesn't auto-create root-owned
  # 0755 directories that are unwritable for the non-root comfyui user.
  mkdir -p "${data_dir}/comfyui/models" \
    "${data_dir}/comfyui/models/checkpoints" \
    "${data_dir}/comfyui/output" \
    "${data_dir}/comfyui/input" \
    "${data_dir}/comfyui/workflows" \
    "${data_dir}/comfyui/ComfyUI/models" \
    "${data_dir}/comfyui/ComfyUI/output" \
    "${data_dir}/comfyui/ComfyUI/input" \
    "${data_dir}/comfyui/ComfyUI/custom_nodes"

  mkdir -p "${ds_dir}/user-extensions" || warn "could not create user-extensions (non-fatal)"
  log "Pre-created data directories for all known extensions"
}

# Set dream user's umask for group-writable files
configure_dream_umask() {
  for f in "${DREAM_HOME}/.bashrc" "${DREAM_HOME}/.profile"; do
    if [[ -f "$f" ]] && ! grep -q 'umask 0002' "$f"; then
      printf '\n# DreamServer: group-writable files by default\numask 0002\n' >> "$f"
    fi
  done
}

# Generate standalone permission-fix script
create_permission_fix_script() {
  local ds_dir="$1"
  local uid_fix_lines=""

  local ext_dirs=("${ds_dir}/extensions/services" "${ds_dir}/user-extensions")
  for ext_root in "${ext_dirs[@]}"; do
    [[ ! -d "$ext_root" ]] && continue
    for ext_path in "${ext_root}"/*/; do
      [[ ! -d "$ext_path" ]] && continue
      local ext_name
      ext_name=$(basename "$ext_path")
      for candidate in "${ext_path}compose.yaml" "${ext_path}compose.yml"; do
        [[ ! -f "$candidate" ]] && continue
        local uid
        uid=$(_extract_compose_uid "$candidate")
        if [[ -n "$uid" && "$uid" != "0" ]]; then
          uid_fix_lines+="[[ -d \"\${DATA_DIR}/${ext_name}\" ]] && chown -R ${uid}:${uid} \"\${DATA_DIR}/${ext_name}\" || warn \"${ext_name} chown failed (non-fatal)\""$'\n'
        fi
        break
      done
    done
  done

  mkdir -p "${ds_dir}/scripts"
  cat > "${ds_dir}/scripts/fix-permissions.sh" << PERMFIX_EOF
#!/usr/bin/env bash
set -euo pipefail
# DreamServer permission fixer — auto-generated, safe to run anytime.
SCRIPT_DIR="\$(cd "\$(dirname "\$0")/.." && pwd)"
DATA_DIR="\${SCRIPT_DIR}/data"
warn() { echo -e "\033[1;33m[!]\033[0m \$*" >&2; }

echo "[*] Fixing permissions on \${DATA_DIR}..."

if command -v setfacl &>/dev/null; then
  find "\$DATA_DIR" -type d -exec chmod 2775 {} + || warn "chmod dirs failed (non-fatal)"
  find "\$DATA_DIR" -type f -exec chmod 0664 {} + || warn "chmod files failed (non-fatal)"
  setfacl -R -d -m "u::rwx,u:1000:rwx,g::rwx,o::rx" "\$DATA_DIR" || warn "setfacl default failed (non-fatal)"
  setfacl -R -m "u:1000:rwx,g::rwx" "\$DATA_DIR" || warn "setfacl current failed (non-fatal)"
else
  echo "[x] setfacl unavailable — install with: apt-get install acl" >&2
  exit 1
fi

${uid_fix_lines}
[[ -d "\${DATA_DIR}/qdrant" ]] && chown -R 1000:1000 "\${DATA_DIR}/qdrant" || warn "qdrant fix failed (non-fatal)"
[[ -d "\${DATA_DIR}/open-webui" ]] && setfacl -R -d -m "u::rwx,u:0:rwx,u:1000:rwx,g::rwx,o::rx" "\${DATA_DIR}/open-webui" || warn "open-webui default ACL fix failed (non-fatal)"
[[ -d "\${DATA_DIR}/open-webui" ]] && setfacl -R -m "u:0:rwx,u:1000:rwx,g::rwx" "\${DATA_DIR}/open-webui" || warn "open-webui ACL fix failed (non-fatal)"
[[ -d "\${DATA_DIR}/whisper" ]] && chown -R 1000:1000 "\${DATA_DIR}/whisper" || warn "whisper chown failed (non-fatal)"
[[ -d "\${DATA_DIR}/whisper" ]] && setfacl -R -d -m "u::rwx,u:0:rwx,u:1000:rwx,g::rwx,o::rx" "\${DATA_DIR}/whisper" || warn "whisper default ACL fix failed (non-fatal)"
[[ -d "\${DATA_DIR}/whisper" ]] && setfacl -R -m "u:0:rwx,u:1000:rwx,g::rwx" "\${DATA_DIR}/whisper" || warn "whisper ACL fix failed (non-fatal)"
# Multi-UID directories: searxng (uid varies), models (llama+comfyui+aria2c write)
[[ -d "\${DATA_DIR}/searxng" ]] && chmod -R a+rwX "\${DATA_DIR}/searxng" || warn "searxng fix failed (non-fatal)"
[[ -d "\${DATA_DIR}/models" ]] && chmod -R a+rwX "\${DATA_DIR}/models" || warn "models fix failed (non-fatal)"

for d in \
  "\${DATA_DIR}/comfyui/models" \
  "\${DATA_DIR}/comfyui/models/checkpoints" \
  "\${DATA_DIR}/comfyui/output" \
  "\${DATA_DIR}/comfyui/input" \
  "\${DATA_DIR}/comfyui/workflows" \
  "\${DATA_DIR}/comfyui/ComfyUI/models" \
  "\${DATA_DIR}/comfyui/ComfyUI/output" \
  "\${DATA_DIR}/comfyui/ComfyUI/input" \
  "\${DATA_DIR}/comfyui/ComfyUI/custom_nodes"; do
  mkdir -p "\$d" || warn "comfyui mkdir failed on \$d (non-fatal)"
  [[ -d "\$d" ]] && chmod 2775 "\$d" || warn "comfyui dir mode fix failed on \$d (non-fatal)"
done

find "\${SCRIPT_DIR}/scripts" -name "*.sh" -exec chmod +x {} + || warn "scripts chmod failed (non-fatal)"
echo "[✓] Permissions fixed"
PERMFIX_EOF

  chmod +x "${ds_dir}/scripts/fix-permissions.sh"
  log "Created reusable permission fixer: ${ds_dir}/scripts/fix-permissions.sh"
}
