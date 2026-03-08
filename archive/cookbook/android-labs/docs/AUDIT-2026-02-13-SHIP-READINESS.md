# Dream Server — Ship-Readiness Audit

**Auditor:** Claude (independent review)  
**Date:** 2026-02-13  
**Existing Audit:** Confirmed — AUDIT-REPORT.md (2026-02-12) with 217 issues / 42 critical  
**Verdict:** 🔴 **NOT READY TO SHIP AS A POLISHED PRODUCT**

---

## What's Genuinely Impressive

Before the bad news — credit where it's due. This project has strong bones:

| Strength | Details |
|----------|---------|
| Architecture | Sound microservices design — vLLM, Open WebUI, Whisper, TTS, n8n, Qdrant, LiveKit all compose cleanly |
| Installer (install.sh) | 1,104 lines, hardware auto-detection, tier selection, bootstrap mode for instant UX — this is well above hobbyist |
| Docker Compose | 8 variants (standard, edge, bootstrap, offline, cluster, nano, pro) with proper healthchecks, resource limits, security_opt on every container |
| Documentation Volume | 23+ docs in /docs, sales materials, FAQ, troubleshooting, hardware guide — more docs than most shipped products |
| Windows Support | Full PowerShell installer with WSL2 detection, GPU validation, and diagnose mode |
| Bootstrap Mode | Brilliant UX — starts with 1.5B model in <2 min, downloads full model in background |
| Dashboard | React 18 + Vite + Tailwind, multi-stage Docker build, professional component architecture |
| Security Hardening | no-new-privileges, read_only: true, tmpfs, non-root users, pinned image versions on most containers |

---

## 🔴 Blockers (Must Fix Before Any User Sees This)

### 1. Security Emergency

| Issue | Severity | Details |
|-------|----------|---------|
| Zero authentication on dashboard-api | 🔴 CRITICAL | Every endpoint wide open — anyone on the network gets full access |
| Wildcard CORS + credentials | 🔴 CRITICAL | Access-Control-Allow-Origin: * with credentials = credential theft vector |
| Docker socket mounted | 🔴 CRITICAL | Container escape risk — compromise dashboard = own the host |
| network_mode: host on dashboard-api | 🔴 CRITICAL | Bypasses all Docker network isolation |
| Hardcoded LiveKit secrets in 3 YAML files committed to git | 🔴 CRITICAL | Secrets in version control |

**Estimated fix time:** 4 hours

### 2. Broken Core Functionality

| Issue | Impact |
|-------|--------|
| n8n workflows send model: 'local' to vLLM | Every workflow call returns 404 — workflows are completely non-functional |
| Service name mismatches | Dashboard shows wrong service status (frontend looks for "Whisper", backend returns "Whisper (STT)") |
| 4 preflight endpoints missing from backend | Setup wizard always shows "passed" even when things are broken |
| M4 deterministic voice layer | before_llm hook never invoked — entire deterministic routing is dead code |
| Update system broken | INSTALL_DIR never set — every migration is a silent no-op |
| PII scrubber IPv6 regex | Overly broad pattern corrupts normal text content |

**Estimated fix time:** 8-12 hours

### 3. Install Script Safety

| Issue | Risk |
|-------|------|
| Shell injection in nohup background download block | Unquoted variables allow code execution |
| Unsafe trap with rm -rf | Variable corruption → deletes unintended directories |
| `curl | sh` for Docker install | Trust-based security model |
| Division by zero in progress_bar | Crash on zero-total edge case |

**Estimated fix time:** 2-3 hours

---

## 🟡 Documentation & Sales Inconsistencies

This is where a "stranger trying to use this" would get confused fast:

### Conflicting Install URLs (6 different URLs across docs!)

| Document | URL |
|----------|-----|
| README.md | raw.githubusercontent.com/.../get-dream-server.sh |
| QUICKSTART.md | dream.openclaw.ai/setup.sh |
| QUICKSTART-NEW.md | raw.githubusercontent.com/.../install.sh |
| LAUNCH-READY.md | dream.lightheartlabs.com/install.sh |
| FAQ.md | dream.lightheartlabs.ai/install.sh |

Three unverified domains referenced. A user following any doc has ~17% chance of picking the one that works.

### Tier Naming (4 different naming schemes!)

| README.md | QUICKSTART.md | landing.html | install.sh |
|-----------|---------------|--------------|------------|
| Starter | Nano | Entry | Entry Level |
| Professional | Edge | Prosumer | Prosumer |
| Business | Pro | Pro | Pro |
| Enterprise | Cluster | Enterprise | Enterprise |

### TTS Engine Identity Crisis

- README.md calls it "OpenTTS"
- FAQ.md calls it "Kokoro"
- EDGE-QUICKSTART calls it "Piper"
- docker-compose.yml uses kokoro-fastapi image

### Broken Doc References

- docs/ARCHITECTURE.md — referenced in FAQ, doesn't exist
- docs/API.md — referenced in FAQ, doesn't exist
- docs/VOICE-SETUP.md — referenced in EDGE-QUICKSTART, doesn't exist

---

## 📊 Component Scorecard

| Component | Polish | Functional | Security | Ship-Ready? |
|-----------|--------|------------|----------|-------------|
| install.sh (Linux) | 8/10 | 7/10 | 5/10 | 🟡 Close |
| install.ps1 (Windows) | 7/10 | 7/10 | 6/10 | 🟡 Close |
| docker-compose.yml | 8/10 | 7/10 | 4/10 | 🔴 No |
| Dashboard (React) | 7/10 | 5/10 | 3/10 | 🔴 No |
| Dashboard API | 5/10 | 6/10 | 2/10 | 🔴 No |
| Voice Pipeline | 6/10 | 4/10 | 5/10 | 🔴 No |
| Privacy Shield | 6/10 | 5/10 | 4/10 | 🔴 No |
| n8n Workflows | 4/10 | 2/10 | 5/10 | 🔴 No |
| Tests | 5/10 | 4/10 | 3/10 | 🔴 No |
| Documentation | 8/10 | 6/10 | N/A | 🟡 Close |
| Sales Materials | 6/10 | N/A | N/A | 🟡 Close |

---

## 🗺️ Path to Ship

### Phase 0: Security Emergency (4 hours)
- [ ] Add auth to dashboard-api (even basic auth)
- [ ] Fix CORS policy
- [ ] Remove Docker socket mount
- [ ] Rotate hardcoded secrets, add to .gitignore

### Phase 1: Core Functionality (8-12 hours)
- [ ] Fix n8n workflow model names
- [ ] Fix service name matching in dashboard
- [ ] Implement missing preflight endpoints
- [ ] Fix PII scrubber regex
- [ ] Fix update system INSTALL_DIR

### Phase 2: Documentation Unification (4-6 hours)
- [ ] Pick ONE install URL, ONE tier naming scheme, ONE TTS name
- [ ] Create missing referenced docs (ARCHITECTURE.md, API.md)
- [ ] Fix all broken links
- [ ] Align pricing numbers across docs

### Phase 3: Install Script Hardening (2-3 hours)
- [ ] Fix shell injection in nohup block
- [ ] Safe trap handling
- [ ] Input validation on --tier
- [ ] Fix progress_bar division by zero

### Phase 4: Test Reliability (4-6 hours)
- [ ] Fix tests that can never fail (RAG test always exits 0)
- [ ] Add mutation/integration tests for dashboard API
- [ ] Standardize port references in tests

**Total estimate:** 22-31 hours of focused work

---

## Bottom Line

The architecture and vision are strong — this is genuinely impressive work. The North Star vision of "stranger installs it in 10 minutes" is achievable. But right now, that stranger would hit:

1. A broken install URL
2. A dashboard with wrong service statuses
3. Non-functional workflows
4. An unauthenticated API exposing their system

**The good news:** the hard part (architecture, multi-tier support, bootstrap mode, voice pipeline, hardware detection) is done. What remains is remediation work, not new feature development.

Your team's existing AUDIT-REPORT.md from yesterday is accurate and thorough — the issues are well-documented, the fix estimates are realistic, and none of the blockers are architectural. They're all fixable bugs and oversights.
