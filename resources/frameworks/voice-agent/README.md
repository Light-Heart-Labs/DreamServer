# Voice Agent Framework (GLO)

**Origin:** [GLO (Grace Local Ocean)](https://github.com/Light-Heart-Labs/GLO) — Multi-Voice Agent Framework for Local Systems

**Status:** Production (Silver Build, Feb 2026)
n**Requirements:** Python >= 3.9, LiveKit account (cloud or self-hosted)

A complete multi-agent voice system built on LiveKit, designed for commercial HVAC customer service but easily adaptable to any domain. Uses DreamServer's own services (Whisper STT, Kokoro TTS, local LLM) as the AI backbone.

## What's Here

### `core/` — Agent System

| File | What It Does |
|------|-------------|
| `hvac_agent.py` | Main orchestrator — 8 specialist agents, shared CallData state, LiveKit session management, transcript capture, audio recording |
| `intent_detection.py` | Keyword-based routing with priority weighting (emergency > admin). Drop-in module, easy to adapt to any domain |
| `tts_filter.py` | Output filtering — removes routing language, normalizes phone numbers/addresses for natural TTS speech |
| `extraction.py` | Regex patterns for extracting phone numbers, names, addresses, equipment types, urgency levels from conversation |
| `state.py` | CallState compatibility layer with per-department required field validation |
| `prompt_builder.py` | Dynamic 4-layer prompt assembly: identity + context + specialist knowledge + pending actions |
| `hvac-token-server.py` | LiveKit token generator (Flask server on port 8096) |

### `prompts/` — Specialist Prompt Library

All prompts share a common identity block (`shared.py` GRACE_IDENTITY) and follow the same structure. Each specialist handles a specific domain:

| Prompt | Domain |
|--------|--------|
| `portal.py` | Greeting and triage — routes callers to the right specialist |
| `service.py` | Emergency dispatch, equipment failures, technician requests |
| `billing.py` | Invoices, payments, account disputes |
| `parts.py` | Order tracking, ETAs, part availability |
| `projects.py` | Quotes, bids, new installations |
| `maintenance.py` | Preventive maintenance scheduling, service contracts |
| `controls.py` | Building automation systems (BAS/DDC) |
| `office.py` | General inquiries, vendor calls, catch-all |
| `closing.py` | Call recap and closing sequence |

### `research/` — Architecture Deep Dives

These documents capture real lessons from building and iterating on the system:

| Document | What You'll Learn |
|----------|------------------|
| `architecture-options.md` | Three architectural approaches compared: single-agent (recommended), multi-agent, orchestrator. Token impact analysis, effort estimates |
| `v2-postmortem.md` | Why a single-agent approach failed the first time (prompt complexity explosion, domain confusion) |
| `current-multiagent-deep-dive.md` | Deep technical analysis of the multi-agent implementation — every class, every handoff, every edge case |
| `prompt-engineering.md` | Strategies for layered prompts, personality consistency, context injection across agent swaps |
| `handoff-analysis.md` | 6 specific problems with agent handoffs and proposed fixes with code examples |
| `current-state-analysis.md` | Handoff flow diagrams and state transition maps |
| `MULTI-AGENT-SEAMLESS-PROJECT.md` | Full project plan for seamless handoff architecture |
| `SEAMLESS-HANDOFF-PROJECT.md` | UI/UX perspective on making handoffs invisible to callers |
| `integration-risk-analysis.md` | Risk analysis for n8n webhook integration |

### `livekit-docs/` — LiveKit Agents SDK Reference

15 guides covering the LiveKit Agents SDK from basics to production:

- Introduction, Agent Sessions, Events, Agent Class
- Turn Detection, Function Tools, Transcriptions
- Telephony (PSTN), Observability, OpenAI Integration
- Agent Handoffs, Session Config, Troubleshooting

### `scripts/` — Operational

- `health-check.sh` — Service health monitoring (checks LLM, STT, TTS endpoints)

### `tests/` — Test Infrastructure

- `test_framework.py` — Voice agent test framework with CallState simulation
- `stress_tests.py` — Load testing for multi-agent handoffs

### `config/` — Setup

- `.env.example` — LiveKit + local AI service configuration
- `requirements.txt` — Python dependencies (LiveKit, OpenAI plugins, Flask)
- `faq/company_info.json` — Sample company FAQ data

## Architecture

```
Caller (phone/web) → LiveKit Room
                        ↓
              PortalAgent (triage)
              ├── detect_intent() → keyword matching
              └── route_to_*() → specialist handoff
                        ↓
              SpecialistAgent (focused domain)
              ├── CallData (shared state persists across handoffs)
              ├── transcript_lines (real-time capture)
              └── extraction → structured ticket JSON
                        ↓
              ClosingAgent (recap)
                        ↓
              n8n webhook → ticket creation
```

### Key Design Patterns

1. **Shared CallData** — Persistent state across agent swaps (name, phone, transcript, departments visited)
2. **Layered Prompts** — Core identity + caller context + specialist knowledge + pending actions
3. **Intent Priority** — Emergency/service always routes before billing/admin
4. **TTS Filtering** — Strip internal language before speech output
5. **Idempotent Extraction** — Convert free-form calls to structured tickets via LLM

## Adapting to Your Domain

This framework is built for HVAC but the architecture is domain-agnostic:

1. **Replace prompts/** — Swap HVAC specialist prompts with your domain (legal, medical, retail, etc.)
2. **Update intent_detection.py** — Change keyword mappings to your routing categories
3. **Modify extraction.py** — Adjust regex patterns for your data types
4. **Keep shared.py pattern** — The identity block + universal rules approach works for any domain
5. **Keep tts_filter.py** — Phone/address normalization is universally useful

## DreamServer Integration

This framework was designed to run on DreamServer's local AI stack:

- **STT:** DreamServer's Whisper service (`http://localhost:9000/v1`)
- **TTS:** DreamServer's Kokoro TTS service (`http://localhost:8880/v1`)
- **LLM:** DreamServer's llama-server (`http://localhost:8080/v1`)
- **Workflows:** DreamServer's n8n instance for ticket/webhook processing
