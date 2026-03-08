# Raspberry Pi 5 AI Capabilities in 2026

*Practical deployment guide for edge AI*

---

## Models That Run on Raspberry Pi 5

| Model | Size | RAM Required | Use Case |
|-------|------|--------------|----------|
| Qwen2.5-0.5B | 0.5B | ~1GB | Basic chat, classification |
| Qwen2.5-1.5B | 1.5B | ~2GB | General assistant |
| Phi-3.5-mini | 3.8B | ~3GB | Reasoning, instruction following |
| Gemma2-2B | 2B | ~2GB | Balanced performance |
| Llama 3.2 1B/3B | 1-3B | 1-3GB | Meta's edge-optimized models |
| Mistral-7B (Q4) | 7B | ~5GB | Quality chat (quantized) |

---

## Expected Performance

### Without AI HAT+

| Model | Quantization | Tokens/sec | RAM Used |
|-------|--------------|------------|----------|
| Qwen2.5-0.5B | Q4_K_M | 15-25 | ~0.5GB |
| Qwen2.5-1.5B | Q4_K_M | 8-12 | ~1.2GB |
| Phi-3.5-mini | Q4_K_M | 4-6 | ~3GB |
| Mistral-7B | Q4_K_M | 2-4 | ~5GB |

### With Raspberry Pi AI HAT+ (Hailo-8L)

- 13 TOPS neural accelerator
- Dedicated NPU offloads inference
- 2-5x speedup for supported models

---

## Memory Constraints

| Pi 5 Variant | Max Model Size | Notes |
|--------------|----------------|-------|
| 4GB | ~3B (Q4) | Basic models only |
| 8GB | ~7B (Q4) | Recommended minimum |
| 16GB | ~13B (Q4) | Best for flexibility |

**Tip:** Use 4-bit quantization (Q4_K_M) to fit larger models in RAM.

---

## Recommended Frameworks

### llama.cpp (Recommended)

Best for: Maximum performance, control

```bash
# Install
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp && make -j4

# Run model
./llama-cli -m models/qwen2.5-1.5b-q4_k_m.gguf -p "Hello" -n 100
```

### Ollama

Best for: Easy setup, API access

```bash
# Install
curl -fsSL https://ollama.com/install.sh | sh

# Run model
ollama run qwen2.5:1.5b
```

### Comparison

| Aspect | llama.cpp | Ollama |
|--------|-----------|--------|
| Performance | ⭐⭐⭐ Best | ⭐⭐ Good |
| Ease of use | ⭐⭐ Moderate | ⭐⭐⭐ Easiest |
| API compatibility | Custom | OpenAI-compatible |
| Model management | Manual | Automatic |

---

## Practical Deployment Guide

### 1. Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y build-essential cmake git

# Clone llama.cpp
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp && make -j4
```

### 2. Download Model

```bash
# Using huggingface-cli
pip install huggingface-hub
huggingface-cli download TheBloke/Qwen2.5-1.5B-Instruct-GGUF \
  qwen2.5-1.5b-instruct-q4_k_m.gguf \
  --local-dir models/
```

### 3. Run Inference

```bash
./llama-server -m models/qwen2.5-1.5b-instruct-q4_k_m.gguf \
  --host 0.0.0.0 --port 8080 \
  -c 2048 -ngl 0
```

### 4. Test API

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Out of memory | Use smaller model or increase swap |
| Slow inference | Use Q4 quantization, reduce context |
| Model won't load | Check GGUF format compatibility |
| High temperature | Add heatsink, ensure airflow |

### Add Swap (If Needed)

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

---

## Use Cases

1. **Smart Home Hub:** Local voice assistant with 1.5B model
2. **Edge Classification:** Image/text classification without cloud
3. **Dev/Testing:** Prototype AI features before GPU deployment
4. **Privacy Gateway:** Process sensitive data locally

---

*Part of M6: Maximum Value, Minimum Hardware*
