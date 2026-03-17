#!/bin/sh
# ============================================================================
# DreamServer Whisper Entrypoint
# ============================================================================
# VAD patch disabled — the sed/perl replacement can break Python syntax
# in newer versions of speaches where the transcribe() call spans multiple
# lines. Using upstream defaults until patch can handle multi-line safely.
# ============================================================================

apply_patch() {
    local stt_file="$1"
    echo "[dream-whisper] apply_patch called for $stt_file (no-op)"
}

PYTHON_CMD="python3"
if command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(0)' >/dev/null 2>&1; then
    PYTHON_CMD="python3"
elif command -v python >/dev/null 2>&1 && python -c 'import sys; sys.exit(0)' >/dev/null 2>&1; then
    PYTHON_CMD="python"
fi

STT_FILE=$($PYTHON_CMD -c "import speaches.routers.stt as m; print(m.__file__)" 2>/dev/null || true)

# VAD patch disabled — upstream compatibility, using defaults
# TODO: Fix patch to handle multi-line function calls safely.
echo "[dream-whisper] VAD patch disabled (upstream compatibility), using defaults"

# Always start uvicorn (patch failure is non-fatal but logged)
exec uvicorn --factory speaches.main:create_app --host 0.0.0.0 --port 8000
