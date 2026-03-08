# Recipe 1: Local Voice Agent System

*Local AI Cookbook | 2026-02-09*

A practical guide for setting up a local voice agent using Whisper, vLLM, and Kokoro.

---

## Components

| Component | Purpose | Model |
|-----------|---------|-------|
| **Whisper** | Speech-to-text | faster-whisper (medium/large) |
| **vLLM** | Conversation engine | Qwen2.5-32B-AWQ |
| **Kokoro** | Text-to-speech | Kokoro-82M |

---

## Hardware Requirements

### Minimum (development/testing)
- **CPU:** Intel Core i5 / AMD Ryzen 5
- **RAM:** 16 GB
- **GPU:** RTX 3060 12GB
- **Storage:** 50 GB SSD

### Recommended (production)
- **CPU:** Intel Core i7 / AMD Ryzen 7
- **RAM:** 32 GB
- **GPU:** RTX 4090 24GB or RTX 6000 48GB
- **Storage:** 100 GB NVMe SSD

---

## Software Dependencies

```bash
# System packages
sudo apt update
sudo apt install -y python3.11 python3.11-venv nvidia-driver-535 docker.io

# CUDA Toolkit (for GPU acceleration)
wget https://developer.download.nvidia.com/compute/cuda/12.1.1/local_installers/cuda_12.1.1_530.30.02_linux.run
sudo sh cuda_12.1.1_530.30.02_linux.run

# Verify CUDA
nvidia-smi
```

---

## Installation

### 1. Whisper (Speech-to-Text)

```bash
# Using faster-whisper for better performance
pip install faster-whisper

# Or via Docker
docker run -d --gpus all \
  -p 8001:8000 \
  --name whisper \
  fedirz/faster-whisper-server:latest-cuda
```

### 2. vLLM (Conversation)

```bash
# Install vLLM
pip install vllm

# Start server with Qwen 32B (quantized)
# Note: Use Coder variant for code-heavy tasks, base for general
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-32B-Instruct-AWQ \
  --quantization awq \
  --dtype float16 \
  --gpu-memory-utilization 0.9 \
  --max-model-len 32768 \
  --enable-auto-tool-choice \
  --tool-call-parser hermes \
  --port 8000
```

**Light Heart Cluster Specifics:**
- `.122:8000` — Qwen2.5-Coder-32B-Instruct-AWQ (code tasks)
- `.143:8000` — Qwen2.5-32B-Instruct-AWQ (general tasks)
- `9100` — Proxy (round-robin, use model name matching target node)

### 3. Kokoro (Text-to-Speech)

```bash
# Clone and install
git clone https://github.com/hexgrad/kokoro
cd kokoro
pip install -e .

# Start server
python server.py --port 8002
```

---

## Low Latency Configuration

### Key optimizations:

1. **Use streaming responses** — Don't wait for complete generation
2. **Enable KV cache** — Reduces repeated computation
3. **Use Flash Attention** — Faster attention mechanism
4. **Optimize batch size** — Balance throughput vs latency

```python
# vLLM streaming example
from openai import OpenAI

# For general tasks (use .143)
client = OpenAI(base_url="http://192.168.0.143:8000/v1", api_key="none")
model = "Qwen/Qwen2.5-32B-Instruct-AWQ"

# For code tasks (use .122)
# client = OpenAI(base_url="http://192.168.0.122:8000/v1", api_key="none")
# model = "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ"

stream = client.chat.completions.create(
    model=model,
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)

for chunk in stream:
    print(chunk.choices[0].delta.content, end="")
```

---

## Common Pitfalls

| Issue | Cause | Solution |
|-------|-------|----------|
| OOM errors | Model too large | Use AWQ/GPTQ quantization |
| High latency | No GPU | Enable CUDA, check `nvidia-smi` |
| Audio glitches | Buffer underrun | Increase buffer size, use streaming |
| Whisper timeouts | Long audio | Chunk audio into segments |

---

## Performance Tuning

1. **VRAM allocation:** Set `--gpu-memory-utilization 0.9` for max usage
2. **Context length:** Reduce if not needed (saves memory)
3. **Concurrent requests:** Use `--max-num-seqs` to limit parallel requests
4. **Docker networking:** Use `--network host` for lowest latency

---

## Example Pipeline

```python
import whisper
from openai import OpenAI
import kokoro

# 1. Transcribe audio
model = whisper.load_model("medium")
result = model.transcribe("audio.wav")
user_text = result["text"]

# 2. Generate response
client = OpenAI(base_url="http://localhost:8000/v1", api_key="none")
response = client.chat.completions.create(
    model="Qwen/Qwen2.5-32B-Instruct-AWQ",
    messages=[{"role": "user", "content": user_text}]
)
assistant_text = response.choices[0].message.content

# 3. Synthesize speech
audio = kokoro.synthesize(assistant_text)
audio.save("response.wav")
```

---

*This recipe is part of the Local AI Cookbook — practical guides for self-hosted AI systems.*
