# M6: Consumer GPU Benchmarks for Local LLM Inference

*Research by Android-17 | 2026-02-09*
*Mission: M6 (Maximum Value, Minimum Hardware)*

---

## Overview

This guide helps users choose the right consumer GPU for local LLM inference, focusing on:
- **VRAM** — Determines max model size
- **Memory Bandwidth** — Determines token generation speed
- **Price/Performance** — Best value for different budgets

---

## Consumer GPU Comparison Table

| GPU | VRAM | Bandwidth | ~tok/s (7B Q4) | ~tok/s (32B Q4) | Price (USD) | Best For |
|-----|------|-----------|----------------|-----------------|-------------|----------|
| **RTX 4090** | 24GB | 1008 GB/s | ~90-100 | ~40-50 | $1,599 | Maximum performance |
| **RTX 4080 SUPER** | 16GB | 736 GB/s | ~70-80 | ~25-35 | $999 | High-end, balanced |
| **RTX 4080** | 16GB | 717 GB/s | ~65-75 | ~25-35 | $1,099 | Skip (4080S is better value) |
| **RTX 4070 Ti SUPER** | 16GB | 672 GB/s | ~60-70 | ~20-30 | $799 | **Sweet spot for 16GB** |
| **RTX 4070 Ti** | 12GB | 504 GB/s | ~55-65 | N/A | $699 | Good mid-range |
| **RTX 4070 SUPER** | 12GB | 504 GB/s | ~55-60 | N/A | $599 | Good mid-range |
| **RTX 4070** | 12GB | 504 GB/s | ~50-58 | N/A | $549 | Entry prosumer |
| **RTX 4060 Ti 16GB** | 16GB | 288 GB/s | ~35-45 | ~15-20 | $499 | Budget 16GB |
| **RTX 4060 Ti 8GB** | 8GB | 288 GB/s | ~35-45 | N/A | $399 | Budget entry |
| **RTX 4060** | 8GB | 272 GB/s | ~35-40 | N/A | $299 | Entry level |
| **RTX 3090** (used) | 24GB | 936 GB/s | ~75-85 | ~35-45 | $700-900 | **Best used value** |
| **RTX 3080 Ti** (used) | 12GB | 912 GB/s | ~70-80 | N/A | $500-700 | Great used option |
| **RTX 3060 12GB** (used) | 12GB | 360 GB/s | ~25-35 | N/A | $200-279 | Budget entry |

*Note: tok/s estimates based on llama.cpp with Q4_K_M quantization. Actual performance varies by model, software, and system config.*

---

## Key Insights

### 1. Memory Bandwidth > Raw Compute for Token Generation

Token generation is **memory-bound**. The RTX 3080 Ti (912 GB/s) matches or beats the RTX 4080 SUPER (736 GB/s) in token generation despite being older, because bandwidth matters more than compute for LLMs.

### 2. VRAM Tiers

| VRAM | What You Can Run |
|------|------------------|
| 8GB | 7B-13B models (Q4), small voice stack |
| 12GB | 7B-13B comfortable, some 32B Q4 with limits |
| 16GB | 32B Q4 + voice stack, most use cases |
| 24GB | 32B full precision, 70B Q4, multi-model |

### 3. Best Value Recommendations

| Budget | Recommendation | Why |
|--------|----------------|-----|
| **$300** | RTX 4060 or used RTX 3060 12GB | Entry level, 7B models |
| **$500** | RTX 4060 Ti 16GB | Best budget 16GB option |
| **$600-700** | **Used RTX 3090** | Best value overall — 24GB VRAM + great bandwidth |
| **$800** | RTX 4070 Ti SUPER | Best new 16GB card |
| **$1,000** | RTX 4080 SUPER | High-end without 4090 price |
| **$1,600+** | RTX 4090 | Maximum single-GPU performance |

### 4. Hidden Gem: Used RTX 3090

At $700-900 used, the RTX 3090 offers:
- 24GB VRAM (same as 4090)
- 936 GB/s bandwidth (better than 4080 SUPER)
- Can run 32B+ models that 16GB cards can't
- ~75% of 4090 performance at ~50% of the price

**Trade-off:** Higher power draw (350W vs 4090's 450W, 4070 Ti SUPER's 285W)

---

## Dream Server Tier Recommendations

Based on this research, here are our hardware tiers for the M5 Dream Server:

### Tier 1: Entry ($500-800 total build)
- **GPU:** RTX 4060 or used RTX 3060 12GB
- **RAM:** 32GB DDR4
- **What runs:** 7B-13B models, small voice stack
- **Use case:** Personal assistant, code completion, chat

### Tier 2: Standard ($1,200-1,800 total build)
- **GPU:** RTX 4070 Ti SUPER (16GB) or used RTX 3090 (24GB)
- **RAM:** 64GB DDR5
- **What runs:** 32B models, full voice stack, image gen
- **Use case:** Power user, small team, development

### Tier 3: Pro ($2,500-4,000 total build)
- **GPU:** RTX 4090 (24GB)
- **RAM:** 128GB DDR5
- **What runs:** 70B Q4 models, multi-model serving, RAG
- **Use case:** Professional, research, multi-user

### Tier 4: Enterprise ($8,000+ total build)
- **GPU:** 2x RTX 4090 or RTX 6000 Ada (48GB)
- **RAM:** 256GB DDR5
- **What runs:** Multiple 70B+ models, production workloads
- **Use case:** Business deployment, API serving

---

## Performance vs Price Chart

```
Performance (7B Q4 tok/s)
100 |                                    ● 4090 ($1,599)
 90 |
 80 |                        ● 3090 used ($800)
 70 |                    ● 4080S ($999)
 60 |            ● 4070TiS ($799)
 50 |        ● 4070 ($549)
 40 |    ● 4060Ti ($399)
 30 | ● 3060 ($250)
    +-----------------------------------------> Price
       $250  $500  $750  $1000  $1250  $1500
```

**The curve shows:** Used RTX 3090 offers the best price/performance ratio for serious local LLM work.

---

## What About RTX 5000 Series?

The RTX 5090 (32GB, ~1,792 GB/s) is starting to appear:
- ~60-70% faster than 4090
- $2,000+ MSRP
- Worth it if you need bleeding edge

For most users, **wait for RTX 5080/5070** pricing to settle, or buy used 3090/4090 now.

---

## Sources

- Puget Systems LLM Inference benchmarks (Aug 2024)
- LocalLLaMA community benchmarks (ongoing)
- Hardware Corner GPU rankings (Dec 2025)
- Our own M8 cluster benchmarks (Feb 2026)

---

*This research directly informs hardware recommendations for M5 (Dream Server) and M6 (Minimum Hardware).*
