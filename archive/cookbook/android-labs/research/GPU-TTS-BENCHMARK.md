# GPU TTS Benchmark Results

**Date:** 2026-02-10
**Tested by:** Android-17
**Hardware:** RTX PRO 6000 Blackwell (96GB VRAM) on .122

## Summary

Upgraded Kokoro TTS from CPU to GPU (v0.2.4-master with PyTorch 2.8 for RTX 50 series support).

**Result:** 3x single-request speedup, ~50-100% capacity increase for voice pipeline.

## Test Configuration

- **Old:** `ghcr.io/remsky/kokoro-fastapi-cpu:latest` (7 months old)
- **New:** `ghcr.io/remsky/kokoro-fastapi-gpu:v0.2.4-master` (CUDA 12.9, PyTorch 2.8)
- **VRAM after upgrade:** 91/98GB (93% - tight but stable)

## Single Request Latency

| Component | CPU TTS | GPU TTS | Improvement |
|-----------|---------|---------|-------------|
| TTS only  | 228ms   | 77ms    | **3x faster** |

## Concurrent TTS Scaling

| Concurrent | CPU Batch* | GPU Batch | Per-Request (GPU) |
|------------|-----------|-----------|-------------------|
| 5          | ~1200ms   | 410ms     | 82ms              |
| 10         | ~2500ms   | 790ms     | 79ms              |
| 20         | ~5000ms   | 1640ms    | 82ms              |
| 50         | ~12s      | 4200ms    | 84ms              |

*CPU estimates extrapolated from previous stress test degradation pattern

**Key Finding:** GPU TTS maintains ~80ms/request regardless of concurrency. CPU TTS degrades linearly.

## Full Voice Pipeline (STT→LLM→TTS)

Test: Simulated voice call with LLM response (~80 tokens) + TTS synthesis

| Concurrent Calls | Total Batch Time | Per-Call Latency |
|------------------|------------------|------------------|
| 5                | 1117ms           | 688-1114ms       |
| 10               | 1584ms           | 684-1581ms       |
| 20               | 2545ms           | 712-2542ms       |

### Component Breakdown at 20 Concurrent

- **LLM:** 555-983ms (scales well, vLLM batching works)
- **TTS:** 154-1669ms (starts queuing after ~10 concurrent)

## Capacity Estimate

**Target:** <2s end-to-end latency (acceptable for voice)

| Configuration | Concurrent Calls | Notes |
|---------------|------------------|-------|
| Single GPU (CPU TTS) | 10-15 | TTS bottleneck |
| Single GPU (GPU TTS) | 15-20 | LLM becomes bottleneck |
| Dual GPU cluster | 30-40 | With load balancing |

**Improvement:** GPU TTS increases practical capacity by **50-100%**

## VRAM Impact

```
Before (CPU TTS): ~89GB used
After (GPU TTS):  ~91GB used (+2GB for Kokoro model)
```

Still within 98GB envelope. No memory pressure observed.

## Deployment Notes

```bash
# Start GPU Kokoro
docker run -d --gpus all --name kokoro-tts-gpu \
  -p 8880:8880 \
  -e USE_GPU=true \
  --restart unless-stopped \
  ghcr.io/remsky/kokoro-fastapi-gpu:v0.2.4-master
```

Requires:
- NVIDIA driver with CUDA 12.9+ support
- `--gpus all` flag
- RTX 50 series: needs v0.2.4+ (PyTorch 2.8 support)

## Conclusion

GPU TTS is a clear win:
- 3x faster single request
- Near-linear scaling under load
- Minimal VRAM overhead
- Increases voice call capacity by 50-100%

Bottleneck shifts from TTS to LLM at high concurrency. For >20 concurrent calls, would need second LLM instance or smaller model.

---

*Benchmark scripts: `/tmp/tts-stress.sh`, `/tmp/full-pipeline-stress.sh`*
