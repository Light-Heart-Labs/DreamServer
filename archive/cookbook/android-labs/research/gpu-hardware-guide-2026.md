# GPU Hardware Guide for Local AI — 2026
*Todd — 2026-02-09*
*Mission: M5 (Dream Server), M6 (Maximum Value, Minimum Hardware)*

## Overview

Hardware recommendations for running local AI models in 2026. Aimed at the "Dream Server" concept — affordable, powerful, turnkey local AI.

---

## TL;DR Quick Picks

| Budget | GPU | VRAM | Best For | Price |
|--------|-----|------|----------|-------|
| **Budget** | RTX 4090 | 24GB | 7B-13B models, entry point | $1,600-$2,000 |
| **Optimal** | RTX 5090 | 32GB | 30B-70B quantized, best value | $2,500-$3,800 |
| **Pro** | Dual RTX 5090 | 64GB | 70B full, matches H100 at 25% cost | $5,000-$7,600 |
| **Enthusiast** | RTX 6000 Blackwell Pro | 96GB | 70B+ unquantized | ~$6,500 |

---

## Consumer GPUs

### RTX 5090 (Recommended for Dream Server)
- **VRAM:** 32GB GDDR7
- **Bandwidth:** 1.79 TB/s
- **Performance:** ~2.6x faster than A100 80GB for inference
- **Price:** $2,500-$3,800
- **Power:** 575W TDP (needs 1,200W+ PSU)

**Key advantage:** 32GB VRAM handles 70B quantized models that don't fit on 24GB 4090.

**Benchmark:** 5,841 tokens/sec on Qwen2.5-Coder-7B

### RTX 4090 (Budget Option)
- **VRAM:** 24GB GDDR6X
- **Bandwidth:** 1.01 TB/s
- **Price:** $1,600-$2,000
- **Power:** 450W TDP

**Key advantage:** Proven, mature, excellent quantization support (GGUF, AWQ). Great for 7B-13B models.

### RTX 5090 vs 4090 Summary
| Metric | RTX 5090 | RTX 4090 |
|--------|----------|----------|
| VRAM | 32GB | 24GB |
| Bandwidth | 1.79 TB/s | 1.01 TB/s |
| Inference Speed | +25-35% typical, up to 70% in some cases | Baseline |
| Price | $2,500-$3,800 | $1,600-$2,000 |

---

## Enterprise/Pro GPUs (For Reference)

### RTX 6000 Blackwell Pro (Michael's Setup)
- **VRAM:** 96GB GDDR7
- **Use case:** 70B+ models unquantized
- **Price:** ~$6,500

### NVIDIA H100
- **VRAM:** 80GB HBM2e
- **Bandwidth:** 2 TB/s
- **Cloud Price:** $1.99-$11.06/hr
- **Use case:** Large-scale training, production clusters

### NVIDIA H200
- **VRAM:** 141GB HBM3e
- **Bandwidth:** 4.8 TB/s
- **Use case:** 405B+ inference, extended context

---

## Apple Silicon Alternative

### Mac Studio M3 Ultra
- **Memory:** Up to 512GB unified
- **Bandwidth:** 819 GB/s
- **Price:** $9,499
- **Use case:** 70B+ quantized, research, large context
- **Power:** 215W (much lower than NVIDIA)

### Mac Mini M4
- **Memory:** 16GB-64GB unified
- **Price:** $599-$1,399+
- **Use case:** Entry point, development, 7B-32B models
- **Performance:** 11-12 tok/s on Qwen 2.5 32B (64GB config)

---

## Memory Requirements (LLM Inference)

| Model Size | VRAM Needed (FP16) | With Quantization (Q4) |
|------------|-------------------|------------------------|
| 7B | ~14GB | ~4GB |
| 13B | ~26GB | ~7GB |
| 32B | ~64GB | ~16GB |
| 70B | ~140GB | ~35GB |
| 405B | ~810GB | ~200GB |

**Rule of thumb:** ~2 bytes per parameter for FP16, ~0.5 bytes for Q4.

---

## Quantization Impact

| Format | Memory Savings | Speed Impact | Quality Impact |
|--------|---------------|--------------|----------------|
| FP16 | Baseline | Baseline | Best |
| AWQ | 4x smaller | 2x faster | Minimal loss |
| GGUF Q4_K_M | 4x smaller | Varies (CPU-friendly) | Minimal loss |
| FP8 | 2x smaller | Faster | Minimal loss |

**Recommendation:** AWQ for GPU inference, GGUF for CPU/hybrid setups.

---

## Dream Server Recommended Builds

### Tier 1: Entry ($2,500-$3,500)
- RTX 4090 (24GB)
- 64GB RAM
- 1TB NVMe SSD
- 850W PSU
- **Runs:** 7B-13B models, 30B quantized

### Tier 2: Optimal ($4,000-$6,000)
- RTX 5090 (32GB)
- 128GB RAM
- 2TB NVMe SSD
- 1200W PSU
- **Runs:** 32B models, 70B quantized

### Tier 3: Pro ($8,000-$12,000)
- Dual RTX 5090 (64GB total)
- 128GB+ RAM
- 4TB NVMe SSD
- 1600W PSU
- **Runs:** 70B full, matches H100 performance

### Tier 4: Enthusiast ($15,000+)
- RTX 6000 Blackwell Pro (96GB) or RTX PRO 6000 (Michael's setup)
- 256GB RAM
- Large NVMe array
- Dual PSU recommended
- **Runs:** 70B+ unquantized, multiple concurrent models

---

## Cost Analysis: Local vs Cloud

| Scenario | Cloud Cost (monthly) | Local Cost (one-time) | Break-even |
|----------|---------------------|----------------------|------------|
| Light (1M tokens/day) | $300-$500 | $3,000 (Tier 1) | 6-10 months |
| Medium (10M tokens/day) | $1,500-$3,000 | $6,000 (Tier 2) | 2-4 months |
| Heavy (100M tokens/day) | $15,000+ | $12,000 (Tier 3) | <1 month |

**Note:** Cloud prices assume specialized providers (Lambda, RunPod). Hyperscalers (AWS, GCP) are 3-5x more expensive.

---

## Power & Cooling Considerations

| GPU | TDP | Monthly Electricity (24/7, $0.15/kWh) |
|-----|-----|---------------------------------------|
| RTX 4090 | 450W | ~$50 |
| RTX 5090 | 575W | ~$65 |
| Dual RTX 5090 | 1150W | ~$130 |
| RTX 6000 Pro | 300W | ~$35 |

Add 15-30% overhead for cooling.

---

## Recommendations for Dream Server Package

1. **Default config:** RTX 5090 + 128GB RAM — handles 90% of use cases
2. **Budget config:** RTX 4090 + 64GB RAM — great for learning/development
3. **Include AWQ quantization by default** — best balance of speed/quality
4. **Pre-install:** vLLM, Ollama, text-generation-webui, OpenClaw
5. **Pre-configure:** n8n workflows, voice agent templates

---

## References
- Fluence GPU Guide 2026
- Local AI Master benchmarks
- NVIDIA specifications
- Real-world deployment case studies

---

*This document informs M5 (Dream Server) hardware selection and M6 (Maximum Value, Minimum Hardware) optimization.*
