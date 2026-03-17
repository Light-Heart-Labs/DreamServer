# HVAC Grace Integration & Cascade Failure Risk Analysis

**Generated:** 2026-02-02  
**System Version:** Multi-Agent Portal Architecture  
**Analyst:** Automated Security Review

---

## 1. Architecture Overview

### 1.1 ASCII Component Diagram

\\\
                              EXTERNAL / CLOUD
--------------------------------------------------------------------------------
   SIP Trunk -----------------------> LiveKit Cloud
   (Phone Calls)    WebRTC/SIP       wss://grace-hvac-jtcdy0sb.livekit.cloud
                                              |
                                              | WebSocket + WebRTC
                                              | (persistent connection)
                                              v
--------------------------------------------------------------------------------
                         LOCAL SERVER (localhost)
--------------------------------------------------------------------------------
                                              |
      ----------------------------------------------------------------
      |            HVAC GRACE AGENT (hvac_agent.py)                  |
      |            Systemd: hvac-grace-agent.service                 |
      ----------------------------------------------------------------
      |                                                              |
      |  PortalAgent --> ServiceAgent --> PartsAgent --> Others...   |
      |   (routing)       (intake)         (parts)    (billing/etc)  |
      |                                                              |
      |  ------------------------------------------------------------  |
      |  |              CallData (In-Memory State)                 |  |
      |  | caller_name, caller_phone, caller_company, caller_site  |  |
      |  | transcript_lines[], audio_frames[]                      |  |
      |  | current_department, departments_visited[]               |  |
      |  ------------------------------------------------------------  |
      |                                                              |
      |  VAD (Silero)    Turn Detector     TTS Filter               |
      |  min_silence:    (Multilingual     (strips tool             |
      |     0.8s           Model)           call text)              |
      ----------------------------------------------------------------
             |                    |                    |
             | HTTP POST          | HTTP POST          | HTTP POST
             | (async, 30s TO)    | (async, 120s TO)   | (sync, 120s TO)
             v                    v                    v
      ---------------    ---------------    ---------------
      | vLLM Server |    | Whisper STT |    | TTS Server  |
      |  (Qwen 32B) |    | (faster-    |    |  (Kokoro)   |
      | Docker:8000 |    | whisper-v3) |    | Docker:8002 |
      ---------------    | Docker:8001 |    ---------------
                         ---------------
             |
             | (call end processing) HTTP POST (async, 10s timeout)
             v
      ----------------------------------------------------------------
      |                   n8n Workflow Engine                       |
      |                   Docker :5678 (n8n-prod)                   |
      |  Webhooks:                                                  |
      |    /webhook/ticket      -> Create ticket in PostgreSQL      |
      |    /webhook/call_record -> Store master call record         |
      ----------------------------------------------------------------
             |
             | SQL
             v
      ---------------
      | PostgreSQL  |
      | (tickets)   |
      ---------------
\\\

### 1.2 Component Dependency Map

| Connection | Protocol | Default Timeout | Retry Logic | Circuit Breaker |
|------------|----------|-----------------|-------------|-----------------|
| LiveKit Cloud -> Agent | WebSocket + WebRTC | Persistent | Auto-reconnect (LiveKit SDK) | No |
| Agent -> Whisper STT | HTTP POST | 120s (warmup), streaming | **NO** | **NO** |
| Agent -> LLM (Qwen) | HTTP POST | 30s | **NO** | **NO** |
| Agent -> TTS (Kokoro) | HTTP POST | N/A (streaming) | **NO** | **NO** |
| Agent -> n8n | HTTP POST | 10s | **NO** | **NO** |
| n8n -> PostgreSQL | SQL | n8n default | n8n internal | **NO** |
| Systemd -> Agent | Process mgmt | N/A | RestartSec=10, Restart=always | **NO** |

---

## 2. Cascade Failure Scenarios

### Scenario A: LLM Becomes Slow (2s -> 10s response time)

**Impact Analysis:**

| Component | Effect | Severity |
|-----------|--------|----------|
| Turn Detection | MultilingualModel continues independently | LOW |
| Agent Response | Delays 10s+ between caller speech and agent reply | **HIGH** |
| Audio Buffer | LiveKit SDK buffers incoming audio - no overflow | MEDIUM |
| Caller Experience | Unnatural pauses, likely hang-up after 2-3 delays | **CRITICAL** |
| Agent Recovery | Will resume normal when LLM speeds up | LOW |

**Current Behavior:**
- NO timeout configured - uses library default
- NO streaming-first fallback
- NO " please hold\ filler during slow responses
- NO detection of degraded LLM performance

**Cascade Path:**
1. LLM slows down (10s responses)
2. Agent appears unresponsive during generation
3. Turn detector fires (caller assumed done)
4. Agent may interrupt with partial response
5. Caller frustrated, hangs up
6. Call too short -> ticket skipped

---

### Scenario B: Whisper Crashes Mid-Call

**Impact Analysis:**

| Component | Effect | Severity |
|-----------|--------|----------|
| STT Processing | stt.StreamAdapter throws exception | **HIGH** |
| Agent Session | Depends on exception handling in LiveKit SDK | **UNKNOWN** |
| LiveKit Connection | May stay alive (separate from STT) | MEDIUM |
| Transcript Capture | Real-time capture stops | **HIGH** |
| Graceful End | Not implemented - no fallback | **CRITICAL** |

**MISSING PROTECTIONS:**
- No STT health monitoring
- No fallback STT provider
- No graceful \Im having trouble hearing you" message
- No automatic call termination with apology

---

### Scenario C: n8n Webhook Times Out

**Impact Analysis:**

| Component | Effect | Severity |
|-----------|--------|----------|
| Ticket Creation | 10s timeout -> ticket lost | **CRITICAL** |
| Call Processing | post_to_n8n() returns False, logs error | MEDIUM |
| Caller Experience | None (happens after call ends) | LOW |
| Data Loss | Ticket data lost, transcript available locally | **HIGH** |
| Call Quality | Not affected (post-call processing) | LOW |

**MISSING PROTECTIONS:**
- No retry with exponential backoff
- No dead letter queue for failed tickets
- No local persistence of failed submissions
- No alerting on repeated failures

---

### Scenario D: Multiple Services Degrade Simultaneously

**Combined Scenario:** LLM slow (5s) + STT flaky (30% packet loss) + High call volume

**Cascade Path:**
1. Multiple calls arrive simultaneously
2. GPU saturated -> LLM slow
3. Whisper queue backs up -> partial transcripts
4. VAD fires on silence (STT gap)
5. Agent responds to incomplete speech
6. Caller clarifies -> more load
7. **Feedback loop of degradation**

**MISSING PROTECTIONS:**
- No load shedding / call queue
- No "high volume, please call back" mode
- No resource monitoring
- No graceful degradation

---

## 3. State Consistency Risks

### 3.1 Agent Crash Mid-Ticket-Creation

| Data Type | State | Recovery |
|-----------|-------|----------|
| CallData (in-memory) | Lost | None |
| Transcript lines | Lost | Audio file may exist |
| Audio file | May be saved | Check recordings/ dir |
| Ticket in n8n | Not created | Lost |
| Master call record | Not created | Lost |

**MISSING PROTECTIONS:**
- No transaction/checkpoint system
- No local persistence before cloud submission
- No recovery process for orphaned audio files

### 3.2 Two Agents Handle Same Call (Reconnect Scenario)

| Aspect | Risk | Severity |
|--------|------|----------|
| Duplicate tickets | Both agents may submit | **HIGH** |
| State conflict | Two CallData objects | **MEDIUM** |
| Transcript gaps | Each has partial transcript | **HIGH** |

**MISSING PROTECTIONS:**
- No room-based state persistence (Redis/database)
- No duplicate detection (idempotency)
- No distributed lock on room_name

---

## 4. Risk Matrix

| Risk | Likelihood | Impact | Score | Priority |
|------|------------|--------|-------|----------|
| LLM slow -> caller hang-up | HIGH | HIGH | **9** | P1 |
| n8n timeout -> ticket lost | MEDIUM | CRITICAL | **8** | P1 |
| Whisper crash -> call fails | LOW | CRITICAL | **6** | P2 |
| Multi-service degradation | LOW | CRITICAL | **6** | P2 |
| Agent crash mid-ticket | LOW | HIGH | **4** | P3 |
| Duplicate tickets (reconnect) | LOW | MEDIUM | **3** | P3 |
| CallData race condition | VERY LOW | MEDIUM | **2** | P4 |

**Scoring:** Likelihood (1-3) x Impact (1-3)

---

## 5. Recovery Procedures

### 5.1 LLM Degradation

| Aspect | Current | Recommended |
|--------|---------|-------------|
| Detection | None | Monitor response time, queue depth |
| Recovery | Manual restart | Auto-fallback to smaller model or cloud LLM |
| Data Loss | Conversation quality | None |
| User Impact | Poor experience, hang-ups | "Please hold" message |

### 5.2 Whisper Crash

| Aspect | Current | Recommended |
|--------|---------|-------------|
| Detection | None (exception logged) | Docker health check + agent probe |
| Recovery | Systemd restarts Docker | Graceful call termination + restart |
| Data Loss | Partial transcript | Use audio recording for recovery |
| User Impact | Call may drop | "Im having trouble please call back\ |

### 5.3 n8n Ticket Failure

| Aspect | Current | Recommended |
|--------|---------|-------------|
| Detection | Log message only | Alert + metrics |
| Recovery | None - data lost | Retry queue + local backup |
| Data Loss | Full ticket | None with proper queue |

---

## 6. Recommended Circuit Breakers

### 6.1 LLM Circuit Breaker
- Failure threshold: 3
- Recovery timeout: 30s
- Fallback: Cloud LLM or shorter responses

### 6.2 STT Health Gate
- Check interval: 30s
- Pre-call validation
- Graceful degradation message

### 6.3 Ticket Submission Queue
- Max queue: 100 tickets
- Retry with exponential backoff
- Disk backup on queue full

---

## 7. Recommended Health Checks

### 7.1 Service Health Endpoints

| Service | Endpoint | Check Interval | Alert Threshold |
|---------|----------|----------------|-----------------|
| Whisper | GET :8001/health | 30s | 2 failures |
| vLLM | GET :8000/health | 30s | 2 failures |
| TTS | GET :8002/health | 30s | 2 failures |
| n8n | GET :5678/healthz | 60s | 3 failures |

### 7.2 Agent Internal Metrics

| Metric | Normal | Warning | Critical |
|--------|--------|---------|----------|
| LLM response time | <2s | 2-5s | >5s |
| STT latency | <500ms | 500ms-1s | >1s |
| Active calls | <10 | 10-20 | >20 |
| Failed tickets/hour | 0 | 1-3 | >3 |

---

## 8. Recommended Alerting

### 8.1 Alert Rules

| Condition | Severity | Action |
|-----------|----------|--------|
| Whisper down >1m | P1 | Page on-call, stop accepting calls |
| vLLM down >1m | P1 | Page on-call, stop accepting calls |
| n8n down >5m | P2 | Alert team, enable local backup |
| Failed tickets >3/hr | P2 | Alert team, investigate |
| LLM latency >5s for 5m | P2 | Alert team, check GPU |
| Agent restart loop | P1 | Page on-call |

---

## 9. Summary of Recommendations

### Immediate Actions (This Week)

1. **Add n8n retry + local backup** - Prevent ticket loss
2. **Add LLM timeout (5s)** - Prevent stuck calls
3. **Add Whisper health check on startup** - Fail fast if STT down
4. **Create failed_tickets directory and recovery script**

### Short-term (This Month)

5. **Implement health monitoring service**
6. **Add alerting integration** (Slack/SMS)
7. **Add \please hold\ filler messages**
8. **Add circuit breakers**

### Medium-term (Next Quarter)

9. **Add fallback LLM** (cloud or smaller model)
10. **Add state persistence** (Redis)
11. **Add idempotency keys**
12. **Add load shedding**

---

## Appendix: Current Service Status

\\\
vllm-qwen32b Up 22 hours 0.0.0.0:8000->8000/tcp
whisper-server Up 7 days 0.0.0.0:8001->8000/tcp
tts-server Up 7 days 0.0.0.0:8002->8880/tcp
n8n-prod Up 7 days 0.0.0.0:5678->5678/tcp

hvac-grace-agent.service active (running) RestartSec=10
hvac-token.service active (running)
\\\

**Note:** Recent agent log shows AssertionError during shutdown - investigate clean shutdown procedure.
