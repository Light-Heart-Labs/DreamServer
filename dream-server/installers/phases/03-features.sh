#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 03: Feature Selection
# ============================================================================
# Part of: installers/phases/
# Purpose: Interactive feature selection menu
#
# Expects: INTERACTIVE, DRY_RUN, TIER, ENABLE_VOICE, ENABLE_WORKFLOWS,
#           ENABLE_RAG, ENABLE_OPENCLAW, GPU_COUNT, GPU_BACKEND,
#           GPU_TOPOLOGY_JSON, LLM_MODEL_SIZE_MB, SCRIPT_DIR, VERBOSE, DEBUG,
#           GPU_INDICES, GPU_UUIDS (arrays from topology),
#           show_phase(), show_install_menu(), chapter(), bootline(),
#           success(), log(), warn(), error(), signal()
# Provides: ENABLE_VOICE, ENABLE_WORKFLOWS, ENABLE_RAG, ENABLE_OPENCLAW,
#           OPENCLAW_CONFIG, GPU_ASSIGNMENT_JSON,
#           LLAMA_SERVER_GPU_UUIDS, WHISPER_GPU_UUID, COMFYUI_GPU_UUID,
#           EMBEDDINGS_GPU_UUID, LLAMA_ARG_SPLIT_MODE, LLAMA_ARG_TENSOR_SPLIT
#
# Modder notes:
#   Add new optional features to the Custom menu here.
# ============================================================================

dream_progress 18 "features" "Selecting features"
if $INTERACTIVE && ! $DRY_RUN; then
    show_phase 2 6 "Feature Selection" "~1 minute"
    show_install_menu

    # Only show individual feature prompts for Custom installs
    if [[ "${INSTALL_CHOICE:-1}" == "3" ]]; then
        read -p "  Enable voice (Whisper STT + Kokoro TTS)? [Y/n] " -r < /dev/tty
        echo
        [[ $REPLY =~ ^[Nn]$ ]] || ENABLE_VOICE=true

        read -p "  Enable n8n workflow automation? [Y/n] " -r < /dev/tty
        echo
        [[ $REPLY =~ ^[Nn]$ ]] || ENABLE_WORKFLOWS=true

        read -p "  Enable Qdrant vector database (for RAG)? [Y/n] " -r < /dev/tty
        echo
        [[ $REPLY =~ ^[Nn]$ ]] || ENABLE_RAG=true

        read -p "  Enable OpenClaw AI agent framework? [y/N] " -r < /dev/tty
        echo
        [[ $REPLY =~ ^[Yy]$ ]] && ENABLE_OPENCLAW=true

        read -p "  Enable image generation (ComfyUI + SDXL Lightning, ~6.5GB)? [Y/n] " -r < /dev/tty
        echo
        [[ $REPLY =~ ^[Nn]$ ]] || ENABLE_COMFYUI=true

        read -p "  Enable DreamForge agent system? [Y/n] " -r < /dev/tty
        echo
        [[ $REPLY =~ ^[Nn]$ ]] || ENABLE_DREAMFORGE=true

        read -p "  Enable Langfuse (LLM observability + telemetry, ~500MB)? [y/N] " -r < /dev/tty
        echo
        [[ $REPLY =~ ^[Yy]$ ]] && ENABLE_LANGFUSE=true

        # Warn if ComfyUI enabled on low-tier hardware
        if [[ "$ENABLE_COMFYUI" == "true" ]]; then
            case "${TIER:-}" in
                0|1)
                    ai_warn "ComfyUI requires 8GB+ RAM and a dedicated GPU. Your Tier $TIER system may not support it."
                    read -p "  Continue with image generation enabled? [y/N] " -r < /dev/tty
                    echo
                    [[ $REPLY =~ ^[Yy]$ ]] || ENABLE_COMFYUI=false
                    ;;
            esac
        fi
    fi
fi

# Tier safety net: disable ComfyUI on Tier 0/1 in non-interactive mode.
# Interactive mode has its own tier checks in the menu — this catches --non-interactive.
if ! $INTERACTIVE && [[ "$ENABLE_COMFYUI" == "true" ]]; then
    case "${TIER:-}" in
        0|1)
            ENABLE_COMFYUI=false
            log "ComfyUI auto-disabled for Tier $TIER (insufficient RAM for shm_size 8GB)"
            ;;
    esac
fi

# Sync optional-extension compose state with the ENABLE_* flags — the
# resolver uses the .disabled convention to exclude services from the compose
# stack. These mv calls are skipped during --dry-run so the source tree is
# never mutated by a preview invocation.
if ! $DRY_RUN; then
    _comfyui_compose="$SCRIPT_DIR/extensions/services/comfyui/compose.yaml"
    if [[ "${ENABLE_COMFYUI:-}" == "true" ]]; then
        # Re-enable if previously disabled (re-install with different options)
        if [[ ! -f "$_comfyui_compose" && -f "${_comfyui_compose}.disabled" ]]; then
            mv "${_comfyui_compose}.disabled" "$_comfyui_compose"
            log "ComfyUI compose re-enabled"
        fi
    else
        # Disable — prevents resolve-compose-stack.sh from including a compose
        # file whose image was never built/pulled, blocking ALL containers.
        if [[ -f "$_comfyui_compose" ]]; then
            mv "$_comfyui_compose" "${_comfyui_compose}.disabled"
            log "ComfyUI compose disabled (image generation not enabled)"
        fi
    fi
    unset _comfyui_compose

    # Sync DreamForge compose state with ENABLE_DREAMFORGE — same .disabled convention.
    _dreamforge_compose="$SCRIPT_DIR/extensions/services/dreamforge/compose.yaml"
    if [[ "${ENABLE_DREAMFORGE:-}" == "true" ]]; then
        if [[ ! -f "$_dreamforge_compose" && -f "${_dreamforge_compose}.disabled" ]]; then
            mv "${_dreamforge_compose}.disabled" "$_dreamforge_compose"
            log "DreamForge compose re-enabled"
        fi
    else
        if [[ -f "$_dreamforge_compose" ]]; then
            mv "$_dreamforge_compose" "${_dreamforge_compose}.disabled"
            log "DreamForge compose disabled (agent system not enabled)"
        fi
    fi
    unset _dreamforge_compose

    # Sync Langfuse compose state with ENABLE_LANGFUSE — same .disabled convention.
    _langfuse_compose="$SCRIPT_DIR/extensions/services/langfuse/compose.yaml"
    if [[ "${ENABLE_LANGFUSE:-}" == "true" ]]; then
        if [[ ! -f "$_langfuse_compose" && -f "${_langfuse_compose}.disabled" ]]; then
            mv "${_langfuse_compose}.disabled" "$_langfuse_compose"
            log "Langfuse compose re-enabled"
        fi
    else
        if [[ -f "$_langfuse_compose" ]]; then
            mv "$_langfuse_compose" "${_langfuse_compose}.disabled"
            log "Langfuse compose disabled (LLM observability not enabled)"
        fi
    fi
    unset _langfuse_compose
fi

# Re-resolve compose flags now that feature selection may have disabled services.
# Without this, Phases 4-11 use stale flags from Phase 2 that reference files
# which were just renamed to .disabled.
if [[ -x "$SCRIPT_DIR/scripts/resolve-compose-stack.sh" ]]; then
    _refreshed_flags=$("$SCRIPT_DIR/scripts/resolve-compose-stack.sh" \
        --script-dir "$SCRIPT_DIR" --tier "${TIER:-1}" --gpu-backend "${GPU_BACKEND:-nvidia}" 2>/dev/null) || true
    if [[ -n "$_refreshed_flags" ]]; then
        COMPOSE_FLAGS="$_refreshed_flags"
        log "Compose flags refreshed after feature selection"
    fi
fi

# All services are core — no profiles needed (compose profiles removed)

# Select tier-appropriate OpenClaw config
if [[ "$ENABLE_OPENCLAW" == "true" ]]; then
    case $TIER in
        NV_ULTRA) OPENCLAW_CONFIG="pro.json" ;;
        SH_LARGE|SH_COMPACT) OPENCLAW_CONFIG="openclaw-strix-halo.json" ;;
        1) OPENCLAW_CONFIG="minimal.json" ;;
        2) OPENCLAW_CONFIG="entry.json" ;;
        3) OPENCLAW_CONFIG="prosumer.json" ;;
        4) OPENCLAW_CONFIG="pro.json" ;;
        *) OPENCLAW_CONFIG="prosumer.json" ;;
    esac
    log "OpenClaw config: $OPENCLAW_CONFIG (matched to Tier $TIER)"
fi

log "All services enabled (core install)"

# Single GPU — generate a trivial assignment so the dashboard API can map
# the GPU UUID to services (without this, /api/gpu/detailed shows empty
# assigned_services).  Multi-GPU systems fall through to the full TUI below.
if [[ "$GPU_COUNT" -le 1 ]]; then
    if [[ "${GPU_BACKEND:-}" == "nvidia" ]]; then
        _single_gpu_uuid=$(nvidia-smi --query-gpu=uuid --format=csv,noheader,nounits 2>/dev/null | sed -n '1p' || true)
        if [[ -n "$_single_gpu_uuid" ]]; then
            GPU_ASSIGNMENT_JSON=$(jq -n \
                --arg uuid "$_single_gpu_uuid" \
                '{
                    gpu_assignment: {
                        version: "1.0",
                        strategy: "single",
                        services: {
                            llama_server: {
                                gpus: [$uuid],
                                parallelism: {
                                    mode: "none",
                                    tensor_parallel_size: 1,
                                    pipeline_parallel_size: 1,
                                    gpu_memory_utilization: 0.95
                                }
                            },
                            whisper:    { gpus: [$uuid] },
                            comfyui:    { gpus: [$uuid] },
                            embeddings: { gpus: [$uuid] }
                        }
                    }
                }')
            log "Single GPU — assignment generated ($_single_gpu_uuid)"
        else
            log "Single GPU detected — no NVIDIA UUID available, skipping assignment."
        fi
        unset _single_gpu_uuid
    else
        log "Single GPU detected — non-NVIDIA backend, skipping GPU assignment."
    fi
    return
fi

# Multi-GPU Configuration

# write $GPU_TOPOLOGY_JSON into a tmpfile to use by the commands
TOPOLOGY_FILE=$(mktemp /tmp/ds_gpu_topology.XXXXXX.json)
trap "rm -f $TOPOLOGY_FILE" EXIT
echo "$GPU_TOPOLOGY_JSON" > "$TOPOLOGY_FILE"

ASSIGN_GPUS_SCRIPT="$SCRIPT_DIR/scripts/assign_gpus.py"

# Validate topology gpu_count matches installer's GPU_COUNT (don't overwrite the canonical value)
_topo_gpu_count=$(jq '.gpu_count // 0' "$TOPOLOGY_FILE")
if [[ "$_topo_gpu_count" != "$GPU_COUNT" ]]; then
    warn "Topology gpu_count ($_topo_gpu_count) differs from detected GPU_COUNT ($GPU_COUNT) — using detected value"
fi
VENDOR=$(jq -r '.vendor' "$TOPOLOGY_FILE")

# Build GPU arrays keyed by actual GPU index
# This ensures GPU_UUIDS[$idx] always maps to the correct GPU even if
# nvidia-smi returns GPUs out of index order.
declare -a GPU_INDICES=()
declare -A GPU_NAMES=()
declare -A GPU_VRAMS_GB=()
declare -A GPU_UUIDS=()
while IFS=$'\t' read -r _idx _name _mem _uuid; do
    GPU_INDICES+=("$_idx")
    GPU_NAMES["$_idx"]="$_name"
    GPU_VRAMS_GB["$_idx"]="$_mem"
    GPU_UUIDS["$_idx"]="$_uuid"
done < <(jq -r '.gpus[] | [.index, .name, .memory_gb, .uuid] | @tsv' "$TOPOLOGY_FILE")

declare -A LINK_RANK
declare -A LINK_TYPE
while IFS=$'\t' read -r a b rank ltype; do
  LINK_RANK["$a,$b"]=$rank
  LINK_RANK["$b,$a"]=$rank
  LINK_TYPE["$a,$b"]=$ltype
  LINK_TYPE["$b,$a"]=$ltype
done < <(jq -r '.links[] | [.gpu_a, .gpu_b, .rank, .link_type] | @tsv' "$TOPOLOGY_FILE")

# Automatic assignment
run_automatic() {
  echo ""
  chapter "AUTOMATIC GPU ASSIGNMENT"
  echo -e "  ${GRN}Running topology-aware assignment...${NC}"
  echo ""

  local result
  result=$(python3 "$ASSIGN_GPUS_SCRIPT" \
    --topology "$TOPOLOGY_FILE" --model-size "$LLM_MODEL_SIZE_MB" 2>&1) || {
    echo -e "  ${RED}Assignment failed:${NC}\n  $result"
    error "GPU assignment failed: $result"
  }

  local strategy mode tp pp mem_util
  strategy=$(echo "$result" | jq -r '.gpu_assignment.strategy')
  mode=$(echo     "$result" | jq -r '.gpu_assignment.services.llama_server.parallelism.mode')
  tp=$(echo       "$result" | jq -r '.gpu_assignment.services.llama_server.parallelism.tensor_parallel_size')
  pp=$(echo       "$result" | jq -r '.gpu_assignment.services.llama_server.parallelism.pipeline_parallel_size')
  mem_util=$(echo "$result" | jq -r '.gpu_assignment.services.llama_server.parallelism.gpu_memory_utilization')

  GPU_ASSIGNMENT_JSON="$result"
  success "Assignment complete"
  echo ""
  echo -e "  ${WHT}Strategy:${NC}    ${BGRN}${strategy}${NC}"
  echo -e "  ${WHT}Llama mode:${NC}  ${BGRN}${mode}${NC}"
  echo ""
  echo -e "  ${WHT}Service assignments:${NC}"

  for svc in llama_server whisper comfyui embeddings; do
    local labels=""
    while IFS= read -r uuid; do
      for i in "${GPU_INDICES[@]}"; do
        [[ "${GPU_UUIDS[$i]}" == "$uuid" ]] && labels+="GPU${i} "
      done
    done < <(echo "$result" | jq -r ".gpu_assignment.services.${svc}.gpus[]" 2>/dev/null)
    [[ -n "$labels" ]] && printf "  ${AMB}*${NC} %-16s ${BGRN}%s${NC}\n" "$svc" "$labels"
  done

  _show_json "$result"
}

# Custom assignment
run_custom() {
  [[ "$INTERACTIVE" == "true" ]] || { warn "run_custom called in non-interactive mode — skipping."; return; }
  echo ""
  chapter "CUSTOM GPU ASSIGNMENT"
  echo -e "  ${GRN}Assign GPUs to each service manually.${NC}"
  echo -e "  ${DIM}whisper / comfyui / embeddings: 1 GPU each.  llama_server: 1 or more.${NC}"
  echo ""

  declare -A CUSTOM_ASSIGNMENT
  for svc in whisper comfyui embeddings; do
    local valid=false
    while ! $valid; do
      read -rp "  GPU for ${WHT}${svc}${NC} (0-$((GPU_COUNT-1))): " chosen
      if [[ "$chosen" =~ ^[0-9]+$ ]] && [[ $chosen -ge 0 ]] && [[ $chosen -lt $GPU_COUNT ]]; then
        CUSTOM_ASSIGNMENT[$svc]=$chosen; valid=true
      else
        warn "  Invalid -- enter a number between 0 and $((GPU_COUNT-1))."
      fi
    done
  done

  echo ""
  local used=("${CUSTOM_ASSIGNMENT[whisper]}" "${CUSTOM_ASSIGNMENT[comfyui]}" "${CUSTOM_ASSIGNMENT[embeddings]}")
  local default_llama=""
  for idx in "${GPU_INDICES[@]}"; do
    local found=false
    for u in "${used[@]}"; do [[ "$u" == "$idx" ]] && found=true; done
    $found || default_llama+="${idx},"
  done
  default_llama="${default_llama%,}"

  read -rp "  GPUs for ${WHT}llama_server${NC} [${default_llama}]: " llama_input
  llama_input="${llama_input:-$default_llama}"
  IFS=',' read -ra LLAMA_GPUS_CUSTOM <<< "$llama_input"
  for g in "${LLAMA_GPUS_CUSTOM[@]}"; do
    [[ "$g" =~ ^[0-9]+$ ]] && [[ $g -lt $GPU_COUNT ]] || error "Invalid GPU index '$g'"
  done

  echo ""
  echo -e "  ${WHT}Assignment:${NC}"
  printf "  ${AMB}*${NC} %-16s ${BGRN}" "llama_server"
  for g in "${LLAMA_GPUS_CUSTOM[@]}"; do printf "GPU%s " "$g"; done
  printf "${NC}\n"
  for svc in whisper comfyui embeddings; do
    printf "  ${AMB}*${NC} %-16s ${BGRN}GPU%s${NC}\n" "$svc" "${CUSTOM_ASSIGNMENT[$svc]}"
  done

  local all_assigned=("${LLAMA_GPUS_CUSTOM[@]}" "${CUSTOM_ASSIGNMENT[whisper]}" \
                      "${CUSTOM_ASSIGNMENT[comfyui]}" "${CUSTOM_ASSIGNMENT[embeddings]}")
  local unique; unique=$(printf '%s\n' "${all_assigned[@]}" | sort -u | wc -l)
  local strategy="dedicated"
  [[ $unique -lt ${#all_assigned[@]} ]] && strategy="colocated"
  [[ $GPU_COUNT -eq 1 ]] && strategy="single"

  local n=${#LLAMA_GPUS_CUSTOM[@]}
  local min_rank=100
  if [[ $n -gt 1 ]]; then
    for ((x=0; x<n; x++)); do
      for ((y=x+1; y<n; y++)); do
        local r; r=$(get_rank "${LLAMA_GPUS_CUSTOM[$x]}" "${LLAMA_GPUS_CUSTOM[$y]}")
        [[ $r -lt $min_rank ]] && min_rank=$r
      done
    done
  fi

  # NOTE: keep in sync with assign_gpus.py select_parallelism()
  local mode tp pp mem_util
  if   [[ $n -eq 1 ]];         then mode="none";     tp=1;  pp=1;        mem_util=0.95
  elif [[ $min_rank -ge 80 ]]; then
    if   [[ $n -le 3 ]];       then mode="tensor";   tp=$n; pp=1;        mem_util=0.92
    else                            mode="hybrid";   tp=2;  pp=$((n/2)); mem_util=0.93; fi
  elif [[ $min_rank -le 10 ]]; then mode="pipeline"; tp=1;  pp=$n;       mem_util=0.95
  elif [[ $n -le 3 ]];         then mode="pipeline"; tp=1;  pp=$n;       mem_util=0.95
  elif [[ $min_rank -ge 40 ]]; then mode="hybrid";   tp=2;  pp=$((n/2)); mem_util=0.93
  else                              mode="pipeline"; tp=1;  pp=$n;       mem_util=0.95
  fi

  echo ""
  echo -e "  ${WHT}Llama parallelism:${NC}  mode=${BGRN}${mode}${NC}  TP=${tp}  PP=${pp}  mem_util=${mem_util}  ${DIM}(min_rank=${min_rank})${NC}"
  echo ""

  read -rp "  Apply this configuration? [Y/n]: " confirm
  confirm="${confirm:-Y}"
  [[ ! $confirm =~ ^[Yy]$ ]] && warn "Cancelled." && return

  local llama_uuids_json
  llama_uuids_json=$(for g in "${LLAMA_GPUS_CUSTOM[@]}"; do echo "\"${GPU_UUIDS[$g]}\""; done | jq -sc '.')

  local result
  result=$(jq -n \
    --arg     strategy        "$strategy" \
    --argjson llama_gpus      "$llama_uuids_json" \
    --arg     mode             "$mode" \
    --argjson tp               "$tp" \
    --argjson pp               "$pp" \
    --argjson mem              "$mem_util" \
    --arg     whisper_gpu     "${GPU_UUIDS[${CUSTOM_ASSIGNMENT[whisper]}]}" \
    --arg     comfyui_gpu     "${GPU_UUIDS[${CUSTOM_ASSIGNMENT[comfyui]}]}" \
    --arg     embeddings_gpu  "${GPU_UUIDS[${CUSTOM_ASSIGNMENT[embeddings]}]}" \
    '{
      gpu_assignment: {
        version: "1.0", strategy: $strategy,
        services: {
          llama_server: {
            gpus: $llama_gpus,
            parallelism: { mode: $mode, tensor_parallel_size: $tp,
                           pipeline_parallel_size: $pp, gpu_memory_utilization: $mem }
          },
          whisper:    { gpus: [$whisper_gpu] },
          comfyui:    { gpus: [$comfyui_gpu] },
          embeddings: { gpus: [$embeddings_gpu] }
        }
      }
    }')

  GPU_ASSIGNMENT_JSON="$result"
  success "Custom configuration applied."
  _show_json "$result"
}

_show_json() {
  [[ "${VERBOSE:-false}" == "true" || "${DEBUG:-false}" == "true" ]] || return 0
  echo ""; bootline
  echo -e "${BGRN}GPU ASSIGNMENT JSON${NC}"
  bootline; echo ""
  echo "$1" | jq .
  echo ""; bootline; echo ""
}

# --- Multi-GPU Config TUI ---
GPU_ASSIGNMENT_JSON=""

# If it is not an interactive session, run automatic assignment with default values
if ! $INTERACTIVE || $DRY_RUN; then
    log "Non-interactive mode: running automatic GPU assignment with default values."
    run_automatic
else
    bootline
    echo -e "${BGRN}MULTI-GPU CONFIGURATION${NC}"
    bootline
    echo ""
    echo -e "  You have ${BGRN}${GPU_COUNT}${NC} GPUs available. How would you like to use them?"
    echo ""
    echo -e "  ${BGRN}[1]${NC} Automatic ${AMB}(Recommended)${NC}"
    echo -e "      ${DIM}Let DreamServer pick the best topology-aware assignment${NC}"
    echo ""
    echo -e "  ${WHT}[2]${NC} Custom Configuration"
    echo -e "      ${DIM}Assign GPUs to services manually${NC}"
    echo ""

    read -rp "  Selection [1]: " choice
    choice="${choice:-1}"
    case "$choice" in
    1) run_automatic ;;
    2) run_custom ;;
    *) warn "Invalid selection. Defaulting to automatic."; run_automatic ;;
    esac
fi

LLAMA_SERVER_GPU_UUIDS=$(echo "$GPU_ASSIGNMENT_JSON" | jq -r '.gpu_assignment.services.llama_server.gpus // [] | join(",")')
if [[ -z "$LLAMA_SERVER_GPU_UUIDS" ]]; then
    warn "LLAMA_SERVER_GPU_UUIDS is empty — NVIDIA_VISIBLE_DEVICES will fall back to 'all' (all GPUs visible to llama-server)"
fi
WHISPER_GPU_UUID=$(echo "$GPU_ASSIGNMENT_JSON" | jq -r '.gpu_assignment.services.whisper.gpus[0]?')
COMFYUI_GPU_UUID=$(echo "$GPU_ASSIGNMENT_JSON" | jq -r '.gpu_assignment.services.comfyui.gpus[0]?')
EMBEDDINGS_GPU_UUID=$(echo "$GPU_ASSIGNMENT_JSON" | jq -r '.gpu_assignment.services.embeddings.gpus[0]?')

_mode=$(echo "$GPU_ASSIGNMENT_JSON" | jq -r '.gpu_assignment.services.llama_server.parallelism.mode // "none"')
case "$_mode" in
  tensor|hybrid) LLAMA_ARG_SPLIT_MODE="row"   ;;
  pipeline)      LLAMA_ARG_SPLIT_MODE="layer" ;;
  *)             LLAMA_ARG_SPLIT_MODE="none"  ;;
esac
unset _mode

LLAMA_ARG_TENSOR_SPLIT=$(echo "$GPU_ASSIGNMENT_JSON" | jq -r '
  .gpu_assignment.services.llama_server as $svc |
  ($svc.parallelism.tensor_split // []) as $ts |
  if ($ts | length) > 0
  then $ts | map(tostring) | join(",")
  else ($svc.gpus | length) as $n |
    if $n > 1 then [range($n) | 1] | map(tostring) | join(",")
    else "1"
    end
  end')

# Persist topology for the dashboard API (mounted read-only at /dream-server/config)
mkdir -p "$INSTALL_DIR/config"
cp "$TOPOLOGY_FILE" "$INSTALL_DIR/config/gpu-topology.json"
chmod 644 "$INSTALL_DIR/config/gpu-topology.json"
rm -f "$TOPOLOGY_FILE"
