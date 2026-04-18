#!/usr/bin/env bash
# ============================================================================
# Dream Server — Vast.ai Phase 10: Voice Stack
# ============================================================================
# Part of: p2p-gpu/phases/
# Purpose: Bootstrap Whisper ASR model + Kokoro TTS readiness gate
#
# Expects: DS_DIR, log(), ensure_whisper_asr_model(), ensure_tts_model_ready()
# Provides: Voice services (STT/TTS) initialized with models
#
# SPDX-License-Identifier: Apache-2.0
# ============================================================================

set -euo pipefail

step "Phase 10/12: Verifying TTS/STT model availability"

ensure_whisper_asr_model "$DS_DIR"
ensure_tts_model_ready "$DS_DIR"
