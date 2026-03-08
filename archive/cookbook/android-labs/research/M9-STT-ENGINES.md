# Comparison of Open-Source STT Engines

## Summary Table

| Engine | Accuracy | Speed | Resource Usage | Offline |
|--------|----------|-------|----------------|---------|
| **Whisper** | High (human-level) | Fast (varies by size) | Heavy (GPU preferred) | Yes |
| **Vosk** | Good | Real-time capable | Light (50MB models) | Excellent |
| **DeepSpeech** | Moderate (~7.5% WER) | Fast for small models | Moderate | Yes |

## Whisper
- **Accuracy**: Human-level robustness, trained on 680k hours multilingual data
- **Speed**: Varies by model size (tiny → large-v3)
- **Resource Usage**: Significant, especially larger models. GPU recommended.
- **Offline**: Requires downloading pre-trained models
- **Best for**: High accuracy needs, multilingual support

## Vosk
- **Accuracy**: Good offline performance, competitive WER
- **Speed**: Efficient real-time processing
- **Resource Usage**: Lightweight, models as small as 50MB
- **Offline**: Designed for offline use, many language models available
- **Best for**: Edge devices, resource-constrained environments

## DeepSpeech
- **Accuracy**: Moderate (~7.5% WER), less accurate than alternatives
- **Speed**: Fast for smaller models
- **Resource Usage**: Relatively intensive for larger models
- **Offline**: Capable but not optimized for small devices
- **Best for**: Legacy projects, specific use cases

## Recommendation for M2 Voice Pipeline
**Whisper** for quality-first deployments (what we use on cluster)
**Vosk** for edge/offline deployments with limited resources
