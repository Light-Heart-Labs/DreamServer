#!/usr/bin/env bash
# =============================================================================
# dreamserver-multimodel-setup.v2.sh
# Ziel-Hardware : AMD Ryzen AI Max+ 395 (Strix Halo), 128 GB UMA, gfx1151, XDNA2
# Ziel-OS       : Ubuntu 26.04, Kernel 7.0.0-15-generic, ROCm 7.2
# Ziel-Stack    : DreamServer (https://github.com/Light-Heart-Labs/DreamServer)
#                 Lemonade-Container (dream-lemonade-server:latest) – Update via Rebuild
# Verbessert    : Idempotent, robust, korrektes Lemonade-models.ini-Format,
#                 .env wird gemerged (Secrets bleiben!), nutzt vorhandene GGUFs,
#                 Healthcheck /api/v1/health, OpenCLAW-tauglich
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

# ----------------------------- Konfiguration ---------------------------------
DREAM_DIR="${DREAM_DIR:-$HOME/dream-server}"
MODELS_DIR="${MODELS_DIR:-$DREAM_DIR/data/models}"
TS="$(date +%Y%m%d-%H%M%S)"
FORCE="${FORCE:-0}"           # FORCE=1 → bestehende Configs überschreiben
SKIP_DOWNLOAD="${SKIP_DOWNLOAD:-0}"
TIER="${TIER:-2}"             # 1 = nur essentielle Modelle, 2 = +reasoning/code

# llama.cpp git ref (Tag oder Commit) – wird als Build-Arg an Dockerfile.amd
# gereicht (siehe extensions/services/llama-server/Dockerfile.amd, ARG LLAMA_CPP_REF).
# Aktuell: b8994 (https://github.com/ggml-org/llama.cpp/releases)
# ACHTUNG: Der MMQ-Register-Patch im Dockerfile (sed auf mmq.cu) ist gegen
# b8763 validiert. Bei Bump können die sed-Targets fehlschlagen → Build läuft
# trotzdem durch, druckt aber "WARNING: MMQ patch did not apply". Nach dem
# Build prüfen:
#   docker logs <build> | grep "MMQ patch"
LLAMA_CPP_REF="${LLAMA_CPP_REF:-b8994}"
AMDGPU_TARGET="${AMDGPU_TARGET:-gfx1151}"

# ----------------------------- Logging / Trap --------------------------------
log()  { printf '\033[1;36m[%s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[FAIL]\033[0m %s\n' "$*" >&2; exit 1; }
trap 'die "Fehler in Zeile $LINENO (Befehl: $BASH_COMMAND)"' ERR

backup() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  cp -a "$f" "${f}.bak.${TS}"
  log "Backup: ${f}.bak.${TS}"
}

confirm_overwrite() {
  local f="$1"
  if [[ -f "$f" && "$FORCE" != "1" ]]; then
    read -r -p "  $f existiert. Überschreiben? [y/N] " a
    [[ "$a" =~ ^[yY]$ ]] || { warn "übersprungen: $f"; return 1; }
  fi
  return 0
}

# ----------------------------- Compose-Helper --------------------------------
# Liefert das `docker compose [-f ...]`-Kommando als Array zurück.
# Hintergrund: resolve-compose-stack.sh gibt eine LANGE Argumentliste auf STDOUT
# aus (`-f base.yml -f overlay.yml -f ext1.yml ...`). Mit `IFS=$'\n\t'` (siehe
# Top des Skripts) splittet `$(...)` NICHT mehr auf Spaces → die ganze Zeile
# landet als EIN Argument bei docker compose → "no such file or directory".
# Lösung: read -a/-A in ein echtes Array (read setzt sein eigenes IFS=' \t\n').
#
# GPU_BACKEND=amd wird explizit übergeben, weil resolve-compose-stack.sh sonst
# auf 'nvidia' defaultet (siehe scripts/resolve-compose-stack.sh:6).
build_compose_cmd() {
  local -n _out=$1   # nameref auf das Ziel-Array
  _out=(docker compose)
  if [[ -x "$DREAM_DIR/scripts/resolve-compose-stack.sh" ]]; then
    local raw
    raw="$("$DREAM_DIR/scripts/resolve-compose-stack.sh" \
              --script-dir "$DREAM_DIR" \
              --gpu-backend amd \
              --skip-broken)"
    # Word-Split auf Spaces/Tabs/Newlines unabhängig vom globalen IFS:
    local -a parts
    IFS=$' \t\n' read -r -a parts <<< "$raw"
    _out+=("${parts[@]}")
  else
    _out+=(-f docker-compose.base.yml -f docker-compose.amd.yml)
  fi
}

# ----------------------------- 0. Preflight ----------------------------------
preflight() {
  log "[0/7] Preflight-Checks…"

  [[ -d "$DREAM_DIR" ]] || die "DreamServer-Verzeichnis fehlt: $DREAM_DIR"
  command -v docker  >/dev/null || die "docker nicht gefunden"
  command -v wget    >/dev/null || die "wget nicht gefunden"
  command -v python3 >/dev/null || die "python3 nicht gefunden"
  python3 -c 'import yaml' 2>/dev/null || die "python3-yaml fehlt: sudo apt install python3-yaml"

  # ROCm / GPU
  if command -v rocminfo >/dev/null; then
    if ! rocminfo 2>/dev/null | grep -q gfx1151; then
      warn "gfx1151 nicht in rocminfo – Treiber/ROCm prüfen"
    fi
  else
    warn "rocminfo fehlt – ROCm 7.0+ wird empfohlen"
  fi

  # NPU (XDNA2)
  if [[ ! -e /dev/accel/accel0 && ! -e /dev/amdxdna0 ]]; then
    warn "NPU-Device nicht sichtbar – amd_xdna Treiber laden für FastFlowLM"
  fi

  # Kernel-Cmdline-Empfehlung (nur Hinweis, NICHT automatisch ändern)
  if ! grep -q 'amdgpu.gttsize' /proc/cmdline 2>/dev/null; then
    warn "Empfohlene Kernel-Cmdline für 128 GB UMA:"
    warn "  amdgpu.gttsize=98304 ttm.pages_limit=25165824"
    warn "  → /etc/default/grub anpassen + update-grub + reboot"
  fi

  # Lemonade läuft im Container – Version aus laufendem Image abfragen
  if docker image inspect dream-lemonade-server:latest >/dev/null 2>&1; then
    local lver
    lver="$(docker run --rm --entrypoint /opt/lemonade/lemonade-server \
      dream-lemonade-server:latest --version 2>/dev/null | awk 'END{print $NF}')"
    log "  Lemonade-Image: ${lver:-unbekannt}"
  else
    warn "Image dream-lemonade-server:latest fehlt – wird beim Build erzeugt"
  fi

  cd "$DREAM_DIR"
  log "Preflight OK – DREAM_DIR=$DREAM_DIR"
}

# ----------------------------- 0a. Build-Env vor-seeden ----------------------
# docker compose liest .env aus dem Compose-Verzeichnis und setzt daraus
# Build-Args. Daher müssen LLAMA_CPP_REF & AMDGPU_TARGET VOR dem Rebuild in
# der .env stehen – sonst greift der Dockerfile-Default (b8763).
seed_build_env() {
  log "[0a/7] Build-Env (GPU_BACKEND, LLAMA_CPP_REF, AMDGPU_TARGET) vor-seeden…"
  local f="$DREAM_DIR/.env"
  [[ -f "$f" ]] || { warn "$f fehlt – wird angelegt"; touch "$f"; }
  # GPU_BACKEND=amd ist Pflicht – sonst defaultet resolve-compose-stack.sh:6
  # auf 'nvidia' und lädt docker-compose.nvidia.yml + nvidia-Overlays.
  set_env_var "$f" GPU_BACKEND     amd
  set_env_var "$f" LLAMA_CPP_REF  "$LLAMA_CPP_REF"
  set_env_var "$f" AMDGPU_TARGET  "$AMDGPU_TARGET"
  log "  ✓ GPU_BACKEND=amd  LLAMA_CPP_REF=$LLAMA_CPP_REF  AMDGPU_TARGET=$AMDGPU_TARGET in .env"

  # Sanity-Check: Vorhandenen falschen Wert lautstark melden.
  local existing_backend
  existing_backend="$(grep -E '^GPU_BACKEND=' "$f" | tail -1 | cut -d= -f2 || true)"
  if [[ -n "$existing_backend" && "$existing_backend" != "amd" ]]; then
    warn "  ACHTUNG: GPU_BACKEND war zuvor '$existing_backend' – wurde auf 'amd' korrigiert."
  fi
}

# ----------------------------- 0b. Lemonade Update ---------------------------
# Lemonade ist Bestandteil des dream-lemonade-server-Images (gebaut aus
# extensions/services/llama-server/Dockerfile.amd). Ein "Update" heißt:
#   1. DreamServer-Repo aktualisieren (dream-update.sh oder git pull)
#   2. Image mit --pull --no-cache neu bauen (zieht aktuelle Lemonade & llama.cpp)
update_lemonade() {
  log "[0b/7] Lemonade-Container-Update prüfen…"

  if [[ "${SKIP_LEMONADE_UPDATE:-0}" == "1" ]]; then
    warn "SKIP_LEMONADE_UPDATE=1 → übersprungen"
    return
  fi

  # 1. Repo aktualisieren falls vorhanden
  if [[ -x "$DREAM_DIR/dream-update.sh" ]]; then
    log "  → dream-update.sh update ausführen…"
    # dream-update.sh nutzt 'update' als Subcommand (kein --yes Flag).
    ( cd "$DREAM_DIR" && ./dream-update.sh update ) || \
      warn "dream-update.sh update exit != 0 – fahre trotzdem fort"
  elif [[ -d "$DREAM_DIR/.git" ]]; then
    log "  → git pull…"
    ( cd "$DREAM_DIR" && git pull --ff-only ) || warn "git pull fehlgeschlagen"
  else
    warn "Kein dream-update.sh und kein .git – überspringe Repo-Update"
  fi

  # 2. Lemonade/llama.cpp Image neu bauen
  log "  → docker compose build llama-server (LLAMA_CPP_REF=$LLAMA_CPP_REF, --pull --no-cache, kann 5–10 min dauern)…"
  cd "$DREAM_DIR"
  # Inline-Export stellt sicher, dass der Build-Arg auch dann gesetzt ist,
  # wenn .env nicht eingelesen wird (z.B. bei alternativen compose-Aufrufen).
  export LLAMA_CPP_REF AMDGPU_TARGET
  local -a compose_cmd
  build_compose_cmd compose_cmd
  "${compose_cmd[@]}" build --pull --no-cache \
      --build-arg "LLAMA_CPP_REF=$LLAMA_CPP_REF" \
      --build-arg "AMDGPU_TARGET=$AMDGPU_TARGET" \
      llama-server
  log "  ✓ Lemonade-Image neu gebaut (llama.cpp $LLAMA_CPP_REF)"
  warn "  Build-Output auf 'WARNING: MMQ patch did not apply' prüfen – falls"
  warn "  vorhanden, sind die Strix-Halo-Patches nicht aktiv (b8994 != b8763)."
}

# ----------------------------- 1. Modell-Downloads ---------------------------
# Format: "ZIEL_PFAD|URL"
# Bestehende Dateien werden NICHT erneut geladen (Idempotenz).
# Bereits vorhanden in $MODELS_DIR (werden nur referenziert):
#   • Qwen3.5-122B-A10B-Q4_K_M-0000{1,2,3}-of-00003.gguf  (~77 GB) Reasoning
#   • Qwen3.6-35B-A3B-Q4_K_XL.gguf                        (~22 GB) Allrounder
#   • qwen3-coder-next-Q4_K_M.gguf                        (~48 GB) Code
#   • qwen3-vl-30b/Qwen3VL-30B-A3B-Instruct-*.gguf        (~22 GB) Vision
declare -a TIER1_MODELS=(
  # Default / Fast (~3.5 GB) – winzig, sehr schnell
  "qwen3-4b/Qwen3-4B-Instruct-2507-Q6_K.gguf|https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q6_K.gguf"
  # Embedding (~600 MB)
  "qwen3-embedding/Qwen3-Embedding-0.6B-Q8_0.gguf|https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-Q8_0.gguf"
  # Reranker (~600 MB)
  "qwen3-reranker/Qwen3-Reranker-0.6B-Q8_0.gguf|https://huggingface.co/Qwen/Qwen3-Reranker-0.6B-GGUF/resolve/main/Qwen3-Reranker-0.6B-Q8_0.gguf"
)

# Tier 2: optionale MXFP4-Upgrades (besser als Q4_K_M, ~25 % schneller auf gfx1151)
# Nur runterladen wenn TIER=2 UND du den Platz/Bandbreite hast.
declare -a TIER2_MODELS=(
  # Qwen3.5-122B-A10B MXFP4 (~63 GB) – Alternative zum vorhandenen Q4_K_M
  # "qwen3.5-122b-mxfp4/Qwen3.5-122B-A10B-MXFP4-00001-of-00002.gguf|https://huggingface.co/unsloth/Qwen3.5-122B-A10B-GGUF/resolve/main/Qwen3.5-122B-A10B-MXFP4-00001-of-00002.gguf"
  # "qwen3.5-122b-mxfp4/Qwen3.5-122B-A10B-MXFP4-00002-of-00002.gguf|https://huggingface.co/unsloth/Qwen3.5-122B-A10B-GGUF/resolve/main/Qwen3.5-122B-A10B-MXFP4-00002-of-00002.gguf"
)

# Validierung: prüfen, dass die referenzierten existierenden Dateien da sind
declare -a EXISTING_REQUIRED=(
  "Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf"
  "Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf"
  "Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf"
  "Qwen3.6-35B-A3B-Q4_K_XL.gguf"
  "qwen3-coder-next-Q4_K_M.gguf"
  "qwen3-vl-30b/Qwen3VL-30B-A3B-Instruct-Q5_K_M.gguf"
  "qwen3-vl-30b/mmproj-Qwen3VL-30B-A3B-Instruct-F16.gguf"
)

check_existing() {
  local missing=0
  for rel in "${EXISTING_REQUIRED[@]}"; do
    if [[ -f "$MODELS_DIR/$rel" ]]; then
      log "  ✓ vorhanden: $rel"
    else
      warn "  ✗ FEHLT: $MODELS_DIR/$rel"
      missing=1
    fi
  done
  if [[ "$missing" == "1" ]]; then
    warn "Fehlende Dateien manuell besorgen oder models.ini anpassen."
    [[ "$FORCE" == "1" ]] || die "Abbruch (mit FORCE=1 trotzdem fortfahren)"
  fi
}

download_models() {
  log "[1/7] Modell-Downloads (Tier=$TIER)…"
  log "  → vorhandene Modelle prüfen:"
  check_existing

  if [[ "$SKIP_DOWNLOAD" == "1" ]]; then
    warn "SKIP_DOWNLOAD=1 → keine neuen Downloads"
    return
  fi

  local list=("${TIER1_MODELS[@]}")
  [[ "$TIER" -ge 2 ]] && list+=("${TIER2_MODELS[@]}")

  for entry in "${list[@]}"; do
    local rel="${entry%%|*}"
    local url="${entry##*|}"
    local dst="$MODELS_DIR/$rel"
    mkdir -p "$(dirname "$dst")"
    if [[ -f "$dst" && "$FORCE" != "1" ]]; then
      log "  ✓ vorhanden: $rel"
      continue
    fi
    log "  ↓ $rel"
    wget -c -q --show-progress -O "$dst.part" "$url"
    mv "$dst.part" "$dst"
  done
}

# ----------------------------- 2. models.ini ---------------------------------
# WICHTIG: Mit `--extra-models-dir /models` exponiert Lemonade JEDE GGUF unter
# /models automatisch als API-Modell-ID `extra.<DATEINAME.gguf>`. Die hier
# definierten [section]-Namen dienen nur als Config-Overrides (n-ctx, mmproj,
# load-on-startup). Im LiteLLM-Routing müssen die `extra.<filename>`-IDs stehen
# (siehe write_litellm), siehe scripts/bootstrap-upgrade.sh:439 im Repo.
write_models_ini() {
  log "[2/7] models.ini schreiben…"
  local f="$DREAM_DIR/config/llama-server/models.ini"
  mkdir -p "$(dirname "$f")"
  backup "$f"

  # Echtes Lemonade-Format (siehe DreamServer-Repo, models.ini):
  #   [section-name]
  #   filename = <relativer Pfad unter /models>
  #   n-ctx = <kontext>
  #   load-on-startup = true|false
  # Multipart-GGUF: nur erste Datei angeben, llama.cpp findet die Splits selbst.
  cat > "$f" << 'EOF'
# === Default / Tool-Routing – Qwen3-4B-Instruct-2507 (klein, schnell) ===
[qwen3-4b]
filename = qwen3-4b/Qwen3-4B-Instruct-2507-Q6_K.gguf
n-ctx = 32768
load-on-startup = true

# === Allrounder (Hauptmodell) – Qwen3.6-35B-A3B-Q4_K_XL ===
# 35B MoE mit 3B aktiv – Sweet-Spot für Strix Halo.
[qwen3.6-35b-a3b]
filename = Qwen3.6-35B-A3B-Q4_K_XL.gguf
n-ctx = 65536
load-on-startup = true

# === Vision – Qwen3-VL-30B-A3B-Instruct (Q5_K_M) ===
[qwen3-vl-30b]
filename = qwen3-vl-30b/Qwen3VL-30B-A3B-Instruct-Q5_K_M.gguf
mmproj = qwen3-vl-30b/mmproj-Qwen3VL-30B-A3B-Instruct-F16.gguf
n-ctx = 32768
load-on-startup = false

# === Code – Qwen3-Coder-Next Q4_K_M ===
[qwen3-coder-next]
filename = qwen3-coder-next-Q4_K_M.gguf
n-ctx = 65536
load-on-startup = false

# === Heavy Reasoning / OpenCLAW – Qwen3.5-122B-A10B (Q4_K_M, 3-part) ===
# Splits werden automatisch geladen – nur die erste Datei referenzieren.
[qwen3.5-122b-a10b]
filename = Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf
n-ctx = 65536
load-on-startup = false

# === Embedding ===
[qwen3-embedding-0.6b]
filename = qwen3-embedding/Qwen3-Embedding-0.6B-Q8_0.gguf
n-ctx = 8192
load-on-startup = true

# === Reranker ===
[qwen3-reranker-0.6b]
filename = qwen3-reranker/Qwen3-Reranker-0.6B-Q8_0.gguf
n-ctx = 8192
load-on-startup = false
EOF
}

# ----------------------------- 3. .env (MERGE!) ------------------------------
# WICHTIG: .env enthält vom Installer generierte Secrets (WEBUI_SECRET,
# LITELLM_KEY, OPENCLAW_TOKEN, ...). NIEMALS komplett überschreiben!
# Stattdessen gezielt einzelne Variablen via sed setzen/anhängen.
set_env_var() {
  local file="$1" key="$2" value="$3"
  if grep -qE "^[#[:space:]]*${key}=" "$file" 2>/dev/null; then
    # Existierende Zeile (auch auskommentierte) ersetzen
    sed -i -E "s|^[#[:space:]]*${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

write_env() {
  log "[3/7] .env mergen (Secrets bleiben unangetastet)…"
  local f="$DREAM_DIR/.env"
  if [[ ! -f "$f" ]]; then
    warn "$f fehlt – DreamServer-Installer noch nicht gelaufen?"
    [[ "$FORCE" == "1" ]] || die "Abbruch"
    touch "$f"
  fi
  backup "$f"

  # AMD/Lemonade-spezifische Werte
  # DREAM_MODE=lemonade ist der vom Installer (06-directories.sh:295) für AMD
  # gesetzte Wert. Damit mountet LiteLLM config/litellm/lemonade.yaml und
  # bootstrap-upgrade.sh schreibt dorthin – local.yaml würde überschrieben.
  set_env_var "$f" DREAM_MODE              lemonade
  set_env_var "$f" LLM_BACKEND             lemonade
  set_env_var "$f" LLM_API_BASE_PATH       /api/v1
  set_env_var "$f" LLM_API_URL             http://litellm:4000
  set_env_var "$f" CTX_SIZE                65536

  # GPU/ROCm – HSA_OVERRIDE explizit LEER, damit gfx1151 nativ läuft
  set_env_var "$f" GPU_BACKEND             amd
  set_env_var "$f" AMDGPU_TARGET           "$AMDGPU_TARGET"
  set_env_var "$f" LLAMA_CPP_REF           "$LLAMA_CPP_REF"
  set_env_var "$f" HSA_OVERRIDE_GFX_VERSION ""
  set_env_var "$f" HSA_XNACK               1
  set_env_var "$f" ROCBLAS_USE_HIPBLASLT   1

  # CPU-Limits passend zu 16 Kernen Strix Halo
  set_env_var "$f" LLAMA_CPU_LIMIT         16.0
  set_env_var "$f" LLAMA_CPU_RESERVATION   4.0

  # ComfyUI / Audio
  set_env_var "$f" ENABLE_IMAGE_GENERATION true
  set_env_var "$f" COMFYUI_FLASH_ATTENTION true
  set_env_var "$f" AUDIO_STT_MODEL         "Systran/faster-whisper-large-v3-turbo"
  set_env_var "$f" AUDIO_TTS_VOICE         af_heart

  set_env_var "$f" TZ                      Europe/Berlin

  log "  ✓ .env aktualisiert (LITELLM_KEY/OPENCLAW_TOKEN/WEBUI_SECRET unverändert)"
}

# ----------------------------- 4. Compose-Patch ------------------------------
patch_compose() {
  log "[4/7] docker-compose.amd.yml patchen (idempotent)…"
  local f="$DREAM_DIR/docker-compose.amd.yml"
  [[ -f "$f" ]] || die "$f fehlt"
  backup "$f"

  python3 - "$f" << 'PYEOF'
import sys, yaml
path = sys.argv[1]
with open(path) as fh:
    c = yaml.safe_load(fh)

svc = c.setdefault('services', {}).setdefault('llama-server', {})

# --- 1. command: nur die --llamacpp-args ersetzen, Rest behalten -----------
# Optimierte Args für Strix Halo (gfx1151, 128 GB UMA, 16 Cores):
#   --metrics --host 0.0.0.0    Pflicht (Prometheus + Bind)
#   -fa on                      FlashAttention-2 (rocWMMA gebaut)
#   -b 2048 -ub 512             Batch/UBatch Sweet-Spot für RDNA3.5
#   -ctk q8_0 -ctv q8_0         KV-Cache 8-bit → halbiert KV-RAM
#   -ngl 999                    Alle Layer auf GPU
#   --threads 16 --threads-batch 16   Matcht LLAMA_CPU_LIMIT=16
#   --mlock                     Pinnt Modellgewichte (UMA: kein Pageout)
#   --parallel 1 --cont-batching   Single-Slot: KV-Budget bleibt für 65k+ Ctx
#                               (parallel=2 würde den 122B mit Multi-Slot OOM-en)
NEW_LLAMACPP_ARGS = (
    '--metrics --host 0.0.0.0 -fa on -b 2048 -ub 512 '
    '-ctk q8_0 -ctv q8_0 -ngl 999 --threads 16 --threads-batch 16 '
    '--mlock --parallel 1 --cont-batching'
)
cmd = svc.get('command') or []
new_cmd = []
i = 0
replaced = False
while i < len(cmd):
    if cmd[i] == '--llamacpp-args' and i + 1 < len(cmd):
        new_cmd.extend(['--llamacpp-args', NEW_LLAMACPP_ARGS])
        i += 2
        replaced = True
    else:
        new_cmd.append(cmd[i]); i += 1
if not replaced:
    new_cmd.extend(['--llamacpp-args', NEW_LLAMACPP_ARGS])
svc['command'] = new_cmd

# --- 2. environment: HSA_OVERRIDE_GFX_VERSION raus (gfx1151 nativ) ---------
# environment kann list ODER dict sein – beides handhaben
def _strip_and_set(env_iter_set, key, value=None):
    pass

env = svc.get('environment')
# UMA-Hints: GGML_CUDA_FORCE_MMQ=1 (MMQ-Pfad) + GGML_HIP_UMA=1 (HIP UMA-Mode)
# Achtung: NICHT `LLAMA_HIP_UMA` – das ist KEIN gültiger llama.cpp env var.
WANTED_ENV = {
    'GGML_CUDA_FORCE_MMQ': '1',
    'GGML_HIP_UMA': '1',
    # Reduziert Speicher-Druck bei großen Modellen auf UMA:
    'HSA_NO_SCRATCH_RECLAIM': '1',
}
if isinstance(env, list):
    env = [e for e in env if not (
        isinstance(e, str) and (
            e.startswith('HSA_OVERRIDE_GFX_VERSION') or
            e.startswith('LLAMA_HIP_UMA')  # falscher Var-Name aus v1
        )
    )]
    have = {e.split('=', 1)[0] for e in env if isinstance(e, str)}
    for k, v in WANTED_ENV.items():
        if k not in have:
            env.append(f'{k}={v}')
    svc['environment'] = env
elif isinstance(env, dict):
    env.pop('HSA_OVERRIDE_GFX_VERSION', None)
    env.pop('LLAMA_HIP_UMA', None)
    for k, v in WANTED_ENV.items():
        env.setdefault(k, v)
    svc['environment'] = env

# --- 3. healthcheck: korrekte URL + model_loaded-Validierung ---------------
# Lemonade liefert /api/v1/health auch dann mit 200 zurück, wenn KEIN Modell
# geladen ist ("model_loaded": null). Ohne grep wäre der Container "healthy"
# trotz nutzlosem Backend (siehe scripts/bootstrap-upgrade.sh:425).
svc.setdefault('healthcheck', {}).update({
    'test': ['CMD-SHELL',
             'curl -sf http://127.0.0.1:8080/api/v1/health '
             "| grep -q '\"model_loaded\"' "
             "&& ! curl -sf http://127.0.0.1:8080/api/v1/health "
             "| grep -q '\"model_loaded\": *null'"],
    'interval':     '20s',
    'timeout':      '10s',
    'retries':      15,
    # Erstbau des llama-server-Binaries kann bis zu 10 min dauern.
    'start_period': '600s',
})

with open(path, 'w') as fh:
    yaml.dump(c, fh, default_flow_style=False, sort_keys=False)
print('  ✓ Compose gepatcht: ub=512, KV-Q8, FA, ngl=999, mlock, parallel=1,')
print('    GGML_HIP_UMA=1, HSA_NO_SCRATCH_RECLAIM=1, gfx1151 nativ,')
print('    Healthcheck validiert model_loaded != null')
PYEOF
}

# ----------------------------- 5. LiteLLM ------------------------------------
write_litellm() {
  log "[5/7] LiteLLM Config schreiben (lemonade.yaml, da DREAM_MODE=lemonade)…"
  local f="$DREAM_DIR/config/litellm/lemonade.yaml"
  mkdir -p "$(dirname "$f")"
  backup "$f"

  # Lemonade exponiert mit `--extra-models-dir /models` jede GGUF als
  # `extra.<DATEINAME.gguf>` (siehe scripts/bootstrap-upgrade.sh:439).
  # LiteLLM-Routing-Namen (links) sind frei wählbar, aber die `model:`-Werte
  # MÜSSEN exakt auf die Lemonade-IDs zeigen, sonst → 404.
  cat > "$f" << 'EOF'
model_list:
  # ---------- Schnell / Tool-Routing ----------
  - model_name: fast
    litellm_params:
      model: openai/extra.Qwen3-4B-Instruct-2507-Q6_K.gguf
      api_base: http://llama-server:8080/api/v1
      api_key: sk-lemonade
      max_tokens: 4096
    model_info: { tags: [fast] }

  # ---------- Default Allrounder (Qwen3.6-35B-A3B) ----------
  - model_name: default
    litellm_params:
      model: openai/extra.Qwen3.6-35B-A3B-Q4_K_XL.gguf
      api_base: http://llama-server:8080/api/v1
      api_key: sk-lemonade
      max_tokens: 8192
    model_info: { tags: [default, chat, agent] }

  # ---------- Vision (Multipart erste Datei → Lemonade lädt mmproj via models.ini) ----------
  - model_name: vision
    litellm_params:
      model: openai/extra.Qwen3VL-30B-A3B-Instruct-Q5_K_M.gguf
      api_base: http://llama-server:8080/api/v1
      api_key: sk-lemonade
      max_tokens: 8192
    model_info: { tags: [vision], supports_vision: true }

  # ---------- Code (Qwen3-Coder-Next) ----------
  - model_name: code
    litellm_params:
      model: openai/extra.qwen3-coder-next-Q4_K_M.gguf
      api_base: http://llama-server:8080/api/v1
      api_key: sk-lemonade
      max_tokens: 8192
    model_info: { tags: [code] }

  # ---------- Heavy Reasoning / OpenCLAW (Qwen3.5-122B-A10B, 3-part split) ----------
  # Bei Multipart-GGUF nur die erste Datei referenzieren – llama.cpp findet die Splits.
  - model_name: reasoning
    litellm_params:
      model: openai/extra.Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf
      api_base: http://llama-server:8080/api/v1
      api_key: sk-lemonade
      max_tokens: 8192
    model_info: { tags: [reasoning, agent, openclaw] }

  # ---------- Embedding ----------
  - model_name: embedding
    litellm_params:
      model: openai/extra.Qwen3-Embedding-0.6B-Q8_0.gguf
      api_base: http://llama-server:8080/api/v1
      api_key: sk-lemonade
    model_info: { mode: embedding }

  # ---------- Reranker ----------
  - model_name: reranker
    litellm_params:
      model: openai/extra.Qwen3-Reranker-0.6B-Q8_0.gguf
      api_base: http://llama-server:8080/api/v1
      api_key: sk-lemonade
    model_info: { mode: rerank }

  # ============================================================
  # Multimodal-Endpoints (Whisper STT + Kokoro TTS)
  # ============================================================
  # Beide Services sind OpenAI-API-kompatibel und werden durch LiteLLM
  # als Single-Endpoint exponiert:
  #   POST http://litellm:4000/v1/audio/transcriptions   (model=stt)
  #   POST http://litellm:4000/v1/audio/speech           (model=tts)
  # → Damit können OpenClaw-Agents (Provider local-llama zeigt auf litellm)
  #   und externe OpenAI-SDK-Clients Audio nutzen, OHNE dass du sie auf
  #   die Service-URLs whisper:8000 / tts:8880 hardcoden musst.
  #
  # Open WebUI ruft TTS/STT bereits DIREKT (docker-compose.base.yml:111-121)
  # — diese Routes hier ändern daran nichts und bremsen nichts aus.
  #
  # ComfyUI ist NICHT enthalten: Es spricht keine OpenAI-Image-API,
  # sondern eine eigene Workflow-API (/prompt). LiteLLM kann das nicht
  # transparent proxy-en. Open WebUI übersetzt es intern. Für OpenClaw-Agents
  # bräuchte ComfyUI ein eigenes Tool (n8n-Workflow oder MCP-Server).
  # ============================================================

  # ---------- STT (Whisper, OpenAI-kompatibel) ----------
  - model_name: stt
    litellm_params:
      model: openai/whisper-1
      api_base: http://whisper:8000/v1
      api_key: not-needed
    model_info: { mode: audio_transcription }

  # ---------- TTS (Kokoro FastAPI) ----------
  - model_name: tts
    litellm_params:
      model: openai/kokoro
      api_base: http://tts:8880/v1
      api_key: not-needed
    model_info: { mode: audio_speech }

  # ---------- Wildcard-Fallback (gibt Anfragen mit beliebigem Model-Namen 1:1 weiter) ----------
  - model_name: "*"
    litellm_params:
      model: openai/*
      api_base: http://llama-server:8080/api/v1
      api_key: sk-lemonade

router_settings:
  routing_strategy: latency-based-routing
  fallbacks:
    - reasoning: [default, vision, fast]
    - vision:    [default, fast]
    - code:      [default, fast]
    - default:   [fast]


litellm_settings:
  drop_params: true
  set_verbose: false
  request_timeout: 240
  stream_timeout: 120
  callbacks: [prometheus]
EOF
}

# ----------------------------- 5b. n8n Image-Gen-Workflow importieren --------
# Importiert config/n8n/image-gen-webhook.json in die laufende n8n-Instanz
# via `n8n import:workflow`. Idempotent (n8n überschreibt bei gleicher ID).
# Falls n8n nicht läuft, wird der Schritt übersprungen.
import_n8n_image_workflow() {
  log "[5b/7] n8n Image-Gen-Workflow importieren…"

  if ! docker ps --format '{{.Names}}' | grep -qx dream-n8n; then
    warn "  dream-n8n nicht aktiv – Import übersprungen."
    warn "  Workflow später manuell importieren: n8n UI → Workflows → Import"
    warn "  Datei: $DREAM_DIR/config/n8n/image-gen-webhook.json"
    return
  fi

  # /home/node/workflows ist via compose.yaml gemountet auf ./config/n8n/
  if docker exec dream-n8n n8n import:workflow \
       --input=/home/node/workflows/image-gen-webhook.json \
       >"$DREAM_DIR/.n8n-import.log" 2>&1; then
    log "  ✓ Workflow importiert (Log: $DREAM_DIR/.n8n-import.log)"
    log "  → in n8n UI noch AKTIVIEREN (Toggle oben rechts) – sonst keine Webhook-URL!"
  else
    warn "  Import fehlgeschlagen – siehe $DREAM_DIR/.n8n-import.log"
    warn "  Fallback: in n8n UI → Workflows → Import from File:"
    warn "  $DREAM_DIR/config/n8n/image-gen-webhook.json"
  fi
}

# ----------------------------- 6. Restart ------------------------------------
restart_services() {
  log "[6/7] Services neu starten…"
  cd "$DREAM_DIR"

  # Compose-Aufruf für diese Maschine ermitteln (resolve-compose-stack
  # falls vorhanden, sonst klassisch base+amd) – siehe build_compose_cmd.
  local -a compose_cmd
  build_compose_cmd compose_cmd

  # Nur die Services starten, die im aufgelösten Compose tatsächlich existieren.
  # Sonst würde "up whisper" failen, falls die Extension nicht aktiviert ist.
  local available
  available="$("${compose_cmd[@]}" config --services 2>/dev/null || true)"
  local -a wanted=(llama-server litellm whisper tts comfyui n8n)
  local -a to_start=()
  for s in "${wanted[@]}"; do
    if grep -qx "$s" <<<"$available"; then
      to_start+=("$s")
    else
      warn "  Service '$s' nicht im Compose-Stack – übersprungen"
    fi
  done
  log "  → up -d --force-recreate ${to_start[*]}"
  "${compose_cmd[@]}" up -d --force-recreate "${to_start[@]}"

  log "  ⏳ warte auf Healthcheck (max 10 min – Erstbau braucht Zeit)…"
  local i=0
  while (( i < 120 )); do
    if docker compose ps --format json 2>/dev/null \
       | grep -q '"Health":"healthy"'; then
      log "  ✓ llama-server healthy"
      break
    fi
    sleep 5; ((i++))
  done
  docker compose ps
}

# ----------------------------- 7. Summary ------------------------------------
summary() {
  log "[7/7] Fertig ✅"
  cat << 'EOF'

==============================================================
🐉 DreamServer Multi-Model Setup abgeschlossen
==============================================================

🧠 Modelle (Lemonade /api/v1, gerouted via LiteLLM auf :4000):
   qwen3-4b              ~3.5 GB   load-on-startup  Tool-Routing
   qwen3.6-35b-a3b       ~22 GB    load-on-startup  Default/Allrounder
   qwen3-vl-30b          ~22 GB    on-demand        Vision (mmproj)
   qwen3-coder-next      ~48 GB    on-demand        Code
   qwen3.5-122b-a10b     ~77 GB    on-demand        Heavy / OpenCLAW
   qwen3-embedding-0.6b  ~0.6 GB   load-on-startup  RAG-Embeddings
   qwen3-reranker-0.6b   ~0.6 GB   on-demand        RAG-Rerank

🎙️ Multimodal-Routes (alle über LiteLLM :4000):
   stt   → Whisper  POST /v1/audio/transcriptions
   tts   → Kokoro   POST /v1/audio/speech

🔀 Wer ruft was an?
   • Open WebUI → ComfyUI/Whisper/Kokoro DIREKT
     (siehe docker-compose.base.yml:111-121 – LiteLLM dazwischen wäre Latenz)
   • OpenClaw-Agent → LiteLLM (sieht Chat + STT + TTS unter EINEM Provider)
   • Externe OpenAI-SDK-Clients → LiteLLM (Single-Endpoint)

🖼️ ComfyUI & OpenClaw (nicht via LiteLLM!)
   ComfyUI hat KEINE OpenAI-Image-API, sondern Workflow-JSON an :8188/prompt.

   ✓ Lösung deployed: n8n-Workflow als HTTP-Tool
     Datei:    config/n8n/image-gen-webhook.json
     Endpoint: POST http://n8n:5678/webhook/generate-image
     Body:     {"prompt": "...", "width": 1024, "height": 1024, "steps": 4}
     Response: OpenAI-Images-kompatibel { "data": [{ "b64_json": "...", "url": "..." }] }
     Modell:   sdxl_lightning_4step (gleich wie Open WebUI – konsistent)
     Latenz:   ~3-5s auf Strix Halo

   WICHTIG: Workflow muss in n8n UI noch AKTIVIERT werden (Toggle oben rechts)!
   Test:
     curl -X POST http://localhost:5678/webhook/generate-image \\
       -H 'Content-Type: application/json' \\
       -d '{"prompt":"a cat astronaut, cinematic","steps":4}' | jq .data[0].url

   Für OpenClaw als Tool registrieren (config/openclaw/openclaw.json):
     "tools": {
       "generate_image": {
         "type": "http",
         "url": "http://n8n:5678/webhook/generate-image",
         "method": "POST",
         "description": "Generate an image from a text prompt via SDXL Lightning"
       }
     }

🔧 Aktive Optimierungen:
   • llama.cpp aktualisiert (LLAMA_CPP_REF=b8994, --pull --no-cache)
   • Lemonade-Image neu gebaut mit aktueller llama.cpp + rocWMMA
   • FlashAttention-2 (-fa on, rocWMMA-Build aus Dockerfile.amd)
   • KV-Cache Q8_0  (halbiert KV-RAM bei langem Kontext)
   • ubatch=512     (Strix-Halo Throughput-Sweetspot)
   • -ngl 999       (alle Layer auf GPU – Lemonade default ist 0)
   • --mlock        (verhindert Pageout der Modellgewichte auf 128 GB UMA)
   • --threads 16   (matcht LLAMA_CPU_LIMIT, dedup mit DEPLOY-Limit)
   • --parallel 1   (Single-Slot – verhindert OOM beim 122B mit 65k Ctx)
   • HSA_OVERRIDE_GFX_VERSION entfernt (gfx1151 nativ ab ROCm 7.x)
   • GGML_HIP_UMA=1 + HSA_NO_SCRATCH_RECLAIM=1 + GGML_CUDA_FORCE_MMQ=1
   • Healthcheck validiert "model_loaded" != null (statt nur 200 OK)
   • LiteLLM nutzt korrekte `extra.<filename>`-IDs für Lemonade
   • DREAM_MODE=lemonade (Installer-konform; lemonade.yaml wird gemountet)
   • LLM_API_URL=http://litellm:4000 (Routing über LiteLLM, nicht direkt)
   • Latency-Routing + Fallback-Kette in LiteLLM
   • .env wurde GEMERGED – Installer-Secrets bleiben erhalten

📋 Tipps:
   • llama.cpp-Version pinnen:        LLAMA_CPP_REF=b8763 ./...
   • GPU-Target ändern:               AMDGPU_TARGET=gfx1100 ./...
   • Lemonade-Update überspringen:    SKIP_LEMONADE_UPDATE=1 ./...
   • Nur Configs (kein Download):     SKIP_DOWNLOAD=1 ./...
   • Erzwinge Überschreiben:          FORCE=1 ./...
   • Tier-2 (MXFP4-Upgrade nachladen): TIER=2 ./...
   • Kernel-Cmdline für 128 GB UMA prüfen:
       amdgpu.gttsize=98304 ttm.pages_limit=25165824
   • Komplettes DreamServer-Update:   ./dream-server/dream-update.sh

==============================================================
EOF
}

# ----------------------------- main ------------------------------------------
main() {
  preflight
  seed_build_env         # NEU: LLAMA_CPP_REF/AMDGPU_TARGET vor Rebuild in .env
  update_lemonade        # Container-Image vor allem anderen aktualisieren
  download_models
  write_models_ini
  write_env
  patch_compose
  write_litellm
  restart_services
  import_n8n_image_workflow   # Import nach Restart, damit n8n garantiert läuft
  summary
}

main "$@"

