# M6: VRAM Limits for Multi-Service Configurations

*Research by local Qwen2.5-Coder-32B sub-agent | 2026-02-09*
*Mission: M6 (Maximum Value, Minimum Hardware)*

---

## Target Hardware: 48GB GPU (RTX 6000 Ada / PRO 6000 Blackwell)

### Combo 1: vLLM (7B) + Whisper + TTS

| Component | VRAM Required |
|-----------|---------------|
| vLLM (7B, FP16) | ~15GB |
| Whisper medium | ~3GB |
| TTS (Tacotron 2 / Kokoro) | ~2GB |
| **Total** | **~20GB** |

**Verdict:** ✅ Fits easily. 28GB headroom for batching, context, multiple requests.

**Compromises:** None needed.

---

### Combo 2: vLLM (32B quantized) + Whisper + TTS

| Component | VRAM Required |
|-----------|---------------|
| vLLM (32B AWQ) | ~8GB |
| Whisper medium | ~3GB |
| TTS | ~2GB |
| **Total** | **~13GB** |

**Verdict:** ✅ Fits with massive headroom. This is our current Hydralisk config.

**Compromises:** None needed. Leaves 35GB for KV cache, concurrent requests, etc.

---

### Combo 3: vLLM (32B full) + Embeddings + Image Gen

| Component | VRAM Required |
|-----------|---------------|
| vLLM (32B, FP16) | ~35GB |
| Embeddings (Sentence Transformers) | ~2GB |
| Image Gen (Stable Diffusion) | ~5GB |
| **Total** | **~42GB** |

**Verdict:** ⚠️ Tight fit. Only 6GB headroom.

**Compromises needed:**
- Reduce context length (32K → 16K or lower)
- Smaller batch sizes
- Consider offloading embeddings to CPU
- Or: use quantized LLM instead

---

## Real-World Recommendations

### For 24GB GPUs (RTX 4090, 3090)

| Config | Fits? | Notes |
|--------|-------|-------|
| 7B + Whisper + TTS | ✅ | Comfortable |
| 13B quantized + Whisper + TTS | ✅ | Comfortable |
| 32B quantized only | ✅ | ~8GB leaves room for other services |
| 32B quantized + Whisper + TTS | ✅ | ~13GB total |
| 32B + SDXL | ⚠️ | Tight, may need compromise |

### For 48GB GPUs (RTX 6000, A6000)

| Config | Fits? | Notes |
|--------|-------|-------|
| All of the above | ✅ | With headroom |
| 70B quantized | ✅ | ~20-25GB |
| 70B quantized + full stack | ✅ | Comfortable |
| 70B full precision | ❌ | Need 80GB+ |

### For 96GB+ (Dual GPU / H100)

| Config | Notes |
|--------|-------|
| Everything | Full multi-tenant stack feasible |
| Multiple 70B+ models | Possible with model sharding |

---

## Key Insights

1. **Quantization is the unlock** — AWQ/GPTQ reduces VRAM by 4-8x with minimal quality loss
2. **32B quantized is the sweet spot** — Fits on 24GB with full voice stack
3. **Full precision 32B+ is problematic** — Doesn't leave room for other services
4. **Whisper + TTS are cheap** — Only ~5GB combined, always fits
5. **Image gen is moderate** — 5-8GB, usually fits but consider timing

---

## Recommendations for Dream Server (M5)

Based on this analysis:

| Tier | GPU | Recommended Stack |
|------|-----|-------------------|
| Entry | RTX 4070 12GB | 7B LLM, Whisper small, Piper TTS |
| Standard | RTX 4090 24GB | 32B quantized, Whisper medium, Kokoro |
| Pro | RTX 6000 48GB | 32B quantized + full voice + image gen |
| Enterprise | Dual RTX PRO 6000 | Separate model specialization per GPU |

---

*This research directly informs hardware recommendations for M5 (Dream Server) and M6 (Minimum Hardware).*
