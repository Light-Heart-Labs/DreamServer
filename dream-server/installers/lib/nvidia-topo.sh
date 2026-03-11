#!/usr/bin/env bash
# ============================================================================
# Dream Server Installer — NVIDIA GPU Topology Detection
# ============================================================================
# Part of: installers/lib/
# Purpose: Detect NVIDIA Multi-GPU topology as well as basic GPU info 
#          and return as JSON. This script can be used standalone or
#          sourced by the main detection.sh script.
#
# Provides: parse_nvidia_topo_matrix(), detect_nvidia(), link_rank(), link_label()
#
# Modder notes:
#   This script handles NVIDIA-specific topology detection including NVLink,
#   PCIe, and NUMA relationships. It outputs structured JSON for consumption
#   by the multi-GPU strategy selection logic.
# ============================================================================

command_exists() { command -v "$1" &>/dev/null; }
json_str() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
link_rank() {
  case "$1" in
  NV4 | NV6 | NV8 | NV12 | NV18)  echo 100 ;;   # NVLink gen2/3
  XGMI | XGMI2)                   echo 90  ;;   # AMD Infinity Fabric
  NV1 | NV2 | NV3)                echo 80  ;;   # NVLink gen1
  MIG)                            echo 70  ;;   # MIG instance, same die
  PIX)                            echo 50  ;;   # Same PCIe switch
  PXB)                            echo 40  ;;   # Multiple PCIe switches, same CPU
  PHB)                            echo 30  ;;   # PCIe host bridge
  NODE)                           echo 20  ;;   # Same NUMA, no direct bridge
  SYS | SOC)                      echo 10  ;;   # Cross-NUMA (SOC = old name for SYS)
  *)                              echo 0   ;;
  esac
}

link_label() {
  case "$1" in
  NV*)   echo "NVLink" ;;
  XGMI*) echo "InfinityFabric" ;;
  MIG)   echo "MIG-SameDie" ;;
  PIX)   echo "PCIe-SameSwitch" ;;
  PXB)   echo "PCIe-CrossSwitch" ;;
  PHB)   echo "PCIe-HostBridge" ;;
  NODE)  echo "SameNUMA-NoBridge" ;;
  SYS | SOC) echo "CrossNUMA" ;;
  X)     echo "Self" ;;
  *)     echo "Unknown" ;;
  esac
}
parse_nvidia_topo_matrix() {
  # Returns JSON array of {gpu_a, gpu_b, link_type, link_label, rank}
  local matrix
  matrix=$(nvidia-smi topo -m 2>/dev/null) || {
    warn "nvidia-smi topo -m failed"
    echo "[]"
    return
  }

  local header_line headers=()
  header_line=$(echo "$matrix" | grep -E '^\s+GPU[0-9]' | head -1)
  read -ra headers <<<"$header_line"

  local pairs="["
  local first_pair=true

  while IFS= read -r line; do
    [[ "$line" =~ ^(GPU[0-9]+|NIC[0-9]+) ]] || continue
    local row_label
    row_label=$(echo "$line" | awk '{print $1}')
    [[ "$row_label" =~ ^GPU ]] || continue # only GPU rows
    local gpu_a="${row_label#GPU}"
    local cells=()
    read -ra cells <<<"$line"
    # cells[0] = row label, cells[1..] = columns
    for col_idx in "${!headers[@]}"; do
      local col_header="${headers[$col_idx]}"
      [[ "$col_header" =~ ^GPU ]] || continue
      local gpu_b="${col_header#GPU}"
      [[ "$gpu_a" == "$gpu_b" ]] && continue  # skip self
      [[ "$gpu_a" -ge "$gpu_b" ]] && continue # dedup (only A<B pairs)
      local cell="${cells[$((col_idx + 1))]:-UNKNOWN}"
      local rank
      rank=$(link_rank "$cell")
      local label
      label=$(link_label "$cell")
      $first_pair || pairs+=","
      first_pair=false
      pairs+="{\"gpu_a\":$gpu_a,\"gpu_b\":$gpu_b,\"link_type\":\"$cell\",\"link_label\":\"$label\",\"rank\":$rank}"
    done
  done <<<"$matrix"

  pairs+="]"
  echo "$pairs"
}

detect_nvidia_topo() {
  # Basic GPU list
  local gpu_list
  gpu_list=$(nvidia-smi --query-gpu=index,name,memory.total,pcie.link.gen.current,pcie.link.width.current,uuid \
    --format=csv,noheader,nounits 2>/dev/null) || {
    err "nvidia-smi query failed"
    return 1
  }

  local gpus_json="["
  local first=true
  local gpu_count=0
  while IFS=',' read -r idx name mem_mb pcie_gen pcie_width uuid; do
    idx=$(echo "$idx" | xargs)
    name=$(echo "$name" | xargs)
    mem_mb=$(echo "$mem_mb" | xargs)
    pcie_gen=$(echo "$pcie_gen" | xargs)
    pcie_width=$(echo "$pcie_width" | xargs)
    uuid=$(echo "$uuid" | xargs)
    local mem_gb
    mem_gb=$(awk "BEGIN{printf \"%.1f\", $mem_mb/1024}")
    $first || gpus_json+=","
    first=false
    gpus_json+="{\"index\":$idx,\"name\":\"$(json_str "$name")\",\"memory_gb\":$mem_gb,\"pcie_gen\":\"$(json_str "$pcie_gen")\",\"pcie_width\":\"$(json_str "$pcie_width")\",\"uuid\":\"$(json_str "$uuid")\"}"
    gpu_count=$((gpu_count + 1))
  done <<<"$gpu_list"
  gpus_json+="]"

  # MIG detection
  local mig_mode="false"
  if nvidia-smi -q 2>/dev/null | grep -q "MIG Mode.*Enabled"; then
    mig_mode="true"
  fi

  # Driver + CUDA version
  local driver_ver
  driver_ver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1 | xargs)

  # Topology matrix
  local topo_pairs
  topo_pairs=$(parse_nvidia_topo_matrix)

  # NUMA info
  local numa_json="{}"
  if command_exists numactl; then
    local numa_nodes
    numa_nodes=$(numactl --hardware 2>/dev/null | grep "^node [0-9]* cpus" | wc -l)
    numa_json="{\"nodes\":$numa_nodes}"
  fi

  cat <<JSON
{
  "vendor": "nvidia",
  "gpu_count": $gpu_count,
  "driver_version": "$(json_str "$driver_ver")",
  "mig_enabled": $mig_mode,
  "numa": $numa_json,
  "gpus": $gpus_json,
  "links": $topo_pairs
}
JSON
}

# ============================================================================
# Topology display helpers (used by 03-features.sh)
# ============================================================================

get_rank()  { echo "${LINK_RANK["$1,$2"]:-0}"; }
get_ltype() { echo "${LINK_TYPE["$1,$2"]:-SYS}"; }

# Color per link_type, matching nvidia-smi conventions
_ltype_color() {
  case "$1" in
    NV*)  echo "$BGRN" ;;   # any NVLink — bright green
    PIX)  echo "$GRN"  ;;   # PCIe same switch — green
    PXB)  echo "$GRN"  ;;   # PCIe two switches — green
    PHB)  echo "$AMB"  ;;   # PCIe host bridge — amber
    NODE) echo "$AMB"  ;;   # PCIe across NUMA — amber
    SYS)  echo "$DIM"  ;;   # across QPI/UPI — dim
    *)    echo "$DIM"  ;;
  esac
}

show_topology() {
  echo ""
  chapter "GPU TOPOLOGY"

  local dname="${GPU_NAMES[0]}"
  dname="${dname/NVIDIA /}"; dname="${dname/AMD /}"
  echo -e "  ${WHT}Detected:${NC} ${BGRN}${GPU_COUNT}×${NC} ${dname}   ${DIM}[${VENDOR}]${NC}"
  echo ""

  # Cell width: wide enough for the longest token ("NV12" = 4, pad to 6)
  local CW=6   # chars per cell including trailing space
  local LW=6   # row-label width "GPU0  "

  # Header row: "        GPU0  GPU1  ..."
  printf "  %${LW}s" ""
  for j in "${GPU_INDICES[@]}"; do
    local hdr="GPU${j}"
    printf "%-${CW}s" "$hdr"
  done
  echo ""

  # Separator line
  printf "  %${LW}s" ""
  for j in "${GPU_INDICES[@]}"; do
    printf "%-${CW}s" "──────" | head -c $CW
  done
  echo ""

  # Data rows
  for i in "${GPU_INDICES[@]}"; do
    # Row label
    printf "  ${WHT}%-${LW}s${NC}" "GPU${i}"

    for j in "${GPU_INDICES[@]}"; do
      if [[ "$i" == "$j" ]]; then
        printf "${WHT}%-${CW}s${NC}" "X"
      else
        local lt; lt=$(get_ltype "$i" "$j")
        local color; color=$(_ltype_color "$lt")
        printf "${color}%-${CW}s${NC}" "$lt"
      fi
    done

    # GPU name + VRAM on the right
    local name="${GPU_NAMES[$i]}"
    name="${name/NVIDIA /}"; name="${name/AMD /}"
    printf "  ${DIM}%-28s  %sGB${NC}" "$name" "${GPU_VRAMS_GB[$i]}"
    echo ""
  done

  echo ""
  echo -e "  ${WHT}Legend:${NC}"
  echo -e "    ${BGRN}NVx${NC}  NVLink (x lanes)    ${GRN}PIX/PXB${NC}  PCIe same switch    ${AMB}PHB/NODE${NC}  PCIe host bridge / cross-NUMA    ${DIM}SYS${NC}  cross-socket"
  echo ""
}
