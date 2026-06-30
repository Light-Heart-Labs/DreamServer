#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

START_SCRIPT="$ROOT_DIR/scripts/start-remote-llm-tunnel.ps1"
REGISTER_SCRIPT="$ROOT_DIR/scripts/register-remote-llm-tunnel-task.ps1"
CHECK_SCRIPT="$ROOT_DIR/scripts/check-remote-llm.ps1"
CONFIGURE_SCRIPT="$ROOT_DIR/scripts/configure-remote-llm.ps1"
DOCTOR_SCRIPT="$ROOT_DIR/scripts/ods-doctor.sh"
ENV_EXAMPLE="$ROOT_DIR/.env.example"
ENV_SCHEMA="$ROOT_DIR/.env.schema.json"
DOC="$ROOT_DIR/docs/REMOTE-LLM-TUNNEL.md"

pass() { printf '[PASS] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1" >&2; exit 1; }

require_file() {
    [[ -f "$1" ]] && pass "$2 exists" || fail "$2 missing"
}

require_grep() {
    local pattern="$1" file="$2" label="$3"
    grep -Fq -- "$pattern" "$file" && pass "$label" || fail "$label"
}

reject_grep() {
    local pattern="$1" file="$2" label="$3"
    if grep -Fq -- "$pattern" "$file"; then
        fail "$label"
    fi
    pass "$label"
}

require_file "$START_SCRIPT" "start-remote-llm-tunnel.ps1"
require_file "$REGISTER_SCRIPT" "register-remote-llm-tunnel-task.ps1"
require_file "$CHECK_SCRIPT" "check-remote-llm.ps1"
require_file "$CONFIGURE_SCRIPT" "configure-remote-llm.ps1"
require_file "$DOC" "REMOTE-LLM-TUNNEL.md"

if command -v powershell.exe >/dev/null 2>&1; then
    PS_BIN="powershell.exe"
elif command -v pwsh >/dev/null 2>&1; then
    PS_BIN="pwsh"
else
    PS_BIN=""
fi

if [[ -n "$PS_BIN" ]]; then
    tmp_ps="$(mktemp "${TMPDIR:-/tmp}/ods-remote-llm-parse.XXXXXX.ps1")"
    trap 'rm -f "$tmp_ps"' EXIT
    cat > "$tmp_ps" <<'PS_EOF'
param([string[]]$Paths)
$ErrorActionPreference = "Stop"
foreach ($p in $Paths) {
    $null = [scriptblock]::Create((Get-Content -LiteralPath $p -Raw))
}
Write-Host "[PASS] PowerShell scripts parse"
PS_EOF
    if command -v cygpath >/dev/null 2>&1; then
        "$PS_BIN" -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$tmp_ps")" \
            "$(cygpath -w "$START_SCRIPT")" \
            "$(cygpath -w "$REGISTER_SCRIPT")" \
            "$(cygpath -w "$CHECK_SCRIPT")" \
            "$(cygpath -w "$CONFIGURE_SCRIPT")" |
            grep -F '[PASS] PowerShell scripts parse'
    else
        "$PS_BIN" -NoProfile -ExecutionPolicy Bypass -File "$tmp_ps" \
            "$START_SCRIPT" "$REGISTER_SCRIPT" "$CHECK_SCRIPT" "$CONFIGURE_SCRIPT" |
            grep -F '[PASS] PowerShell scripts parse'
    fi
else
    printf '[SKIP] PowerShell unavailable; static checks still run\n'
fi

require_grep 'REMOTE_LLM_TUNNEL_SSH_HOST' "$START_SCRIPT" "supervisor reads SSH host from env"
require_grep 'REMOTE_LLM_TUNNEL_EXPECTED_MODEL' "$START_SCRIPT" "supervisor validates expected model"
require_grep 'ExitOnForwardFailure=yes' "$START_SCRIPT" "ssh tunnel fails fast when port forward cannot bind"
require_grep 'ServerAliveInterval=30' "$START_SCRIPT" "ssh tunnel has keepalive"
require_grep 'BatchMode=yes' "$START_SCRIPT" "ssh tunnel is non-interactive"
require_grep '-WindowStyle Hidden' "$START_SCRIPT" "ssh process starts hidden"
require_grep 'Get-NetTCPConnection' "$START_SCRIPT" "supervisor checks listener ownership"
require_grep 'System.Threading.Mutex' "$START_SCRIPT" "supervisor prevents duplicate loops"
reject_grep 'tower2' "$START_SCRIPT" "supervisor is not Tower2-specific"

require_grep 'New-ScheduledTaskTrigger -AtLogOn' "$REGISTER_SCRIPT" "task starts at user logon"
require_grep '-RestartCount 999' "$REGISTER_SCRIPT" "task retries after launch failures"
require_grep '-MultipleInstances IgnoreNew' "$REGISTER_SCRIPT" "task avoids duplicate supervisors"
require_grep '-RunLevel Limited' "$REGISTER_SCRIPT" "task does not require elevation"

require_grep 'docker-compose.cloud.yml' "$CONFIGURE_SCRIPT" "configure helper inserts cloud overlay"
require_grep 'remote-llm-backup-' "$CONFIGURE_SCRIPT" "configure helper backs up runtime files"
require_grep 'HERMES_LLM_BASE_URL' "$CONFIGURE_SCRIPT" "configure helper updates Hermes route"
require_grep 'config\litellm\cloud.yaml' "$CONFIGURE_SCRIPT" "configure helper updates cloud LiteLLM config"
require_grep 'REMOTE_LLM_TUNNEL_ENABLED' "$CONFIGURE_SCRIPT" "configure helper writes remote tunnel env"
reject_grep 'tower2' "$CONFIGURE_SCRIPT" "configure helper is not Tower2-specific"

require_grep 'host remote models' "$CHECK_SCRIPT" "validation checks host model list"
require_grep 'container remote models' "$CHECK_SCRIPT" "validation checks Docker reachability"
require_grep 'local llama-server stopped' "$CHECK_SCRIPT" "validation catches stale local inference"

require_grep 'REMOTE_LLM_TUNNEL_ENABLED=false' "$ENV_EXAMPLE" "env example documents remote tunnel switch"
require_grep '"REMOTE_LLM_TUNNEL_LOCAL_PORT"' "$ENV_SCHEMA" "env schema documents remote tunnel port"
require_grep 'remote_llm_tunnel = _truthy(env_get("REMOTE_LLM_TUNNEL_ENABLED"))' "$DOCTOR_SCRIPT" "doctor reads remote tunnel switch"
require_grep 'cloud_bypass_is_remote_tunnel' "$DOCTOR_SCRIPT" "doctor allows intentional direct tunnel route"
require_grep 'Start-ScheduledTask -TaskName "ODS Remote LLM Tunnel"' "$DOC" "docs include startup command"

echo "[PASS] Windows remote LLM tunnel contracts"
