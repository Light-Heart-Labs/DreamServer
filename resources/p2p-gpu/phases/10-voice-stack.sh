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

_check_open_webui_health() {
	local env_file="${DS_DIR}/.env"
	local webui_port
	webui_port="$(env_get "$env_file" "WEBUI_PORT")"
	webui_port="${webui_port:-3000}"

	if docker ps --format '{{.Names}}' | grep -qx 'dream-webui'; then
		if ! wait_for_http "http://127.0.0.1:${webui_port}/health" 60 4; then
			warn "Open WebUI not healthy yet — STT requests may return server connection errors"
		fi
	fi
}

_check_open_webui_health
