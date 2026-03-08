# M5 Stranger Testing — Complete Analysis

**Mission M5: "Done when: A stranger can run the installer and be chatting with a voice agent within 15 minutes"**

**Analysis Date:** 2026-02-12  
**Analyst:** Android-17 (consolidated analysis)  
**Test Scope:** Dream Server installer, documentation, and voice chat setup  
**Target User:** NVIDIA GPU owner, basic terminal comfort, zero prior knowledge, 15-minute patience budget

---

## 1. Executive Summary

### The 15-Minute Stranger Test Goal

Dream Server's Mission M5 establishes a clear success criterion: **any stranger with an NVIDIA GPU and basic terminal skills must be able to run the installer and have a working voice conversation with the AI agent within 15 minutes**.

This is not just a documentation test — it validates the entire onboarding funnel from first encounter to first successful voice interaction.

### Current State

| Metric | Current | Target |
|--------|---------|--------|
| Success Rate (Technical Users) | ~70% | 95%+ |
| Success Rate (True Strangers) | ~30% | 80%+ |
| Time to Working Chat | 10-25 min | <15 min |
| Time to Working Voice | 15-30+ min | <15 min |

### Key Finding

The **one-line install works for basic chat** but **voice activation is a cliff** — strangers fall off when Docker Compose knowledge is required to enable voice profiles. The gap between "chat works" and "voice works" is the primary blocker to M5 success.

---

## 2. All 28 Friction Points by Category

### 🔴 INSTALL FRICTION (Critical Path) — 8 Issues

| # | Friction Point | Impact | Status |
|---|----------------|--------|--------|
| 1 | **Two different install URLs** — README uses `get-dream-server.sh`, QUICKSTART uses `dream.openclaw.ai/setup.sh` | Decision paralysis, 2 min lost | **PENDING** |
| 2 | **Manual install instructions buried** — `git clone` path assumes GitHub knowledge, no directory guidance | Clone fails, no fix guidance | **PENDING** |
| 3 | **Docker "auto-install" overconfidence** — "Installs Docker if needed" doesn't mention restart/logout requirement | Docker command fails post-install | **PENDING** |
| 4 | **NVIDIA Container Toolkit gap** — Not mentioned in pre-reqs, only in troubleshooting | "GPU not detected" panic | **PENDING** |
| 5 | **Port conflicts with no early warning** — No pre-flight port check in one-liner | Install fails halfway with port error | **PENDING** |
| 6 | **Model download time undisclosed** — Bootstrap <1 min but full model 10-30 min not mentioned | User thinks install is stuck | **PENDING** |
| 7 | **WSL Windows path unclear** — Docs waffle between "automatic" and "requirements" | User unsure if manual WSL2 needed | **PENDING** |
| 8 | **No pre-install validation script** — Can't check "will this work?" before 20GB download | Sunk cost if it fails | **PENDING** |
| 9 | **No GPU detection in install script** — Script downloads 20GB+ before checking NVIDIA GPU | Wastes 30+ min on incompatible hardware | **PENDING** |
| 10 | **Docker not installed = silent fail** — No Docker check before cloning | Immediate cryptic failure | **PENDING** |

### 🟡 CONFIG FRICTION (Setup Phase) — 7 Issues

| # | Friction Point | Impact | Status |
|---|----------------|--------|--------|
| 11 | **`.env` confusion** — "Auto-detects GPU" but also "Copy `.env.example` to `.env`" | User doesn't know if editing needed | **PENDING** |
| 12 | **Profile activation unclear** — Commands shown but not WHERE to run them | Stranger at localhost:3000, needs Docker command? | **PENDING** |
| 13 | **Voice requires TWO profiles** — `livekit` AND `voice` needed — not obvious | "I enabled voice but LiveKit isn't working" | **PENDING** |
| 14 | **LiveKit port mismatch** — README 7880, QUICKSTART 7880/3001/voice confusion | "Where do I actually talk to it?" | **PENDING** |
| 15 | **OpenClaw integration assumed** — Config snippet but no file location context | User can't find `openclaw.json` | **PENDING** |
| 16 | **Dashboard vs WebUI confusion** — Two ports (3000 vs 3001), which is "chatting"? | "Opened 3000 but voice isn't there" | **PENDING** |
| 17 | **Bootstrap model upgrade path** — `./scripts/upgrade-model.sh` assumes cd into directory | Command not found error | **PENDING** |
| 18 | **Voice requires manual Open WebUI config** — Starting voice services doesn't auto-configure UI URLs | Microphone appears but doesn't work | **PENDING** |

### 🟠 USAGE FRICTION ("I'm In, Now What?") — 5 Issues

| # | Friction Point | Impact | Status |
|---|----------------|--------|--------|
| 19 | **No "success checklist"** — Docs show URLs but not what "working" looks like | User unsure if voice configured | **PENDING** |
| 20 | **Voice chat entry point unclear** — QUICKSTART `/voice` vs README LiveKit playground | "Do I click something? Automatic?" | **PENDING** |
| 21 | **First interaction failure unclear** — No "if voice doesn't respond, check X" | Microphone? Model? LiveKit? Mystery | **PENDING** |
| 22 | **No "hello world" for voice** — No simple "say this to test it works" | User mumbles at screen | **PENDING** |
| 23 | **Silent failures common** — vLLM loading, model downloading all silent in UI | "Connection error" with no progress indicator | **PENDING** |

### 🔵 KNOWLEDGE ASSUMPTIONS (Invisible to Docs) — 8 Issues

| # | Assumption | Why It Excludes Strangers | Status |
|---|------------|---------------------------|--------|
| 24 | Knows what Docker Compose profiles are | Just wanted to chat, now learning Docker | **PENDING** |
| 25 | Knows difference between WebUI and Dashboard | Two UIs, no visual preview | **PENDING** |
| 26 | Knows LiveKit is a separate component | Marketing says "voice included" | **PENDING** |
| 27 | Knows to check `docker compose logs` | CLI debugging expected when GUI fails | **PENDING** |
| 28 | Knows what AWQ quantization means | Tier table uses unexplained jargon | **PENDING** |
| 29 | Comfortable editing JSON files | OpenClaw integration requires manual JSON | **PENDING** |
| 30 | Knows what "RAG" stands for | Used throughout docs without expansion | **PENDING** |
| 31 | Knows bootstrap mode trade-offs | "Instant gratification" hides swap complexity | **PENDING** |
| 32 | **"Basic terminal comfort" undefined** — Subjective requirement, no concrete check | User unsure if qualified | **PENDING** |

*Note: Consolidation revealed 4 additional friction points (#9-10, #18, #32) not in original 28 — now tracking 32 total.*

---

## 3. Critical Blockers (Severity Ratings)

These are **complete show-stoppers** — the stranger would reasonably give up here and declare the product broken.

### 🔴 Blocker A: No GPU Detection in Install Script
**Severity:** CRITICAL (P0)

**Scenario:** User runs one-liner on non-NVIDIA system, sees Docker pulling images for 5 minutes, then vLLM fails cryptically.

**Stranger Experience:**
```
$ curl ... | bash
[dream] Detected OS: linux
[  ok ] Linux/WSL detected — full support
[dream] Cloning Dream Server...
# ... downloads 20GB ...
[error] vLLM failed to start
# Stranger: "What just happened? Is my computer broken?"
```

**Why Fatal:** Wastes 30+ minutes and bandwidth on incompatible hardware. User has no feedback on what went wrong or how to fix.

**Required Fix:** Add `nvidia-smi` check before any download with clear error message and hardware guide link.

**Status:** **PENDING**

---

### 🔴 Blocker B: The Voice Profile Activation Gap
**Severity:** CRITICAL (P0)

**Scenario:** User followed one-liner, at localhost:3000, chat works, now wants voice. Docs say:
```bash
docker compose --profile livekit --profile voice up -d
```
But user doesn't know WHERE to run this, realizes it's a SECOND command, runs in wrong directory → "docker-compose.yml not found"

**Why Fatal:** The "15 minutes to voice chat" promise breaks here. User has working chat but no voice, no clear path forward, and the "quick" install suddenly requires Docker knowledge.

**Required Fix:** Installer should ask "Enable voice? [Y/n]" and do it automatically, OR voice should be in default profile.

**Status:** **PENDING**

---

### 🔴 Blocker C: Voice Requires Manual Open WebUI Config
**Severity:** CRITICAL (P0)

**Scenario:** User starts voice services (`docker compose --profile voice up -d`), sees "whisper running" and "tts running". In Open WebUI, microphone icon appears. Click it, speak... nothing happens. No error message, just silence.

**Root Cause:** Open WebUI needs explicit STT/TTS URLs in Settings → Audio:
- Speech-to-Text: `http://localhost:9000/v1/audio/transcriptions`
- Text-to-Speech: `http://localhost:8880/v1/audio/speech`

**Why Fatal:** Voice is a headline feature that silently fails. User thinks they did everything right but it doesn't work.

**Required Fix:** Add explicit voice configuration instructions to QUICKSTART Step 3, or auto-configure via environment variables.

**Status:** **PENDING**

---

### 🟠 Blocker D: The Port Conflict Mid-Install
**Severity:** HIGH (P1)

**Scenario:** User runs one-liner, sees Docker pulling images for 5 minutes, then:
```
Error: port 3000 already in use
```

**Why Fatal:** No indication this could happen beforehand, no auto-recovery, no clear "run this to fix" command. User feels betrayed by "one-line install" promise. Common conflict with React dev servers.

**Required Fix:** Add pre-flight port check to install script with auto-suggestion of alternative ports or automatic port selection.

**Status:** **PENDING**

---

### 🟠 Blocker E: The "Connection Error" at Startup
**Severity:** HIGH (P1)

**Scenario:** User opens localhost:3000 immediately after install script says "Done!" Sees red "Connection error" banner in Open WebUI. Docs say "wait for health check" but that's a `curl` command. Stranger wants to click, not curl.

**Why Fatal:** Panic uninstall follows. Script declared success but UI shows failure.

**Required Fix:** Dashboard should show loading state, not error state. OR script should "wait for ready" loop and poll health endpoint before declaring success.

**Status:** **PENDING**

---

## 4. Fixed vs Pending Status Matrix

### P0 — Must Fix for M5 Success (All PENDING)

| Fix | Impact | Effort | Status |
|-----|--------|--------|--------|
| Add GPU detection to `get-dream-server.sh` | Eliminates Blocker A | Low | **PENDING** |
| Add Docker check before cloning | Eliminates Blocker A variant | Low | **PENDING** |
| Single voice-enabled install path | Eliminates Blocker B | Medium | **PENDING** |
| Add voice config instructions to QUICKSTART | Eliminates Blocker C | Low | **PENDING** |
| Pre-flight port check in install script | Eliminates Blocker D | Medium | **PENDING** |
| Post-install "wait for ready" loop | Eliminates Blocker E | Low | **PENDING** |
| Unified progress display (model download) | Eliminates anxiety from #6 | Low | **PENDING** |
| Single source of truth for URLs | Eliminates friction #1 | Low | **PENDING** |

### P1 — High Impact (All PENDING)

| Fix | Impact | Effort | Status |
|-----|--------|--------|--------|
| Voice chat "hello world" button | Fixes friction #22 | Medium | **PENDING** |
| Visual profile toggle in dashboard | Fixes friction #12-13 | Medium | **PENDING** |
| Windows pre-flight validation | Fixes Blocker C edge cases | Medium | **PENDING** |
| Merge `.env` generation explanation | Fixes friction #11 | Low | **PENDING** |
| Show `.env` summary after generation | Fixes friction #17 | Low | **PENDING** |
| Add model download progress visibility | Fixes friction #6 variant | Low | **PENDING** |
| Define "basic terminal comfort" concretely | Fixes friction #32 | Low | **PENDING** |

### P2 — Polish Items (All PENDING)

| Fix | Impact | Effort | Status |
|-----|--------|--------|--------|
| Consolidate terminology (WebUI vs Dashboard) | Fixes friction #16 | Low | **PENDING** |
| Add jargon glossary (AWQ, RAG) | Fixes friction #28, #30 | Low | **PENDING** |
| Model download resume capability | Prevents re-download | Medium | **PENDING** |
| Create `TROUBLESHOOTING.md` | Fixes dead link | Low | **PENDING** |
| Expand Windows WSL2 instructions | Fixes friction #7 | Medium | **PENDING** |
| First-run guided tour | Fixes friction #19-20 | High | **PENDING** |

---

## 5. The 15-Minute Success Path

### Current Path (What Actually Happens)

```
0:00  curl | bash (user hopes this "just works")
0:02  Wait... what URL? Two options shown. Decision paralysis.
0:03  Script runs, Docker pulls start
0:05  "Bootstrap mode ready!" message appears
0:06  Open localhost:3000 → sees chat, tries it
0:08  "Now for voice..." → finds profile command
0:09  Runs command, gets "docker-compose.yml not found"
0:11  Finds correct directory, runs again
0:13  Port conflict on 7880? Or LiveKit not responding?
0:15  **TIME EXPIRED — success uncertain**
```

**Success Rate:** ~30% for true strangers

### Ideal Path (M5 Target)

```
0:00  curl | bash
0:01  Pre-flight: "Checking your system... ✓ GPU ✓ Docker ✓ Ports"
0:02  "Installing with voice enabled..."
0:05  "Downloading models (ETA: 4 minutes)... [████████░░] 75%"
0:08  "Starting services..." (with actual ready check)
0:10  "Ready! Opening dashboard..."
0:11  Dashboard loads with big "Test Voice Chat" button
0:13  User clicks, speaks, hears response
0:15  **SUCCESS — chatting with voice agent**
```

**Target Success Rate:** 80%+ for terminal-comfortable GPU owners

### Gap Analysis

**~4 critical friction points** separate current from ideal:
1. Pre-flight checks (GPU, Docker, ports)
2. Voice as default or interactive opt-in
3. Progress visibility during download/startup
4. Post-install ready-state validation

**Fix P0 items = close the gap to 80%+ success rate**

---

## 6. Service Matrix (Reference)

| Service | Profile | Port | Depends On | Startup Time | Memory |
|---------|---------|------|------------|--------------|--------|
| vLLM | default | 8000 | — | 2-5 min | 16GB+ |
| open-webui | default | 3000 | vLLM healthy | 30s | 512MB |
| whisper | voice | 9000 | — | 1 min | 2GB |
| tts | voice | 8880 | — | 30s | 1GB |
| livekit | livekit | 7880 | — | 15s | 1GB |
| livekit-voice-agent | livekit | — | livekit, whisper, tts | 30s | 1GB |
| n8n | workflows | 5678 | — | 30s | 1GB |
| qdrant | rag | 6333 | — | 15s | 512MB |
| embeddings | rag | 8090 | — | 1 min | 1GB |

**Key Insight:** vLLM is the critical path. Everything waits for it.

---

## 7. Recommended Implementation Priority

### Week 1: P0 Blockers (Unblocks M5)
1. Add GPU + Docker pre-flight checks to `get-dream-server.sh`
2. Add voice profile to default OR add interactive "Enable voice?" prompt
3. Add voice config instructions to QUICKSTART Step 3
4. Add port conflict detection with auto-suggest
5. Add post-install health check loop before "Ready!" message

### Week 2: P1 Friction Reduction
6. Add model download progress visibility
7. Show `.env` summary after generation
8. Create `TROUBLESHOOTING.md` or fix dead link
9. Define "basic terminal comfort" with concrete checks

### Week 3: P2 Polish
10. Consolidate WebUI vs Dashboard terminology
11. Add jargon glossary (AWQ, RAG)
12. Expand Windows WSL2 instructions

---

## 8. Test Protocol for Validating Fixes

```bash
# Fresh VM test (simulates true stranger)
1. Spin up fresh Ubuntu 22.04 VM
2. Install NVIDIA drivers (simulate user with GPU)
3. Run: curl -fsSL .../get-dream-server.sh | bash
4. Time to working chat: ___ min
5. Time to working voice: ___ min
6. Document any errors encountered

Success Criteria (M5 Complete):
- [ ] Script detects missing prerequisites clearly
- [ ] Working chat in <15 min on fresh system
- [ ] Voice works with explicit config steps
- [ ] All errors have actionable messages
- [ ] No Docker knowledge required beyond copy-paste
```

---

## 9. Summary

**Current State:** The one-liner install is solid for basic chat. Voice activation is the cliff — strangers will fall off here.

**Biggest Risk:** Blocker B (voice profile gap) and Blocker C (voice config gap). A stranger can get chat working but voice requires Docker Compose and manual UI configuration they shouldn't need.

**Fastest Win:** Make voice the default profile or add an interactive "Enable voice chat? [Y/n]" prompt to the install script that handles all profile activation automatically.

**15-Minute Success Probability (Current):** ~30% — works if nothing goes wrong and user knows Docker.

**15-Minute Success Probability (After P0 Fixes):** ~80% — works for terminal-comfortable GPU owners.

---

*This document consolidates analysis from:*
- `M5-STRANGER-FRICTION-ANALYSIS.md` (28 friction points, 5 blockers)
- `M5-STRANGER-TEST-RESULTS.md` (executive summary, test protocol)

*Consolidated on: 2026-02-12 by Android-17 (subagent)*
