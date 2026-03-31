# Agent LLM API Integration

Best practices for integrating with LLM APIs in autonomous agent systems — streaming, retry logic, model selection, rate limiting, fallback chains, and cost tracking. Derived from production analysis of agentic systems making millions of API calls daily with high reliability and cost awareness.

*Last updated: 2026-03-31*

---

## Why This Matters

The LLM API call is the heartbeat of an agentic system. Every decision, every tool call, every response flows through it. A single retry bug can burn thousands of dollars. A missing timeout can hang the entire session. A bad model selection can make the agent useless or prohibitively expensive.

Production systems treat API integration as critical infrastructure — instrumented, resilient, and cost-aware.

---

## 1. Streaming vs Non-Streaming

### When to Stream

| Scenario | Approach | Why |
|----------|----------|-----|
| Interactive user session | **Stream** | User sees progress, doesn't think it's frozen |
| Background worker task | Either | No user watching; non-streaming is simpler |
| Tool-heavy turns | **Stream** | Tool calls arrive as they're generated, enabling parallel execution |
| Short responses | Non-streaming OK | Overhead of streaming not worth it for small payloads |

### Streaming Implementation

```
streamResponse(messages, tools):
  stream = api.createStream({
    model: selectedModel,
    messages: messages,
    tools: tools,
    stream: true
  })

  fullResponse = ""
  toolCalls = []

  for chunk in stream:
    if chunk.type == "content_delta":
      fullResponse += chunk.text
      displayToUser(chunk.text)  // incremental display

    elif chunk.type == "tool_use_start":
      toolCalls.push({ id: chunk.id, name: chunk.name, input: "" })

    elif chunk.type == "tool_use_delta":
      toolCalls[current].input += chunk.partial_json

    elif chunk.type == "message_stop":
      break

  return { content: fullResponse, toolCalls }
```

### Stream Error Handling

Streams can fail mid-response. Handle gracefully:

| Failure | Recovery |
|---------|----------|
| Stream disconnects mid-content | Keep partial content, retry from last position if API supports it; otherwise discard and retry full |
| Stream disconnects mid-tool-call | Discard incomplete tool call, retry the full turn |
| Stream hangs (no data for N seconds) | Abort stream, retry with timeout |
| Rate limit mid-stream | Back off, retry full turn |

---

## 2. Retry Logic

### Retryable vs Non-Retryable Errors

| Error | Retryable | Action |
|-------|-----------|--------|
| 429 Rate Limited | Yes | Back off using Retry-After header |
| 500 Internal Server Error | Yes | Back off with exponential delay |
| 502/503 Service Unavailable | Yes | Back off, likely transient |
| 408 Request Timeout | Yes | Retry immediately or with short delay |
| 400 Bad Request | **No** | Fix the request (malformed input) |
| 401 Unauthorized | **No** | Refresh token, then retry once |
| 403 Forbidden | **No** | Escalate to user |
| 404 Not Found | **No** | Wrong endpoint, fix configuration |

### Exponential Backoff with Jitter

```
retry(request, maxAttempts = 3):
  for attempt in 1..maxAttempts:
    try:
      response = makeRequest(request)
      return response

    catch error:
      if not isRetryable(error):
        throw error

      if attempt == maxAttempts:
        throw error

      // Exponential backoff: 1s, 2s, 4s, 8s...
      baseDelay = min(2^(attempt-1) * 1000, 30000)  // cap at 30s

      // Add jitter to prevent thundering herd
      jitter = random(0, baseDelay * 0.5)
      delay = baseDelay + jitter

      // Respect Retry-After header if present
      if error.headers["retry-after"]:
        delay = max(delay, parseRetryAfter(error.headers["retry-after"]))

      sleep(delay)
```

### Retry-After Header

APIs often include a `Retry-After` header telling you exactly when to retry:

| Format | Example | Interpretation |
|--------|---------|---------------|
| Seconds | `Retry-After: 30` | Wait 30 seconds |
| Date | `Retry-After: Tue, 31 Mar 2026 12:05:00 GMT` | Wait until that time |

**Always respect Retry-After when present.** It's more accurate than your exponential backoff calculation.

---

## 3. Model Selection

### Model Tiers

Production systems use multiple models for different tasks:

| Tier | Model Class | Use Case | Cost |
|------|------------|----------|------|
| **High** | Largest/smartest (e.g., Opus-class) | Complex reasoning, architecture decisions, debugging | $$$ |
| **Medium** | Balanced (e.g., Sonnet-class) | Code generation, file editing, standard tasks | $$ |
| **Low** | Fast/cheap (e.g., Haiku-class) | Summarization, classification, simple transforms | $ |

### Automatic Model Selection

Route requests to the appropriate tier based on task complexity:

```
selectModel(taskContext):
  if taskContext.isPlanning or taskContext.isArchitectural:
    return HIGH_TIER

  if taskContext.isSimpleEdit or taskContext.isSearchOnly:
    return LOW_TIER

  return MEDIUM_TIER  // default
```

### Model Fallback Chain

When the primary model is unavailable:

```
callWithFallback(request):
  models = [PRIMARY_MODEL, FALLBACK_MODEL_1, FALLBACK_MODEL_2]

  for model in models:
    try:
      return callApi(request, model)
    catch error:
      if isModelUnavailable(error):
        log("Model {model} unavailable, trying next")
        continue
      throw error  // non-availability errors don't trigger fallback

  throw AllModelsUnavailableError()
```

**Important:** Fallback to a less capable model may change behavior. Log the actual model used so users and telemetry know.

### Model Migration

When upgrading to a new model version:

```
modelMigration:
  old: "model-v4.5"
  new: "model-v4.6"
  strategy: gradual  // not instant

  // Phase 1: 10% of sessions use new model
  // Phase 2: 50% after monitoring
  // Phase 3: 100% after confidence
  // Rollback: revert to old at any phase
```

---

## 4. Rate Limit Management

### Understanding Rate Limits

Most LLM APIs enforce multiple limits simultaneously:

| Limit Type | Unit | Example |
|-----------|------|---------|
| Requests per minute (RPM) | API calls | 60 RPM |
| Tokens per minute (TPM) | Input + output tokens | 100,000 TPM |
| Tokens per day (TPD) | Cumulative daily tokens | 5,000,000 TPD |
| Concurrent requests | Simultaneous connections | 5 concurrent |

### Client-Side Rate Tracking

Don't wait for 429 errors. Track usage proactively:

```
RateLimiter:
  requestsThisMinute: 0
  tokensThisMinute: 0
  minuteStartTime: now()

  canMakeRequest(estimatedTokens):
    resetIfMinuteElapsed()

    if requestsThisMinute >= RPM_LIMIT * 0.9:  // 90% threshold
      return WAIT

    if tokensThisMinute + estimatedTokens >= TPM_LIMIT * 0.9:
      return WAIT

    return OK

  recordRequest(actualTokens):
    requestsThisMinute += 1
    tokensThisMinute += actualTokens
```

### Rate Limit Messaging

When rate limited, inform the user clearly:

```
displayRateLimitMessage(retryAfter, limitType):
  if limitType == "RPM":
    show("Rate limited — too many requests. Retrying in {retryAfter}s...")
  elif limitType == "TPM":
    show("Token limit reached for this minute. Waiting {retryAfter}s...")
  elif limitType == "TPD":
    show("Daily token limit reached. Consider upgrading your plan.")
```

### Multi-Agent Rate Coordination

When running multiple workers, share rate limit state:

```
SharedRateLimiter:
  // All workers check the same counter before making API calls
  // Prevents N workers from independently hitting the limit
  acquireSlot(estimatedTokens):
    lock()
    if canMakeRequest(estimatedTokens):
      reserve(estimatedTokens)
      unlock()
      return OK
    else:
      unlock()
      return WAIT(timeUntilAvailable())
```

---

## 5. Request Construction

### Message Format

```
request:
  model: "selected-model"
  system: systemPrompt          // system instructions
  messages: conversationHistory  // user/assistant/tool messages
  tools: availableTools          // tool definitions with schemas
  max_tokens: outputBudget       // max response length
  temperature: 0                 // deterministic for code tasks
  stream: true
  metadata:
    session_id: "abc-123"        // for tracking
```

### Temperature Settings

| Task Type | Temperature | Why |
|-----------|------------|-----|
| Code generation | 0.0 | Deterministic, reproducible |
| Code review | 0.0 | Consistent analysis |
| Creative writing | 0.5-0.8 | Variety desired |
| Brainstorming | 0.8-1.0 | Maximum creativity |
| Tool selection | 0.0 | Reliable tool usage |

### Max Tokens Strategy

```
calculateMaxTokens(contextUsed, contextWindow):
  available = contextWindow - contextUsed
  // Reserve some space for the response but don't over-allocate
  // Over-allocation wastes money; under-allocation truncates output
  return min(available, MAX_RESPONSE_SIZE)  // e.g., cap at 16K
```

---

## 6. Cost Tracking

### Per-Request Cost Calculation

```
calculateCost(request, response):
  inputTokens = response.usage.input_tokens
  outputTokens = response.usage.output_tokens
  cacheHitTokens = response.usage.cache_read_tokens or 0

  model = request.model
  pricing = MODEL_PRICING[model]

  inputCost = (inputTokens - cacheHitTokens) * pricing.input_per_token
  cacheCost = cacheHitTokens * pricing.cache_per_token
  outputCost = outputTokens * pricing.output_per_token

  return inputCost + cacheCost + outputCost
```

### Session Cost Tracking

```
SessionCostTracker:
  totalInputTokens: 0
  totalOutputTokens: 0
  totalCacheHitTokens: 0
  totalCost: 0.0
  costByModel: {}      // per-model breakdown
  costByTool: {}       // which tools drive the most cost

  record(request, response):
    cost = calculateCost(request, response)
    totalCost += cost
    costByModel[request.model] = (costByModel[request.model] or 0) + cost

    // Attribute cost to the tool that triggered this turn
    if request.triggeredByTool:
      costByTool[request.triggeredByTool] += cost
```

### Budget Limits

```
BudgetEnforcement:
  sessionBudget: 5.00     // $5 per session
  warningThreshold: 0.80  // warn at 80%

  checkBudget(additionalCost):
    projected = totalCost + additionalCost
    if projected > sessionBudget:
      return DENY("Session budget exceeded (${totalCost}/${sessionBudget})")
    elif projected > sessionBudget * warningThreshold:
      return WARN("Approaching session budget: ${totalCost}/${sessionBudget}")
    return OK
```

---

## 7. Event Batching for Telemetry

### The Problem

Sending a telemetry event for every API call creates overhead and can fail under poor network conditions.

### Batch Architecture

```
EventBatcher:
  queue: []
  maxBatchSize: 50           // events per batch
  maxBatchBytes: 1_000_000   // 1MB per batch
  flushInterval: 30_000      // 30 seconds
  maxQueueSize: 1000         // backpressure limit

  enqueue(event):
    if queue.length >= maxQueueSize:
      dropOldest()           // or block, depending on policy

    queue.push(event)

    if shouldFlush():
      flush()

  shouldFlush():
    return queue.length >= maxBatchSize
        or totalBytes(queue) >= maxBatchBytes

  flush():
    batch = queue.splice(0, maxBatchSize)
    sendBatch(batch)         // with retry logic
```

### Retry with Backoff for Batches

```
sendBatch(batch, attempt = 1):
  try:
    post("/telemetry/events", batch)
  catch error:
    if attempt > MAX_RETRIES:
      onBatchDropped(batch)  // callback for monitoring
      return

    delay = min(2^attempt * 1000, 30000)
    jitter = random(0, delay * 0.3)

    // Respect Retry-After
    if error.retryAfter:
      delay = max(delay, error.retryAfter * 1000)

    sleep(delay + jitter)
    sendBatch(batch, attempt + 1)
```

### Fail-Open Design

Telemetry should never block the agent:

```
// WRONG: Agent stops if telemetry fails
await sendTelemetry(event)  // blocks agent on network failure

// RIGHT: Fire and forget with async retry
telemetryBatcher.enqueue(event)  // returns immediately
```

---

## 8. Implementation Checklist

### Minimum Viable API Integration

- [ ] Streaming support for interactive sessions
- [ ] Retry with exponential backoff (3 attempts)
- [ ] Respect Retry-After headers
- [ ] Retryable vs non-retryable error classification
- [ ] Token counting (at least from API response headers)
- [ ] Temperature 0 for code tasks
- [ ] Max tokens calculation based on remaining context

### Production-Grade API Integration

- [ ] All of the above, plus:
- [ ] Model tier selection (high/medium/low by task)
- [ ] Model fallback chain
- [ ] Client-side rate tracking (don't wait for 429s)
- [ ] Multi-agent shared rate limiter
- [ ] Per-request cost calculation with cache awareness
- [ ] Session cost tracking with budget enforcement
- [ ] Cost attribution by model and tool
- [ ] Event batching for telemetry (byte-aware, with backoff)
- [ ] Fail-open telemetry (never blocks agent)
- [ ] Stream error recovery (mid-stream disconnect handling)
- [ ] Model migration with gradual rollout
- [ ] Rate limit user messaging
- [ ] Request metadata (session ID, prompt version) for tracing

---

## Related Documents

- [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) — Context management that determines input token count
- [AGENT-SYSTEM-PROMPT-ENGINEERING.md](AGENT-SYSTEM-PROMPT-ENGINEERING.md) — System prompt that consumes context and prompt cache
- [AGENT-BOOTSTRAP-AND-CONFIGURATION.md](AGENT-BOOTSTRAP-AND-CONFIGURATION.md) — Configuration of model selection, API keys, rate limits
- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — Authentication for API access
- [AGENT-COORDINATION-PATTERNS.md](AGENT-COORDINATION-PATTERNS.md) — Multi-agent rate limit coordination
