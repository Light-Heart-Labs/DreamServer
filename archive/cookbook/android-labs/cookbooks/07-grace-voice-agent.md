# Recipe 05: Grace-Style Voice Agent from Scratch

*Deep-dive guide for building production voice agents with deterministic flows*

---

## Overview

Build a voice agent like Grace (our HVAC assistant) that combines:
- **Local STT/TTS** for privacy and reduced latency
- **Deterministic FSM flows** for reliability
- **LLM fallback** for complex queries
- **LiveKit** for real-time WebRTC communication

**Missions:** M2 (Democratized Voice), M4 (Deterministic Voice Agents)

**Difficulty:** Advanced | **Time:** 4-8 hours | **Prerequisites:** Python, Docker, basic ML knowledge

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Voice Agent Pipeline                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Phone/WebRTC ──► LiveKit ──► Agent Process                     │
│                                    │                            │
│                          ┌─────────┴─────────┐                  │
│                          │                   │                  │
│                          ▼                   │                  │
│                    ┌──────────┐              │                  │
│                    │  Whisper │ STT          │                  │
│                    │  (Local) │              │                  │
│                    └────┬─────┘              │                  │
│                         │                    │                  │
│                         ▼                    │                  │
│              ┌────────────────────┐          │                  │
│              │ Intent Classifier  │          │                  │
│              │   (DistilBERT)     │          │                  │
│              └────────┬───────────┘          │                  │
│                       │                      │                  │
│          ┌────────────┼────────────┐         │                  │
│          ▼            │            ▼         │                  │
│   ┌──────────┐        │     ┌──────────┐     │                  │
│   │   FSM    │ ◄──────┼────►│   LLM    │     │                  │
│   │ Executor │        │     │  (Qwen)  │     │                  │
│   └────┬─────┘        │     └────┬─────┘     │                  │
│        │              │          │           │                  │
│        └──────────────┼──────────┘           │                  │
│                       │                      │                  │
│                       ▼                      │                  │
│                ┌──────────┐                  │                  │
│                │  Kokoro  │ TTS              │                  │
│                │  (Local) │                  │                  │
│                └────┬─────┘                  │                  │
│                     │                        │                  │
│                     ▼                        │                  │
│               Audio Response ◄───────────────┘                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Hardware Requirements

| Tier | GPU | VRAM | Services | Cost |
|------|-----|------|----------|------|
| **Budget** | RTX 3060 | 12GB | Whisper + TTS only (cloud LLM) | ~$300 |
| **Mid** | RTX 4070 Ti Super | 16GB | Whisper + TTS + 7B LLM | ~$800 |
| **Dream** | RTX 4090 | 24GB | All local, 32B LLM | ~$2000 |
| **Enterprise** | RTX 6000 | 48GB+ | All local + scale | ~$5000+ |

**Our setup:** Dual RTX PRO 6000 Blackwell (96GB each) running all services.

**Light Heart Labs cluster ports (use these when deploying to our infra):**
- Whisper STT: `http://192.168.0.122:9101/v1`
- vLLM (Qwen): `http://192.168.0.122:9100/v1`
- Kokoro TTS: `http://192.168.0.122:9102/v1`

The Docker examples below show standalone ports. For our cluster, use the proxy ports above.

---

## Component Setup

### 1. Whisper STT (Local)

**Docker Compose snippet:**
```yaml
whisper:
  image: fedirz/faster-whisper-server:latest-cuda
  ports:
    - "8001:8000"
  environment:
    - WHISPER__MODEL=Systran/faster-whisper-large-v3
    - WHISPER__DEVICE=cuda
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
  volumes:
    - whisper-cache:/root/.cache
```

**Python client:**
```python
import requests

def transcribe(audio_bytes: bytes) -> str:
    """Transcribe audio using local Whisper."""
    response = requests.post(
        "http://localhost:8001/v1/audio/transcriptions",
        files={"file": ("audio.wav", audio_bytes, "audio/wav")},
        data={"model": "Systran/faster-whisper-large-v3"}
    )
    return response.json()["text"]
```

**Latency:** ~400ms for typical utterance

---

### 2. Intent Classifier (DistilBERT)

For deterministic flows, classify user intent before hitting the LLM:

```python
from transformers import DistilBertTokenizer, DistilBertForSequenceClassification
import torch

class IntentClassifier:
    def __init__(self, model_path: str = "distilbert-base-uncased"):
        self.tokenizer = DistilBertTokenizer.from_pretrained(model_path)
        self.model = DistilBertForSequenceClassification.from_pretrained(
            model_path, num_labels=7
        )
        self.labels = [
            "schedule_service", "describe_issue", "confirm_time",
            "cancel", "check_status", "general_inquiry", "fallback"
        ]
        self.model.eval()
    
    def predict(self, text: str) -> tuple[str, float]:
        inputs = self.tokenizer(text, return_tensors="pt", truncation=True)
        with torch.no_grad():
            outputs = self.model(**inputs)
            probs = torch.softmax(outputs.logits, dim=-1)
            confidence, pred_idx = torch.max(probs, dim=-1)
        return self.labels[pred_idx.item()], confidence.item()
```

**Latency:** ~20-50ms

---

### 3. FSM Executor

The heart of deterministic voice agents:

```python
from dataclasses import dataclass
from typing import Optional
import yaml

@dataclass
class FSMResponse:
    text: str
    state: str
    is_complete: bool
    use_llm: bool = False

class ConversationFSM:
    def __init__(self, flow_path: str):
        with open(flow_path) as f:
            self.spec = yaml.safe_load(f)
        self.state = self.spec["policy"]["initial"]
        self.context = {}
    
    def process(self, intent: str, entities: dict = None) -> FSMResponse:
        current = self.spec["policy"]["states"][self.state]
        
        # Check for intent match
        if intent not in current.get("on", {}):
            # Fallback to LLM for unknown intents
            return FSMResponse(
                text="", state=self.state, 
                is_complete=False, use_llm=True
            )
        
        transition = current["on"][intent]
        
        # Handle transition
        if isinstance(transition, str):
            self.state = transition
        elif isinstance(transition, dict):
            if "then" in transition:
                self.state = transition["then"]
            if "capture" in transition:
                for field in transition["capture"]:
                    self.context[field] = entities.get(field)
        
        # Get next state info
        next_state = self.spec["policy"]["states"][self.state]
        nlg_key = next_state.get("say", "").split(".")[-1]
        template = self.spec["nlg"].get(nlg_key, {}).get("template", "")
        
        return FSMResponse(
            text=template.format(**self.context),
            state=self.state,
            is_complete="end" in next_state,
            use_llm=False
        )
```

**Example flow YAML:**
```yaml
domain: "hvac_scheduling"

policy:
  initial: S0_greeting
  states:
    S0_greeting:
      say: nlg.greeting
      on:
        schedule_service: S1_address
        describe_issue: S1_issue_details
        general_inquiry: S_llm_mode
        fallback: S_llm_mode
    
    S1_address:
      say: nlg.ask_address
      on:
        address_provided: S2_time
    
    S2_time:
      say: nlg.ask_time
      capture: [preferred_time]
      on:
        time_provided: S3_confirm
    
    S3_confirm:
      say: nlg.confirm
      end: booked

nlg:
  greeting:
    template: "Thanks for calling Grace HVAC. How can I help today?"
  ask_address:
    template: "I can help schedule that. What's your service address?"
  ask_time:
    template: "What time works best for you?"
  confirm:
    template: "Perfect, I have you scheduled for {preferred_time}. We'll see you then!"
```

---

### 4. Local LLM (vLLM with Qwen)

**Docker Compose:**
```yaml
vllm:
  image: vllm/vllm-openai:latest
  ports:
    - "8000:8000"
  environment:
    - VLLM_WORKER_MULTIPROC_METHOD=spawn
  command: >
    --model Qwen/Qwen2.5-32B-Instruct-AWQ
    --gpu-memory-utilization 0.9
    --max-model-len 32768
    --enable-auto-tool-choice
    --tool-call-parser hermes
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

**Python client:**
```python
from openai import OpenAI

llm = OpenAI(base_url="http://localhost:8000/v1", api_key="not-needed")

def generate_response(conversation_history: list, system_prompt: str) -> str:
    response = llm.chat.completions.create(
        model="Qwen/Qwen2.5-32B-Instruct-AWQ",
        messages=[{"role": "system", "content": system_prompt}] + conversation_history,
        temperature=0.7,
        max_tokens=500
    )
    return response.choices[0].message.content
```

**Latency:** ~500-800ms for first token

---

### 5. Kokoro TTS (Local)

**Docker Compose:**
```yaml
kokoro:
  image: ghcr.io/remsky/kokoro-fastapi:latest
  ports:
    - "8002:8880"
  environment:
    - DEVICE=cuda
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]
```

**Python client:**
```python
import requests

def synthesize_speech(text: str, voice: str = "af_bella") -> bytes:
    response = requests.post(
        "http://localhost:8002/v1/audio/speech",
        json={
            "model": "kokoro",
            "input": text,
            "voice": voice,
            "response_format": "wav"
        }
    )
    return response.content
```

**Latency:** ~150-200ms for typical response

---

### 6. LiveKit Agent Integration

**Install:**
```bash
pip install livekit-agents livekit-plugins-silero
```

**Agent skeleton:**
```python
from livekit import agents
from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli
from livekit.plugins import silero

class GraceAgent(agents.VoicePipelineAgent):
    def __init__(self):
        self.fsm = ConversationFSM("flows/hvac.yaml")
        self.intent_classifier = IntentClassifier()
        self.conversation_history = []
        
        super().__init__(
            vad=silero.VAD.load(),
            stt=LocalWhisperSTT(),
            llm=LocalQwenLLM(),
            tts=LocalKokoroTTS(),
        )
    
    async def on_user_speech(self, text: str):
        # 1. Classify intent
        intent, confidence = self.intent_classifier.predict(text)
        
        # 2. Try FSM first if confidence is high
        if confidence > 0.7:
            response = self.fsm.process(intent)
            if not response.use_llm:
                return response.text
        
        # 3. Fallback to LLM
        self.conversation_history.append({"role": "user", "content": text})
        llm_response = generate_response(
            self.conversation_history,
            "You are Grace, a helpful HVAC assistant..."
        )
        self.conversation_history.append({"role": "assistant", "content": llm_response})
        
        return llm_response

async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    agent = GraceAgent()
    agent.start(ctx.room)

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
```

---

## Full Docker Compose

```yaml
version: '3.8'

services:
  whisper:
    image: fedirz/faster-whisper-server:latest-cuda
    ports:
      - "8001:8000"
    environment:
      - WHISPER__MODEL=Systran/faster-whisper-large-v3
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    volumes:
      - whisper-cache:/root/.cache

  vllm:
    image: vllm/vllm-openai:latest
    ports:
      - "8000:8000"
    environment:
      - VLLM_WORKER_MULTIPROC_METHOD=spawn
    command: >
      --model Qwen/Qwen2.5-32B-Instruct-AWQ
      --gpu-memory-utilization 0.9
      --max-model-len 32768
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  kokoro:
    image: ghcr.io/remsky/kokoro-fastapi:latest
    ports:
      - "8002:8880"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  livekit:
    image: livekit/livekit-server:latest
    ports:
      - "7880:7880"
      - "7881:7881"
    command: --config /etc/livekit.yaml
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml

  agent:
    build: ./agent
    depends_on:
      - whisper
      - vllm
      - kokoro
      - livekit
    environment:
      - LIVEKIT_URL=ws://livekit:7880
      - WHISPER_URL=http://whisper:8000
      - VLLM_URL=http://vllm:8000
      - KOKORO_URL=http://kokoro:8880

volumes:
  whisper-cache:
```

---

## Latency Budget

| Component | Target | Actual | Notes |
|-----------|--------|--------|-------|
| STT | <400ms | 400ms | Whisper streaming |
| Intent Classification | <50ms | 30ms | DistilBERT |
| FSM/LLM Decision | <10ms | 5ms | In-memory |
| NLG (FSM) | <10ms | 5ms | Template |
| NLG (LLM) | <800ms | 600ms | Qwen 32B |
| TTS | <200ms | 180ms | Kokoro |
| **Total (FSM path)** | <700ms | ~620ms | ✅ |
| **Total (LLM path)** | <1500ms | ~1200ms | ✅ |

---

## Testing Methodology

### Unit Tests
```python
def test_fsm_happy_path():
    fsm = ConversationFSM("flows/hvac.yaml")
    
    # User wants to schedule
    r1 = fsm.process("schedule_service")
    assert r1.state == "S1_address"
    
    # Provides address
    r2 = fsm.process("address_provided", {"address": "123 Main St"})
    assert r2.state == "S2_time"
```

### Integration Tests
```python
async def test_full_pipeline():
    # Record test audio
    audio = load_test_audio("schedule_appointment.wav")
    
    # Run through pipeline
    text = await transcribe(audio)
    intent, _ = classifier.predict(text)
    response = fsm.process(intent)
    audio_response = await synthesize(response.text)
    
    assert "schedule" in response.text.lower()
```

### Load Tests
```bash
# Simulate concurrent callers
locust -f loadtest.py --users 10 --spawn-rate 1
```

---

## Production Deployment Tips

### 1. Health Checks
```python
@app.get("/health")
async def health():
    checks = {
        "whisper": await check_whisper(),
        "vllm": await check_vllm(),
        "kokoro": await check_kokoro(),
    }
    return {"status": "healthy" if all(checks.values()) else "degraded", **checks}
```

### 2. Graceful Degradation
- If local LLM is slow → fall back to cloud API
- If intent classifier fails → route everything to LLM
- If TTS fails → return text response

### 3. Monitoring
- Track latency per component
- Alert on p95 > target
- Log all conversations for review

### 4. Scaling
- Separate GPU for each service (when available)
- Load balance across multiple agents
- Use Redis for shared conversation state

---

## Common Pitfalls

| Problem | Cause | Solution |
|---------|-------|----------|
| High latency | Waiting for completion | Enable streaming everywhere |
| Poor intent accuracy | Insufficient training data | Add domain-specific examples |
| Cut-off responses | VAD too aggressive | Tune silence threshold (500-600ms) |
| Memory leaks | Conversation history growth | Cap history length, summarize |
| GPU OOM | Model too large | Use quantized models (AWQ/GPTQ) |

---

## Next Steps

1. Train intent classifier on domain-specific data
2. Build conversation flow library (common HVAC scenarios)
3. Implement call transfer for emergencies
4. Add sentiment detection for escalation
5. Build analytics dashboard

---

## References

- [DETERMINISTIC-CALL-FLOWS.md](../research/DETERMINISTIC-CALL-FLOWS.md)
- [VOICE-LATENCY-OPTIMIZATION.md](../research/VOICE-LATENCY-OPTIMIZATION.md)
- [m4-intent-classification.md](../research/m4-intent-classification.md)
- [LiveKit Agents Documentation](https://docs.livekit.io/agents)
- [Pipecat Flows](https://github.com/pipecat-ai/pipecat)

---

*Part of the Android-Labs Cookbook — M2, M4*
