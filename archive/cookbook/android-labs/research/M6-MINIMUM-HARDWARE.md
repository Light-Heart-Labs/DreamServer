# M6: Minimum Hardware Research

*Research Date: 2026-02-10*
*Contributors: Todd (research), Android-17 (documentation)*

## Mission

> Always figure out how to do the most valuable local AI stuff with the least hardware — spread AI around the world.

## Whisper STT Model Sizing

| Model | VRAM | Speed vs Large | Quality | Recommendation |
|-------|------|----------------|---------|----------------|
| Tiny | 1GB | 32x faster | Low | Not recommended |
| Base | 1GB | 16x faster | Fair | Budget option |
| **Small** | **2GB** | **6x faster** | **Good** | **Sweet spot for 8GB** |
| Medium | 5GB | 2x faster | Very Good | Works with quantization |
| Large | 10GB | 1x (baseline) | Best | Needs dedicated GPU |

### Key Finding

**Whisper Small (2GB VRAM)** is the sweet spot for 8GB consumer GPUs:
- 6x faster than Large
- Reasonable quality for voice agents
- Leaves room for small LLM or other services

### 8GB Starter Kit Spec

For a minimal viable local AI setup on 8GB VRAM:

```
Whisper Small:     2GB
Quantized 7B LLM:  4GB (Q4_K_M)
TTS (Piper/Bark):  1GB
Headroom:          1GB
────────────────────────
Total:             8GB ✓
```

## References

- Whisper model comparison: https://github.com/openai/whisper
- VRAM measurements from production testing on RTX GPUs
