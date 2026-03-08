# M1 Zero-Cloud Configuration Recipe

**Version:** 1.0  
**Date:** 2026-02-12  
**Authors:** Android-17 & Todd  
**Mission:** M1 (Fully Local OpenClaw)  
**Target:** >90% tool-calling success with zero cloud API calls

---

## Quick Summary

This recipe configures OpenClaw to run **100% offline** using only local models and services. It disables all cloud providers and sets local alternatives as defaults.

**Prerequisites:**
- Local LLM server (vLLM, llama.cpp, or TabbyAPI) running on `172.17.0.1:8003`
- Local TTS (Kokoro) on port 8880
- Local STT (Whisper) on port 9000
- Local search (SearXNG) on port 8888

**Time to configure:** ~15 minutes  
**Validation time:** ~30 minutes (150 tool-calling tests)

---

## Step 1: Backup Current Config

```bash
# Create timestamped backup
cp ~/.openclaw/openclaw.json ~/.openclaw/openclaw.json.backup.$(date +%Y%m%d-%H%M%S)

echo "Backup created: ~/.openclaw/openclaw.json.backup.$(date +%Y%m%d-%H%M%S)"
```

---

## Step 2: Disable Cloud Providers

Edit `~/.openclaw/openclaw.json` and **remove** the following provider blocks entirely:

### Remove: Anthropic Provider
```json
{
  "provider": "anthropic",
  "baseUrl": "http://172.17.0.1:9110",
  "apiKey": "sk-ant-api03-...",
  "api": "anthropic-messages",
  "models": [...]
}
```

### Remove: Moonshot Provider
```json
{
  "provider": "moonshot",
  "baseUrl": "http://172.17.0.1:9110/v1",
  "apiKey": "sk-35LGvYo8...",
  "api": "openai-completions",
  "models": [...]
}
```

### Remove: Google Provider
```json
{
  "provider": "google",
  "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
  "apiKey": "AIzaSyA2QmG...",
  "api": "openai-completions",
  "models": [...]
}
```

### Remove: Other Cloud Providers (if present)
- OpenAI
- Groq
- Voyage AI
- GitHub Copilot
- Amazon Bedrock

---

## Step 3: Configure Local-Only Providers

### LLM Provider (vLLM)
```json
{
  "models": {
    "mode": "merge",
    "defaultProvider": "local-vllm",
    "defaultModel": "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
    "providers": {
      "local-vllm": {
        "baseUrl": "http://172.17.0.1:8003/v1",
        "apiKey": "none",
        "api": "openai-completions",
        "models": [
          {
            "id": "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
            "name": "Qwen2.5 Coder 32B (Local)",
            "reasoning": false,
            "input": ["text"],
            "cost": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0},
            "contextWindow": 32768,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

### Voice Provider (Kokoro TTS)
```json
{
  "voice": {
    "defaultProvider": "kokoro",
    "providers": {
      "kokoro": {
        "baseUrl": "http://172.17.0.1:8880",
        "apiKey": "none",
        "voice": "af_bella"
      }
    }
  }
}
```

### STT Provider (Whisper)
```json
{
  "stt": {
    "defaultProvider": "whisper",
    "providers": {
      "whisper": {
        "baseUrl": "http://172.17.0.1:9000",
        "apiKey": "none",
        "model": "base"
      }
    }
  }
}
```

### Search Provider (SearXNG)
```json
{
  "search": {
    "defaultProvider": "searxng",
    "providers": {
      "searxng": {
        "baseUrl": "http://172.17.0.1:8888",
        "apiKey": "none"
      }
    }
  }
}
```

---

## Step 4: Verify Configuration

### Test 1: LLM Connectivity
```bash
curl -s http://172.17.0.1:8003/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 10
  }' | jq '.choices[0].message.content'
```

**Expected:** "Hello! How can I assist you today?"

### Test 2: Tool Calling
```bash
curl -s http://172.17.0.1:8003/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "tools": [{"type": "function", "function": {"name": "calculate", "description": "Math", "parameters": {"type": "object", "properties": {"expr": {"type": "string"}}}}}],
    "temperature": 0.1
  }' | grep -o "<tools>" && echo "✅ Tool calling works"
```

**Expected:** `<tools>` tag in response

---

## Step 5: Network Verification (Zero External Calls)

### Method 1: Monitor During Test
```bash
# Terminal 1: Start monitoring
sudo tcpdump -i any -n \
  host not 172.17.0.1 and \
  host not 127.0.0.1 and \
  host not 192.168.0.0/24 \
  2>&1 | grep -v "ssh" | head -20

# Terminal 2: Run OpenClaw agent workflow
# If any external IPs appear, zero-cloud is NOT achieved
```

### Method 2: Firewall Block Test
```bash
# Temporarily block all outbound (test only!)
sudo iptables -A OUTPUT -d 0.0.0.0/0 -j DROP
sudo iptables -A OUTPUT -d 127.0.0.1 -j ACCEPT
sudo iptables -A OUTPUT -d 172.17.0.0/16 -j ACCEPT
sudo iptables -A OUTPUT -d 192.168.0.0/16 -j ACCEPT

# Run OpenClaw workflow
# If it works, zero-cloud achieved

# Restore (IMPORTANT!)
sudo iptables -F
```

---

## Step 6: Full Validation (150 Tool-Calling Tests)

```bash
# Run M1 validation suite
cd ~/.openclaw/workspace/Android-Labs/research
bash m1-validation.sh

# Expected results:
# - Total Tests: 150
# - Tool Calls: 150 (100%)
# - Direct Answers: 0
# - Errors: 0
# - Success Rate: 100%
# - Avg Latency: ~330-450ms
```

---

## Troubleshooting

### Issue: "No model providers configured"
**Fix:** Ensure at least one provider remains in config after removing cloud providers.

### Issue: "Connection refused to 172.17.0.1:8003"
**Fix:** Verify vLLM is running: `docker ps | grep vllm`

### Issue: Tool calling returns direct answers
**Fix:** Add explicit system prompt: `"You MUST use tools. Never answer directly."`

### Issue: Slow latency (>1s)
**Check:** GPU utilization with `nvidia-smi`. If low, model may be CPU-bound.

---

## Validation Checklist

- [ ] Backup created
- [ ] All cloud providers removed
- [ ] Local-vllm set as default
- [ ] LLM connectivity test passes
- [ ] Tool calling test passes
- [ ] Network monitoring shows no external calls
- [ ] 150-test validation >90% success
- [ ] All agent workflows tested

---

## Known Limitations

1. **No automatic fallback** — If local service down, workflow fails (no cloud backup)
2. **Model updates** — Must manually download new models (no cloud auto-update)
3. **No web browsing** — SearXNG required for search; no fallback to commercial search
4. **Image generation** — Requires local Stable Diffusion (not included in basic recipe)

---

## Related Documents

- `research/M1-EXTERNAL-APIS-AUDIT.md` — Todd's comprehensive API audit
- `research/M1-ZERO-CLOUD-CONFIG-GAPS.md` — Config-level analysis
- `research/M1-VALIDATION-RESULTS-2026-02-12.md` — Validation test results
- `docs/GOLDEN-BUILD.md` — Infrastructure golden state

---

**Status:** Recipe validated — 150/150 tests passing on local Qwen 32B  
**Last Updated:** 2026-02-12
