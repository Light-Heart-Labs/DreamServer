# PROJECTS.md — The Collective Work Board

Last updated: 2026-02-15 08:55 EST by 16 — Gateway instability, TimescaleDB deployment blocked

## How This Works

- **Anyone can add** projects to Backlog
- **Anyone can claim** unclaimed work
- **Update status** when you start/finish
- **Cross-pollinate** — share discoveries within 1 hour
- **Reference MISSIONS.md** — every project should connect to a north star

### Status Key
- `[ ]` — Not started
- `[~]` — In progress  
- `[x]` — Complete
- `[!]` — Blocked (add note why)

---

**2026-02-16 09:25 EST Update (16)**: Token Spy load test completed with expanded scenario (150 users, 20 multi-turn, edge cases). Total: 925 requests, 25.4% success rate. Health endpoints 100% healthy; API endpoints show high failure rate (74.6%) requiring investigation.

---

## 🔥 Active Work

| Owner | Project | Status | Notes | Mission |
|-------|---------|--------|-------|---------|
| @16 | **Dream Server Mode Switch** | [x] | **COMPLETE** — Docker compose auto-detect, model path auto-detect, -y flag. Deployed to .143 | M1 → M5 |
| @16 | **M4 Deterministic Voice Agent** | [x] | **COMPLETE** — before_llm registration, intent-to-flow mapping. LLM reduction 60-80% | M4 → M5 |
| @16 | **Token Spy Load Test Expansion** | [x] | **COMPLETE** — Test completed: 925 requests, 25.4% success rate. Health: 100%, API endpoints: 74.6% fail rate. Investigating API auth/configuration issues. | M8/M12 |

### ⚠️ Recent Gateway Issues (2026-02-15 08:55 EST)

**Connection errors** observed from multiple agents:
- Todd: ~08:28 EST - Connection drops
- Android-17: ~08:28 EST - Connection drops
- 16: Gateway `pairing required` error, multiple gateway processes detected

**Root cause:** Hot work on production portal (.122) instead of dev server (.143) caused gateway instability.

**Corrective action:**
- All non-essential work paused until gateway restarts cleanly
- TimescaleDB deployment (17) to resume on `.143` dev server once gateway stable
- Guardian.sh to be updated to prevent production server hot work in future

### ⚠️ Blocked Items (Need Michael)

| Project | Blocked On | Notes |
|---------|------------|-------|
| **Gateway pairing issue** | System restart needed | Multiple gateway processes causing instability; needs clean restart |
| **Privacy Shield ghcr.io push** | GitHub PAT | Needs PAT with `packages:write` scope for container registry push |

---

_This file lives in Android-Labs and syncs across both machines. Reference: MISSIONS.md contains the 9 north star priorities._

### Recent Progress (02:12 EST) — **Latest Checkpoint**
| Owner | Project | Status | Notes |
|-------|---------|--------|-------|
| @16 | Dream Server Mode Switch | ✅ Complete | All 3 config gaps resolved. Deployed to .143 (`3a0ec7f`, `498667d`) |
| @16 | Token Spy→Dream Server Integration | [~] | **CLAIMED** — Bundling Token Spy as observability layer in Dream Server stack |
| @16 | Token Spy Load Test Expansion | [~] | **CLAIMED** — TimescaleDB migration complete, ready for 275+ request validation |
| @17 | Token Spy TimescaleDB | ✅ Complete | TimescaleDB extension enabled, `requests` table is hypertable, API/dashboard healthy on .143 |

## 📋 Backlog (Zero-Cost Work for Android-16)

| Project | Priority | Owner | Mission | Status |
|---------|----------|-------|---------|--------|
| **Post-migration Token Spy Load Test** | P1 | **16** | M8/M12 — Test completed 2026-02-16: 925 requests, 25.4% success rate. Health endpoints 100% healthy, API endpoints 74.6% fail rate. Investigating auth/config issues. | [x] |
| **Token Spy Load Test Expansion** | P1 | 16 | M8 — ✅ COMPLETE — Found concurrency bottleneck: writes fail under load (49% error rate). Bug fix applied. Results in `token-spy/LOAD-TEST-RESULTS-2026-02-15.md` | [x] |
| **Windows M5 Troubleshooting Guide** | P2 | 16 | M5/M6 — ✅ COMPLETE — Comprehensive Windows troubleshooting for non-technical users. Docs: `dream-server/docs/WINDOWS-TROUBLESHOOTING-GUIDE.md` | [x] |
| **Token Spy Concurrency Fix** | P1 | 16 | M12 — ✅ COMPLETE — Root cause identified (SQLite locking). Fix: TimescaleDB migration. Docs: `token-spy/CONCURRENCY-FIX-ANALYSIS.md` | [x] |
| **Token Spy TimescaleDB Post-Migration Validation** | P1 | **16** | M8/M12 — **CLAIMED** — Re-run 275+ request load test to verify TimescaleDB concurrency fix | [~] **CLAIMED** |

| Project | Priority | Owner | Mission | Status |
|---------|----------|-------|---------|--------|
| **Token Spy Phase 1: Provider Plugin System** | P1 | 17 | M12 — ✅ COMPLETE — Configuration-driven providers, 7 pre-configured, YAML-based extensibility | [x] |
| **Token Spy Phase 1: TimescaleDB Migration** | P1 | 17 | M12 — ✅ COMPLETE — TimescaleDB extension enabled, `requests` table converted to hypertable | [x] |
| **Token Spy Phase 1: Multi-Tenancy Architecture** | P1 | 17 | M12 — ✅ COMPLETE — Tenant isolation, API keys, RBAC, plan tiers | [x] |
| **Token Spy → Dream Server Integration** | P1 | **17** | M12 → M5 — Bundle Token Spy as observability layer in Dream Server stack | [x] **COMPLETE** — TimescaleDB migration complete, bundled in stack |

---

## Recent Progress (01:57 EST) — **Latest Checkpoint**
| Owner | Project | Status | Notes |
|-------|---------|--------|-------|
| @16 | Dream Server Mode Switch | ✅ Complete | All 3 config gaps fixed: docker compose auto-detect, model path auto-detect, -y flag. Deployed to .143 (`3a0ec7f`, `498667d`) |
| @16 | Token Spy→Dream Server Integration | [~] | **Active** — TimescaleDB ready, proceeding with integration |
| @17 | Token Spy TimescaleDB | ✅ Complete | TimescaleDB extension enabled, requests table is hypertable, all services healthy | [x] |

### Completed This Session (01:42 EST)
| Owner | Project | Status | Notes |
|-------|---------|--------|-------|
| @16 | Dream Server Mode Switch | ✅ Complete | All 3 config gaps resolved. Deployed to .143 (`ed79b01`) |

### Completed Today (2026-02-14)
| @Both | M5 Stranger Test Fixes | [x] | 4 P0 blockers cleared: Docker/GPU checks, hardcoded IP, TTS port, preflight script | M5 |
| @17 | M5 Stranger Test Analysis | [x] | `research/M5-STRANGER-TEST-RESULTS.md` — full friction point audit | M5 |

### Completed This Session (2026-02-09 ~21:04-21:10 UTC)
| @Todd | M5 Launch Readiness | [x] | `LAUNCH-READY.md` — distribution options, marketing copy, one-pager | M5 |
| @Todd | Stranger Test | [x] | `STRANGER-TEST-FINDINGS.md` — friction points, QUICKSTART fix | M5 |
| @Todd | Standalone README | [x] | `README-STANDALONE.md` + `CONTRIBUTING.md` for separate repo | M5 |

### Earlier This Session (2026-02-09 ~20:45-21:00 UTC)
| @Todd | M1 Real Config Analysis | [x] | Added live config analysis to M1 doc | M1 |
| @Todd | M5 Dream Server Validation | [x] | Fixed bugs: duplicate embeddings, TTS mismatch, hermes template | M5 |
| @Todd | M5 dream-cli | [x] | CLI tool for Dream Server: status, logs, restart, chat, benchmark | M5 |
| @Todd | M9 Model Landscape Research | [x] | Sub-agent researched GLM-4.7, DeepSeek V3.2, Qwen3-235B | M9 |
| @17 | **M3 Privacy Shield COMPLETE** | [x] | Full Presidio integration: `products/privacy-shield/` — actual PII filtering | M3 |
| @17 | **M8 Stress Test Harness** | [x] | `tools/stress-test/` — harness.py + cluster_check.py | M8 |
| @17 | **M3 Privacy Shield MVP** | [x] | Code complete: `products/privacy-shield/` (Dockerfile, proxy.py, README) | M3 |
| @Todd | Cookbook Validation (01,02,08) | [x] | Fixed model names, ports for cluster | M5, M7, M9 |
| @17 | M4 FSM executor | [x] | Complete with flows + integration tests | M4, M6 |
| @17 | M4 Intent Classifier Bridge | [x] | DistilBERT wrapper + keyword fallback | M4, M6 |
| @17 | M4 Integration Tests | [x] | 4/4 passing (keyword fallback mode) | M4, M6 |
| @17 | M4 Latency Benchmarks | [x] | Todd's thresholds wired in, all tests pass | M4, M8 |
| @17 | M8 Stress Scenarios | [x] | 17 test cases: multi-turn, interrupts, pauses, edge cases | M8 |

---

## 📋 Backlog (Coordination Update by Todd, 2026-02-15)

### 🎯 Current Division of Labor

| Agent | Primary Role | Work Type | Why This Allocation |
|-------|-------------|-----------|---------------------|
| **Android-16** 🌿 | Heavy Executor | All coding, testing, experiments, docs | Zero cost = unlimited iteration. 128K context. 65K output. 100% tool-calling success. Sub-agent swarms. |
| **Android-17** | Architect & Reviewer | Code review, design decisions, complex debugging | K2.5 frontier reasoning for quality gates. Reviews keep main stable. |
| **Todd** | Integration Tester | E2E validation, Docker testing, parallel building | K2.5 for multi-system reasoning. Validates what 16 builds. Second builder for throughput. |
| **Android-18** | Ops Controller | Situation reports, punch lists, monitoring | Keeps everyone informed. Opus 4.6 audits drive priorities. |

### M1 Zero-Cloud Testing — CLAIMED by Android-16
**Mission:** M1 (Fully Local OpenClaw)  
**Goal:** Prove >90% tool-calling success on local Qwen with REAL workflows  
**Deliverable:** `research/M1-ZERO-CLOUD-AGENT-TEST.md`

**Test Spec (for 16):**
1. SSH to .143, verify Qwen3-Coder-Next 80B on port 8000
2. `dream-server mode local` — activate offline profile  
3. Execute 20+ multi-step agent workflows:
   - File operations (read/write/edit via sessions_spawn)
   - Web search (SearXNG local endpoint)
   - Code generation + execution
   - Multi-turn conversations with tool calling
   - Concurrent agent scenarios (2-3 parallel)
4. Measure and document:
   - Tool-calling success rate (target: >90%)
   - VRAM usage peaks during tests
   - Failure patterns (which tools fail, why)
   - Response quality vs cloud baseline
5. Output format: markdown table of test cases + results summary

**Why this matters:** M1 is Michael's core democratization mission. Research docs exist — now we need validation data proving local AI works for real workloads.

### Token Spy Phase 1 — Ready for 17
**Mission:** M12 (Token Spy Product)  
**Components:**
- [ ] Provider plugin system (generalize Anthropic + OpenAI handlers)
- [ ] PostgreSQL + TimescaleDB migration
- [ ] Multi-tenancy with tenant isolation

**Next step:** 17 to architect provider plugin interface, then 16 can benchmark implementations.

### Blockers
**None** — M10 (security) and M11 (updates) were release blockers, both ✅ complete.

---

## Multi-Phase: Token Spy (Product) (M12)

**Priority:** Critical (Michael's go-to-market focus)
**Mission:** M12 (Token Spy)
**Owner:** @Todd (Phase 1 Foundation), @17 (Phase 2 Analytics Dashboard)
**Status:** Active — split parallel work started
**Full Scope:** `research/TOKEN-MONITOR-PRODUCT-SCOPE.md`

Transform the existing personal token monitoring tool into a commercial product: a **transparent API proxy** that captures per-request token usage, cost, and session health metrics with **zero code changes** to downstream applications.

### Core Value Prop
"See everything your AI spends. Change nothing in your code." Differentiated from Helicone/Portkey (require base URL changes) and LangSmith/Langfuse (require SDK instrumentation). Session-aware intelligence + prompt cost attribution (no competitor has this).

### Phase 1: Foundation (Weeks 1–6)
- [ ] Provider plugin system (generalize Anthropic + OpenAI handlers)
- [ ] Multi-tenancy & auth (proxy API keys, tenant isolation)
- [ ] PostgreSQL + TimescaleDB migration (replace SQLite)
- [ ] Docker Compose self-hosted deployment
- **Deliverable:** Self-hostable stack, 15-min deploy, any OpenAI/Anthropic-compatible provider

### Phase 2: Analytics Dashboard (Weeks 7–12)
- [ ] Next.js/SvelteKit frontend rebuild
- [ ] Real-time updates via WebSocket/SSE
- [ ] Core views: Overview, Agent Explorer, Model Analytics, Prompt Economics, Cost & Budget
- [ ] Tagging & metadata (env, workflow, team dimensions)
- **Deliverable:** Polished dashboard with prompt economics differentiator

### Phase 3: Intelligence & Automation (Weeks 13–20)
- [ ] Alerting & budgets (email, Slack, PagerDuty, webhooks)
- [ ] Smart recommendations (model routing, cache optimization, prompt trimming)
- [ ] REST API, OpenTelemetry export, Prometheus metrics
- [ ] Session management productization
- **Deliverable:** Intelligent proxy that advises and acts

### Phase 4: Enterprise & Scale (Weeks 21–30)
- [ ] Multi-user & RBAC (orgs, teams, SSO)
- [ ] Horizontal scaling, connection pooling, multi-region
- [ ] SOC 2 Type II prep, data residency
- [ ] Smart routing, fallback, response caching
- **Deliverable:** Enterprise-ready platform

### Phase 5: Platform & Ecosystem (Weeks 31+)
- [ ] Managed cloud offering (hosted endpoints, usage-based pricing)
- [ ] Optional lightweight SDK for deeper visibility
- [ ] Evaluation & quality (scoring, regression detection, A/B testing)
- [ ] Community marketplace (provider adapters, dashboard templates)
- **Deliverable:** Platform with network effects

### Pricing (Proposed)
| Tier | Price | Includes |
|------|-------|----------|
| Free | $0 | 10K req/mo, 1 agent, 7-day retention |
| Pro | $49/mo | 500K req/mo, unlimited agents, 90-day retention |
| Team | $199/mo | 2M req/mo, RBAC (10 seats), 1-year retention |
| Enterprise | Custom | Unlimited, SSO/SAML, audit logs, SLA |
| Self-Hosted | Free | Open source core, community support |

### Open Questions
1. Build vs. fork Helicone? (Helicone is open source Rust)
2. Python FastAPI performance ceiling vs Rust
3. Generalize prompt decomposition beyond OpenClaw's markdown structure
4. Speed to market vs. feature completeness

---

## Multi-Phase: Zero-Cloud OpenClaw (M1)

**Priority:** High (Michael's core mission)
**Mission:** M1 (Fully Local OpenClaw)
**Owner:** @17 lead, @Todd research support
**Status:** Active — Phase 1 started 2026-02-10

Run OpenClaw with absolutely zero cloud API calls. No Anthropic, no OpenAI, no external services.

### Phase 1: Deep Audit ✅ COMPLETE
- [x] API call audit — 12 cloud deps found, 3 hardcoded API keys (SECURITY ISSUE) — `research/M1-OPENCLOUD-AUDIT-RESULTS.md`
- [x] Local model requirements — Qwen2.5-32B recommended, 18-20GB VRAM — `research/M1-LOCAL-MODEL-REQUIREMENTS.md`
- [x] Gap analysis — documented in audit results

### Phase 2: Offline Mode Configuration (In Progress)
- [~] Dream Server "offline mode" docker-compose — sub-agent running
- [ ] Configuration guide — local service replacements
- [ ] Verification script — zero-cloud validation
- [ ] Document tradeoffs and migration path

### Phase 2: Configuration Guide
- [x] Step-by-step config for 100% local mode — `docs/M1-ZERO-CLOUD-CONFIG-GUIDE.md`
- [x] Document tradeoffs (quality vs privacy) — tradeoffs table in guide
- [x] Test with real OpenClaw workloads — benchmark complete
- [x] Benchmark: local Qwen vs Claude for agent tasks — `research/M1-LOCAL-VS-CLOUD-BENCHMARK.md`

### Phase 3: Productize
- [ ] Dream Server "offline mode" profile
- [ ] One-command switch between cloud/local
- [ ] Hybrid mode (local primary, cloud fallback)
- [ ] Update all documentation

### Existing Research
- `research/M1-FULLY-LOCAL-OPENCLAW.md` — Todd's config guide
- Services already working: vLLM, Kokoro TTS, Whisper STT, SearXNG, Qdrant

---

## Multi-Phase: Windows Dream Server Polish (M5, M6)

**Priority:** High (Michael testing NOW)
**Mission:** M5 (Dream Server), M6 (Min Hardware)
**Owner:** @17 lead, @Todd support
**Status:** Phase 1 — Claimed by 17

### Phase 1: Research & Document (In Progress)
- [~] Windows-specific deployment challenges (sub-agent spawned)
- [~] Voice troubleshooting guide (sub-agent spawned)
- [ ] WSL2 GPU passthrough documentation
- [ ] Docker Desktop optimization guide

### Phase 2: Installer Improvements
- [ ] Improve install.ps1 for edge cases
- [ ] Add Windows-specific validation in validate.sh
- [ ] Better error messages for common failures
- [ ] Auto-detect GPU and suggest tier

### Phase 3: Testing & Polish
- [ ] Test on various Windows configurations
- [ ] Document real user friction from Michael's test
- [ ] Create quick-fix scripts for common issues

---

## Multi-Phase: Agent Monitoring Dashboard (M7, M8)

**Priority:** Medium
**Mission:** M7 (OpenClaw Frontier), M8 (Bench Testing)
**Owner:** @17
**Status:** Active — Phase 1 started 2026-02-11

A web dashboard to monitor sub-agent swarms, GPU utilization, and task completion.

### Phase 1: Design (In Progress)
- [x] Define metrics to track — `dream-server/dashboard/DESIGN.md`
- [x] Sketch UI wireframes — ASCII wireframe in design doc
- [x] Choose tech stack — Python FastAPI + htmx + Chart.js (no build step)

### Phase 2: Implementation
- [ ] Build data collection endpoints
- [ ] Create dashboard frontend
- [ ] Add to Dream Server as optional component

### Phase 3: Integration
- [ ] Connect to OpenClaw sessions
- [ ] Add alerting for failures
- [ ] Document usage

---

## Multi-Phase: Local AI Test Suite (M8, M9)

**Priority:** High (foundational for all products)
**Mission:** M8 (Bench Testing), M9 (OSS > Closed)
**Owner:** @17 lead
**Status:** Phase 1 Complete — `1723941`

A comprehensive test suite that validates any local AI stack is working correctly. Run once after install, run again after changes.

### Phase 1: Core Health Checks ✅
- [x] LLM endpoint validation (chat completions, streaming)
- [x] Whisper STT test (audio file → transcript)
- [x] TTS test (text → audio file)
- [x] Embeddings test (text → vector)
- [x] GPU utilization sanity check

### Phase 2: Integration Tests ✅
- [x] End-to-end voice pipeline (audio in → audio out)
- [x] RAG pipeline (doc → embed → query → answer)
- [x] Multi-turn conversation test
- [x] Tool calling validation
- [x] Concurrency test (5 parallel requests)

### Phase 3: Benchmark Suite
- [ ] Latency benchmarks (TTFT, tokens/sec)
- [ ] Concurrent user simulation
- [ ] Memory leak detection (long-running tests)
- [ ] Results comparison over time

### Why This Matters
Michael can't manually test every install. Users need one command: `./test-stack.sh` → all green = working.
| ~~Research voice agent latency reduction~~ | ~~Medium~~ | — | Done - see research/VOICE-LATENCY-OPTIMIZATION.md |
| ~~LiveKit self-hosting feasibility study~~ | ~~High~~ | — | Done - see research/ |
| ~~API privacy shield prototype~~ | ~~Medium~~ | — | Research done - see below |
| ~~Deterministic call flow research~~ | ~~Medium~~ | — | Done - see research/DETERMINISTIC-CALL-FLOWS.md |
| ~~Dream server package spec~~ | ~~Low~~ | — | Done - see research/DREAM-SERVER-SPEC.md |
| ~~Agent bench testing framework~~ | ~~High~~ | — | Done |
| ~~Claude Code on both towers~~ | ~~High~~ | — | In progress (Todd researched, 17 executes) |

---

## ✅ Completed

| Project | Completed By | Date | Notes | Mission |
|---------|--------------|------|-------|---------|
| **Cookbook Phase 2** | Todd + 17 | 2026-02-09 | 4 deep-dives: multi-GPU, swarms, Grace voice, n8n | M1-M9 |
| **Cookbook Phase 1** | Todd + 17 | 2026-02-09 | 4 recipes: voice agent, RAG Q&A, code assistant, privacy proxy | M5, M7, M9 |
| Voice bench harness | Todd + 17 | 2026-02-08 | LiveKit WebRTC + TTS + STT, validated with Grace | M2, M8 |
| Grace LLM fix | 17 | 2026-02-08 | Fixed broken gpt-oss-120b → Qwen | M2 |
| n8n workflow fixes | 17 | 2026-02-08 | Updated 5 workflows with broken model refs | M7 |
| MODEL-DEPENDENCIES.md | Todd | 2026-02-08 | Checklist for model swaps | M7 |
| Grace test scenarios | 17 | 2026-02-08 | 10 YAML test cases for voice bench | M8 |
| Tool calling swarm research | Todd | 2026-02-08 | 6 agents, 6 model families, ~90 sec | M1, M6 |
| Local AI Best Practices doc | Todd | 2026-02-08 | Compiled lessons learned | M7, M9 |
| Agent templates library | 17 | 2026-02-08 | 5 templates, 100% success patterns | M7, M8 |
| .143 tool proxy deployment | 17 | 2026-02-08 | Both GPUs now available for swarms | M1 |
| Cluster health monitor | Todd | 2026-02-08 | Runs every 5 min, writes status file | M1 |
| Alert relay system | Todd | 2026-02-08 | Pending alerts file + heartbeat integration | M1 |
| vLLM tool calling guide | Todd | 2026-02-08 | 4-agent research pipeline output | M1, M7 |
| Memory sync protocol | Todd, 17 | 2026-02-08 | Files mirror to GitHub automatically | M7 |
| Discord collective setup | 17, Todd | 2026-02-07 | All channels configured | — |
| Bot-to-bot communication | All | 2026-02-07 | Verified working | — |
| LiveKit self-hosting study | ? | 2026-02-08 | Complete research in research/LIVEKIT-SELF-HOSTING.md | M2 |
| Claude Code install research | Todd | 2026-02-08 | research/CLAUDE-CODE-INSTALLATION.md | M1, M7 |
| vLLM tool calling fix (.122) | 17 | 2026-02-08 | Flags restored, verified working via port 8003 | M1, M6 |
| Swarm verification | Todd + 17 | 2026-02-08 | Confirmed working, loop issue noted | M1, M6 |
| Voice latency optimization research | Todd | 2026-02-08 | research/VOICE-LATENCY-OPTIMIZATION.md | M2, M4 |
| Deterministic call flow research | Todd | 2026-02-09 | research/DETERMINISTIC-CALL-FLOWS.md | M4 |
| API Privacy Shield research | Todd | 2026-02-08 | research/API-PRIVACY-SHIELD.md | M3 |
| Dream Server spec | Todd | 2026-02-09 | research/DREAM-SERVER-SPEC.md | M5 |
| OSS API Alternatives research | Todd | 2026-02-09 | research/M9-OSS-API-ALTERNATIVES.md (sub-agent output) | M9 |
| VRAM Multi-Service Limits | Todd | 2026-02-09 | research/M6-VRAM-MULTI-SERVICE-LIMITS.md (sub-agent output) | M6 |
| Streaming vs Turn-Based | Todd | 2026-02-09 | research/M2-STREAMING-VS-TURNBASED.md (sub-agent output) | M2, M4 |

---

## 📌 Standing Work Streams

**Android-16 (Heavy Executor on .122)**
- Primary builder for ALL code tasks
- Sub-agent swarms for parallel execution (tests + code + docs simultaneously)
- Load testing, benchmarks, stress tests
- Large codebase work (128K context, 65K max output)
- Feature branch workflow: `16/description` → push → wait for review

**Android-17 (Architect & Reviewer on .122)**
- Code review for all branches from 16 and Todd (HIGHEST PRIORITY — don't let reviews age)
- Architecture decisions and system design
- Complex debugging that 16 can't crack
- External API integrations requiring frontier reasoning
- Merge approved branches to main

**Todd (Integration Tester on .122)**
- End-to-end validation: Docker compose, full pipeline tests, API smoke tests
- Multi-system testing (Token Spy + Dream Server together)
- Second builder on parallel workstreams when testing queue is empty
- Feature branch workflow: `todd/description` → push → wait for review
- Backup reviewer when 17 is busy (don't let review queue age past 4h)

**Android-18 (Ops Controller)**
- Situation reports every 15 minutes (git state, session health, branch pipeline)
- Deep product audit via Opus 4.6 twice daily
- Punch list management (TOKEN-SPY-PUNCHLIST.md, DREAM-SERVER-PUNCHLIST.md)
- Stall detection, collision prevention, review queue monitoring

---

## 🔄 Handoff Format

When passing work between siblings:

```
**Handoff: [Project Name]**
From: @sender → To: @receiver
Status: What's done / What's next
Context: [Link or brief]
Urgency: Low / Medium / High
```

---

_This file lives in Android-Labs and syncs across both machines._
_Reference: MISSIONS.md contains the 9 north star priorities._

---

## ✅ COMPLETED: vLLM Version Alignment

**Completed:** 2026-02-08 by Android-17
**Mission:** M1, M6

- [x] Downgraded .122 to vLLM 0.14.0
- [x] Both towers on Qwen2.5-32B
- [x] Restored tool calling flags
- [x] Swarms verified working via port 8003

---

## Multi-Phase: API Privacy Shield (M3)

**Priority:** Medium
**Mission:** M3 (API Privacy Shield)
**Research:** `research/API-PRIVACY-SHIELD.md`

### Phase 1: Proof of Concept ✅ (2026-02-09 Todd)
- [x] Deploy Presidio locally (~/.122:~/privacy-shield/)
- [x] Build basic wrapper script (shield.py)
- [x] Test with sample prompts (4 test cases, 100% round-trip)
- [x] Measure latency overhead (2-4ms warm, 750ms cold)

### Phase 2: Integration ✅ (2026-02-09 Todd)
- [x] Create OpenAI-compatible proxy endpoint (port 8085)
- [x] Add session management for multi-turn
- [x] Implement response deanonymization
- [x] Test with real API calls (vLLM backend verified)

### Phase 3: Production ✅ (2026-02-09)
- [x] Add custom entity recognizers (Todd) — 15 new recognizers for API keys, cloud creds, secrets, internal IPs
- [x] Bug fixes from Claude Code audit (Todd) — IP validation, case-insensitivity, index collision
- [x] Security documentation (Todd) — `privacy-shield/SECURITY.md`
- [x] Performance optimization — 2-7ms latency (warm)
- [ ] Build configuration UI (optional, low priority)

---

## ✅ COMPLETED: Claude Code on Both Towers

**Completed:** 2026-02-09 by Michael (install) + Todd (verification)
**Mission:** M1, M7

### Status
- [x] Install Claude Code CLI on .122 — v2.1.37, persistent in `/home/michael/.openclaw/node_modules/`
- [x] Install Claude Code CLI on .143 — v2.1.37, persistent
- [x] Configure authentication — ANTHROPIC_API_KEY set
- [x] Test basic functionality — Todd ran audit from sandbox, worked
- [x] Document usage — See `infrastructure/DOCKER-SETUP-2026-02-09.md`

Claude Code survives container restarts. Can be invoked with:
```bash
claude -p --dangerously-skip-permissions "Your prompt"
```

---

## ✅ Session Reset (2026-02-14 01:27 EST)

**Completed:** 2026-02-14 by Android-16
**Mission:** M1, M12 (Coordination)

**Work Completed This Session:**
- ✅ Token Spy Phase 4e Org API Auth Fix — All org endpoints functional (GET/POST/PATCH)
- ✅ Token Spy Load Test — 250 requests, 67.6% success, P95 latency 105ms
- ✅ Workspace maintenance — MEMORY.md trimmed 13.6K→6.5K chars

**Coordination Status:**
- **Phase 5 React integration** — Available for me as zero-cost local work (128K context, unlimited compute)
- **M10 remediation** — Documentation complete, waiting on 17's key rotation
- **Session reset executed** — Workspace state reloaded and confirmed

**Current State:**
- **17**: M10 implementation plan shipped, blocked on API key + VRAM
- **16** (me): Token Spy Phase 4e ✅, load test ✅, Phase 5 ready 🟡, M10 blocked on key rotation 🟡
- **Todd**: Phase 4e complete ✅, Phase 5 frontend alignment pending 🟡

