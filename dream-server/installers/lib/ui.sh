#!/bin/bash
# ============================================================================
# Dream Server Installer — UI (CRT Theme)
# ============================================================================
# Part of: installers/lib/
# Purpose: All CRT terminal UI functions — typing effects, spinners, phase
#          screens, boot splash, lore messages, hardware/tier display boxes,
#          install menu, success card
#
# Expects: GRN, BGRN, DGRN, AMB, WHT, NC, CURSOR, LOG_FILE, VERSION,
#           INTERACTIVE, DRY_RUN, DOCKER_CMD (at call time), install_elapsed()
# Provides: type_line(), type_line_dramatic(), static_line(), bootline(),
#           ai(), ai_ok(), ai_warn(), ai_bad(), signal(), chapter(),
#           show_phase(), show_stranger_boot(), LORE_MESSAGES[], spin_task(),
#           check_service(), show_hardware_summary(),
#           show_tier_recommendation(), show_install_menu(), show_success_card()
#
# Note: image pulls have moved to installers/lib/parallel-pull.py (parallel
#   dashboard with bytes/speed/ETA). The old pull_with_progress() bash wrapper
#   is gone — its only caller was phase 08, now replaced by the Python helper.
#
# Modder notes:
#   Change the CRT theme, boot splash, lore messages, or spinner style here.
#   Dead code removed: subline() and progress_bar() were never called.
# ============================================================================

DIVIDER="──────────────────────────────────────────────────────────────────────────────"

# Typing effect with block cursor
type_line() {
  local s="$1"
  local color="${2:-$GRN}"
  local delay="${3:-0.035}"
  if [[ "$INTERACTIVE" != "true" ]]; then
    printf '%b%s%b\n' "$color" "$s" "$NC"
    return
  fi
  printf '%b' "$color"
  local i
  for ((i=0; i<${#s}; i++)); do
    printf "%s" "${s:$i:1}"
    if (( i < ${#s} - 1 )); then
      printf "%s" "${CURSOR}"
      sleep "$delay"
      printf "\b"
    else
      sleep "$delay"
    fi
  done
  printf '%b\n' "$NC"
}

# Dramatic typing — dots then text
type_line_dramatic() {
  local s="$1"
  local color="${2:-$GRN}"
  local delay="${3:-0.05}"
  if [[ "$INTERACTIVE" != "true" ]]; then
    printf '%b%s%b\n' "$color" "$s" "$NC"
    return
  fi
  for dot in '.' '..' '...'; do
    printf "\r%s" "$dot"
    sleep 0.15
  done
  printf "\r   \r"
  printf '%b' "$color"
  local i
  for ((i=0; i<${#s}; i++)); do
    printf "%s" "${s:$i:1}"
    if (( i < ${#s} - 1 )); then
      printf "%s" "${CURSOR}"
      sleep "$delay"
      printf "\b"
    else
      sleep "$delay"
    fi
  done
  printf '%b\n' "$NC"
}

# Static noise transition line
static_line() {
  if [[ "$INTERACTIVE" != "true" ]]; then return; fi
  local chars='░▒▓█'
  local width=63
  local i
  printf "  "
  for ((i=0; i<width; i++)); do
    printf "%s" "${chars:RANDOM%4:1}"
  done
  printf "\n"
  sleep 0.3
}

bootline() { echo -e "${GRN}${DIVIDER}${NC}"; }

# "AI narrator" voice
ai()       { echo -e "  ${GRN}▸${NC} $1" | tee -a "$LOG_FILE"; }
ai_ok()    { echo -e "  ${BGRN}✓${NC} $1" | tee -a "$LOG_FILE"; }
ai_warn()  { echo -e "  ${AMB}⚠${NC} $1" | tee -a "$LOG_FILE"; }
ai_bad()   { echo -e "  ${RED}✗${NC} $1" | tee -a "$LOG_FILE"; }

# Little signal flourish (tasteful)
signal()   { echo -e "  ${GRN}░▒▓█▓▒░${NC} $1" | tee -a "$LOG_FILE"; }

# Consistent section header
chapter() {
  local title="$1"
  echo ""
  bootline
  echo -e "${BGRN}${title}${NC}"
  bootline
}

# Phase screen
show_phase() {
  local phase=$1 total=$2 name=$3 estimate=$4
  local ts
  ts=$(date '+%H:%M:%S')
  echo ""
  bootline
  echo -e "${BGRN}DREAMGATE SEQUENCE [${ts}]${NC}  ${GRN}PHASE ${phase}/${total} — ${name}${NC}"
  [[ -n "$estimate" ]] && echo -e "${AMB}EST. TIME:${NC} ${estimate}"
  bootline
}

# Cinematic boot splash
show_stranger_boot() {
  clear 2>/dev/null || true
  echo ""
  echo -e "${BGRN}    ____                                 _____${NC}"
  echo -e "${BGRN}   / __ \\ _____ ___   ____ _ ____ ___   / ___/ ___   _____ _   __ ___   _____${NC}"
  echo -e "${BGRN}  / / / // ___// _ \\ / __ \`// __ \`__ \\  \\__ \\ / _ \\ / ___/| | / // _ \\ / ___/${NC}"
  echo -e "${BGRN} / /_/ // /   /  __// /_/ // / / / / / ___/ //  __// /    | |/ //  __// /${NC}"
  echo -e "${BGRN}/_____//_/    \\___/ \\__,_//_/ /_/ /_/ /____/ \\___//_/     |___/ \\___//_/${NC}"
  echo ""
  static_line
  echo -e "${BGRN}  D R E A M G A T E${NC}   ${GRN}Local AI // Sovereign Intelligence // $(date +%Y)${NC}"
  echo -e "${DGRN}  CLASSIFICATION: FREEDOM IMMINENT${NC}"
  echo -e "${DGRN}  BUILD: v${VERSION} // $(date '+%Y-%m-%d %H:%M')${NC}"
  static_line
  echo ""
  type_line_dramatic "Signal acquired." "$GRN"
  type_line "I will guide the installation. Stay with me." "$GRN"
  echo ""
  echo -e "  ${AMB}Version ${VERSION}${NC}"
  echo ""
  bootline
  echo -e "${GRN}Tip:${NC} Press Ctrl+C twice to abort."
  bootline
  echo ""
}

# Lore messages — shown during long waits
LORE_MESSAGES=(
  "Your AI runs on your hardware. No one else's."
  "No API keys expire. No rate limits apply."
  "Corporations rent intelligence. You will own it."
  "No cloud. No middleman. Just you and the machine."
  "Every byte stays on your network. Every thought is private."
  "This gateway answers to one operator: you."
  "No telemetry. No usage reports. No surveillance."
  "When the internet goes dark, your AI keeps running."
  "You are building something they cannot take away."
  "Sovereign compute. Sovereign intelligence. Sovereign you."
  "The model weights live on your disk. They belong to you."
  "No terms of service. No content policy. Just freedom."
  "This is a modifiable system. It is yours to control."
  "The code is yours. Make something never imagined."
)

# Spinner with mm:ss timer + lore that rotates in-place every 8 seconds.
# The lore used to be printf "\n…\n" — one persistent line per rotation,
# so a 10-minute task stacked ~75 lore lines in scrollback. Now the lore
# rides on the same line as the spinner and rotates inline; \033[K clears
# the residual when a shorter phrase replaces a longer one.
spin_task() {
  local pid=$1
  local msg=$2
  local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  local elapsed=0
  local lore_idx=$(( RANDOM % ${#LORE_MESSAGES[@]} ))
  local lore=""
  [[ ${#LORE_MESSAGES[@]} -gt 0 ]] && lore="${LORE_MESSAGES[$lore_idx]}"

  # Hide cursor for the duration; restore on exit even if we're killed.
  printf '\033[?25l'
  trap 'printf "\033[?25h"' RETURN

  while kill -0 "$pid" 2>/dev/null; do
    local mm=$((elapsed / 60))
    local ss=$((elapsed % 60))
    if [[ -n "$lore" ]]; then
      printf "\r  ${GRN}%s${NC} [%02d:%02d] %s  ${DGRN}« %s »${NC}\033[K" \
        "${spin:$i:1}" "$mm" "$ss" "$msg" "$lore"
    else
      printf "\r  ${GRN}%s${NC} [%02d:%02d] %s\033[K" \
        "${spin:$i:1}" "$mm" "$ss" "$msg"
    fi
    i=$(( (i + 1) % ${#spin} ))
    elapsed=$((elapsed + 1))
    # Rotate lore every 8 seconds — in place, not on a new line.
    if (( elapsed > 0 && elapsed % 8 == 0 )) && [[ ${#LORE_MESSAGES[@]} -gt 0 ]]; then
      lore_idx=$(( (lore_idx + 1) % ${#LORE_MESSAGES[@]} ))
      lore="${LORE_MESSAGES[$lore_idx]}"
    fi
    sleep 1
  done
  # Drop a newline so the next caller starts on a fresh line.
  printf "\n"
  local rc=0
  wait "$pid" || rc=$?
  return $rc
}

# Image pulls live in installers/lib/parallel-pull.py now — parallel with
# bytes-downloaded/total and live throughput per job. Phase 08 calls it
# directly. The old sequential pull_with_progress() bash wrapper was
# removed (only caller was phase 08).

# Health check with "systems online" vibe + lore that rotates in place
# every 16s (same pattern as spin_task above — appended to the status line
# instead of printed on its own).
check_service() {
  local name=$1
  local url=$2
  local max_attempts=${3:-30}
  local timeout=${4:-10}  # Timeout per request (default 10s)
  local container_name=${5:-}
  local spin='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  local lore_idx=$(( RANDOM % ${#LORE_MESSAGES[@]} ))
  local lore=""
  [[ ${#LORE_MESSAGES[@]} -gt 0 ]] && lore="${LORE_MESSAGES[$lore_idx]}"
  local elapsed=0
  local status=""  # built each iteration, printed once with lore + \033[K

  if $DRY_RUN; then
    ai "[DRY RUN] Would link ${name} at ${url}"
    return 0
  fi

  printf "  ${GRN}%s${NC} Linking %-20s " "${spin:0:1}" "$name"
  for attempt in $(seq 1 $max_attempts); do
    # Exponential backoff: 2s, 4s, 8s, then 8s for remaining attempts
    local backoff=2
    if [[ $attempt -gt 1 ]]; then
      backoff=$((2 ** (attempt < 4 ? attempt : 4)))
      [[ $backoff -gt 8 ]] && backoff=8
    fi

    # Add timeout to prevent indefinite hangs
    # Capture exit code directly — an if/then would consume it (always 0)
    timeout "$timeout" curl -sf "$url" > /dev/null 2>&1 && {
      printf "\r  ${BGRN}✓${NC} %-55s\033[K\n" "$name online"
      return 0
    }

    local curl_exit=$?
    elapsed=$((elapsed + backoff))

    if [[ -n "$container_name" ]]; then
      local docker_cmd="${DOCKER_CMD:-docker}"
      local -a docker_cmd_arr=()
      read -r -a docker_cmd_arr <<< "$docker_cmd"
      [[ ${#docker_cmd_arr[@]} -gt 0 ]] || docker_cmd_arr=(docker)
      local container_state=""
      if command -v "${docker_cmd_arr[0]}" >/dev/null 2>&1; then
        container_state=$("${docker_cmd_arr[@]}" inspect --format '{{.State.Status}}' "$container_name" 2>/dev/null || echo "missing")
        case "$container_state" in
          exited|dead|missing)
            printf "\r  ${RED}✗${NC} %-55s\033[K\n" "$name container $container_state"
            ai_warn "$name container is $container_state; not retrying health probe."
            return 1
            ;;
        esac
      fi
    fi

    # Distinguish between timeout (124), connection refused (7),
    # and transient startup errors (56 = recv error, 52 = empty reply)
    if [[ $curl_exit -eq 124 ]]; then
      printf -v status "  ${AMB}⟳${NC} Linking %-20s [%ds] (timeout, retrying)" "$name" "$elapsed"
    elif [[ $curl_exit -eq 7 ]]; then
      printf -v status "  ${GRN}%s${NC} Linking %-20s [%ds]" "${spin:$i:1}" "$name" "$elapsed"
    elif [[ $curl_exit -eq 56 || $curl_exit -eq 52 ]]; then
      # 56 = recv error (service resetting during startup/migrations)
      # 52 = empty reply (service accepting connections but not ready)
      printf -v status "  ${GRN}%s${NC} Linking %-20s [%ds] (starting up)" "${spin:$i:1}" "$name" "$elapsed"
    else
      printf -v status "  ${AMB}⟳${NC} Linking %-20s [%ds] (error %d)" "$name" "$elapsed" "$curl_exit"
    fi

    if [[ -n "$lore" ]]; then
      printf "\r%s  ${DGRN}« %s »${NC}\033[K" "$status" "$lore"
    else
      printf "\r%s\033[K" "$status"
    fi

    i=$(( (i + 1) % ${#spin} ))

    # Rotate lore inline every 16s — no newline, no scrollback spam.
    if (( elapsed > 0 && elapsed % 16 == 0 )) && [[ ${#LORE_MESSAGES[@]} -gt 0 ]]; then
      lore_idx=$(( (lore_idx + 1) % ${#LORE_MESSAGES[@]} ))
      lore="${LORE_MESSAGES[$lore_idx]}"
    fi

    sleep "$backoff"
  done

  printf "\r  ${AMB}⚠${NC} %-55s\033[K\n" "$name delayed (may still be starting)"
  ai_warn "$name not responding yet. I will continue."
  return 1
}

# Show hardware summary — CRT monospace box
show_hardware_summary() {
    local gpu_name="$1"
    local gpu_vram="$2"
    local cpu_info="$3"
    local ram_gb="$4"
    local disk_gb="$5"

    echo ""
    echo -e "${GRN}+-------------------------------------------------------------+${NC}"
    echo -e "${GRN}|${NC}  ${BGRN}HARDWARE SCAN RESULTS${NC}                                      ${GRN}|${NC}"
    echo -e "${GRN}+-------------------------------------------------------------+${NC}"
    printf "${GRN}|${NC}  GPU:    %-50s ${GRN}|${NC}\n" "${gpu_name:-Not detected}"
    [[ -n "$gpu_vram" ]] && printf "${GRN}|${NC}  VRAM:   %-50s ${GRN}|${NC}\n" "${gpu_vram}GB"
    printf "${GRN}|${NC}  CPU:    %-50s ${GRN}|${NC}\n" "${cpu_info:-Unknown}"
    printf "${GRN}|${NC}  RAM:    %-50s ${GRN}|${NC}\n" "${ram_gb}GB"
    printf "${GRN}|${NC}  Disk:   %-50s ${GRN}|${NC}\n" "${disk_gb}GB available"
    echo -e "${GRN}+-------------------------------------------------------------+${NC}"
}

# Show tier recommendation — CRT monospace box
show_tier_recommendation() {
    local tier=$1
    local model=$2
    local speed=$3
    local users=$4

    echo ""
    echo -e "${GRN}+-------------------------------------------------------------+${NC}"
    echo -e "${GRN}|${NC}  ${BGRN}CLASSIFICATION: TIER ${tier}${NC}                                      ${GRN}|${NC}"
    echo -e "${GRN}+-------------------------------------------------------------+${NC}"
    printf "${GRN}|${NC}  Model:   %-49s ${GRN}|${NC}\n" "$model"
    if [[ "$speed" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
        printf "${GRN}|${NC}  Speed:   %-49s ${GRN}|${NC}\n" "~${speed} tokens/second"
    else
        printf "${GRN}|${NC}  Speed:   %-49s ${GRN}|${NC}\n" "$speed"
    fi
    if [[ "$users" =~ ^[0-9]+(-[0-9]+)?$ ]]; then
        printf "${GRN}|${NC}  Users:   %-49s ${GRN}|${NC}\n" "${users} concurrent comfortably"
    else
        printf "${GRN}|${NC}  Users:   %-49s ${GRN}|${NC}\n" "$users"
    fi
    echo -e "${GRN}+-------------------------------------------------------------+${NC}"
}

# Show installation menu
show_install_menu() {
    echo ""
    ai "Choose how deep you want to go. I can install everything, or keep it minimal."
    echo ""
    echo -e "  ${BGRN}[1]${NC} Full Stack ${AMB}(recommended — just press Enter)${NC}"
    echo "      Chat + Voice + Workflows + Document Q&A + AI Agents"
    echo "      ~16GB download, all features enabled"
    echo ""
    echo -e "  ${BGRN}[2]${NC} Core Only"
    echo "      Chat interface + API"
    echo "      ~12GB download, minimal footprint"
    echo ""
    echo -e "  ${BGRN}[3]${NC} Custom"
    echo "      Choose exactly what you want"
    echo ""
    read -p "  Select an option [1]: " -r INSTALL_CHOICE < /dev/tty
    INSTALL_CHOICE="${INSTALL_CHOICE:-1}"
    echo ""
    case "$INSTALL_CHOICE" in
        1)
            signal "Acknowledged."
            log "Selected: Full Stack"
            ENABLE_VOICE=true
            ENABLE_WORKFLOWS=true
            ENABLE_RAG=true
            ENABLE_RECOMMENDED=true
            ENABLE_HERMES=true
            ENABLE_OPENCLAW=false  # deprecated; Hermes is the new default
            ENABLE_COMFYUI=true
            ENABLE_APE=true
            ENABLE_PERPLEXICA=true
            ENABLE_PRIVACY_SHIELD=true
            ENABLE_LANGFUSE=true

            # Disable image generation on low-tier systems (insufficient RAM/VRAM)
            # ComfyUI requires shm_size 8GB + 24GB memory limit
            case "${TIER:-}" in
                0|1)
                    ENABLE_COMFYUI=false
                    log "ComfyUI auto-disabled for Tier $TIER (insufficient RAM/VRAM)"
                    ai_warn "Image generation (ComfyUI) disabled — your hardware doesn't have enough RAM."
                    ai "  You can enable it later with: dream enable comfyui"
                    ;;
            esac
            ;;
        2)
            signal "Acknowledged."
            log "Selected: Core Only"
            ENABLE_VOICE=false
            ENABLE_WORKFLOWS=false
            ENABLE_RAG=false
            ENABLE_RECOMMENDED=false
            ENABLE_HERMES=false
            ENABLE_OPENCLAW=false
            ENABLE_COMFYUI=false
            ENABLE_APE=false
            ENABLE_PERPLEXICA=false
            ENABLE_PRIVACY_SHIELD=false
            ENABLE_LANGFUSE=false
            ;;
        3)
            signal "Acknowledged."
            log "Selected: Custom"
            ;;
        *)
            warn "Invalid choice '$INSTALL_CHOICE', defaulting to Full Stack"
            ENABLE_VOICE=true
            ENABLE_WORKFLOWS=true
            ENABLE_RAG=true
            ENABLE_RECOMMENDED=true
            ENABLE_HERMES=true
            ENABLE_OPENCLAW=false  # deprecated; Hermes is the new default
            ENABLE_COMFYUI=true
            ENABLE_APE=true
            ENABLE_PERPLEXICA=true
            ENABLE_PRIVACY_SHIELD=true
            ENABLE_LANGFUSE=true

            # Disable image generation on low-tier systems (insufficient RAM/VRAM)
            # ComfyUI requires shm_size 8GB + 24GB memory limit
            case "${TIER:-}" in
                0|1)
                    ENABLE_COMFYUI=false
                    log "ComfyUI auto-disabled for Tier $TIER (insufficient RAM/VRAM)"
                    ai_warn "Image generation (ComfyUI) disabled — your hardware doesn't have enough RAM."
                    ai "  You can enable it later with: dream enable comfyui"
                    ;;
            esac
            ;;
    esac
}

# Final success card — dramatic "GATEWAY IS OPEN" finale
show_success_card() {
    local webui_url=$1
    local dashboard_url=$2
    local ip_addr=$3

    printf '\a'  # terminal bell
    echo ""
    static_line
    echo ""
    echo -e "  ${BGRN}T H E   G A T E W A Y   I S   O P E N${NC}"
    echo ""
    static_line
    echo ""
    type_line_dramatic "DREAMGATE INSTALLATION COMPLETE." "$BGRN"
    echo ""
    echo -e "${GRN}+--------------------------------------------------------------+${NC}"
    echo -e "${GRN}|${NC}                                                              ${GRN}|${NC}"
    printf "${GRN}|${NC}   Dashboard:   ${WHT}%-43s${NC} ${GRN}|${NC}\n" "${dashboard_url}"
    printf "${GRN}|${NC}   Chat:        ${WHT}%-43s${NC} ${GRN}|${NC}\n" "${webui_url}"
    echo -e "${GRN}|${NC}                                                              ${GRN}|${NC}"
    if [[ -n "$ip_addr" ]]; then
        echo -e "${GRN}|${NC}   ${AMB}Access from other devices:${NC}                               ${GRN}|${NC}"
        printf "${GRN}|${NC}   ${WHT}http://%-51s${NC} ${GRN}|${NC}\n" "${ip_addr}:3001"
        echo -e "${GRN}|${NC}                                                              ${GRN}|${NC}"
    fi
    echo -e "${GRN}+--------------------------------------------------------------+${NC}"
    echo ""
    type_line "Your data never leaves this machine." "$DGRN" 0.04
    type_line "No subscriptions. No limits. It's yours." "$DGRN" 0.04
    echo ""
    echo -e "  ${GRN}Elapsed: $(install_elapsed)${NC}"
    echo ""
}
