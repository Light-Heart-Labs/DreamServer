# Hardware Tiering Research for Dream Server

*Research date: 2026-02-09*

## Executive Summary

Three tiers based on VRAM. The 5090's 32GB is a "tweener" — more than 24GB consumer cards but not enough for unquantized 70B.

---

## Tier Definitions

| Tier | GPU Examples | VRAM | Max Model (vLLM) | Notes |
|------|--------------|------|------------------|-------|
| Entry | RTX 4090, 3090 | 24GB | 32B Q4 | Sweet spot for 14B-32B quantized |
| Prosumer | RTX 5090 | 32GB | 70B Q4 (tight) | Comfortable 32B, stretch to 70B |
| Pro | RTX 6000 Ada/Blackwell | 48-96GB | 70B FP16+ | Full-fat models, long context |

---

## Model-to-VRAM Mapping

### Quantization Impact

| Model Size | FP16 | Q8 | Q4 |
|------------|------|-----|-----|
| 7-8B | ~16GB | ~9GB | ~5GB |
| 14B | ~28GB | ~16GB | ~9GB |
| 32B | ~64GB | ~36GB | ~19-20GB |
| 70B | ~140GB | ~75GB | ~40GB |

*vLLM adds ~2-4GB overhead for KV cache, CUDA kernels*

### Per-Tier Recommendations

**Entry (24GB — RTX 4090/3090):**
- Default: `Qwen2.5-14B-Instruct-AWQ` (comfortable, room for context)
- Stretch: `Qwen2.5-32B-Instruct-AWQ` (tight, short context)
- Context limit: ~8K tokens at 32B

**Prosumer (32GB — RTX 5090):**
- Default: `Qwen2.5-32B-Instruct-AWQ` (comfortable)
- Stretch: `Qwen3-70B-Instruct-AWQ` (very tight, ~4K context)
- Note: 32GB is "neither here nor there" per community — models are optimized for 24GB or 48GB+

**Pro (96GB — RTX 6000 Blackwell):**
- Default: `Qwen2.5-32B-Instruct` (FP16, full quality)
- Alt: `Qwen3-70B-Instruct-AWQ` (comfortable, long context)
- Context limit: 32K+ tokens easily

---

## GPU Detection Script

```bash
#!/bin/bash
# Detect GPU and recommend tier

GPU_INFO=$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null)

if [ -z "$GPU_INFO" ]; then
    echo "ERROR: No NVIDIA GPU detected"
    exit 1
fi

GPU_NAME=$(echo "$GPU_INFO" | cut -d',' -f1 | xargs)
VRAM_MB=$(echo "$GPU_INFO" | cut -d',' -f2 | xargs)
VRAM_GB=$((VRAM_MB / 1024))

echo "Detected: $GPU_NAME with ${VRAM_GB}GB VRAM"

if [ "$VRAM_GB" -ge 80 ]; then
    TIER="pro"
    MODEL="Qwen2.5-32B-Instruct"
    echo "Tier: PRO — Full FP16 models supported"
elif [ "$VRAM_GB" -ge 28 ]; then
    TIER="prosumer"
    MODEL="Qwen2.5-32B-Instruct-AWQ"
    echo "Tier: PROSUMER — 32B quantized models"
elif [ "$VRAM_GB" -ge 20 ]; then
    TIER="entry"
    MODEL="Qwen2.5-14B-Instruct-AWQ"
    echo "Tier: ENTRY — 14B-32B quantized models"
else
    TIER="minimal"
    MODEL="Qwen2.5-7B-Instruct-AWQ"
    echo "Tier: MINIMAL — 7B models only"
fi

echo "Recommended model: $MODEL"
export DREAM_SERVER_TIER=$TIER
export DREAM_SERVER_MODEL=$MODEL
```

---

## RTX 5090 Reality Check

From community research (LocalLLaMA, Dec 2024 - Nov 2025):

> "32GB is kinda neither here nor there... models are sized for single 24GB VRAM or 2x4090 of 48GB"

> "RTX 5090 excels at running 32B models, but cannot run 70B or 110B in single-GPU mode"

> "5090's 32GB VRAM opens the door to comfortable 70B inference" (with aggressive quantization)

**Takeaway:** 5090 tier should default to 32B, with optional 70B Q4 for adventurous users willing to accept context limits.

---

## vLLM Memory Overhead

- Base overhead: ~2GB
- KV cache per token: ~0.5MB for 32B model
- Context window: Major VRAM consumer

**Example:**
- 32B Q4 model: ~19GB
- vLLM overhead: ~2GB
- 4K context: ~2GB
- **Total: ~23GB** (fits in 24GB, barely)

---

## Pre-download vs Pull-on-demand

**Recommendation:** Pull on first run

Reasons:
1. Reduces initial download size
2. User sees progress, feels something is happening
3. Allows tier-specific model selection
4. Avoids shipping 20GB+ archives

**Implementation:**
- Detect tier during install
- Set `DREAM_SERVER_MODEL` env var
- vLLM pulls model on first start
- Add progress indicator: "First run downloads model (~20GB), please wait..."

---

## Deliverables

1. ✅ GPU detection script (above)
2. Create `config/hardware-profiles/` with tier-specific docker-compose overrides
3. Update `install.sh` to auto-detect and configure
4. Add `docs/HARDWARE-TIERS.md` for user reference
