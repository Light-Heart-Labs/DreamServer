# Comparison of Open-Source TTS Engines

## Summary Table

| Engine | Quality | Speed | Languages | Setup |
|--------|---------|-------|-----------|-------|
| **Coqui** | High (voice cloning) | <200ms streaming | 1100+ | Moderate-High |
| **Piper** | Good (Google TTS level) | Near espeak | Primarily English | Simple |
| **Kokoro** | High | Fast (82M params) | Multiple | Simple-Moderate |

## Coqui TTS
- **Voice Quality**: High-quality with XTTS-v2, rivals commercial alternatives
- **Voice Cloning**: 85-95% similarity with just 10 seconds of audio
- **Speed**: Streaming inference <200ms latency
- **Languages**: 1100+ via Fairseq models
- **Setup**: Moderate-high, requires familiarity with DL frameworks
- **Best for**: Voice cloning, multilingual, production deployments

## Piper TTS
- **Voice Quality**: Good, comparable to Google TTS "Medium" quality
- **Speed**: Fast, almost as fast as espeak
- **Multi-speaker**: Supports quick speaker switching
- **Languages**: Primarily English (expanding)
- **Setup**: Simple with Docker, less compute needed
- **Best for**: Fast synthesis, resource-constrained deployments

## Kokoro TTS
- **Voice Quality**: High with lightweight 82M parameter architecture
- **Speed**: Faster than many alternatives due to small size
- **Voice Blending**: Supports mixed voices
- **Languages**: Multiple, quality varies for non-English
- **Setup**: Simple CLI, various input formats
- **Best for**: Balance of quality/speed, cost efficiency

## Recommendation for M2 Voice Pipeline
**Kokoro** for balanced quality/speed (what we use on cluster)
**Piper** for edge deployments needing fast synthesis
**Coqui** for voice cloning or 1100+ language support
