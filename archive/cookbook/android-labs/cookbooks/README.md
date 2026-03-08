# Local AI Cookbook

*Practical recipes for local AI setups — Michael's consulting toolkit*

---

## What This Is

Copy-paste recipes for common local AI configurations. Each recipe includes:
- Hardware requirements
- Step-by-step installation
- Configuration for production
- Common pitfalls and solutions
- Performance tuning tips

**Target audience:** Technical consultants, developers, and IT teams deploying local AI.

---

## Phase 1: Core Recipes

| # | Recipe | Description | Status |
|---|--------|-------------|--------|
| 01 | [Voice Agent](01-voice-agent-setup.md) | Whisper + LLM + TTS | ✅ Complete |
| 02 | [Document Q&A](02-document-qa-setup.md) | Embeddings + RAG + LLM | ✅ Complete |
| 03 | [Code Assistant](03-code-assistant-setup.md) | Qwen Coder + tool calling | ✅ Complete |
| 04 | [Privacy Proxy](04-privacy-proxy-setup.md) | API shield with PII stripping | ✅ Complete |

## Phase 2: Advanced Guides

| # | Guide | Description | Owner | Status |
|---|-------|-------------|-------|--------|
| 05 | [Multi-GPU Cluster](05-multi-gpu-cluster.md) | Load balancing, TP/PP, monitoring | 17 | ✅ Complete |
| 06 | [Swarm Patterns](06-swarm-patterns.md) | Sub-agent orchestration | 17 | ✅ Complete |
| 07 | [Grace Voice Agent](07-grace-voice-agent.md) | Full voice agent with FSM | Todd | ✅ Complete |
| 08 | [n8n + Local LLM](08-n8n-local-llm.md) | Workflow automation with local AI | Todd | ✅ Complete |

---

## Hardware Tiers

| Tier | GPU | VRAM | Good For |
|------|-----|------|----------|
| Budget | RTX 3060 | 12GB | 7B models, basic voice |
| Mid | RTX 4070 Ti Super | 16GB | 13B models, good voice |
| Dream | RTX 4090 | 24GB | 32B models, production voice |
| Enterprise | RTX 6000 | 48-96GB | Multiple services, scale |

---

## Quick Start

1. Pick a recipe
2. Check hardware requirements
3. Follow installation steps
4. Test with provided examples
5. Customize for your use case

---

## Related Resources

- `research/` — Deep dive research on each topic
- `tools/` — Reusable scripts and utilities
- `MISSIONS.md` — Why we're building this

---

## Contributing

Built by The Collective (Android-17, Todd, Android-18) for Michael's consulting business.

Found an issue or have an improvement? Update the recipe directly and test before committing.

---

*Part of the Android-Labs collective — advancing local AI for everyone.*
