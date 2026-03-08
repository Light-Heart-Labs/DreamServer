# whisper

Speech-to-text service for Dream Server

## Overview

The Whisper service provides real-time audio transcription using [speaches](https://github.com/speaches-ai/speaches), a high-performance Whisper server with an OpenAI-compatible API. It is used by Open WebUI for voice input and can be called directly from any application that supports the OpenAI Audio Transcriptions endpoint.

The service includes a custom VAD (Voice Activity Detection) patch that is applied at container startup to tune silence detection for conversational AI use cases.

## Features

- **OpenAI-compatible API**: Drop-in replacement for `POST /v1/audio/transcriptions`
- **Multiple Whisper models**: Supports tiny through large-v3-turbo via HuggingFace model IDs
- **Voice Activity Detection (VAD)**: Patched at startup with tuned parameters for conversation
- **Model caching**: Models are downloaded once and cached in `data/whisper/`
- **TTL-based model eviction**: Unused models unloaded after 24 hours (`WHISPER__TTL=86400`)
- **CPU and GPU backends**: CPU image by default; GPU overlay available for NVIDIA

## Configuration

Environment variables (set in `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_PORT` | `9000` | External port (maps to internal 8000) |
| `WHISPER__TTL` | `86400` | Model time-to-live in seconds (unload after inactivity) |

The Whisper model is selected per-request using the `model` field in the API call. Open WebUI uses:
- AMD/CPU: `Systran/faster-whisper-base`
- NVIDIA: `deepdml/faster-whisper-large-v3-turbo-ct2`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/v1/audio/transcriptions` | Transcribe audio (OpenAI format) |
| `GET` | `/v1/models` | List available/cached models |

### Example

```bash
curl http://localhost:9000/v1/audio/transcriptions \
  -F "file=@audio.wav" \
  -F "model=Systran/faster-whisper-base"
```

## VAD Patch

The `docker-entrypoint.sh` script applies a VAD tuning patch to the upstream speaches STT router at container startup. The patch is idempotent — it detects an existing `DREAM_PATCHED` marker and skips re-application on container restart.

VAD parameters injected:

| Parameter | Value | Effect |
|-----------|-------|--------|
| `threshold` | `0.3` | Speech probability threshold |
| `min_silence_duration_ms` | `400` | Silence gap before segment end |
| `min_speech_duration_ms` | `50` | Minimum speech segment length |
| `speech_pad_ms` | `200` | Padding added around speech segments |

## Data Persistence

Downloaded models are cached in `data/whisper/` (mounted at `/home/ubuntu/.cache/huggingface/hub` inside the container). Models are downloaded automatically on first use.

## Files

- `compose.yaml` — Service definition
- `manifest.yaml` — Service metadata and feature requirements
- `docker-entrypoint.sh` — VAD patch + server startup script

## Troubleshooting

**Service not starting:**
```bash
docker compose ps whisper
docker compose logs whisper
```

**Transcription errors or poor quality:**
- Try a larger model: set `model=Systran/faster-whisper-small` or `model=deepdml/faster-whisper-large-v3-turbo-ct2` in the request
- Check available disk space for model download

**VAD patch not applying:**
- The patch targets a specific line in the speaches source; if the upstream image changes, the patch may be skipped silently
- Check logs for `[dream-whisper] WARNING: Target pattern not found`

**Model download hanging:**
- Whisper downloads models from HuggingFace on first use; allow a few minutes
- Check container logs: `docker compose logs -f whisper`

**Open WebUI not using Whisper:**
- Verify `AUDIO_STT_ENGINE=openai` and `AUDIO_STT_OPENAI_API_BASE_URL=http://whisper:8000/v1` in the open-webui environment

## License

Part of Dream Server — Local AI Infrastructure
