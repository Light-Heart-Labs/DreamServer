#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 06: Directories & Configuration
# ============================================================================
# Part of: installers/phases/
# Purpose: Create directories, copy source files, generate .env, configure
#          OpenClaw, SearXNG, and validate .env schema
#
# Expects: SCRIPT_DIR, INSTALL_DIR, LOG_FILE, DRY_RUN, INTERACTIVE,
#           TIER, TIER_NAME, VERSION, GPU_BACKEND, SYSTEM_TZ,
#           LLM_MODEL, MAX_CONTEXT, GGUF_FILE, COMPOSE_FLAGS,
#           ENABLE_VOICE, ENABLE_WORKFLOWS, ENABLE_RAG, ENABLE_OPENCLAW,
#           OPENCLAW_CONFIG, OPENCLAW_PROVIDER_NAME_DEFAULT,
#           OPENCLAW_PROVIDER_URL_DEFAULT,
#           chapter(), ai(), ai_ok(), ai_warn(), log(), warn(), error()
# Provides: WEBUI_SECRET, N8N_PASS, LITELLM_KEY, LIVEKIT_SECRET,
#           DASHBOARD_API_KEY, OPENCODE_SERVER_PASSWORD, OPENCLAW_TOKEN,
#           OPENCLAW_PROVIDER_NAME, OPENCLAW_PROVIDER_URL, OPENCLAW_MODEL,
#           OPENCLAW_CONTEXT
#
# Modder notes:
#   This is the largest phase. Modify .env generation, add new config files,
#   or change directory layout here.
# ============================================================================

dream_progress 38 "directories" "Preparing installation directory"
chapter "SETTING UP INSTALLATION"

if $DRY_RUN; then
    log "[DRY RUN] Would create: $INSTALL_DIR/{config,data,models}"
    log "[DRY RUN] Would copy compose files ($COMPOSE_FLAGS) and source tree"
    log "[DRY RUN] Would generate .env with secrets (WEBUI_SECRET, N8N_PASS, LITELLM_KEY, etc.)"
    log "[DRY RUN] Would generate SearXNG config with randomized secret key"
    [[ "$ENABLE_OPENCLAW" == "true" ]] && log "[DRY RUN] Would configure OpenClaw (model: $LLM_MODEL, config: ${OPENCLAW_CONFIG:-default})"
    log "[DRY RUN] Would validate .env against schema"
else
    # Create directories
    dream_progress 38 "directories" "Creating directory structure"
    mkdir -p "$INSTALL_DIR"/{config,data,models}
    mkdir -p "$INSTALL_DIR"/data/{open-webui,whisper,tts,n8n,qdrant,models}
    mkdir -p "$INSTALL_DIR"/data/langfuse/{postgres,clickhouse,redis,minio}
    mkdir -p "$INSTALL_DIR"/config/{n8n,litellm,openclaw,searxng}

    # Fix ownership of data/config dirs that may have been created by containers
    # (e.g. SearXNG runs as uid 977, ComfyUI data owned by root)
    for _data_dir in "$INSTALL_DIR"/data/*/; do
        if [[ -d "$_data_dir" ]] && ! [[ -w "$_data_dir" ]]; then
            sudo chown -R "$(id -u):$(id -g)" "$_data_dir" 2>/dev/null || true
        fi
    done
    for _cfg_dir in "$INSTALL_DIR"/config/*/; do
        if [[ -d "$_cfg_dir" ]] && ! [[ -w "$_cfg_dir" ]]; then
            sudo chown -R "$(id -u):$(id -g)" "$_cfg_dir" 2>/dev/null || true
        fi
    done

    # Copy entire source tree to install dir (skip if same directory)
    dream_progress 39 "directories" "Copying source files"
    if [[ "$SCRIPT_DIR" != "$INSTALL_DIR" ]]; then
        ai "Copying source files to $INSTALL_DIR..."
        if command -v rsync &>/dev/null; then
            rsync -a \
                --exclude='.git' \
                --exclude='data/' \
                --exclude='logs/' \
                --exclude='models/' \
                --exclude='.env' \
                --exclude='node_modules/' \
                --exclude='dist/' \
                --exclude='*.log' \
                --exclude='.current-mode' \
                --exclude='.profiles' \
                --exclude='.target-model' \
                --exclude='.target-quantization' \
                --exclude='.offline-mode' \
                "$SCRIPT_DIR/" "$INSTALL_DIR/"
        else
            # Fallback: cp -r everything, then remove runtime artifacts
            cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/" 2>/dev/null || true
            cp "$SCRIPT_DIR"/.gitignore "$INSTALL_DIR/" 2>/dev/null || true
            rm -rf "$INSTALL_DIR/.git" 2>/dev/null || true
        fi
        # Ensure scripts are executable
        chmod +x "$INSTALL_DIR"/*.sh "$INSTALL_DIR"/scripts/*.sh "$INSTALL_DIR"/dream-cli 2>/dev/null || true
        ai_ok "Source files installed"
    else
        log "Running in-place (source == install dir), skipping file copy"
    fi

    # Select tier-appropriate OpenClaw config
    if [[ "$ENABLE_OPENCLAW" == "true" && -n "$OPENCLAW_CONFIG" ]]; then
        OPENCLAW_MODEL="$LLM_MODEL"
        OPENCLAW_CONTEXT=$MAX_CONTEXT

        if [[ -f "$INSTALL_DIR/config/openclaw/$OPENCLAW_CONFIG" ]]; then
            cp "$INSTALL_DIR/config/openclaw/$OPENCLAW_CONFIG" "$INSTALL_DIR/config/openclaw/openclaw.json"
        elif [[ -f "$SCRIPT_DIR/config/openclaw/$OPENCLAW_CONFIG" ]]; then
            cp "$SCRIPT_DIR/config/openclaw/$OPENCLAW_CONFIG" "$INSTALL_DIR/config/openclaw/openclaw.json"
        else
            warn "OpenClaw config $OPENCLAW_CONFIG not found, using default"
            cp "$SCRIPT_DIR/config/openclaw/openclaw.json.example" "$INSTALL_DIR/config/openclaw/openclaw.json" 2>/dev/null || true
        fi
        # Resolve provider name/URL before any sed replacements that depend on them
        OPENCLAW_PROVIDER_NAME="${OPENCLAW_PROVIDER_NAME_DEFAULT}"
        OPENCLAW_PROVIDER_URL="${OPENCLAW_PROVIDER_URL_DEFAULT}"

        # Replace model and provider placeholders to match what the inference backend actually serves
        # Escape sed special chars in variable values to prevent injection
        _sed_escape() { printf '%s\n' "$1" | sed 's/[&/\]/\\&/g'; }
        _oc_model_esc=$(_sed_escape "$OPENCLAW_MODEL")
        _oc_prov_esc=$(_sed_escape "$OPENCLAW_PROVIDER_NAME")
        _sed_i "s|__LLM_MODEL__|${_oc_model_esc}|g" "$INSTALL_DIR/config/openclaw/openclaw.json"
        _sed_i "s|Qwen/Qwen2.5-[^\"]*|${_oc_model_esc}|g" "$INSTALL_DIR/config/openclaw/openclaw.json"
        _sed_i "s|local-ollama|${_oc_prov_esc}|g" "$INSTALL_DIR/config/openclaw/openclaw.json"
        log "Installed OpenClaw config: $OPENCLAW_CONFIG -> openclaw.json (model: $OPENCLAW_MODEL)"
        mkdir -p "$INSTALL_DIR/data/openclaw/home/agents/main/sessions"
        # Generate OpenClaw home config with local llama-server provider
        OPENCLAW_TOKEN=$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p)

        cat > "$INSTALL_DIR/data/openclaw/home/openclaw.json" << OCLAW_EOF
{
  "models": {
    "providers": {
      "${OPENCLAW_PROVIDER_NAME}": {
        "baseUrl": "${OPENCLAW_PROVIDER_URL}",
        "apiKey": "none",
        "api": "openai-completions",
        "models": [
          {
            "id": "${OPENCLAW_MODEL}",
            "name": "Dream Server LLM (Local)",
            "reasoning": false,
            "input": ["text"],
            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            "contextWindow": ${OPENCLAW_CONTEXT},
            "maxTokens": 8192,
            "compat": {
              "supportsStore": false,
              "supportsDeveloperRole": false,
              "supportsReasoningEffort": false,
              "maxTokensField": "max_tokens"
            }
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {"primary": "${OPENCLAW_PROVIDER_NAME}/${OPENCLAW_MODEL}"},
      "models": {"${OPENCLAW_PROVIDER_NAME}/${OPENCLAW_MODEL}": {}},
      "compaction": {"mode": "safeguard"},
      "subagents": {"maxConcurrent": 20, "model": "${OPENCLAW_PROVIDER_NAME}/${OPENCLAW_MODEL}"}
    }
  },
  "commands": {"native": "auto", "nativeSkills": "auto"},
  "gateway": {
    "mode": "local",
    "bind": "lan",
    "controlUi": {"allowInsecureAuth": true},
    "auth": {"mode": "token", "token": "${OPENCLAW_TOKEN}"}
  }
}
OCLAW_EOF
        # Generate agent auth-profiles.json for llama-server provider
        mkdir -p "$INSTALL_DIR/data/openclaw/home/agents/main/agent"
        cat > "$INSTALL_DIR/data/openclaw/home/agents/main/agent/auth-profiles.json" << AUTH_EOF
{
  "version": 1,
  "profiles": {
    "${OPENCLAW_PROVIDER_NAME}:default": {
      "type": "api_key",
      "provider": "${OPENCLAW_PROVIDER_NAME}",
      "key": "none"
    }
  },
  "lastGood": {"${OPENCLAW_PROVIDER_NAME}": "${OPENCLAW_PROVIDER_NAME}:default"},
  "usageStats": {}
}
AUTH_EOF
        cat > "$INSTALL_DIR/data/openclaw/home/agents/main/agent/models.json" << MODELS_EOF
{
  "providers": {
    "${OPENCLAW_PROVIDER_NAME}": {
      "baseUrl": "${OPENCLAW_PROVIDER_URL}",
      "apiKey": "none",
      "api": "openai-completions",
      "models": [
        {
          "id": "${OPENCLAW_MODEL}",
          "name": "Dream Server LLM (Local)",
          "reasoning": false,
          "input": ["text"],
          "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
          "contextWindow": ${OPENCLAW_CONTEXT},
          "maxTokens": 8192,
          "compat": {
            "supportsStore": false,
            "supportsDeveloperRole": false,
            "supportsReasoningEffort": false,
            "maxTokensField": "max_tokens"
          }
        }
      ]
    }
  }
}
MODELS_EOF
        log "Generated OpenClaw home config (model: $OPENCLAW_MODEL, gateway token set)"
        # Create workspace directory (must exist before Docker Compose,
        # otherwise Docker auto-creates it as root and the container can't write to it)
        mkdir -p "$INSTALL_DIR/config/openclaw/workspace/memory"
        # Copy workspace personality files (Todd identity, system knowledge, etc.)
        # Exclude .git and .openclaw dirs — those are runtime/dev artifacts
        if [[ -d "$SCRIPT_DIR/config/openclaw/workspace" ]]; then
            if command -v rsync &>/dev/null; then
                rsync -a --exclude='.git' --exclude='.openclaw' --exclude='.gitkeep' \
                    "$SCRIPT_DIR/config/openclaw/workspace/" "$INSTALL_DIR/config/openclaw/workspace/"
            else
                cp -r "$SCRIPT_DIR/config/openclaw/workspace"/* "$INSTALL_DIR/config/openclaw/workspace/" 2>/dev/null || true
                rm -rf "$INSTALL_DIR/config/openclaw/workspace/.git" 2>/dev/null || true
                rm -rf "$INSTALL_DIR/config/openclaw/workspace/.openclaw" 2>/dev/null || true
            fi
            log "Installed OpenClaw workspace files (agent personality)"
        fi
        # OpenClaw container runs as node (uid 1000) — fix ownership
        chown -R 1000:1000 "$INSTALL_DIR/data/openclaw" "$INSTALL_DIR/config/openclaw/workspace" 2>/dev/null || true
    fi

    # ── .env merge logic: preserve user-configured values on re-install ──
    dream_progress 40 "directories" "Generating secrets and configuration"
    # If an existing .env exists, read user-editable values so we don't
    # destroy API keys, custom ports, or manually-set secrets.
    _env_existing=""
    if [[ -f "$INSTALL_DIR/.env" ]]; then
        _env_existing="$INSTALL_DIR/.env"
        log "Found existing .env — preserving user-configured values"
    fi

    # Safe reader: extract a value from existing .env without sourcing it
    _env_get() {
        local key="$1" default="${2:-}"
        if [[ -n "$_env_existing" ]]; then
            local val
            val=$(grep -m1 "^${key}=" "$_env_existing" 2>/dev/null | cut -d= -f2- || true)
            # Strip surrounding quotes
            val="${val%\"}" && val="${val#\"}"
            val="${val%\'}" && val="${val#\'}"
            if [[ -n "$val" ]]; then
                echo "$val"
                return
            fi
        fi
        echo "$default"
    }

    # Secrets: reuse existing values, generate only if missing
    WEBUI_SECRET=$(_env_get WEBUI_SECRET "$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)")
    N8N_PASS=$(_env_get N8N_PASS "$(openssl rand -base64 16 2>/dev/null || head -c 16 /dev/urandom | base64)")
    LITELLM_KEY=$(_env_get LITELLM_KEY "sk-dream-$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)")
    LIVEKIT_SECRET=$(_env_get LIVEKIT_API_SECRET "$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64)")
    DASHBOARD_API_KEY=$(_env_get DASHBOARD_API_KEY "$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)")
    DIFY_SECRET_KEY=$(_env_get DIFY_SECRET_KEY "$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)")
    QDRANT_API_KEY=$(_env_get QDRANT_API_KEY "$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)")
    OPENCODE_SERVER_PASSWORD=$(_env_get OPENCODE_SERVER_PASSWORD "$(openssl rand -base64 16 2>/dev/null || head -c 16 /dev/urandom | base64)")

    # Langfuse (LLM Observability)
    LANGFUSE_PORT=$(_env_get LANGFUSE_PORT "3006")
    LANGFUSE_ENABLED=$(_env_get LANGFUSE_ENABLED "false")
    LANGFUSE_NEXTAUTH_SECRET=$(_env_get LANGFUSE_NEXTAUTH_SECRET "$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')")
    LANGFUSE_SALT=$(_env_get LANGFUSE_SALT "$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')")
    LANGFUSE_ENCRYPTION_KEY=$(_env_get LANGFUSE_ENCRYPTION_KEY "$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')")
    LANGFUSE_DB_PASSWORD=$(_env_get LANGFUSE_DB_PASSWORD "$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)")
    LANGFUSE_CLICKHOUSE_PASSWORD=$(_env_get LANGFUSE_CLICKHOUSE_PASSWORD "$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)")
    LANGFUSE_REDIS_PASSWORD=$(_env_get LANGFUSE_REDIS_PASSWORD "$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)")
    LANGFUSE_MINIO_ACCESS_KEY=$(_env_get LANGFUSE_MINIO_ACCESS_KEY "$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)")
    LANGFUSE_MINIO_SECRET_KEY=$(_env_get LANGFUSE_MINIO_SECRET_KEY "$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')")
    LANGFUSE_PROJECT_PUBLIC_KEY=$(_env_get LANGFUSE_PROJECT_PUBLIC_KEY "pk-lf-dream-$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)")
    LANGFUSE_PROJECT_SECRET_KEY=$(_env_get LANGFUSE_PROJECT_SECRET_KEY "sk-lf-dream-$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)")
    LANGFUSE_INIT_PROJECT_ID=$(_env_get LANGFUSE_INIT_PROJECT_ID "$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)")
    LANGFUSE_INIT_USER_EMAIL=$(_env_get LANGFUSE_INIT_USER_EMAIL "admin@dreamserver.local")
    LANGFUSE_INIT_USER_PASSWORD=$(_env_get LANGFUSE_INIT_USER_PASSWORD "$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)")

    # Preserve user-supplied cloud API keys
    ANTHROPIC_API_KEY=$(_env_get ANTHROPIC_API_KEY "${ANTHROPIC_API_KEY:-}")
    OPENAI_API_KEY=$(_env_get OPENAI_API_KEY "${OPENAI_API_KEY:-}")
    TOGETHER_API_KEY=$(_env_get TOGETHER_API_KEY "${TOGETHER_API_KEY:-}")

    # Generate .env file
    cat > "$INSTALL_DIR/.env" << ENV_EOF
# Dream Server Configuration — ${TIER_NAME} Edition
# Generated by installer v${VERSION} on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Tier: ${TIER} (${TIER_NAME})

#=== Dream Server Version (used by dream-cli update for version-compat checks) ===
DREAM_VERSION=${VERSION:-2.3.4}

#=== LLM Backend Mode ===
DREAM_MODE=$(if [[ "$GPU_BACKEND" == "amd" && "${DREAM_MODE:-local}" == "local" ]]; then echo "lemonade"; else echo "${DREAM_MODE:-local}"; fi)
LLM_API_URL=$(if [[ "${DREAM_MODE:-local}" == "local" ]]; then echo "http://llama-server:8080"; else echo "http://litellm:4000"; fi)

#=== Cloud API Keys ===
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
OPENAI_API_KEY=${OPENAI_API_KEY:-}
TOGETHER_API_KEY=${TOGETHER_API_KEY:-}

#=== LLM Settings (llama-server) ===
LLM_MODEL=${LLM_MODEL}
GGUF_FILE=${GGUF_FILE}
MAX_CONTEXT=${MAX_CONTEXT}
CTX_SIZE=${MAX_CONTEXT}
GPU_BACKEND=${GPU_BACKEND}
N_GPU_LAYERS=${N_GPU_LAYERS:-99}

$(if [[ "$GPU_BACKEND" == "amd" ]]; then cat << AMD_ENV
#=== GPU Group IDs (for container device access) ===
VIDEO_GID=$(getent group video 2>/dev/null | cut -d: -f3 || echo 44)
RENDER_GID=$(getent group render 2>/dev/null | cut -d: -f3 || echo 992)

#=== AMD ROCm Settings ===
HSA_OVERRIDE_GFX_VERSION=11.5.1
ROCBLAS_USE_HIPBLASLT=0
AMD_ENV
fi)
$(if [[ "$GPU_BACKEND" == "sycl" ]]; then cat << INTEL_ENV
#=== GPU Group IDs (for container device access) ===
VIDEO_GID=$(getent group video 2>/dev/null | cut -d: -f3 || echo 44)
RENDER_GID=$(getent group render 2>/dev/null | cut -d: -f3 || echo 992)

#=== Intel Arc / oneAPI SYCL Settings ===
ONEAPI_DEVICE_SELECTOR=level_zero:gpu
SYCL_CACHE_PERSISTENT=1
ZES_ENABLE_SYSMAN=1
INTEL_ENV
fi)

#=== Ports ===
OLLAMA_PORT=11434
WEBUI_PORT=3000
SEARXNG_PORT=8888
PERPLEXICA_PORT=3004
WHISPER_PORT=${WHISPER_PORT:-9000}
TTS_PORT=8880
N8N_PORT=5678
QDRANT_PORT=6333
QDRANT_GRPC_PORT=6334
EMBEDDINGS_PORT=8090
LITELLM_PORT=4000
OPENCLAW_PORT=7860
LANGFUSE_PORT=${LANGFUSE_PORT}

#=== Security (auto-generated, keep secret!) ===
WEBUI_SECRET=${WEBUI_SECRET}
DASHBOARD_API_KEY=${DASHBOARD_API_KEY}
N8N_USER=admin
N8N_PASS=${N8N_PASS}
LITELLM_KEY=${LITELLM_KEY}
LIVEKIT_API_KEY=$(_env_get LIVEKIT_API_KEY "$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | xxd -p)")
LIVEKIT_API_SECRET=${LIVEKIT_SECRET}
OPENCLAW_TOKEN=${OPENCLAW_TOKEN:-$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | xxd -p)}
QDRANT_API_KEY=${QDRANT_API_KEY}
OPENCODE_SERVER_PASSWORD=${OPENCODE_SERVER_PASSWORD}
DIFY_SECRET_KEY=${DIFY_SECRET_KEY}

#=== Voice Settings ===
WHISPER_MODEL=base
TTS_VOICE=en_US-lessac-medium

#=== Web UI Settings ===
WEBUI_AUTH=true
ENABLE_WEB_SEARCH=true
WEB_SEARCH_ENGINE=searxng

#=== n8n Settings ===
N8N_AUTH=true
N8N_HOST=localhost
N8N_WEBHOOK_URL=http://localhost:5678
TIMEZONE=${SYSTEM_TZ:-UTC}

#=== Langfuse (LLM Observability) ===
LANGFUSE_ENABLED=${LANGFUSE_ENABLED}
LANGFUSE_NEXTAUTH_SECRET=${LANGFUSE_NEXTAUTH_SECRET}
LANGFUSE_SALT=${LANGFUSE_SALT}
LANGFUSE_ENCRYPTION_KEY=${LANGFUSE_ENCRYPTION_KEY}
LANGFUSE_DB_PASSWORD=${LANGFUSE_DB_PASSWORD}
LANGFUSE_CLICKHOUSE_PASSWORD=${LANGFUSE_CLICKHOUSE_PASSWORD}
LANGFUSE_REDIS_PASSWORD=${LANGFUSE_REDIS_PASSWORD}
LANGFUSE_MINIO_ACCESS_KEY=${LANGFUSE_MINIO_ACCESS_KEY}
LANGFUSE_MINIO_SECRET_KEY=${LANGFUSE_MINIO_SECRET_KEY}
LANGFUSE_PROJECT_PUBLIC_KEY=${LANGFUSE_PROJECT_PUBLIC_KEY}
LANGFUSE_PROJECT_SECRET_KEY=${LANGFUSE_PROJECT_SECRET_KEY}
LANGFUSE_INIT_PROJECT_ID=${LANGFUSE_INIT_PROJECT_ID}
LANGFUSE_INIT_USER_EMAIL=${LANGFUSE_INIT_USER_EMAIL}
LANGFUSE_INIT_USER_PASSWORD=${LANGFUSE_INIT_USER_PASSWORD}

# ── Image Generation ──
ENABLE_IMAGE_GENERATION=${ENABLE_COMFYUI:-true}
ENV_EOF

    chmod 600 "$INSTALL_DIR/.env"  # Secure secrets file
    ai_ok "Created $INSTALL_DIR"
    ai_ok "Generated secure secrets in .env (permissions: 600)"

    # Generate LiteLLM config for Lemonade with baked-in model alias.
    # model_name must be a literal string (os.environ/ not proven for routing keys).
    if [[ "$GPU_BACKEND" == "amd" ]]; then
        mkdir -p "$INSTALL_DIR/config/litellm"
        cat > "$INSTALL_DIR/config/litellm/lemonade.yaml" << LITELLM_EOF
model_list:
  - model_name: "${LLM_MODEL}"
    litellm_params:
      model: "openai/extra.${GGUF_FILE}"
      api_base: http://llama-server:8080/api/v1
      api_key: sk-lemonade

  - model_name: "*"
    litellm_params:
      model: openai/*
      api_base: http://llama-server:8080/api/v1
      api_key: sk-lemonade

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY

litellm_settings:
  drop_params: true
  set_verbose: false
  request_timeout: 120
  stream_timeout: 60
LITELLM_EOF
        ai_ok "Generated LiteLLM config for Lemonade (model alias: ${LLM_MODEL})"
    fi

    # Validate generated .env against schema (fails fast on missing/unknown keys).
    dream_progress 41 "directories" "Validating configuration"
    if [[ -f "$SCRIPT_DIR/scripts/validate-env.sh" && -f "$SCRIPT_DIR/.env.schema.json" ]]; then
        if bash "$SCRIPT_DIR/scripts/validate-env.sh" "$INSTALL_DIR/.env" "$SCRIPT_DIR/.env.schema.json" >> "$LOG_FILE" 2>&1; then
            ai_ok "Validated .env against .env.schema.json"
        else
            error "Generated .env failed schema validation. See $LOG_FILE for details."
        fi
    else
        warn "Skipping .env schema validation (.env.schema.json or scripts/validate-env.sh missing)"
    fi

    # Generate SearXNG config with randomized secret key
    # Fix ownership from previous container runs (SearXNG writes as uid 977)
    mkdir -p "$INSTALL_DIR/config/searxng"
    if [[ -f "$INSTALL_DIR/config/searxng/settings.yml" ]] && ! [[ -w "$INSTALL_DIR/config/searxng/settings.yml" ]]; then
        sudo chown "$(id -u):$(id -g)" "$INSTALL_DIR/config/searxng/settings.yml" 2>/dev/null || true
    fi
    SEARXNG_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p)
    cat > "$INSTALL_DIR/config/searxng/settings.yml" << SEARXNG_EOF
use_default_settings: true
server:
  secret_key: "${SEARXNG_SECRET}"
  bind_address: "0.0.0.0"
  port: 8080
  limiter: false
search:
  safe_search: 0
  formats:
    - html
    - json
engines:
  - name: duckduckgo
    disabled: false
  - name: google
    disabled: false
  - name: brave
    disabled: false
  - name: wikipedia
    disabled: false
  - name: github
    disabled: false
  - name: stackoverflow
    disabled: false
SEARXNG_EOF
    ai_ok "Generated SearXNG config with randomized secret key"
fi

# Documentation, CLI tools, and compose variants already copied by rsync/cp block above
