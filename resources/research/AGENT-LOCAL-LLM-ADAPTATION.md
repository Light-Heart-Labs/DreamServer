# Agent Local LLM Adaptation

How to run the entire agent architecture on local LLMs instead of cloud APIs — API compatibility, GPU memory budgeting, small context windows, unreliable tool calling, system prompt tuning, and DreamServer integration. This document bridges the 31 cloud-native agent docs to local AI infrastructure.

*Last updated: 2026-03-31*

---

## Why This Matters

The other 31 documents describe how to build a world-class agentic coding tool. But they assume a cloud API: 200K context windows, per-token billing, OAuth flows, instant model switching, and reliable tool calling. None of that is true locally. A 7B model on a consumer GPU has 4K-32K context, costs nothing per token, needs no OAuth, takes 15 seconds to switch models, and fails at tool calling 30% of the time.

This document adapts every cloud assumption to local reality. It's the bridge between the blueprint and the mission: **local AI that empowers everyone.**

---

## 1. API Compatibility Layer

### The Problem

The agent blueprint assumes one LLM provider's SDK and message format. Local inference servers (llama-server, Ollama, vLLM, LM Studio) speak the OpenAI-compatible API format.

### The Translation

| Cloud Pattern | Local Equivalent |
|-------------|-----------------|
| Provider-specific SDK | OpenAI SDK (`openai` npm package) pointed at local endpoint |
| Provider message format | OpenAI chat completion format (llama-server native) |
| `tool_use` content blocks | `tool_calls` array on assistant message |
| `tool_result` content blocks | `tool` role messages with `tool_call_id` |
| `message_start` / `content_block_delta` streaming | `chat.completion.chunk` streaming |

### Adapter Pattern

Build a thin adapter that normalizes both formats to an internal representation:

```
InternalToolCall:
  id: string
  name: string
  input: object

fromProviderFormat(message):
  if message has tool_use content blocks:    // Provider-specific format
    return message.content.filter(b => b.type == "tool_use").map(toInternal)
  if message has tool_calls array:            // OpenAI format
    return message.tool_calls.map(toInternal)

toProviderFormat(toolResult, format):
  if format == "provider_specific":
    return { type: "tool_result", tool_use_id, content }
  if format == "openai":
    return { role: "tool", tool_call_id, content }
```

### Streaming Adapter

| Cloud Event | OpenAI Equivalent |
|-------------|-------------------|
| `message_start` | First `chat.completion.chunk` with role |
| `content_block_start` (text) | Chunk with `delta.content` |
| `content_block_start` (tool_use) | Chunk with `delta.tool_calls[0].function.name` |
| `content_block_delta` (text) | Chunk with `delta.content` |
| `content_block_delta` (tool_use input) | Chunk with `delta.tool_calls[0].function.arguments` |
| `message_stop` | Chunk with `finish_reason: "stop"` or `"tool_calls"` |

### DreamServer Endpoint Configuration

```
# DreamServer's llama-server
LLM_ENDPOINT=http://localhost:8080/v1

# Or via LiteLLM proxy (for model routing)
LLM_ENDPOINT=http://localhost:4000/v1

# Backend config: dream-server/config/backends/nvidia.json
{
  "provider_url": "http://llama-server:8080/v1",
  "public_api_port": 8080,
  "public_health_url": "http://localhost:8080/health"
}
```

**See also:** [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md), [AGENT-STREAMING-TOOL-EXECUTION.md](AGENT-STREAMING-TOOL-EXECUTION.md), [AGENT-BUILD-AND-DEPENDENCIES.md](AGENT-BUILD-AND-DEPENDENCIES.md)

---

## 2. GPU Memory Budgeting (Replacing Rate Limits)

### The Inversion

| Cloud Constraint | Local Constraint |
|-----------------|-----------------|
| Tokens per minute (TPM) | VRAM capacity (GB) |
| Requests per minute (RPM) | Concurrent inference slots |
| Tokens per day (TPD) | None (run as much as hardware allows) |
| Cost per token | None (hardware is already paid for) |

### VRAM Budget Model

```
VRAMBudget:
  totalVRAM: number          // e.g., 24GB (RTX 4090)
  modelSize: number          // e.g., 4.5GB (Qwen 3 8B Q4_K_M)
  kvCachePerToken: number    // e.g., 0.5MB per token of context
  maxContext: number         // e.g., 32768 tokens
  kvCacheMax: number         // kvCachePerToken × maxContext

  canFitModel(modelFile):
    modelSize = readGGUFMetadata(modelFile).size
    kvCache = kvCachePerToken * maxContext
    required = modelSize + kvCache + OVERHEAD_BUFFER  // 500MB overhead
    return required <= totalVRAM

  availableForInference():
    return totalVRAM - modelSize - OVERHEAD_BUFFER
```

### Concurrent Inference Slots

llama-server's `parallel` parameter controls how many requests it handles simultaneously:

```
# DreamServer default: 1 slot
parallel = 1  → one request at a time, others queue

# With more VRAM headroom:
parallel = 2  → two concurrent requests (doubles KV cache memory)
parallel = 4  → four concurrent (for 48GB+ GPUs)
```

**Agent integration:** The semaphore in [AGENT-STREAMING-TOOL-EXECUTION.md](AGENT-STREAMING-TOOL-EXECUTION.md) §3 should match the server's `parallel` setting, not a hardcoded 10.

### Model Switching Cost

| Operation | Time | Impact |
|-----------|------|--------|
| Unload current model | 1-3s | VRAM freed |
| Load new model | 10-30s | VRAM consumed, server unavailable |
| Verify health | 1s | Server ready for inference |

**Adaptation for the query loop:** When [AGENT-QUERY-LOOP-AND-STATE-MACHINE.md](AGENT-QUERY-LOOP-AND-STATE-MACHINE.md) §5.1 describes "fallback model retry," the local version must:
1. Check if fallback model fits in VRAM
2. Warn user: "Switching model, this will take ~15 seconds"
3. Unload current → load fallback → verify health
4. Resume query loop

**See also:** [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) §4 (rate limits), DreamServer's [HARDWARE-GUIDE.md](HARDWARE-GUIDE.md), [M6-VRAM-MULTI-SERVICE-LIMITS.md](M6-VRAM-MULTI-SERVICE-LIMITS.md)

---

## 3. Context Window Adaptation

### Window Sizes in Practice

| Model | Base Window | Extended | DreamServer Config |
|-------|-----------|----------|-------------------|
| Llama 2 | 4,096 | — | n-ctx=4096 |
| Llama 3 | 8,192 | 128K (with RoPE scaling) | n-ctx=8192 |
| Mistral 7B | 8,192 | 32K | n-ctx=8192 |
| Qwen 2.5/3 | 32,768 | 128K | n-ctx=32768 |
| Phi-4 | 16,384 | — | n-ctx=16384 |

DreamServer's default: `n-ctx=32768` (Qwen 3 8B) in `config/llama-server/models.ini`.

### Budget Reallocation for Small Windows

[AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) §1 allocates 10-20% for system prompt on a 200K window (20-40K tokens). On an 8K window:

| Region | 200K Window | 8K Window | 4K Window |
|--------|-----------|----------|----------|
| System prompt | 20,000 (10%) | 800 (10%) | 400 (10%) |
| History | 130,000 (65%) | 5,200 (65%) | 2,600 (65%) |
| Current turn | 30,000 (15%) | 1,200 (15%) | 600 (15%) |
| Output reserve | 20,000 (10%) | 800 (10%) | 400 (10%) |

**800 tokens for the system prompt** means drastic simplification. See Section 5 (System Prompt Tuning).

### Dynamic Window Detection

```
detectContextWindow():
  // Query llama-server for model metadata
  response = GET "{LLM_ENDPOINT}/v1/models"
  model = response.data[0]

  // llama-server reports context size
  contextSize = model.context_length or DEFAULT_CONTEXT

  // Or read from DreamServer config
  modelConfig = readIni("config/llama-server/models.ini")
  contextSize = modelConfig[currentModel].n_ctx

  return contextSize
```

### Aggressive Compaction Triggers

For small windows, compact earlier and more aggressively:

| Window Size | Auto-Compact Threshold | Microcompact Age |
|-------------|----------------------|------------------|
| 200K | 85% (170K) | Tool results >10 turns old |
| 32K | 70% (22K) | Tool results >5 turns old |
| 8K | 60% (4.8K) | Tool results >2 turns old |
| 4K | 50% (2K) | Tool results >1 turn old |

**See also:** [AGENT-CONTEXT-COMPACTION-ADVANCED.md](AGENT-CONTEXT-COMPACTION-ADVANCED.md), DreamServer's [LOCAL-AI-BEST-PRACTICES.md](LOCAL-AI-BEST-PRACTICES.md)

---

## 4. Tool Calling Reliability

### Model Tier System

Based on DreamServer's tool-calling research (see `tool-calling-*.md` guides):

| Tier | Models | Tool Calling Quality | Strategy |
|------|--------|---------------------|----------|
| **A** (Reliable) | Qwen 2.5/3 (hermes), Llama 3.1+ (llama3_json) | 90%+ structured output | Use standard tool_calls format |
| **B** (Usable) | Mistral, DeepSeek, Command-R | 70-85% with correct parser | Use model-specific parser, validate JSON |
| **C** (Unreliable) | Llama 2, Phi <4, small 1-3B models | <60%, frequent malformed JSON | Prompt-based fallback |

### Standard Tool Calling (Tier A)

Works like the cloud — model returns structured `tool_calls` in OpenAI format:

```json
{
  "role": "assistant",
  "tool_calls": [{
    "id": "call_1",
    "type": "function",
    "function": {
      "name": "file_read",
      "arguments": "{\"path\": \"/src/main.ts\"}"
    }
  }]
}
```

**Parser configuration for DreamServer:**
- Qwen 2.5/3: vLLM with `--tool-call-parser hermes`
- Llama 3.1+: vLLM with `--tool-call-parser llama3_json`
- llama-server: native tool calling support (GGUF models with chat template)

### Prompt-Based Fallback (Tier C)

When the model can't produce structured tool calls, fall back to prompt-based selection:

```
System prompt addition for Tier C models:

"You have access to these tools:
1. file_read(path: string) - Read a file's contents
2. bash(command: string) - Run a shell command
3. file_edit(path: string, old: string, new: string) - Edit a file

When you want to use a tool, respond with EXACTLY this JSON format on a new line:
{"tool": "tool_name", "input": {"param": "value"}}

Example:
{"tool": "file_read", "input": {"path": "/src/main.ts"}}

Do NOT wrap in markdown code blocks. Do NOT add explanation before the JSON."
```

### Malformed JSON Recovery

```
parseToolCall(modelOutput):
  try:
    return JSON.parse(modelOutput)
  catch:
    // Try to extract JSON from markdown code block
    match = modelOutput.match(/```json?\s*([\s\S]*?)```/)
    if match:
      try:
        return JSON.parse(match[1])
      catch:
        pass

    // Re-prompt the model
    return RE_PROMPT("Your tool call JSON was malformed. Please try again with valid JSON.")
```

### Automatic Tier Detection

```
detectToolCallingTier(modelName):
  if modelName matches "qwen*2.5*" or "qwen*3*":
    return TIER_A  // hermes parser
  if modelName matches "llama*3.1*" or "llama*3.2*" or "llama*3.3*":
    return TIER_A  // llama3_json parser
  if modelName matches "mistral*" or "deepseek*" or "command-r*":
    return TIER_B  // model-specific parser, validate JSON
  return TIER_C    // prompt-based fallback
```

**See also:** [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md), [AGENT-STREAMING-TOOL-EXECUTION.md](AGENT-STREAMING-TOOL-EXECUTION.md), DreamServer's [TOOL-CALLING-SURVEY.md](TOOL-CALLING-SURVEY.md), [tool-calling-qwen.md](tool-calling-qwen.md), [tool-calling-llama.md](tool-calling-llama.md)

---

## 5. System Prompt Tuning for Small Models

### Model Size → Prompt Strategy

| Parameter | 70B+ | 13B-30B | 7B | <7B |
|-----------|------|---------|-----|-----|
| System prompt | Full (from doc 7) | Simplified | Minimal | Ultra-minimal |
| Safety rules | Complete | Condensed | Top 5 only | Top 3 only |
| Tool definitions | Full schemas | Simplified schemas | Name + description only | Name only + examples |
| Injection defense | Multi-section | Single section | One paragraph | None (not effective) |
| Memory integration | Full memdir | Condensed memories | Last 3 memories | None |
| Context intelligence | Query profiling, side queries | Basic categorization | None | None |

### Prompt Simplification Example

**Full prompt (70B+, ~15K tokens):**
```
You are an expert coding assistant. [500 words of identity]
[2000 words of safety rules]
[3000 words of tool definitions with schemas]
[1000 words of permission context]
[500 words of environment context]
[1000 words of project memory]
```

**Minimal prompt (7B, ~500 tokens):**
```
You are a coding assistant. You can use tools by responding with JSON.

Tools:
- file_read: Read a file. Input: {"path": "filepath"}
- bash: Run a command. Input: {"command": "cmd"}
- file_edit: Edit a file. Input: {"path": "filepath", "old": "text", "new": "text"}

When done, respond normally without tool JSON.
Current directory: /home/user/project
```

### Instruction Reinforcement for Small Models

Small models (<13B) lose track of system prompt instructions as conversations grow. Re-inject core rules:

```
shouldReinforceInstructions(modelSize, turnsSinceLastReinforcement):
  if modelSize >= 30B: return turnsSinceLastReinforcement > 20
  if modelSize >= 13B: return turnsSinceLastReinforcement > 10
  if modelSize >= 7B:  return turnsSinceLastReinforcement > 5
  return turnsSinceLastReinforcement > 2  // every other turn for tiny models

reinforcementMessage():
  return "Reminder: Use tool JSON format when you need to read/write files or run commands.
  When done with tools, respond to the user normally."
```

**See also:** [AGENT-SYSTEM-PROMPT-ENGINEERING.md](AGENT-SYSTEM-PROMPT-ENGINEERING.md), DreamServer's [LOCAL-AI-BEST-PRACTICES.md](LOCAL-AI-BEST-PRACTICES.md)

---

## 6. Authentication Simplification

### Cloud vs Local Auth

| Cloud | Local |
|-------|-------|
| OAuth + PKCE flow | API key in config or env var |
| Token refresh (hourly) | No refresh needed |
| Keychain integration | Simple file storage |
| Scope-based access | All-or-nothing (local = full access) |
| Subscription tiers | Hardware tiers (VRAM-based) |

### Local Auth Flow

```
authenticateLocal():
  // 1. Check environment variable
  key = env.LLM_API_KEY
  if key:
    return { method: "env", key }

  // 2. Check config file
  config = readConfig("~/.agent/config.json")
  if config.apiKey:
    return { method: "config", key: config.apiKey }

  // 3. No auth needed for most local servers
  if isLocalEndpoint(env.LLM_ENDPOINT):
    return { method: "none" }  // llama-server doesn't require auth by default

  error("No authentication configured")
```

### Service Discovery

Before the first API call, verify the LLM server is running:

```
discoverLLMService():
  endpoint = env.LLM_ENDPOINT or "http://localhost:8080/v1"

  // Health check
  try:
    response = GET "{endpoint}/../health"  // llama-server health endpoint
    if response.status == "ok":
      return { endpoint, healthy: true }
  catch:
    pass

  // Try LiteLLM
  try:
    response = GET "http://localhost:4000/health"
    if response.ok:
      return { endpoint: "http://localhost:4000/v1", healthy: true }
  catch:
    pass

  error("No LLM server found. Start DreamServer or configure LLM_ENDPOINT.")
```

**See also:** [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md)

---

## 7. Cost Model Inversion

### What to Track Instead of Dollars

| Cloud Metric | Local Replacement | Why |
|-------------|------------------|-----|
| $/input token | ms/token (time to first token) | Measures inference speed |
| $/output token | tokens/second (generation speed) | Measures throughput |
| $/session budget | GPU utilization % | Measures resource usage |
| Cache hit savings | KV cache reuse rate | Measures prompt efficiency |

### Session Metrics

```
LocalSessionMetrics:
  totalInferenceTimeMs: number      // time spent generating tokens
  totalTokensGenerated: number      // output tokens
  averageTokensPerSecond: number    // throughput
  modelLoadCount: number            // how many times model was swapped
  modelLoadTimeMs: number           // total time spent loading models
  peakVRAMUsageMB: number          // highest VRAM usage during session
  gpuUtilizationAvg: number        // average GPU utilization %
```

### Cost Display

Instead of "$0.47 this session," show:
```
Session: 12 turns | 3,400 tokens generated | 45 tok/s avg | 18.2 GB VRAM peak
```

**See also:** [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) §6

---

## 8. Model Registry and Switching

### The Problem

Cloud APIs handle model routing transparently. Locally, you manage model files, quantization variants, and VRAM allocation yourself.

### Model Registry

```
ModelRegistry:
  models: Map<modelName, ModelEntry>

ModelEntry:
  name: string              // "qwen3-8b"
  file: string              // "Qwen3-8B-Q4_K_M.gguf"
  quantization: string      // "Q4_K_M"
  sizeGB: number            // 4.5
  contextWindow: number     // 32768
  toolCallingTier: string   // "A", "B", or "C"
  toolCallParser: string    // "hermes", "llama3_json", or "prompt"
  vramRequired: number      // 5.2 (model + overhead)
```

DreamServer already has this in `config/llama-server/models.ini` and `config/backends/*.json`.

### Switching Protocol

```
switchModel(targetModel):
  entry = registry.get(targetModel)

  // 1. VRAM check
  if entry.vramRequired > availableVRAM():
    error("Model requires {entry.vramRequired}GB but only {available}GB available")

  // 2. Notify user
  notifyUser("Switching to {entry.name} ({entry.quantization}). This takes ~15 seconds...")

  // 3. Unload current model
  POST "{endpoint}/v1/models/unload"
  await waitForHealthy(timeout: 5000)

  // 4. Load new model
  POST "{endpoint}/v1/models/load" body: { model: entry.file }
  await waitForHealthy(timeout: 30000)

  // 5. Reconfigure agent
  updateContextWindow(entry.contextWindow)
  updateToolCallingTier(entry.toolCallingTier)
  recalculateTokenBudgets()

  notifyUser("Switched to {entry.name}. Ready.")
```

### Quantization Awareness

Same model at different quantizations:

| Quant | Size (8B model) | Quality | VRAM | Use When |
|-------|-----------------|---------|------|----------|
| Q4_K_M | 4.5 GB | Good | 5.2 GB | Default — best size/quality balance |
| Q5_K_M | 5.3 GB | Better | 6.0 GB | Have spare VRAM |
| Q6_K | 6.5 GB | Great | 7.2 GB | Quality-sensitive tasks |
| Q8_0 | 8.5 GB | Near-original | 9.2 GB | Maximum quality, 24GB+ GPU |

**Auto-selection:** If the requested model doesn't fit at the user's preferred quant, try smaller quants:
```
selectBestQuant(model, availableVRAM):
  for quant in [Q8_0, Q6_K, Q5_K_M, Q4_K_M, Q4_K_S, Q3_K_M]:
    variant = model + "-" + quant
    if registry.has(variant) and registry.get(variant).vramRequired <= availableVRAM:
      return variant
  return null  // no variant fits
```

**See also:** [AGENT-QUERY-LOOP-AND-STATE-MACHINE.md](AGENT-QUERY-LOOP-AND-STATE-MACHINE.md), [AGENT-FEATURE-DELIVERY.md](AGENT-FEATURE-DELIVERY.md), DreamServer's [HARDWARE-GUIDE.md](HARDWARE-GUIDE.md)

---

## 9. GPU Out-of-Memory Recovery

### The Problem

Cloud APIs never OOM. Local GPUs do — especially when context grows large (KV cache expands) or when running multiple services.

### Detection

| Symptom | Cause | Detection Method |
|---------|-------|-----------------|
| llama-server returns HTTP 500 | CUDA OOM during inference | Check response body for "out of memory" |
| llama-server crashes | Fatal OOM | Health check fails after request |
| Inference hangs then times out | Near-OOM, swapping to system RAM | Response time exceeds 3x normal |

### Recovery Strategy

```
onGPUOutOfMemory(error):
  // 1. Try reducing context (emergency compaction)
  if canCompact():
    compactResult = emergencyCompact(keepRecentTurns: 3)
    if compactResult.success:
      return RETRY

  // 2. Try smaller quantization of same model
  currentModel = getCurrentModel()
  smallerQuant = selectSmallerQuant(currentModel, currentVRAM * 0.8)
  if smallerQuant:
    await switchModel(smallerQuant)
    return RETRY

  // 3. Try a smaller model entirely
  smallerModel = selectSmallerModel(currentVRAM * 0.8)
  if smallerModel:
    await switchModel(smallerModel)
    return RETRY

  // 4. Report to user
  return TERMINAL("GPU out of memory. Try a smaller model or close other GPU applications.")
```

### Prevention: VRAM Headroom Check

Before each inference call, estimate VRAM needed:

```
checkVRAMHeadroom(contextTokens):
  modelSize = currentModel.sizeGB
  kvCacheSize = contextTokens * KV_CACHE_PER_TOKEN_MB / 1024  // convert to GB
  overhead = 0.5  // system overhead

  required = modelSize + kvCacheSize + overhead
  available = getAvailableVRAM()

  if required > available * 0.95:  // 95% threshold
    warn("VRAM near capacity ({required}GB / {available}GB). Consider compacting.")
    triggerProactiveCompaction()
```

**See also:** [AGENT-QUERY-LOOP-AND-STATE-MACHINE.md](AGENT-QUERY-LOOP-AND-STATE-MACHINE.md) §5 (add as 12th recovery transition)

---

## 10. DreamServer Integration

### Connecting the Agent to DreamServer's Stack

The agent architecture can plug into DreamServer as a service:

```
Agent connects to:
  llama-server → http://localhost:8080/v1     (LLM inference)
  LiteLLM      → http://localhost:4000/v1     (model routing, optional)
  embeddings   → http://localhost:8081/v1     (if RAG needed)
  dashboard-api → http://localhost:3002       (system status)
```

### As a DreamServer Extension

The agent could be packaged as a DreamServer extension:

```yaml
# extensions/services/agent/manifest.yaml
id: agent
name: "AI Coding Agent"
description: "Agentic coding tool powered by local LLMs"
port: 3010
health_endpoint: /health
container_name: dream-agent
depends_on:
  - llama-server
gpu_backends:
  - nvidia
  - amd
  - apple
  - cpu
```

### Leveraging Existing Services

| DreamServer Service | What Agent Can Use It For |
|--------------------|--------------------------|
| **llama-server** | Primary LLM inference |
| **LiteLLM** | Model routing, fallback chain |
| **embeddings** | RAG-based code search |
| **open-webui** | Alternative chat UI |
| **dashboard-api** | GPU monitoring, system status |
| **n8n** | Workflow automation integration |

### Environment Variables for DreamServer

```bash
# Set by DreamServer's Docker Compose
LLM_ENDPOINT=http://llama-server:8080/v1    # inside Docker
LLM_ENDPOINT=http://localhost:8080/v1        # from host

# Optional: LiteLLM for model routing
LITELLM_ENDPOINT=http://litellm:4000/v1

# GPU backend (detected by DreamServer installer)
GPU_BACKEND=nvidia  # or amd, apple, cpu

# Model config
DEFAULT_MODEL=qwen3-8b
MODEL_QUANT=Q4_K_M
```

---

## 11. Token Counting for Local Models

### The Problem

Each model family uses a different tokenizer. The character heuristic (~3.7 chars/token) from [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) §7 varies significantly:

| Model Family | Chars/Token | Heuristic Accuracy |
|-------------|------------|-------------------|
| Llama 2/3 | ~4.2 | 88% |
| Mistral | ~2.8 | 75% |
| Qwen | ~3.5 | 90% |
| Phi | ~3.8 | 92% |

### Solutions (Best to Simplest)

1. **Query the server:** `POST /v1/tokenize` (if supported) — exact count
2. **Use model-specific tokenizer:** Load the tokenizer for the current model — exact but heavy
3. **Per-family heuristic:** Use the table above with detected model family — ~85% accurate
4. **Universal heuristic:** 3.7 chars/token — ~80% accurate (current approach)

**Recommendation:** Use per-family heuristic (option 3) as default, upgrade to server tokenization (option 1) when available. The accuracy difference matters most for small context windows where 15% error means 1,200 tokens on an 8K window.

---

## 12. Implementation Checklist

### Minimum Viable Local Adaptation

- [ ] OpenAI SDK pointed at local endpoint (`openai` npm package)
- [ ] Streaming format adapter (OpenAI chunks → internal events)
- [ ] Tool calling format adapter (OpenAI function_call → internal tool calls)
- [ ] Service discovery (health check llama-server before first call)
- [ ] Context window detection from model metadata
- [ ] Adjusted compaction thresholds for small windows
- [ ] Simplified system prompt for <13B models
- [ ] Tool calling tier detection (A/B/C by model name)
- [ ] Prompt-based tool calling fallback for Tier C
- [ ] Malformed JSON recovery with re-prompt

### Production-Grade Local Deployment

- [ ] All of the above, plus:
- [ ] VRAM budget model (detect GPU, query VRAM, check model fit)
- [ ] Model registry with quantization variants
- [ ] Auto-quant selection (fit best quality in available VRAM)
- [ ] Model switching protocol (unload → load → health check → reconfigure)
- [ ] GPU OOM recovery (compact → smaller quant → smaller model → report)
- [ ] VRAM headroom check before each inference
- [ ] Per-model-family token counting heuristics
- [ ] Server tokenization when available (POST /tokenize)
- [ ] Instruction reinforcement for <13B models (every N turns)
- [ ] Local session metrics (inference time, tokens/second, VRAM peak)
- [ ] DreamServer extension packaging (manifest.yaml)
- [ ] LiteLLM integration for model routing
- [ ] Dynamic semaphore based on server's `parallel` setting
- [ ] Concurrent inference slot tracking

---

## Related Documents

### Agent Architecture (Cloud Patterns These Adapt)
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — API client this doc adapts
- [AGENT-STREAMING-TOOL-EXECUTION.md](AGENT-STREAMING-TOOL-EXECUTION.md) — Streaming format this doc translates
- [AGENT-QUERY-LOOP-AND-STATE-MACHINE.md](AGENT-QUERY-LOOP-AND-STATE-MACHINE.md) — Recovery paths this doc extends
- [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) — Token budgets this doc rescales
- [AGENT-CONTEXT-COMPACTION-ADVANCED.md](AGENT-CONTEXT-COMPACTION-ADVANCED.md) — Thresholds this doc adjusts
- [AGENT-SYSTEM-PROMPT-ENGINEERING.md](AGENT-SYSTEM-PROMPT-ENGINEERING.md) — Prompts this doc simplifies
- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — Auth this doc replaces
- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Tools this doc adds fallbacks for
- [AGENT-BUILD-AND-DEPENDENCIES.md](AGENT-BUILD-AND-DEPENDENCIES.md) — Dependencies this doc swaps
- [AGENT-ARCHITECTURE-OVERVIEW.md](AGENT-ARCHITECTURE-OVERVIEW.md) — The master blueprint this doc localizes

### DreamServer Research (Local AI Knowledge Base)
- [LOCAL-AI-BEST-PRACTICES.md](LOCAL-AI-BEST-PRACTICES.md) — Production lessons from local GPU deployments
- [TOOL-CALLING-SURVEY.md](TOOL-CALLING-SURVEY.md) — Tool calling across model families
- [tool-calling-qwen.md](tool-calling-qwen.md), [tool-calling-llama.md](tool-calling-llama.md), [tool-calling-mistral.md](tool-calling-mistral.md) — Per-model guides
- [HARDWARE-GUIDE.md](HARDWARE-GUIDE.md) — GPU selection and VRAM planning
- [M6-VRAM-MULTI-SERVICE-LIMITS.md](M6-VRAM-MULTI-SERVICE-LIMITS.md) — VRAM budgets for multi-service stacks
- [SINGLE-GPU-MULTI-SERVICE.md](SINGLE-GPU-MULTI-SERVICE.md) — Running multiple AI services on one GPU
