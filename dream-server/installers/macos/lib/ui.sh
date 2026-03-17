#!/bin/bash
# ============================================================================
# Dream Server macOS Installer -- UI Helpers
# ============================================================================
# Part of: installers/macos/lib/
# Purpose: Colored output, phase headers, progress, banners
#
# Matches the CRT narrator voice from installers/lib/ui.sh
# ============================================================================

DIVIDER="──────────────────────────────────────────────────────────────────────────────"

# Elapsed time since install start
install_elapsed() {
    local secs=$(( $(date +%s) - INSTALL_START_EPOCH ))
    local m=$(( secs / 60 ))
    local s=$(( secs % 60 ))
    printf '%dm %02ds' "$m" "$s"
}

# ── Logging ──

log() { echo -e "${GRN}[INFO]${NC} $1" | tee -a "$DS_LOG_FILE"; }

# ── AI narrator voice ──

ai()       { echo -e "  ${GRN}>${NC} $1" | tee -a "$DS_LOG_FILE"; }
ai_ok()    { echo -e "  ${BGRN}[OK]${NC} $1" | tee -a "$DS_LOG_FILE"; }
ai_warn()  { echo -e "  ${AMB}[!!]${NC} $1" | tee -a "$DS_LOG_FILE"; }
ai_err()   { echo -e "  ${RED}[XX]${NC} $1" | tee -a "$DS_LOG_FILE"; }
info_box() { echo -e "  ${DGRN}$1${NC} ${WHT}$2${NC}" | tee -a "$DS_LOG_FILE"; }

# Section header
chapter() {
    local title="$1"
    echo ""
    echo -e "  ${DGRN}$(printf '=%.0s' {1..60})${NC}"
    echo -e "  ${WHT}${title}${NC}"
    echo -e "  ${DGRN}$(printf '=%.0s' {1..60})${NC}"
}

# Phase screen
show_phase() {
    local phase=$1 total=$2 name=$3 estimate=$4
    local elapsed
    elapsed=$(install_elapsed)
    echo ""
    echo -e "  ${DGRN}DREAMGATE SEQUENCE [${elapsed}]${NC}  ${WHT}PHASE ${phase}/${total}${NC} ${BGRN}-- ${name}${NC}"
    if [[ -n "$estimate" ]]; then
        echo -e "  ${DGRN}Estimated: ${estimate}${NC}"
    fi
    echo -e "  ${DGRN}$(printf -- '-%.0s' {1..60})${NC}"
}

# Boot banner
show_dream_banner() {
    echo ""
    echo -e "${BGRN}    ____                              ____${NC}"
    echo -e "${BGRN}   / __ \\________  ____ _____ ___   / ___/___  ______   _____  _____${NC}"
    echo -e "${BGRN}  / / / / ___/ _ \\/ __ \`/ __ \`__ \\  \\__ \\/ _ \\/ ___/ | / / _ \\/ ___/${NC}"
    echo -e "${BGRN} / /_/ / /  /  __/ /_/ / / / / / / ___/ /  __/ /   | |/ /  __/ /${NC}"
    echo -e "${BGRN}/_____/_/   \\___/\\__,_/_/ /_/ /_/ /____/\\___/_/    |___/\\___/_/${NC}"
    echo ""
    echo -e "  ${WHT}DREAMGATE macOS Installer v${DS_VERSION}${NC}"
    echo -e "  ${DGRN}One command to a full local AI stack.${NC}"
    echo -e "  ${DGRN}Apple Silicon + Metal acceleration${NC}"
    echo ""
}

# Download with curl and resume support
download_with_progress() {
    local url="$1"
    local destination="$2"
    local label="${3:-Downloading}"

    ai "${label}..."
    local part_file="${destination}.part"
    if curl -C - -L --progress-bar \
        --connect-timeout 10 \
        --speed-time 30 --speed-limit 10240 \
        -o "$part_file" "$url"; then
        mv "$part_file" "$destination"
        ai_ok "${label} complete"
        return 0
    else
        local rc=$?
        ai_err "${label} failed (curl exit code: ${rc})"
        ai "Re-run the installer to resume the download."
        return 1
    fi
}

# Success card
show_success_card() {
    local webui_port="${1:-3000}"
    local dashboard_port="${2:-3001}"

    # Detect local IP for network access
    local local_ip
    local_ip=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "your-ip")

    echo ""
    echo -e "  ${BGRN}$(printf '=%.0s' {1..60})${NC}"
    echo ""
    echo -e "       ${WHT}THE GATEWAY IS OPEN${NC}"
    echo ""
    echo -e "       ${DGRN}Chat UI:${NC}    ${WHT}http://localhost:${webui_port}${NC}"
    echo -e "       ${DGRN}Dashboard:${NC}  ${WHT}http://localhost:${dashboard_port}${NC}"
    echo -e "       ${DGRN}Network:${NC}    ${WHT}http://${local_ip}:${webui_port}${NC}"
    echo ""
    echo -e "       ${DGRN}Manage:${NC}     ${GRN}./dream-macos.sh status${NC}"
    echo -e "       ${DGRN}Logs:${NC}       ${GRN}./dream-macos.sh logs llama-server${NC}"
    echo -e "       ${DGRN}Stop:${NC}       ${GRN}./dream-macos.sh stop${NC}"
    echo ""
    echo -e "       ${DGRN}Install completed in $(install_elapsed)${NC}"
    echo ""
    echo -e "  ${BGRN}$(printf '=%.0s' {1..60})${NC}"
    echo ""
}
