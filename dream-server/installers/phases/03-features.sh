#!/bin/bash
# ============================================================================
# Dream Server Installer — Phase 03: Feature Selection
# ============================================================================
# Part of: installers/phases/
# Purpose: Interactive feature selection menu
#
# Expects: INTERACTIVE, DRY_RUN, TIER, ENABLE_VOICE, ENABLE_WORKFLOWS,
#           ENABLE_RAG, ENABLE_OPENCLAW, show_phase(), show_install_menu(),
#           log(), warn(), signal()
# Provides: ENABLE_VOICE, ENABLE_WORKFLOWS, ENABLE_RAG, ENABLE_OPENCLAW,
#           OPENCLAW_CONFIG
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
        read -p "  Enable voice (Whisper STT + Kokoro TTS)? [Y/n] " -r
        echo
        [[ $REPLY =~ ^[Nn]$ ]] || ENABLE_VOICE=true

        read -p "  Enable n8n workflow automation? [Y/n] " -r
        echo
        [[ $REPLY =~ ^[Nn]$ ]] || ENABLE_WORKFLOWS=true

        read -p "  Enable Qdrant vector database (for RAG)? [Y/n] " -r
        echo
        [[ $REPLY =~ ^[Nn]$ ]] || ENABLE_RAG=true

        read -p "  Enable OpenClaw AI agent framework? [y/N] " -r
        echo
        [[ $REPLY =~ ^[Yy]$ ]] && ENABLE_OPENCLAW=true
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
