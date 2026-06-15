# SenseVoice (STT)

OpenAI-compatible speech-to-text powered by [FunASR](https://github.com/modelscope/FunASR)'s
SenseVoiceSmall model. A lightweight, fast alternative to the Whisper service.

- **Endpoint:** `POST /v1/audio/transcriptions` (multipart `file`, optional `language` form field, default `auto`)
- **Health:** `GET /health`
- **In-container port:** 8000 · **Host port:** `SENSEVOICE_PORT` (default `9100`)
- **Model:** `iic/SenseVoiceSmall` (+ FSMN VAD), cached under `./data/sensevoice`

## Using it

Point any OpenAI-STT-compatible client at the host endpoint:

```bash
curl -s http://127.0.0.1:9100/v1/audio/transcriptions \
  -F file=@clip.wav -F language=auto
# -> {"text": "..."}
```

SenseVoice is **additive**: enabling it does not change Dream Server's default
voice wiring (Open WebUI / Hermes continue to use Whisper). To use SenseVoice as
the STT backend for an app, point that app's OpenAI STT base URL at
`http://sensevoice:8000/v1`.

## Acceleration

The service builds a small custom image (FastAPI + FunASR `AutoModel`, no vllm),
so it runs on CPU everywhere and on NVIDIA GPUs via `SENSEVOICE_DEVICE=cuda`
(set automatically by the NVIDIA compose overlay). The AMD overlay provides GPU
device isolation but, lacking a vllm-free ROCm path, inference runs CPU-mode;
Apple Silicon uses the CPU base compose.
