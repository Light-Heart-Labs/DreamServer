# Mac Mini AI Deployment Guide 2026

*M1/M2/M4 configurations for local AI*

---

## Hardware Tiers

| Chip | Neural Engine | Unified Memory | Best For |
|------|---------------|----------------|----------|
| M1 | 16-core, 11 TOPS | 8-16GB | Basic inference, small models |
| M2 | 16-core, 15.8 TOPS | 8-24GB | Medium models, dev work |
| M4 | 16-core, 38 TOPS | 16-32GB | Real-time LLMs, multimodal |
| M4 Pro | 16-core, 38 TOPS | 24-64GB | Production workloads |

---

## Memory Requirements

| Model Size | Minimum RAM | Recommended |
|------------|-------------|-------------|
| 1-3B (Q4) | 8GB | 16GB |
| 7B (Q4) | 16GB | 24GB |
| 13B (Q4) | 24GB | 32GB |
| 32B (Q4) | 48GB | 64GB |

**Note:** M-series uses unified memory — RAM is shared with GPU.

---

## Framework Comparison: MLX vs llama.cpp

| Aspect | MLX | llama.cpp |
|--------|-----|-----------|
| **Integration** | Native Apple Silicon | Cross-platform |
| **Performance** | Optimized for Metal | Good with Metal backend |
| **Power** | Lower consumption | Moderate |
| **Flexibility** | Apple-only | Runs anywhere |
| **Best for** | Production on Mac | Dev/testing, portability |

### Performance (Qwen 7B Q4, M4 Pro 48GB)

| Framework | Tokens/sec | Load Time |
|-----------|------------|-----------|
| MLX | 45-55 | ~3s |
| llama.cpp | 35-45 | ~5s |

---

## Recommended Configurations

### Entry ($599 - M4 16GB)
- Models: Up to 7B quantized
- Use case: Personal assistant, dev testing
- Framework: MLX or Ollama

### Mid-tier ($1,399 - M4 Pro 24GB)
- Models: Up to 13B quantized
- Use case: Team dev server, quality chat
- Framework: MLX

### Professional ($1,999+ - M4 Pro 48-64GB)
- Models: Up to 32B quantized
- Use case: Production inference, multiple concurrent users
- Framework: MLX with vLLM frontend

---

## Quick Start

### Using Ollama (Easiest)

```bash
# Install
brew install ollama

# Run 7B model
ollama run qwen2.5:7b

# API available at localhost:11434
```

### Using MLX (Best Performance)

```bash
# Install
pip install mlx-lm

# Download and run
mlx_lm.generate --model mlx-community/Qwen2.5-7B-Instruct-4bit \
  --prompt "Hello!" --max-tokens 100
```

### Using llama.cpp (Most Flexible)

```bash
# Build with Metal
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp && make LLAMA_METAL=1

# Run server
./llama-server -m models/qwen2.5-7b-q4_k_m.gguf \
  --host 0.0.0.0 --port 8080 -ngl 99
```

---

## Use Cases

1. **Home AI Server:** Mac Mini + Ollama = always-on local assistant
2. **Dev Machine:** Test before deploying to GPU servers
3. **Edge Inference:** Low-power, fanless (with M4)
4. **Privacy-first:** All data stays local

---

## Limitations

- No CUDA — some tools need adaptation
- Memory not upgradeable — buy what you need upfront
- Smaller models than 4090 (24GB VRAM vs shared unified memory)

---

*Part of M6: Maximum Value, Minimum Hardware*
