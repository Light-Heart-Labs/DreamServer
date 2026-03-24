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
