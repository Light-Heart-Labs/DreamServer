#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 13: Summary & Desktop Shortcut
# ============================================================================
# Part of: installers/phases/
# Purpose: Display URLs, create desktop shortcut, pin to sidebar, write
#          summary JSON, run preflight validation
#
# Expects: DRY_RUN, INSTALL_DIR, SCRIPT_DIR, LOG_FILE, INTERACTIVE,
#           TIER, TIER_NAME, VERSION, GPU_BACKEND, LLM_MODEL, OFFLINE_MODE,
#           ENABLE_VOICE, ENABLE_WORKFLOWS, ENABLE_RAG, ENABLE_OPENCLAW,
#           COMPOSE_FLAGS, SUMMARY_JSON_FILE, PREFLIGHT_REPORT_FILE,
#           BGRN, GRN, AMB, WHT, NC, DASHBOARD_PORT (:-3001),
#           CAP_HARDWARE_CLASS_ID (:-unknown), CAP_HARDWARE_CLASS_LABEL (:-Unknown),
#           BACKEND_SERVICE_NAME (:-llama-server),
#           show_success_card(), bootline(), signal(), ai_ok(), log()
# Provides: Desktop shortcut, sidebar pin, summary JSON
#
# Modder notes:
#   Change the final banner, add new service URLs, or modify the desktop
#   shortcut here.
# ============================================================================

dream_progress 98 "summary" "Finishing up"

# Source service registry for port resolution
. "$SCRIPT_DIR/lib/service-registry.sh"
sr_load

# Get local IP for LAN access
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")

# Mode is now stored in .env as DREAM_MODE (set by phase 06)
if ! $DRY_RUN; then
    mkdir -p "$INSTALL_DIR"
else
    log "[DRY RUN] Would write mode metadata to $INSTALL_DIR"
fi

# Show the cinematic success card
show_success_card "http://localhost:3000" "http://localhost:3001" "$LOCAL_IP"

# Check background tasks before showing additional info
if [[ -f "$SCRIPT_DIR/installers/lib/background-tasks.sh" ]]; then
    . "$SCRIPT_DIR/installers/lib/background-tasks.sh"

    # Check if any background tasks are registered
    if [[ -f "$BG_TASK_REGISTRY" ]]; then
        echo ""
        ai "Checking background tasks..."
        bg_task_summary >> "$LOG_FILE" 2>&1

        # Check FLUX download specifically
        bg_task_status "flux-download" &>/dev/null
        flux_status=$?
        if [[ $flux_status -ne 3 ]]; then
            case $flux_status in
                0)  # Still running
                    ai_warn "FLUX model download still in progress"
                    ai "ComfyUI image generation will be available once download completes"
                    ai "Check progress: tail -f $INSTALL_DIR/logs/flux-download.log"
                    ;;
                1)  # Completed
                    ai_ok "FLUX model download completed"
                    ;;
                2)  # Failed
                    ai_warn "FLUX model download encountered errors"
                    ai "Check log: $INSTALL_DIR/logs/flux-download.log"
                    ;;
            esac
        fi
    fi
fi

# Additional service info
bootline
echo -e "${BGRN}ALL SERVICES${NC}"
bootline
# Core services always shown
echo "  • Chat UI:       http://localhost:${SERVICE_PORTS[open-webui]:-3000}"
echo "  • Dashboard:     http://localhost:${SERVICE_PORTS[dashboard]:-3001}"
echo "  • Perplexica:    http://localhost:${SERVICE_PORTS[perplexica]:-3004}"
echo "  • ComfyUI:       http://localhost:${SERVICE_PORTS[comfyui]:-8188}"
echo "  • LLM API:       http://localhost:${SERVICE_PORTS[llama-server]:-11434}/v1  (llama-server)"
[[ "$ENABLE_OPENCLAW" == "true" ]] && echo "  • OpenClaw:      http://localhost:${SERVICE_PORTS[openclaw]:-7860}"
systemctl --user is-active opencode-web &>/dev/null && echo "  • OpenCode:      http://localhost:3003"
[[ "$ENABLE_VOICE" == "true" ]] && echo "  • Whisper STT:   http://localhost:${SERVICE_PORTS[whisper]:-9000}"
[[ "$ENABLE_VOICE" == "true" ]] && echo "  • TTS (Kokoro):  http://localhost:${SERVICE_PORTS[tts]:-8880}"
[[ "$ENABLE_WORKFLOWS" == "true" ]] && echo "  • n8n:           http://localhost:${SERVICE_PORTS[n8n]:-5678}"
[[ "$ENABLE_RAG" == "true" ]] && echo "  • Qdrant:        http://localhost:${SERVICE_PORTS[qdrant]:-6333}"
echo ""

# Configuration summary
bootline
echo -e "${BGRN}YOUR CONFIGURATION${NC}"
bootline
echo "  • Tier: $TIER ($TIER_NAME)"
echo "  • Model: $LLM_MODEL"
echo "  • Install dir: $INSTALL_DIR"
echo ""

# Quick commands
bootline
echo -e "${BGRN}QUICK COMMANDS${NC}"
bootline
echo "  cd $INSTALL_DIR"
echo "  docker compose ps                          # Check container status"
echo "  docker compose logs -f                     # View container logs"
echo "  docker compose restart                     # Restart containers"
echo "  systemctl --user list-timers               # Check maintenance timers"
echo "  dream status                                 # Check service health"
echo ""

if [[ -f "$LOG_FILE" ]]; then
    echo -e "${BGRN}Full installation log:${NC} $LOG_FILE"
    echo ""
fi
if [[ -f "$PREFLIGHT_REPORT_FILE" ]]; then
    echo -e "${BGRN}Preflight report:${NC} $PREFLIGHT_REPORT_FILE"
    echo ""
fi

# Run preflight check to validate installation
echo ""
bootline
echo -e "${BGRN}RUNNING PREFLIGHT VALIDATION${NC}"
bootline
echo ""

if [[ -f "$SCRIPT_DIR/dream-preflight.sh" ]]; then
    # Wait a moment for services to stabilize
    sleep 2
    bash "$SCRIPT_DIR/dream-preflight.sh" || true
else
    log "Preflight script not found — skipping validation"
fi

# Extension manifest validation (non-blocking)
echo ""
bootline
echo -e "${BGRN}VALIDATING EXTENSIONS${NC}"
bootline
echo ""
if [[ -f "$SCRIPT_DIR/scripts/validate-manifests.sh" ]]; then
    if bash "$SCRIPT_DIR/scripts/validate-manifests.sh"; then
        ai_ok "Extension manifests validated for this Dream Server version."
    else
        warn "Extension manifest validation reported issues. See details above."
    fi
else
    log "Extension validation script not found — skipping extension checks"
fi

#=============================================================================
# Desktop Shortcut & Sidebar Pin
#=============================================================================
if ! $DRY_RUN; then
    DESKTOP_FILE="$HOME/.local/share/applications/dream-server.desktop"
    mkdir -p "$HOME/.local/share/applications"
    cat > "$DESKTOP_FILE" << DESKTOP_EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Dream Server
Comment=Local AI Dashboard
Exec=xdg-open http://localhost:3001
Icon=applications-internet
Terminal=false
Categories=Development;
StartupNotify=true
DESKTOP_EOF

    # Pin to GNOME sidebar (favorites) if gsettings is available
    if command -v gsettings &> /dev/null; then
        CURRENT_FAVS=$(gsettings get org.gnome.shell favorite-apps 2>/dev/null || echo "[]")
        if [[ "$CURRENT_FAVS" != *"dream-server.desktop"* ]]; then
            NEW_FAVS=$(echo "$CURRENT_FAVS" | sed "s/]$/, 'dream-server.desktop']/" | sed "s/\[, /[/")
            gsettings set org.gnome.shell favorite-apps "$NEW_FAVS" 2>/dev/null || true
            ai_ok "Dashboard pinned to sidebar"
        fi
    fi

    ai_ok "Desktop shortcut created: Dream Server"
fi

#=============================================================================
# Bash Completion Setup
#=============================================================================
if ! $DRY_RUN; then
    COMPLETION_FILE="$INSTALL_DIR/completions/dream-cli.bash"
    if [[ -f "$COMPLETION_FILE" ]]; then
        # Add completion sourcing to .bashrc if not already present
        if ! grep -q "dream-cli.bash" "$HOME/.bashrc" 2>/dev/null; then
            cat >> "$HOME/.bashrc" << 'BASHRC_EOF'

# Dream Server CLI bash completion
if [[ -f "$HOME/dream-server/completions/dream-cli.bash" ]]; then
    . "$HOME/dream-server/completions/dream-cli.bash"
fi
BASHRC_EOF
            ai_ok "Bash completion enabled for dream-cli"
        fi
    fi
fi

echo ""
signal "Broadcast stable. You're free now."
echo ""
DASHBOARD_PORT="${SERVICE_PORTS[dashboard]:-3001}"
WEBUI_PORT="${SERVICE_PORTS[open-webui]:-3000}"
OPENCLAW_PORT="${SERVICE_PORTS[openclaw]:-7860}"
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo -e "${GRN}──────────────────────────────────────────────────────────────────────────────${NC}"
echo -e "${BGRN}  YOUR DREAM SERVER IS LIVE${NC}"
echo -e "${GRN}──────────────────────────────────────────────────────────────────────────────${NC}"
echo ""
echo -e "  ${BGRN}Dashboard${NC}    ${WHT}http://localhost:${DASHBOARD_PORT}${NC}"
echo -e "  ${BGRN}Chat${NC}         ${WHT}http://localhost:${WEBUI_PORT}${NC}"
[[ "$ENABLE_OPENCLAW" == "true" ]] && \
echo -e "  ${BGRN}OpenClaw${NC}     ${WHT}http://localhost:${OPENCLAW_PORT}${NC}"
systemctl --user is-active opencode-web &>/dev/null && \
echo -e "  ${BGRN}OpenCode${NC}     ${WHT}http://localhost:3003${NC}"
echo ""
if [[ -n "$LOCAL_IP" ]]; then
echo -e "  ${AMB}On your network:${NC}  ${WHT}http://${LOCAL_IP}:${DASHBOARD_PORT}${NC}"
fi
echo ""
echo -e "  Start here → ${WHT}http://localhost:${DASHBOARD_PORT}${NC}"
echo -e "  The Dashboard shows all services, GPU status, and quick links."
echo ""
echo -e "${GRN}──────────────────────────────────────────────────────────────────────────────${NC}"
echo ""

if [[ -n "$SUMMARY_JSON_FILE" ]]; then
    PYTHON_CMD="python3"
    if [[ -f "$SCRIPT_DIR/lib/python-cmd.sh" ]]; then
        . "$SCRIPT_DIR/lib/python-cmd.sh"
        PYTHON_CMD="$(ds_detect_python_cmd)"
    elif command -v python >/dev/null 2>&1; then
        PYTHON_CMD="python"
    fi

    "$PYTHON_CMD" - "$SUMMARY_JSON_FILE" "$VERSION" "$INSTALL_DIR" "$TIER" "$TIER_NAME" "$GPU_BACKEND" "${BACKEND_SERVICE_NAME:-llama-server}" "$LLM_MODEL" "$COMPOSE_FLAGS" "$DRY_RUN" "$PREFLIGHT_REPORT_FILE" "${CAP_HARDWARE_CLASS_ID:-unknown}" "${CAP_HARDWARE_CLASS_LABEL:-Unknown}" <<'PY'
import json
import pathlib
import sys
from datetime import datetime, timezone

(
    out_file,
    version,
    install_dir,
    tier,
    tier_name,
    gpu_backend,
    backend_service,
    llm_model,
    compose_flags,
    dry_run,
    preflight_report,
    hw_class_id,
    hw_class_label,
) = sys.argv[1:]

payload = {
    "version": "1",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "installer_version": version,
    "install_dir": install_dir,
    "tier": {"id": tier, "name": tier_name},
    "runtime": {
        "gpu_backend": gpu_backend,
        "backend_service": backend_service,
        "llm_model": llm_model,
        "compose_flags": compose_flags,
        "dry_run": dry_run == "true",
    },
    "hardware_class": {"id": hw_class_id, "label": hw_class_label},
    "preflight_report": preflight_report,
}

path = pathlib.Path(out_file)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
print(f"[INFO] Wrote installer summary JSON: {out_file}")
PY
fi
