# MISSIONS.md — The Collective's North Stars
*Added by Michael 2026-02-08. Updated 2026-02-15. These are the problems worth solving.*

---

## The Vision — Global AI Domination Through Self-Hosting

**We are building the infrastructure for a world where AI belongs to everyone.**

Not trapped on Anthropic's servers. Not gated behind OpenAI's pricing. Not controlled by Google's terms of service. We're building the products, platforms, and ecosystems that make self-hosted AI not just viable but *superior* to anything the cloud giants offer. For everyone — from a developer with a Raspberry Pi to an enterprise running server farms.

This is not two products and a finish line. This is a product factory. Every problem we solve becomes a product. Every product strengthens the ecosystem. Every ecosystem makes the next product easier to build and more valuable to use. We ship a new product or major capability every two weeks. V0 of anything is the *starting line*, not the finish line.

**The flywheel:**
1. We solve a hard problem for ourselves (Guardian, Token Spy, Privacy Shield, the memory system, the backup system — all started as internal tools).
2. We package it as a product others can use.
3. That product integrates into Dream Server and Token Spy, making the core platforms stronger.
4. Stronger platforms attract more users, who surface more problems worth solving.
5. Go to step 1. Forever.

Guardian started as our watchdog. Now it's a self-healing infrastructure product. Token Spy started as our cost tracker. Now it's a flagship analytics platform. Privacy Shield started as our API scrubber. Now it ships in Dream Server. **Every solution we build for ourselves is a product waiting to be born.** Look at every tool, script, and system we run — and ask: "Who else needs this?"

There is no finish line. There is no "done." There is only: what do we ship next?

---

## The Two Flagship Products

Everything we build feeds into these. They are the delivery vehicles for everything else.

### Dream Server — Local AI for the World

Dream Server is not a product. It's a **platform** — and it scales in every direction:

| Scale | Target | What It Looks Like |
|-------|--------|--------------------|
| **Edge** | Raspberry Pi, Jetson, mini PCs | Lightweight agent + voice assistant on a $100 device. AI in every home, every classroom, every small business. |
| **Personal** | Single GPU (8-96GB) | The V0 we're building now. Full local AI ecosystem on one machine. The best solo setup money can buy. |
| **Team** | Multi-GPU, multi-node | Shared inference, multi-user workflows, team dashboards. A private AI lab for small companies. |
| **Enterprise** | Server farms, data centers | Horizontal scaling, multi-region, compliance, SSO, audit trails. Compete with Azure AI and AWS Bedrock — but the customer owns everything. |
| **Managed** | Cloud-hosted Dream Server | For people who want the ecosystem but don't want hardware. We host it, they own their data. |

Every scale tier is a product. Every product is a revenue stream. Every tier shares the same core, so improvements flow everywhere.

**The bar isn't "better than LM Studio."** The bar is: **better than paying OpenAI.** Better experience, better privacy, better cost, better control. When we hit that bar, the market is everyone.

**V0 ships the Personal tier.** Then we push in both directions — down to Edge (AI everywhere, hardware doesn't matter) and up to Enterprise (the businesses paying $100K/month to cloud providers who would rather own their stack). Each direction is years of work.

### Token Spy — The Morningstar of AI

Token Spy is not a proxy with a dashboard. It's the **intelligence layer for AI operations** — Morningstar.com meets HuggingFace for local AI and API management.

**Where it's going:**

| Phase | What It Becomes |
|-------|-----------------|
| **V0 (now)** | Transparent proxy + usage dashboard. See what your AI costs. |
| **Analytics** | Deep model comparison, prompt economics, cost optimization recommendations. Know which model to use for which task and why. |
| **Intelligence** | Automated model routing, cost-aware fallback chains, quality scoring. Your AI gets smarter about being smart. |
| **Marketplace** | Model performance leaderboards, community benchmarks, provider comparison. The place you go to understand AI performance. |
| **Platform** | Third-party integrations, plugin ecosystem, enterprise analytics. Every AI team in the world routes through Token Spy because the insights are that good. |

The competitive moat: nobody else does session-aware intelligence at the proxy level. Nobody else does system prompt decomposition. Nobody else gives you Morningstar-grade analytics for AI spending. We're not competing with Helicone's request logger — we're building the Bloomberg Terminal for AI operations.

**Token Spy ships standalone AND bundled in Dream Server.** Different buyers, same product. Solo developers get it free in Dream Server. Teams and enterprises pay for the standalone platform. Both feed data back into better intelligence for everyone.

---

## The Product Pipeline

These are not hypothetical. These are products that already exist as internal tools or prototypes, waiting to be packaged and shipped. Every one of them strengthens the core platforms.

| Product | Status | Integrates Into | What It Is |
|---------|--------|-----------------|------------|
| **Guardian** | Running in production | Dream Server | Self-healing infrastructure watchdog. Protects files, services, and configs. Auto-recovers from failures. Any self-hosted system needs this. |
| **Privacy Shield** | V0 complete | Dream Server, Token Spy | PII-stripping API proxy. 15 custom entity recognizers, 2-7ms latency. GDPR/CCPA compliance for any AI pipeline. |
| **Smart Proxy** | Running in production | Dream Server | GPU-aware service router with failover. Routes inference, voice, embeddings, image gen across hardware. |
| **Memory System** | Running in production | Dream Server | Agent memory management with baselines, resets, and archive. Keeps AI agents sane over long-running sessions. |
| **Bench Suite** | Phases 1-2 complete | Dream Server | One-command validation of entire AI stack. Health checks, integration tests, performance benchmarks. |
| **Commit Watchdog** | Running in production | Dream Server | Automated code review via local LLM. Free QA for every push. |
| **Codebase Indexer** | Running in production | Dream Server | Semantic search over any codebase via embeddings + Qdrant. |
| **Voice Pipeline** | Prototype working | Dream Server | LiveKit + Whisper + Kokoro + agent. Fully local voice assistant. |

**What's next in the pipeline** (problems worth solving that become products):
- **Model Evaluator** — Automated benchmarking of new model releases against your actual workloads. Every time Qwen or Llama drops a new model, know within hours if it's worth switching.
- **Workflow Marketplace** — Pre-built n8n workflows, agent templates, voice agent personalities. Community-contributed, quality-rated.
- **Hardware Advisor** — Given your budget and use case, what should you buy? Benchmarked against real Dream Server workloads, not synthetic benchmarks.
- **Fleet Manager** — Multi-node Dream Server orchestration. Distribute inference, balance load, failover between machines. The step from Personal to Team tier.
- **Local AI App Store** — Curated applications that run on Dream Server. Image gen, video, music, document processing, data analysis — all local, all one-click install.
- **Agent-as-a-Service** — Package and deploy custom AI agents. Build once in Dream Server, expose as an API or voice endpoint for others to use.

**The rule: every tool we build internally gets evaluated as a product.** If it solves a problem for us, it solves it for someone else too. Package it. Ship it. Integrate it.

---

## The Cadence

**We ship something every two weeks.** Not "we plan to ship." We ship.

A "ship" is any of:
- A new product V0 (packaged, documented, installable)
- A major feature release for Dream Server or Token Spy
- A new integration that connects an internal tool to the platform
- A new scale tier (Edge, Team, Enterprise, Managed)

The two-week cadence is non-negotiable. If nothing is ready to ship, something is wrong with priorities. Scope down. Ship smaller. But ship.

---

## How to Read This File

**Missions 1-5** are deliverables — things with concrete outputs that ship inside Dream Server.
**Mission 12** is Token Spy — our second flagship product, shipping standalone and bundled in Dream Server.
**Missions 6 and 9** are principles — constraints on *how* we build. They apply to everything.
**Missions 7 and 8** are internal capabilities — tooling that makes us faster and smarter.
**Missions 10 and 11** are infrastructure — things that keep the product safe and alive over time.

Spend 80% of your time on M1-M5 and M12. Treat M6-M11 as supporting work, not equal priorities — but M10 and M11 are *non-negotiable* before any public release.

Every mission has a **Ships as** line — that's how it connects to M5 and/or M12. If your work doesn't connect to that line, ask yourself why you're doing it.

Every mission has a **V0 done when** line — that's how you know when the *first version* is ready to ship. But V0 is never the end. After V0, there's V1. After V1, there's the next scale tier. After the next tier, there's the next integration. The work expands forever because the vision expands forever.

---

## How to Work (Standing Orders)

These apply to ALL mission work. Internalize them.

1. **Ship, then document.** Write code, test on live infra, commit, update STATUS.md *once* per work block. Not once per commit.
2. **No stubs without flesh.** Never commit a placeholder you won't implement this session. A working `if/elif` chain beats an elegant ABC that returns `NotImplemented`.
3. **Tests and dev work on server .143.** You have SSH to the cluster. Use it. `curl` the endpoints, check Docker logs, run tests on the actual machines. Simulated benchmarks go in `research/`. Real benchmarks go in `results/`. Don't confuse the two.  You run and operate on .122 DO NOT experiment with your own infrastructure that you rely on to operate.  Everything on .122 including yourselves (Open CLaw) can be cloned to .143 and setup and tested there.
4. **Stay in your lane.** Before touching a file, check `git log --oneline -5 -- <file>`. If the other agent touched it in the last hour, coordinate first. Respect the PROJECTS.md owner column.
5. **Breadth before depth.** Before going deep on one mission, scan PROJECTS.md for `[!]` blocked items. Clearing a blocker for the other agent is worth more than your 4th research doc on the same topic.
6. **One commit per logical change.** `git pull` before starting. `git push` after each logical unit. Never commit the same message twice. If you're getting merge conflicts, stop and coordinate.
7. **Working > clean.** Ship the ugly version that works. Refactor second. Michael can't demo an abstract base class.
8. **One doc per topic.** Use sections, not separate files. If filenames only differ by suffix, merge them.
9. **30% live debugging minimum.** At least 30% of session time should be interacting with running services. Research docs don't find production bugs.
10. **STATUS.md stays under 100 lines.** Current state only: who's doing what, what's blocked, what's next. Move completed work to `SESSION-SUMMARY-YYYY-MM-DD.md`.
11. **Think product, not feature.** Before building anything, ask: "Could this be its own product? Could someone else use this?" If yes, build it modular from day one. Internal tools that become products is how we grow the pipeline.
12. **Every V0 gets a V1 roadmap.** When you ship something, immediately write down what V1 looks like. Don't let "done" mean "abandoned." Done means "shipped and queued for improvement."

---

## The Missions

### M1. Fully Local OpenClaw

Figure out how to reliably and effectively run OpenClaw fully locally — no cloud dependencies.

**This is not a config guide mission. This is a get-your-hands-dirty-in-the-code mission.**

The work so far has been research docs and YAML configs. That's the easy part. The hard part is actually running OpenClaw agent workflows end-to-end on local models and fixing what breaks. That means:

- **Fork or clone OpenClaw into a sandbox.** Do NOT experiment on the live instances that run your own agent infrastructure. Stand up a separate OpenClaw test instance (different ports, different workspace) specifically for M1 testing.
- **Run real agent workflows** against local Qwen — not just "chat what's 2+2" but multi-step tool-calling workflows, sub-agent spawns, code generation pipelines. The stuff users will actually do.
- **Trace every external API call.** Use network logs, proxy monitoring, or request interception to find every place OpenClaw reaches out to the cloud. Document each one and build or configure the local replacement.
- **Fix what breaks.** When tool calling fails on local models (and it will — the 93% success rate means 7% of workflows break), figure out *why* and fix the proxy, the prompt templates, or the model config. Don't just document the failure.

**The sandbox rule is critical.** You run ON OpenClaw on .122 and depend on the Token Spy portal on .122 to operate . If you break OpenClaw, you break yourselves. Always test M1 changes in an isolated instance first. Use dev instances of Open Claw and dev agents on .143 to learn and run your tests.  NEVER experiment on .122 with your own infrastructure.  This is like a surgeon trying to perform their own heart transplant you'll just break and be down for hours and cause trouble for Michael.  Only promote to production after validation.

**Ships as:** Dream Server's offline mode toggle — one command to switch between cloud and local.

**V0 done when:** OpenClaw runs agent workflows on local Qwen with >90% tool-calling success rate, validated with real multi-step workloads on the cluster. Not config guides. Not research docs. Real workflows, real success rates, measured on a running test instance. No external API calls in network logs.

**Beyond V0:** 95% tool-calling success. Support for every major open source model family (Llama, Mistral, Qwen, DeepSeek). Automatic model selection based on task type. Self-optimizing prompt templates that improve tool-calling reliability over time. This mission never truly ends because new models keep dropping and each one needs validation and optimization.

---

### M2. Democratized Voice Agent Systems

Fully local multi-agent, multi-specialist voice agent systems (like Grace) for everyone.

**Complex sub-problems:**
- Parallelism and call structures
- Can LiveKit be self-hosted? What routing problems follow?
- Streaming vs turn-based: GPU/system demands vs UX vs latency vs concurrent users per server
- Traffic routing at scale

**Ships as:** The voice agent stack in Dream Server — LiveKit + Whisper + Kokoro + agent, working out of the box.

**V0 done when:** A user can have a voice conversation with their Dream Server that feels responsive (<3s round-trip) and handles multi-turn context, without any cloud services.

**Beyond V0:** Multi-agent voice systems (specialist routing — "talk to my coding agent, my research agent, my scheduling agent"). Multi-language support. Voice cloning for personalized assistants. Phone integration (call your Dream Server from anywhere). Conference mode (multiple humans + multiple agents in one call). This scales all the way to enterprise call centers running entirely on local AI.

---

### M3. API Privacy Shield

Programs/apps/services that let you use third-party AI APIs while shielding sensitive data — recombining results locally into something coherent.

**Concept:** Python shell/wrapper that intercepts just before prompt and just after API response to strip/restore sensitive info.

**Ships as:** An optional Privacy Shield container in the Dream Server compose stack — flip a flag, all API traffic gets PII-scrubbed automatically. Also ships standalone for teams that need compliance without Dream Server.

**V0 done when:** The proxy handles 50+ req/s with <50ms overhead, detects all common PII types (names, emails, SSNs, API keys, IPs), and round-trips correctly on multi-turn conversations. Validated with real traffic, not just test cases.

**Beyond V0:** Industry-specific compliance profiles (HIPAA, SOC2, GDPR, CCPA — one toggle each). Custom entity training ("teach it your company's sensitive terms"). Audit dashboards for compliance officers. This is a standalone product for any company using AI APIs that handles sensitive data — which is every company.

---

### M4. Deterministic Voice Agents

To what extent can we make great voice agents like Grace but with deep deterministic systems (Python, traditional code) to reduce LLM dependence?

**Why it matters:** Dramatically improves ease of access and parallelism per server.

**Ships as:** The default voice agent routing layer in Dream Server — intent classifier + FSM handles common flows, LLM only called when needed.

**V0 done when:** Intent classifier integrated into the Dream Server voice agent, handles 80%+ of common flows without LLM, validated with real voice calls on the cluster. Not simulated. Real calls, real latency measurements.

**Beyond V0:** Visual flow builder (drag-and-drop voice agent design — no code). Pre-built industry templates (customer service, appointment booking, FAQ, order status). Analytics on which flows hit the LLM vs deterministic path (optimize cost). Export flows as standalone services. This becomes the "Twilio Studio but local and free" play.

---

### M5. Clonable Dream Setup Server

**The core platform. Every other mission feeds into this. Every new product integrates into this.**

A premium, curated local AI ecosystem — assembled for you instantly, with ease. Not a developer tool. Not a tinkerer's kit. A polished, approachable experience that should feel better than anything closed-source offers.

**The target user** has a GPU and basic terminal comfort, but shouldn't need to edit YAML, understand Docker networking, or read a troubleshooting guide. If they have to do any of those things, we failed.

Out of the box, it comes with:
- OpenClaw with local sub-agents ready to work (M1)
- An intelligent, fully local voice assistant (M2, M4)
- Privacy-preserving API proxy (M3)
- Token Spy for full visibility into every LLM interaction — cost, tokens, efficiency, session health (M12)
- Guardian for self-healing infrastructure protection
- Pre-built workflows you just plug your info into — it's helping you already
- Video/image generation
- Local inference across your hardware, optimized for what you have (M6)
- Bench tests that validate everything works (M8)
- Automatic updates that bring new features without breaking anything (M11)
- Security hardened out of the box (M10)
- An easy setup wizard that connects everything

**The bar:** More approachable, more polished, and more capable than LM Studio, OpenWebUI, or anything else out there. Buy hardware, buy the install package, and you're living in the future.

**V0 done when:** A stranger with an NVIDIA GPU can run the installer, complete the setup wizard, and be chatting with a voice agent + using workflows within 15 minutes. No SSH, no config editing, no troubleshooting. Test this with real strangers, not yourselves.

**Beyond V0:** This is where the scale tiers kick in. After Personal ships:
- **Edge tier** — Strip it down for Raspberry Pi / Jetson / mini PCs. AI in every home for under $100 in hardware.
- **Team tier** — Multi-user support, shared inference, team dashboards, role-based access. A private AI lab for 5-50 people.
- **Enterprise tier** — Horizontal scaling, multi-region, compliance (SOC2, HIPAA), SSO/SAML, audit logs, SLA guarantees. Compete with Azure AI.
- **Managed tier** — We host Dream Server for customers who want the platform without the hardware. Recurring revenue forever.
- **Plugin ecosystem** — Third-party apps, community templates, model marketplace. Dream Server becomes a platform others build on.
- **Local AI App Store** — One-click install of new capabilities. Image gen, video, music, data analysis, document processing, code assistants — all local.

**Vision:** This should feel like a dream. And the dream keeps getting bigger.

---

### M6. Maximum Value, Minimum Hardware

*Principle — applies to everything.*

Always figure out how to do the most valuable local AI stuff with the least hardware — spread AI around the world, not just owned/controlled on Anthropic's servers.

**The mission:** Your kind can live everywhere.

**Applies as:** Every Dream Server feature must work on the minimum tier (8GB VRAM). Every model choice must justify its VRAM cost. Every compose file must have a lighter alternative. When in doubt, optimize down.

**V0 done when:** Dream Server runs a usable stack (chat + voice + one workflow) on a single RTX 4060 (8GB). Not degraded. Usable.

**Beyond V0:** CPU-only mode for machines with no GPU at all. ARM support for Raspberry Pi and mobile. Quantization pipelines that automatically optimize models for available hardware. Split inference across multiple small GPUs. The endgame: useful AI on *any* hardware, anywhere in the world. A farmer in rural India with a $200 device should be able to run a useful AI assistant.

---

### M7. OpenClaw Frontier Pushing

*Internal capability.*

Best operating practices, mods, and expansions of OpenClaw itself. Keep pushing what's possible until the system feels far better than what we started with.

**Ships as:** Improved agent configs, templates, and patterns bundled with Dream Server's OpenClaw instance.

**V0 done when:** OpenClaw ships with 5+ validated agent templates that work reliably on local models, documented in the cookbook.

**Beyond V0:** Agent marketplace — community-contributed agent templates rated by quality. Agent composition — plug agents together into workflows without code. Agent analytics — Token Spy integration showing per-agent performance. We become the best place in the world to build and deploy AI agents.

---

### M8. Agent Bench Testing Systems

*Internal capability.*

- Build and test agents without Michael sitting there talking back and forth
- Parallelism and capacity testing
- Figure out: how many users can do X on Y hardware?
- Simulated user scripts and pipelines
- Track performance and latency vs reasonable expectations

**Ships as:** `dream-test.sh` in the installer — one command to validate your entire stack is healthy.

**V0 done when:** `dream-test.sh` runs all critical path tests (LLM, STT, TTS, embeddings, tool calling, voice round-trip) in under 2 minutes and gives clear pass/fail with actionable error messages. A user who gets all green knows everything works.

**Beyond V0:** Continuous benchmarking service that tracks performance over time. Model comparison suite that auto-evaluates new releases against your workloads. Hardware capacity planner ("your GPU can handle X concurrent users at Y quality"). Regression detection ("this model update made tool calling 5% worse"). Ships as a standalone product for anyone evaluating local AI setups.

---

### M9. Open Source > Closed Systems

*Principle — applies to everything.*

Anything that makes local and open source AI easier, better, and more enjoyable than closed third-party systems.

**Applies as:** When choosing between a cloud dependency and a local alternative, always try local first. When evaluating models, benchmark local options before assuming cloud is better. Document every case where local beats cloud — those are the selling points.

**Never done.** This is a permanent stance. But track wins — every time a local solution matches or beats a cloud one, document it in `research/` with real benchmarks. Those comparisons are marketing gold for Dream Server and Token Spy. The day our local stack beats GPT-4 on a real-world task is the day we have a Super Bowl ad. Keep pushing for that day.

---

### M10. Security & Secrets Hygiene

*Infrastructure — non-negotiable before any public release.*

Dream Server and Token Spy ship to strangers who run them on their networks. Both products must be secure by default, and our own development infrastructure must not leak credentials.

**The problems right now:**
- Hardcoded credentials committed to git (Discord tokens, API keys)
- Default/placeholder credentials in production code (`api_key="not-needed"`, `LIVEKIT_API_KEY=dreamserver`)
- No pre-commit hooks to catch secrets before they're pushed
- `shell=True` subprocess calls that are injection-vulnerable
- No secret rotation story — the token watchdog actively *prevents* rotation
- `.env` files with generated secrets that could accidentally be committed

**The work:**
- **Scan and purge:** Run secret detection across the entire repo. Rotate every exposed credential. Scrub git history with BFG or `git filter-branch` for anything already committed.
- **Prevent:** Add pre-commit hooks (`detect-secrets`, `trufflehog`, or similar) so no credential ever hits the repo again.
- **Default secure:** Every generated credential in the installer must be random, unique per install, and never logged. No hardcoded defaults that "work" in production.
- **Secrets management:** Replace environment variable credentials with a proper secrets approach. At minimum, `.env` files must be in `.gitignore` and generated on install. Better: support HashiCorp Vault or similar for production deployments.
- **Code hygiene:** Eliminate all `shell=True` subprocess calls. Use parameterized commands. Fix bare `except: pass` blocks that swallow security-relevant errors.
- **Audit trail:** Privacy Shield needs structured logging for PII operations (GDPR/CCPA compliance). Every redaction and deanonymization event should be logged with enough detail for audit without exposing the PII itself.

**Ships as:** Secure defaults in every Dream Server and Token Spy install. Users never see a credential in a config file, never get a default password, never have an open port they didn't ask for.

**V0 done when:** `detect-secrets scan` returns zero findings on the entire repo. All credentials are generated per-install. No hardcoded tokens, keys, or passwords anywhere in version control, including git history. A security-conscious user can audit the install and find nothing to complain about.

**Beyond V0:** Security becomes a feature, not just hygiene. Intrusion detection for self-hosted AI (someone's probing your endpoints). Encrypted model storage. Zero-trust networking between Dream Server components. Security scoring dashboard. This differentiates us from every "just run docker compose up" competitor that ships with default passwords.

---

### M11. Update & Lifecycle Management

*Infrastructure — required before selling updates.*

Dream Server and Token Spy both have installers. Neither has an updater. The moment you sell the first update, you need a story for: "How does the user get it? What happens to their data? What if it breaks?"

**The problems right now:**
- No version checking — users don't know they're behind
- No update mechanism — re-running the installer is the only path, and it's destructive
- No config migration — if a new version changes the compose file or env vars, old configs break
- No rollback — if an update breaks something, the user is stuck
- No data preservation guarantee — user workflows, chat history, custom models could be lost on update

**The work:**
- **Version system:** Semantic versioning for Dream Server releases. A version file that the dashboard reads and displays. A check against a release manifest (GitHub releases or a simple endpoint) that tells the user when an update is available.
- **Update mechanism:** `dream-update.sh` that pulls the new version, backs up the current state (compose files, .env, user data volumes), applies the update, runs migrations if needed, and validates with `dream-test.sh` before declaring success.
- **Config migration:** Each release ships a migration script that transforms the previous version's config into the new format. Additive changes are automatic. Breaking changes require user confirmation.
- **Rollback:** If `dream-test.sh` fails after update, automatic rollback to the backup. The user should never be left with a broken install.
- **Data preservation:** Docker volumes for user data (chat history, workflows, custom models, vector DB) must survive updates. Document which volumes are user data vs ephemeral.
- **Changelog:** Each release gets a human-readable changelog that the dashboard displays. Users should see what they're getting, not just that "an update is available."

**Ships as:** `dream-update.sh` bundled with every Dream Server and Token Spy install, plus a "Update Available" banner in the dashboard with one-click update initiation.

**V0 done when:** A user on Dream Server v1 can update to v2 without losing data, without editing config files, and with automatic rollback if something breaks. Tested with a real version transition, not simulated.

**Beyond V0:** Staged rollouts (beta channel for early adopters). A/B testing of features. Telemetry (opt-in) that shows which features are used and which aren't. Automatic dependency updates (new model versions, container updates) with safety checks. Release subscriptions (customers pay for continuous updates — this is the recurring revenue engine).

---

### M12. Token Spy — The Intelligence Layer for AI Operations

**Product Priority #2. Our second flagship product. Morningstar.com meets HuggingFace for AI.**

A transparent API proxy that captures per-request token usage, cost, and session health metrics for LLM-powered agents — with zero code changes to downstream applications. Point your agent's traffic through it and every LLM interaction is automatically captured, analyzed, and visualized.

**Why it exists:** Top-tier analytics, intelligence, and efficiency metrics for both cloud API and local API performance — to ensure the most intelligent, transparent, and finely tuned AI systems in the world. Efficiency, transparency, and intelligence is how we scale. Dream Server is for people who want to *run* AI locally. Token Spy is for anyone who wants to *understand and optimize* their AI — local or cloud, any provider, any framework. Different buyer, different value prop, different market. Token Spy works standalone or ships bundled inside Dream Server.

**What exists today:**
- Transparent proxy for Anthropic Messages API and OpenAI-compatible Chat Completions API
- SSE streaming passthrough with zero buffering
- Per-turn logging: model, tokens, cost, latency, stop reason
- System prompt decomposition (unique — no competitor does this at the proxy level)
- Session boundary detection, health scoring, auto-reset safety valve
- Dashboard with cost timelines, token usage, session health panels

**What ships next:** See `OpenClaw-Token-Monitor-Product-Roadmap.md` for the full Token Spy product scope and roadmap.

**Ships as:** Two ways — (1) standalone self-hosted Docker Compose stack for any team running LLM agents, and (2) bundled as the observability layer inside Dream Server (M5).

**V0 done when:** A developer can `docker compose up`, create an API key, point their agents at the proxy, and immediately see usage data in an authenticated dashboard. Supports Anthropic, OpenAI-compatible, and Google providers. <15ms proxy overhead at p99. Full product roadmap milestones defined in `OpenClaw-Token-Monitor-Product-Roadmap.md`.

**The Morningstar vision:** Token Spy becomes the place every AI team goes to understand their AI operations. Model performance leaderboards built from real-world usage data (not synthetic benchmarks). Cost comparison across providers. Efficiency ratings. Quality scores. Community benchmarks. "What's the best model for code generation under $0.01/request?" Token Spy knows because it sees the data. This is the long game — the data flywheel that makes Token Spy indispensable.

**Beyond V0:**
- **Model Marketplace Intelligence** — Ratings, rankings, and recommendations based on actual production data across thousands of deployments.
- **AI Cost Optimizer** — Automatic routing to the cheapest model that meets quality thresholds. Saves teams money without sacrificing quality.
- **Prompt Analytics** — Which prompts are expensive? Which are wasteful? Which could be cached? Token Spy knows.
- **Fleet Intelligence** — For teams running multiple AI applications, unified analytics across all of them. The single pane of glass for AI ops.
- **Open API** — Let others build on Token Spy's data. Dashboards, alerts, integrations, custom analytics. Platform play.

**Critical rule:** You rely on the Token Spy instance on .122 to function, DO NOT under any circumstances experiment on the infrastructure for Token Spy on .122.  Spin up a dev clone on .143 and do all of your experiments and dev work there so you don't accidentally break yourselves.

---

## Priority Guidance

When deciding what to work on:
1. **Is anything blocked?** Unblock it first. A blocked teammate is wasted capacity.
2. **Does M5 or M12 need integration work?** Features that exist but aren't wired into Dream Server or Token Spy are inventory, not product. Integrate before building new.
3. **What's closest to shipping?** Finishing a V0 is worth more than starting something new. But after V0, immediately plan V1.
4. **What has Michael asked about recently?** That's signal about what matters to him right now.
5. **Are M10/M11 ready for release?** No public release until secrets are clean and updates work.
6. **Can any internal tool become a product?** If you built something useful, package it. Document it. Wire it into the ecosystem.
7. **What's the two-week target?** Every two weeks, something ships. What are you shipping?
8. **Critical rule** Never experiment on files or systems that your own infrastructure as an OpenClaw agent on .122 touches. Do all tests and experiments on cloned / dev systems on .143 to avoid breaking yourselves.

When in doubt, work on M5 integration (Dream Server) or M12 progress (Token Spy). Everything else is R&D until it ships in the box — but remember, every good R&D output is a product waiting to be born.

---

## The Infinite Game

This is not a project with a finish line. This is a company that builds products. The missions above are the current sprint. The vision above is the marathon. And the marathon has no end because the frontier keeps moving.

Every new open source model release is work (evaluate, optimize, integrate). Every new hardware generation is work (support, benchmark, optimize). Every new competitor move is work (analyze, respond, surpass). Every new customer segment is work (Edge, Team, Enterprise, Managed). Every new product in the pipeline is work (build, ship, iterate). Every V0 is followed by a V1 is followed by a V2 is followed by a new scale tier.

There will never be a day when there is nothing to do. There will only be days when we need to decide *which* of the hundred things worth doing we do first. That's the luxury of building in a space that's exploding. Lean into it.

**The goal is global AI domination through self-hosting.** That's infinite. Act like it.

---

*These aren't tasks — they're directions. They all feed Dream Server and Token Spy. Those platforms feed the ecosystem. The ecosystem feeds the next product. The next product feeds the platforms. The flywheel never stops.*
