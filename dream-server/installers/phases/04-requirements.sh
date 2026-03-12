#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 04: Requirements Check
# ============================================================================
# Part of: installers/phases/
# Purpose: RAM, disk, GPU, and port availability checks
#
# Expects: SCRIPT_DIR, LOG_FILE, TIER, RAM_GB, DISK_AVAIL, GPU_BACKEND,
#           GPU_VRAM, GPU_NAME, GPU_COUNT, INTERACTIVE, DRY_RUN,
#           PREFLIGHT_REPORT_FILE, CAP_PLATFORM_ID, CAP_COMPOSE_OVERLAYS,
#           ENABLE_VOICE, ENABLE_WORKFLOWS, ENABLE_RAG,
#           tier_rank(), chapter(), ai_ok(), ai_bad(), ai_warn(), log(), warn()
# Provides: REQUIREMENTS_MET, TIER_RANK
#
# Modder notes:
#   Change minimum RAM/disk thresholds per tier here.
# ============================================================================

chapter "REQUIREMENTS CHECK"

[[ -f "${SCRIPT_DIR:-}/lib/safe-env.sh" ]] && . "${SCRIPT_DIR}/lib/safe-env.sh"

REQUIREMENTS_MET=true
TIER_RANK="$(tier_rank "$TIER")"

# Capability-aware preflight checks
if [[ -x "$SCRIPT_DIR/scripts/preflight-engine.sh" ]]; then
    PREFLIGHT_ENV="$("$SCRIPT_DIR/scripts/preflight-engine.sh" \
        --report "$PREFLIGHT_REPORT_FILE" \
        --tier "$TIER" \
        --ram-gb "$RAM_GB" \
        --disk-gb "$DISK_AVAIL" \
        --gpu-backend "$GPU_BACKEND" \
        --gpu-vram-mb "$GPU_VRAM" \
        --gpu-name "$GPU_NAME" \
        --platform-id "${CAP_PLATFORM_ID:-linux}" \
        --compose-overlays "${CAP_COMPOSE_OVERLAYS:-}" \
        --script-dir "$SCRIPT_DIR" \
        --env 2>>"$LOG_FILE")"
    load_env_from_output <<< "$PREFLIGHT_ENV"

    log "Preflight report: $PREFLIGHT_REPORT_FILE"
    if [[ "${PREFLIGHT_BLOCKERS:-0}" -gt 0 ]]; then
        REQUIREMENTS_MET=false
        ai_bad "Preflight found ${PREFLIGHT_BLOCKERS} blocker(s) and ${PREFLIGHT_WARNINGS:-0} warning(s)."
        python3 - "$PREFLIGHT_REPORT_FILE" << 'PY'
import json
import sys

path = sys.argv[1]
try:
    data = json.load(open(path, "r", encoding="utf-8"))
except Exception:
    sys.exit(0)
for check in data.get("checks", []):
    if check.get("status") != "blocker":
        continue
    message = check.get("message", "").strip()
    action = check.get("action", "").strip()
    if message:
        print(f"  - BLOCKER: {message}")
    if action:
        print(f"    Fix: {action}")
PY
    else
        ai_ok "Preflight passed with ${PREFLIGHT_WARNINGS:-0} warning(s)."
    fi

    if [[ "${PREFLIGHT_WARNINGS:-0}" -gt 0 ]]; then
        python3 - "$PREFLIGHT_REPORT_FILE" << 'PY'
import json
import sys

path = sys.argv[1]
try:
    data = json.load(open(path, "r", encoding="utf-8"))
except Exception:
    sys.exit(0)
for check in data.get("checks", []):
    if check.get("status") != "warn":
        continue
    message = check.get("message", "").strip()
    action = check.get("action", "").strip()
    if message:
        print(f"  - WARN: {message}")
    if action:
        print(f"    Suggestion: {action}")
PY
    fi
else
    warn "Preflight engine missing, using legacy requirement checks."
    case $TIER in
        NV_ULTRA) MIN_RAM=96 ;;
        SH_LARGE) MIN_RAM=96 ;;
        SH_COMPACT) MIN_RAM=64 ;;
        4) MIN_RAM=64 ;;
        3) MIN_RAM=48 ;;
        2) MIN_RAM=32 ;;
        *) MIN_RAM=16 ;;
    esac
    if [[ $RAM_GB -lt $MIN_RAM ]]; then
        warn "RAM: ${RAM_GB}GB available, ${MIN_RAM}GB recommended for Tier $TIER"
    else
        ai_ok "RAM: ${RAM_GB}GB (recommended: ${MIN_RAM}GB+)"
    fi
    case $TIER in
        1) MIN_DISK=30 ;;
        2) MIN_DISK=50 ;;
        3) MIN_DISK=80 ;;
        4) MIN_DISK=150 ;;
        *) MIN_DISK=50 ;;
    esac
    if [[ $DISK_AVAIL -lt $MIN_DISK ]]; then
        warn "Disk: ${DISK_AVAIL}GB available, ${MIN_DISK}GB minimum required for Tier $TIER"
        REQUIREMENTS_MET=false
    else
        ai_ok "Disk: ${DISK_AVAIL}GB available (minimum: ${MIN_DISK}GB for Tier $TIER)"
    fi
    if [[ "$TIER_RANK" -ge 2 && "$GPU_BACKEND" != "amd" && $GPU_VRAM -lt 10000 ]]; then
        warn "GPU: Tier $TIER requires dedicated NVIDIA GPU with 12GB+ VRAM"
    else
        ai_ok "GPU: Detected $GPU_NAME"
    fi
fi

# Port availability check (handles IPv4 and IPv6)
_port_check_warned=false
check_port() {
    local port=$1
    if command -v ss &> /dev/null; then
        ss -tln 2>/dev/null | grep -qE ":${port}(\s|$)" && return 1
    elif command -v netstat &> /dev/null; then
        netstat -tln 2>/dev/null | grep -qE ":${port}(\s|$)" && return 1
    else
        # Neither tool available — warn once, then skip port checks
        if [[ "$_port_check_warned" != "true" ]]; then
            warn "Neither 'ss' nor 'netstat' found — cannot verify port availability"
            warn "Install iproute2 (for ss) or net-tools (for netstat) to enable port checks"
            _port_check_warned=true
        fi
        return 0  # Can't check, assume free but user is warned
    fi
    return 0
}

PORTS_TO_CHECK="${SERVICE_PORTS[llama-server]:-8080} ${SERVICE_PORTS[open-webui]:-3000}"
[[ "$ENABLE_VOICE" == "true" ]] && PORTS_TO_CHECK="$PORTS_TO_CHECK ${SERVICE_PORTS[whisper]:-9000} ${SERVICE_PORTS[tts]:-8880}"
[[ "$ENABLE_WORKFLOWS" == "true" ]] && PORTS_TO_CHECK="$PORTS_TO_CHECK ${SERVICE_PORTS[n8n]:-5678}"
[[ "$ENABLE_RAG" == "true" ]] && PORTS_TO_CHECK="$PORTS_TO_CHECK ${SERVICE_PORTS[qdrant]:-6333}"

for port in $PORTS_TO_CHECK; do
    if ! check_port $port; then
        warn "Port $port is already in use"
        REQUIREMENTS_MET=false
    fi
done

if [[ "$REQUIREMENTS_MET" != "true" ]]; then
    warn "Some requirements not met. Installation may have limited functionality."
    if $INTERACTIVE && ! $DRY_RUN; then
        read -p "  Continue anyway? [y/N] " -r
        [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
    elif $DRY_RUN; then
        log "[DRY RUN] Would prompt to continue despite unmet requirements"
    fi
fi
