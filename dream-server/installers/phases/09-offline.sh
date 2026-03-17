#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 09: Offline Mode Setup
# ============================================================================
# Part of: installers/phases/
# Purpose: Configure M1 offline/air-gapped operation
#
# Expects: OFFLINE_MODE, DRY_RUN, INSTALL_DIR, ENABLE_OPENCLAW, LOG_FILE,
#           chapter(), ai(), ai_ok(), ai_warn(), log()
# Provides: Offline mode marker, M1 config files, embedded embeddings
#
# Modder notes:
#   Add offline-specific configuration or bundled models here.
# ============================================================================

if [[ "$OFFLINE_MODE" == "true" ]] && $DRY_RUN; then
    log "[DRY RUN] Would configure offline/air-gapped mode (M1)"
    log "[DRY RUN] Would create offline mode marker, disable cloud features"
    [[ "$ENABLE_OPENCLAW" == "true" ]] && log "[DRY RUN] Would create OpenClaw M1 config"
    log "[DRY RUN] Would pre-download GGUF embeddings for memory_search"
elif [[ "$OFFLINE_MODE" == "true" ]] && ! $DRY_RUN; then
    chapter "CONFIGURING OFFLINE MODE (M1)"

    # Create offline mode marker
    touch "$INSTALL_DIR/.offline-mode"

    # Disable any cloud-dependent features in .env
    _sed_i 's/^BRAVE_API_KEY=.*/BRAVE_API_KEY=/' "$INSTALL_DIR/.env" 2>/dev/null || true
    _sed_i 's/^ANTHROPIC_API_KEY=.*/ANTHROPIC_API_KEY=/' "$INSTALL_DIR/.env" 2>/dev/null || true
    _sed_i 's/^OPENAI_API_KEY=.*/OPENAI_API_KEY=/' "$INSTALL_DIR/.env" 2>/dev/null || true

    # Add offline mode config
    cat >> "$INSTALL_DIR/.env" << 'OFFLINE_EOF'

#=============================================================================
# M1 Offline Mode Configuration
#=============================================================================
OFFLINE_MODE=true

# Disable telemetry and update checks
DISABLE_TELEMETRY=true
DISABLE_UPDATE_CHECK=true

# Use local RAG instead of web search
WEB_SEARCH_ENABLED=false
LOCAL_RAG_ENABLED=true
OFFLINE_EOF

    # Create OpenClaw M1 config if OpenClaw is enabled
    if [[ "$ENABLE_OPENCLAW" == "true" ]]; then
        mkdir -p "$INSTALL_DIR/config/openclaw"
        cat > "$INSTALL_DIR/config/openclaw/openclaw-m1.yaml" << 'M1_EOF'
# OpenClaw M1 Mode Configuration
# Fully offline operation - no cloud dependencies

memorySearch:
  enabled: true
  # Uses bundled GGUF embeddings (auto-downloaded during install)
  # No external API calls

# Disable web search (not available offline)
# Use local RAG with Qdrant instead
webSearch:
  enabled: false

# Local inference only
inference:
  provider: local
  baseUrl: http://llama-server:8080/v1
M1_EOF
        ai_ok "OpenClaw M1 config created"
    fi

    # Pre-download GGUF embeddings for memory_search
    ai "Pre-downloading GGUF embeddings for offline memory_search..."
    mkdir -p "$INSTALL_DIR/models/embeddings"

    # Download embeddinggemma GGUF (small, ~300MB)
    if command -v curl &> /dev/null; then
        EMBED_URL="https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf"
        if ! [[ -f "$INSTALL_DIR/models/embeddings/nomic-embed-text-v1.5.Q4_K_M.gguf" ]]; then
            curl -L --max-time 600 -o "$INSTALL_DIR/models/embeddings/nomic-embed-text-v1.5.Q4_K_M.gguf" "$EMBED_URL" 2>/dev/null || \
                ai_warn "Could not pre-download embeddings. Memory search will download on first use."
        else
            log "Embeddings already downloaded"
        fi
    fi

    # Offline docs already copied by rsync/cp block above
    ai_ok "Offline mode configured"
    log "After installation, disconnect from internet for fully air-gapped operation"
    log "See docs/M1-OFFLINE-MODE.md for offline operation guide"
fi
