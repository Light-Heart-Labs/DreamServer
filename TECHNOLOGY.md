# Dream Server — Technology Stack & Architecture

> Professional overview of the advanced technologies powering Dream Server.

## Core Stack

| Component | Technology |
|-----------|------------|
| LLM | llama.cpp, LiteLLM, Qwen 2.5/3 |
| Voice | Whisper (STT), Kokoro (TTS) |
| RAG | Qdrant, sentence-transformers |
| API | FastAPI, Pydantic |
| Dashboard | React 18, Vite 5, Tailwind |
| GPU | CUDA, ROCm, Metal |

## Codebase Metrics

Run `./dream-server/scripts/codebase-stats.sh` for current counts.

## See Also

- [System Architecture](dream-server/docs/SYSTEM-ARCHITECTURE.md)
- [Installer Architecture](dream-server/docs/INSTALLER-ARCHITECTURE.md)
