# Memory System V5 — Definitive Architecture

> Built on: V4 Draft + Hackathon Teams 1–5 + Infrastructure Research (Turso/Convex/Retrieval Pipeline)
> Status: Pre-implementation design document
> Date: 2026-02-22
> Key change from V4: Turso/libSQL replaces better-sqlite3, Convex for auth/team/UI, OpenAI embedding fallback, Graphiti replaced by TS Knowledge Graph, complete retrieval pipeline from day one

---

## Table of Contents

1. [Design Philosophy and Competitive Positioning](#1-design-philosophy-and-competitive-positioning)
2. [Infrastructure Architecture](#2-infrastructure-architecture)
3. [Memory Schema](#3-memory-schema)
4. [Memory Observer](#4-memory-observer)
5. [Scratchpad to Validated Promotion Pipeline](#5-scratchpad-to-validated-promotion-pipeline)
6. [Knowledge Graph](#6-knowledge-graph)
7. [Complete Retrieval Pipeline](#7-complete-retrieval-pipeline)
8. [Embedding Strategy](#8-embedding-strategy)
9. [Agent Loop Integration](#9-agent-loop-integration)
10. [Build Pipeline Integration](#10-build-pipeline-integration)
11. [Worker Thread Architecture and Concurrency](#11-worker-thread-architecture-and-concurrency)
12. [Cross-Session Pattern Synthesis](#12-cross-session-pattern-synthesis)
13. [UX and Developer Trust](#13-ux-and-developer-trust)
14. [Cloud Sync, Multi-Device, and Web App](#14-cloud-sync-multi-device-and-web-app)
15. [Team and Organization Memories](#15-team-and-organization-memories)
16. [Privacy and Compliance](#16-privacy-and-compliance)
17. [Database Schema](#17-database-schema)
18. [Memory Pruning and Lifecycle](#18-memory-pruning-and-lifecycle)
19. [A/B Testing and Metrics](#19-ab-testing-and-metrics)
20. [Implementation Checklist](#20-implementation-checklist)
21. [Open Questions](#21-open-questions)

---

## 1. Design Philosophy and Competitive Positioning

### Why Memory Is the Technical Moat

Auto Claude positions as "more control than Lovable, more automatic than Cursor or Claude Code." Memory is the primary mechanism that delivers on this promise. Every session without memory forces agents to rediscover the codebase from scratch — re-reading the same files, retrying the same failed approaches, hitting the same gotchas. With a well-designed memory system, agents navigate the codebase like senior developers who built it.

The accumulated value compounds over time:

```
Sessions 1-5:   Cold. Agent explores from scratch every session.
                High discovery cost. No patterns established.

Sessions 5-15:  Co-access graph built. Prefetch patterns emerging.
                Gotchas accumulating. ~30% reduction in redundant reads.

Sessions 15-30: Calibration active. QA failures no longer recur.
                Workflow recipes firing at planning time.
                Impact analysis preventing ripple bugs.
                ~60% reduction in discovery cost.

Sessions 30+:   The system knows this codebase. Agents navigate it
                like senior developers who built it. Context token
                savings measurable in the thousands per session.
```

### The Three-Tier Injection Model

| Tier | When | Mechanism | Purpose |
|------|------|-----------|---------|
| Passive | Session start | System prompt + initial message injection | Global memories, module memories, workflow recipes, work state |
| Reactive | Mid-session, agent-requested | `search_memory` tool in agent toolset | On-demand retrieval when agent explicitly needs context |
| Active | Mid-session, system-initiated | `prepareStep` callback in `streamText()` | Proactive injection per step based on what agent just did |

### Observer-First Philosophy

The most valuable memories are never explicitly requested. They emerge from watching what the agent does — which files it reads together, which errors it retries, which edits it immediately reverts, which approaches it abandons. Explicit `record_memory` calls are supplementary, not primary.

### Competitive Gap Matrix

| Capability | Cursor | Windsurf | Copilot | Augment | Devin | Auto Claude V5 |
|---|---|---|---|---|---|---|
| Behavioral observation | No | Partial | No | No | No | Yes (17 signals) |
| Co-access graph | No | No | No | No | No | Yes |
| BM25 + semantic + graph hybrid | No | No | No | Partial | No | Yes |
| Graph neighborhood boost | No | No | No | No | No | Yes (+7pp, unique) |
| Cross-encoder reranking | No | No | No | No | No | Yes (local) |
| AST-based chunking | Partial | No | No | No | No | Yes (tree-sitter) |
| Contextual embeddings | No | No | No | No | No | Yes |
| Active prepareStep injection | No | No | No | No | No | Yes |
| Scratchpad-to-promotion gate | No | No | No | No | No | Yes |
| Knowledge graph (3 layers) | No | No | No | No | No | Yes |
| Same code path local + cloud | N/A | N/A | N/A | N/A | N/A | Yes (libSQL) |

**Where Auto Claude uniquely wins:**
1. **Graph neighborhood boost** — 3-path hybrid retrieval that boosts results co-located in the knowledge graph. No competitor does this because none have a closure-table knowledge graph.
2. **Behavioral observation** — watching what agents *do*, not what they say.
3. **Active prepareStep injection** — the third tier that fires between every agent step.

---

## 2. Infrastructure Architecture

### The Core Design Decision: Turso/libSQL

The single most important infrastructure decision is using **Turso/libSQL** (`@libsql/client`) as the memory database. This gives us identical query code for both local Electron and cloud web app deployments.

```typescript
// Free tier — Electron desktop, no login
const db = createClient({ url: 'file:memory.db' });

// Logged-in user — Electron with cloud sync
const db = createClient({
  url: 'file:memory.db',            // Local replica (fast reads)
  syncUrl: 'libsql://project-user.turso.io',
  authToken: convexAuthToken,
  syncInterval: 60,                 // Sync every 60 seconds
});

// Web app (SaaS, Next.js) — no local file, pure cloud
const db = createClient({
  url: 'libsql://project-user.turso.io',
  authToken: convexAuthToken,
});
```

**The identical query**: FTS5, vector search, closure tables, co-access edges — same SQL works in all three modes.

### Technology Stack

| Concern | Technology | Notes |
|---------|-----------|-------|
| Memory storage | libSQL (`@libsql/client`) | Turso Cloud in cloud mode, in-process for local |
| Vector search | `sqlite-vec` extension | `vector_distance_cos()`, `vector_top_k()` — works in libSQL |
| BM25 search | FTS5 virtual table | Same in local and cloud; FTS5 not Tantivy (Tantivy is cloud-only) |
| Knowledge graph | SQLite closure tables | Recursive CTEs work in libSQL |
| Auth, billing, team UI | Convex + Better Auth | Real-time subscriptions, multi-tenancy, per-query scoping |
| Embeddings (local) | Qwen3-embedding 4b/8b via Ollama | 1024-dim primary |
| Embeddings (cloud/fallback) | OpenAI `text-embedding-3-small` | Request 1024-dim to match Qwen3 |
| Reranking (local) | Qwen3-Reranker-0.6B via Ollama | Free, ~85-380ms latency |
| Reranking (cloud) | Cohere Rerank API | ~$1/1K queries, ~200ms latency |
| AST parsing | tree-sitter WASM (`web-tree-sitter`) | No native rebuild on Electron updates |
| Agent execution | Vercel AI SDK v6 `streamText()` | Worker threads in Electron |

### Deployment Modes

```
MODE 1: Free / Offline (Electron, no login)
  └── libSQL in-process → memory.db
      ├── All features work offline
      ├── No cloud sync
      └── Ollama for embeddings (or OpenAI fallback)

MODE 2: Cloud User (Electron, logged in)
  └── libSQL embedded replica → memory.db + syncUrl → Turso Cloud
      ├── Same queries, same tables
      ├── Reads from local replica (fast, offline-tolerant)
      ├── Syncs to Turso Cloud every 60s
      └── Convex for auth, team memory display, real-time UI

MODE 3: Web App (Next.js SaaS)
  └── libSQL → Turso Cloud directly (no local file)
      ├── Same queries as Electron
      ├── OpenAI embeddings (no Ollama in cloud)
      ├── Convex for auth, billing, real-time features
      └── Cohere Rerank API for cross-encoder reranking
```

### Convex Responsibilities (What Convex Is NOT Doing)

Convex handles the **application layer** concerns, NOT memory storage:

| Convex handles | libSQL/Turso handles |
|----------------|---------------------|
| Authentication (Better Auth) | All memory records |
| Session management | Vector embeddings |
| Team membership + roles | Knowledge graph nodes/edges |
| Billing and subscription state | FTS5 BM25 index |
| Real-time UI subscriptions | Co-access graph |
| Project metadata | Observer scratchpad data |

This clean split means Convex never touches the hot path of memory search. libSQL handles all data-intensive operations.

### Multi-Tenancy with Turso

Every user or project gets an isolated Turso database. This is Turso's database-per-tenant model:

```
user-alice-project-myapp.turso.io    → Alice's memory for "myapp"
user-alice-project-backend.turso.io  → Alice's memory for "backend"
user-bob-project-myapp.turso.io      → Bob's memory for "myapp"
```

No row-level security complexity. No cross-tenant leak risk. Each database is fully isolated.

### Cost at Scale

| Users | Turso (Scaler $25/month base) | Convex (Pro $25/month) | OpenAI Embeddings | Total |
|-------|-------------------------------|------------------------|-------------------|-------|
| 10 | $25 | $25 | <$1 | ~$51/mo |
| 100 | ~$165 | $25 | ~$3 | ~$193/mo |
| 500 | ~$1,200 | $25+ | ~$15 | ~$1,240/mo |

At 500+ users, negotiate Turso Enterprise pricing. Writes dominate the bill; embedded replica reads are free.

---

## 3. Memory Schema

### Core Memory Interface

```typescript
// apps/desktop/src/main/ai/memory/types.ts

interface Memory {
  id: string;                           // UUID
  type: MemoryType;
  content: string;
  confidence: number;                   // 0.0 - 1.0
  tags: string[];
  relatedFiles: string[];
  relatedModules: string[];
  createdAt: string;                    // ISO 8601
  lastAccessedAt: string;
  accessCount: number;

  workUnitRef?: WorkUnitRef;
  scope: MemoryScope;

  // Provenance
  source: MemorySource;
  sessionId: string;
  commitSha?: string;
  provenanceSessionIds: string[];

  // Knowledge graph link
  targetNodeId?: string;
  impactedNodeIds?: string[];

  // Relations
  relations?: MemoryRelation[];

  // Decay
  decayHalfLifeDays?: number;

  // Trust
  needsReview?: boolean;
  userVerified?: boolean;
  citationText?: string;               // Max 40 chars, for inline chips
  pinned?: boolean;                    // Pinned memories never decay
  methodology?: string;              // Which plugin created this (for cross-plugin retrieval)

  // Chunking metadata (V5 new — for AST-chunked code memories)
  chunkType?: 'function' | 'class' | 'module' | 'prose';
  chunkStartLine?: number;
  chunkEndLine?: number;
  contextPrefix?: string;              // Prepended at embed time for contextual embeddings
}

type MemoryType =
  // Core
  | 'gotcha'            // Trap or non-obvious constraint
  | 'decision'          // Architectural decision with rationale
  | 'preference'        // User or project coding preference
  | 'pattern'           // Reusable implementation pattern
  | 'requirement'       // Functional or non-functional requirement
  | 'error_pattern'     // Recurring error and its fix
  | 'module_insight'    // Understanding about a module's purpose

  // Active loop
  | 'prefetch_pattern'  // Files always/frequently read together
  | 'work_state'        // Partial work snapshot for cross-session continuity
  | 'causal_dependency' // File A must be touched when file B changes
  | 'task_calibration'  // Actual vs planned step ratio per module

  // V3+
  | 'e2e_observation'   // UI behavioral fact from MCP tool use
  | 'dead_end'          // Strategic approach tried and abandoned
  | 'work_unit_outcome' // Per work-unit result
  | 'workflow_recipe'   // Step-by-step procedural map
  | 'context_cost';     // Token consumption profile per module

type MemorySource =
  | 'agent_explicit'    // Agent called record_memory
  | 'observer_inferred' // MemoryObserver derived from behavioral signals
  | 'qa_auto'           // Auto-extracted from QA report failures
  | 'mcp_auto'          // Auto-extracted from Electron MCP tool results
  | 'commit_auto'       // Auto-tagged at git commit time
  | 'user_taught';      // User typed /remember or used Teach panel

type MemoryScope = 'global' | 'module' | 'work_unit' | 'session';

interface WorkUnitRef {
  methodology: string;      // 'native' | 'bmad' | 'tdd'
  hierarchy: string[];      // e.g. ['spec_042', 'subtask_3']
  label: string;
}

type UniversalPhase =
  | 'define'      // Planning, spec creation, writing failing tests
  | 'implement'   // Coding, development
  | 'validate'    // QA, acceptance criteria
  | 'refine'      // Refactoring, cleanup, fixing QA issues
  | 'explore'     // Research, insights, discovery
  | 'reflect';    // Session wrap-up, learning capture

interface MemoryRelation {
  targetMemoryId?: string;
  targetFilePath?: string;
  relationType: 'required_with' | 'conflicts_with' | 'validates' | 'supersedes' | 'derived_from';
  confidence: number;
  autoExtracted: boolean;
}
```

### Extended Memory Types

```typescript
interface WorkflowRecipe extends Memory {
  type: 'workflow_recipe';
  taskPattern: string;        // "adding a new IPC handler"
  steps: Array<{
    order: number;
    description: string;
    canonicalFile?: string;
    canonicalLine?: number;
  }>;
  lastValidatedAt: string;
  successCount: number;
  scope: 'global';
}

interface DeadEndMemory extends Memory {
  type: 'dead_end';
  approachTried: string;
  whyItFailed: string;
  alternativeUsed: string;
  taskContext: string;
  decayHalfLifeDays: 90;
}

interface PrefetchPattern extends Memory {
  type: 'prefetch_pattern';
  alwaysReadFiles: string[];       // >80% session coverage
  frequentlyReadFiles: string[];   // >50% session coverage
  moduleTrigger: string;
  sessionCount: number;
  scope: 'module';
}

interface TaskCalibration extends Memory {
  type: 'task_calibration';
  module: string;
  methodology: string;
  averageActualSteps: number;
  averagePlannedSteps: number;
  ratio: number;
  sampleCount: number;
}
```

### Methodology Abstraction Layer

All methodology phases map into six `UniversalPhase` values. The retrieval engine operates exclusively on `UniversalPhase`.

```typescript
interface MemoryMethodologyPlugin {
  id: string;
  displayName: string;
  mapPhase(methodologyPhase: string): UniversalPhase;
  resolveWorkUnitRef(context: ExecutionContext): WorkUnitRef;
  getRelayTransitions(): RelayTransition[];
  formatRelayContext(memories: Memory[], toStage: string): string;
  extractWorkState(sessionOutput: string): Promise<Record<string, unknown>>;
  formatWorkStateContext(state: Record<string, unknown>): string;
  customMemoryTypes?: MemoryTypeDefinition[];
  onWorkUnitComplete?(ctx: ExecutionContext, result: WorkUnitResult, svc: MemoryService): Promise<void>;
}

const nativePlugin: MemoryMethodologyPlugin = {
  id: 'native',
  displayName: 'Auto Claude (Subtasks)',
  mapPhase: (p) => ({
    planning: 'define', spec: 'define',
    coding: 'implement',
    qa_review: 'validate', qa_fix: 'refine',
    debugging: 'refine',
    insights: 'explore',
  }[p] ?? 'explore'),
  resolveWorkUnitRef: (ctx) => ({
    methodology: 'native',
    hierarchy: [ctx.specNumber, ctx.subtaskId].filter(Boolean),
    label: ctx.subtaskId
      ? `Spec ${ctx.specNumber} / Subtask ${ctx.subtaskId}`
      : `Spec ${ctx.specNumber}`,
  }),
  getRelayTransitions: () => [
    { from: 'planner', to: 'coder' },
    { from: 'coder', to: 'qa_reviewer' },
    { from: 'qa_reviewer', to: 'qa_fixer', filter: { types: ['error_pattern', 'requirement'] } },
  ],
};
```

---

## 4. Memory Observer

The Observer is the passive behavioral layer. It runs on the main thread, tapping every `postMessage` event from worker threads. It never writes to the database during execution.

### 17-Signal Taxonomy with Priority Scoring

Signal value formula: `signal_value = (diagnostic_value × 0.5) + (cross_session_relevance × 0.3) + (1.0 - false_positive_rate) × 0.2`

Signals with `signal_value < 0.4` are discarded before promotion filtering.

| # | Signal Class | Score | Promotes To | Min Sessions |
|---|-------------|-------|-------------|-------------|
| 2 | Co-Access Graph | 0.91 | causal_dependency, prefetch_pattern | 3 |
| 9 | Self-Correction | 0.88 | gotcha, module_insight | 1 |
| 3 | Error-Retry | 0.85 | error_pattern, gotcha | 2 |
| 16 | Parallel Conflict | 0.82 | gotcha | 1 |
| 5 | Read-Abandon | 0.79 | gotcha | 3 |
| 6 | Repeated Grep | 0.76 | module_insight, gotcha | 2 |
| 13 | Test Order | 0.74 | task_calibration | 3 |
| 7 | Tool Sequence | 0.73 | workflow_recipe | 3 |
| 1 | File Access | 0.72 | prefetch_pattern | 3 |
| 15 | Step Overrun | 0.71 | task_calibration | 3 |
| 4 | Backtrack | 0.68 | gotcha | 2 |
| 14 | Config Touch | 0.66 | causal_dependency | 2 |
| 11 | Glob-Ignore | 0.64 | gotcha | 2 |
| 17 | Context Token Spike | 0.63 | context_cost | 3 |
| 10 | External Reference | 0.61 | module_insight | 3 |
| 12 | Import Chase | 0.52 | causal_dependency | 4 |
| 8 | Time Anomaly | 0.48 | (with correlation) | 3 |

### Self-Correction Detection

```typescript
const SELF_CORRECTION_PATTERNS = [
  /I was wrong about (.+?)\. (.+?) is actually/i,
  /Let me reconsider[.:]? (.+)/i,
  /Actually,? (.+?) (not|instead of|rather than) (.+)/i,
  /I initially thought (.+?) but (.+)/i,
  /Correction: (.+)/i,
  /Wait[,.]? (.+)/i,
];
```

### Trust Defense Layer (Anti-Injection)

Inspired by the Windsurf SpAIware exploit. Any signal derived from agent output produced after a WebFetch or WebSearch call is flagged as potentially tainted:

```typescript
function applyTrustGate(
  candidate: MemoryCandidate,
  externalToolCallStep: number | undefined,
): MemoryCandidate {
  if (externalToolCallStep !== undefined && candidate.originatingStep > externalToolCallStep) {
    return {
      ...candidate,
      needsReview: true,
      confidence: candidate.confidence * 0.7,
      trustFlags: { contaminated: true, contaminationSource: 'web_fetch' },
    };
  }
  return candidate;
}
```

### Performance Budget

| Resource | Hard Limit | Enforcement |
|---------|-----------|-------------|
| CPU per event (ingest) | 2ms | `process.hrtime.bigint()` measurement; logged if exceeded, never throw |
| CPU for finalize (non-LLM) | 100ms | Budget tracked; abort if exceeded |
| Scratchpad resident memory | 50MB | Pre-allocated buffers; evict low-value signals on overflow |
| LLM synthesis calls per session | 1 max | Counter enforced in `finalize()` |
| Memories promoted per session | 20 (build), 5 (insights), 3 (others) | Hard cap |
| DB writes per session | 1 batched transaction after finalize | No writes during execution |

### Key Implementation Details (Reference V4)

```typescript
// Dead-end detection patterns (from agent text stream)
const DEAD_END_LANGUAGE_PATTERNS = [
  /this approach (won't|will not|cannot) work/i,
  /I need to abandon this/i,
  /let me try a different approach/i,
  /unavailable in (test|ci|production)/i,
  /not available in this environment/i,
];

// In-session early promotion triggers
const EARLY_TRIGGERS = [
  { condition: (a: ScratchpadAnalytics) => a.selfCorrectionCount >= 1, signalType: 'self_correction', priority: 0.9 },
  { condition: (a) => [...a.grepPatternCounts.values()].some(c => c >= 3), signalType: 'repeated_grep', priority: 0.8 },
  { condition: (a) => a.configFilesTouched.size > 0 && a.fileEditSet.size >= 2, signalType: 'config_touch', priority: 0.7 },
  { condition: (a) => a.errorFingerprints.size >= 2, signalType: 'error_retry', priority: 0.75 },
];
```

### MemoryObserver Class Interface

```typescript
export class MemoryObserver {
  private readonly scratchpad: Scratchpad;
  private externalToolCallStep: number | undefined = undefined;

  observe(message: MemoryIpcRequest): void {
    const start = process.hrtime.bigint();

    switch (message.type) {
      case 'memory:tool-call': this.onToolCall(message); break;
      case 'memory:tool-result': this.onToolResult(message); break;
      case 'memory:reasoning': this.onReasoning(message); break;
      case 'memory:step-complete': this.onStepComplete(message.stepNumber); break;
    }

    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
    if (elapsed > 2) {
      logger.warn(`[MemoryObserver] observe() budget exceeded: ${elapsed.toFixed(2)}ms`);
    }
  }

  async finalize(outcome: SessionOutcome): Promise<MemoryCandidate[]> {
    const candidates = [
      ...this.finalizeCoAccess(),
      ...this.finalizeErrorRetry(),
      ...this.finalizeAcuteCandidates(),
      ...this.finalizeRepeatedGrep(),
      ...this.finalizeSequences(),
    ];

    const gated = candidates.map(c => applyTrustGate(c, this.externalToolCallStep));
    const gateLimit = SESSION_TYPE_PROMOTION_LIMITS[this.scratchpad.sessionType];
    const filtered = gated.sort((a, b) => b.priority - a.priority).slice(0, gateLimit);

    if (outcome === 'success' && filtered.some(c => c.signalType === 'co_access')) {
      const synthesized = await this.synthesizeWithLLM(filtered);
      filtered.push(...synthesized);
    }

    return filtered;
  }
}
```

---

## 5. Scratchpad to Validated Promotion Pipeline

### Scratchpad Data Structures

```typescript
interface Scratchpad {
  sessionId: string;
  sessionType: SessionType;
  startedAt: number;
  signals: Map<SignalType, ObserverSignal[]>;
  analytics: ScratchpadAnalytics;
  acuteCandidates: AcuteCandidate[];
}

interface ScratchpadAnalytics {
  fileAccessCounts: Map<string, number>;
  fileFirstAccess: Map<string, number>;
  fileLastAccess: Map<string, number>;
  fileEditSet: Set<string>;
  grepPatternCounts: Map<string, number>;
  errorFingerprints: Map<string, number>;
  currentStep: number;
  recentToolSequence: CircularBuffer<string>;   // last 8 tool calls
  intraSessionCoAccess: Map<string, Set<string>>;
  configFilesTouched: Set<string>;
  selfCorrectionCount: number;
  totalInputTokens: number;
}
```

### Promotion Gates by Session Type

| Session Type | Gate Trigger | Max Memories | Primary Signals |
|---|---|---|---|
| Build (full pipeline) | QA passes | 20 | All 17 signals |
| Insights | Session end | 5 | co_access, self_correction, repeated_grep |
| Roadmap | Session end | 3 | decision, requirement |
| Terminal (agent terminal) | Session end | 3 | error_retry, sequence |
| Changelog | Skip | 0 | None |
| Spec Creation | Spec accepted | 3 | file_access, module_insight |
| PR Review | Review completed | 8 | error_retry, self_correction |

### Promotion Filter Pipeline

1. **Validation filter**: discard signals from failed approaches (unless becoming `dead_end`)
2. **Frequency filter**: require minimum sessions per signal class
3. **Novelty filter**: cosine similarity > 0.88 to existing memory = discard
4. **Trust gate**: contamination check for post-external-tool signals
5. **Scoring**: final confidence from signal priority + session count + source trust multiplier
6. **LLM synthesis**: single `generateText()` call — raw signal data → 1-3 sentence memory content
7. **Embedding generation**: batch embed all promoted memories
8. **DB write**: single transaction for all promoted memories

### Scratchpad Checkpointing

At each subtask boundary, checkpoint the scratchpad to disk to survive Electron crashes during long pipelines:

```typescript
await scratchpadStore.checkpoint(workUnitRef, sessionId);
// On restart: restore from checkpoint and continue
```

For builds with more than 5 subtasks, promote scratchpad notes after each validated subtask rather than waiting for the full pipeline.

---

## 6. Knowledge Graph

Fully TypeScript. **Graphiti Python MCP sidecar is removed.** All structural and semantic code intelligence lives here.

### Three-Layer Architecture

```
LAYER 3: KNOWLEDGE (agent-discovered + LLM-analyzed)
+----------------------------------------------------------+
|  [Pattern: Repository]    [Decision: JWT over sessions]  |
|       | applies_pattern        | documents               |
+----------------------------------------------------------+
LAYER 2: SEMANTIC (LLM-derived module relationships)
+----------------------------------------------------------+
|  [Module: auth]  --is_entrypoint_for-->  [routes/auth.ts]|
|  [Fn: login()] --flows_to--> [Fn: validateCreds()]       |
+----------------------------------------------------------+
LAYER 1: STRUCTURAL (AST-extracted via tree-sitter WASM)
+----------------------------------------------------------+
|  [File: routes/auth.ts]                                  |
|       | imports                                          |
|       v                                                  |
|  [File: middleware/auth.ts] --calls--> [Fn: verifyJwt()] |
+----------------------------------------------------------+
```

Layer 1: computed from code — fast, accurate, automatically maintained via file watchers.
Layer 2: LLM analysis of Layer 1 subgraphs — async, scheduled.
Layer 3: accumulates from agent sessions and user input — continuous, incremental.

### tree-sitter WASM Integration

```typescript
import Parser from 'web-tree-sitter';
import { app } from 'electron';
import { join } from 'path';

const GRAMMAR_PATHS: Record<string, string> = {
  typescript:  'tree-sitter-typescript.wasm',
  tsx:         'tree-sitter-tsx.wasm',
  python:      'tree-sitter-python.wasm',
  rust:        'tree-sitter-rust.wasm',
  go:          'tree-sitter-go.wasm',
  javascript:  'tree-sitter-javascript.wasm',
};

export class TreeSitterLoader {
  private getWasmDir(): string {
    return app.isPackaged
      ? join(process.resourcesPath, 'grammars')
      : join(__dirname, '..', '..', '..', '..', 'node_modules', 'tree-sitter-wasms');
  }

  async initialize(): Promise<void> {
    await Parser.init({ locateFile: (f) => join(this.getWasmDir(), f) });
  }

  async loadGrammar(lang: string): Promise<Parser.Language | null> {
    const wasmFile = GRAMMAR_PATHS[lang];
    if (!wasmFile) return null;
    return Parser.Language.load(join(this.getWasmDir(), wasmFile));
  }
}
```

Grammar load time: ~50ms per grammar. Incremental re-parse: <5ms on edit. No native rebuild on Electron updates.

### AST-Based Chunking (V5 New — Built In From Day One)

Instead of chunking code by fixed line counts, split at function/class boundaries using tree-sitter. This prevents function bodies from being split across chunks.

```typescript
interface ASTChunk {
  content: string;
  filePath: string;
  language: string;
  chunkType: 'function' | 'class' | 'module' | 'prose';
  startLine: number;
  endLine: number;
  name?: string;               // Function name, class name, etc.
  contextPrefix: string;       // Prepended at embed time
}

export async function chunkFileByAST(
  filePath: string,
  content: string,
  lang: string,
  parser: Parser,
): Promise<ASTChunk[]> {
  const tree = parser.parse(content);
  const chunks: ASTChunk[] = [];

  // Walk tree looking for function/class declarations
  // Split at these boundaries; never split a function body across chunks
  // For files with no AST structure (JSON, .md), fall back to 100-line chunks

  const query = CHUNK_QUERIES[lang];
  if (!query) return fallbackChunks(content, filePath);

  const matches = query.matches(tree.rootNode);
  for (const match of matches) {
    const node = match.captures[0].node;
    chunks.push({
      content: node.text,
      filePath,
      language: lang,
      chunkType: nodeTypeToChunkType(node.type),
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      name: extractName(node),
      contextPrefix: buildContextPrefix(filePath, node),
    });
  }

  return chunks;
}
```

The `contextPrefix` is critical — it's prepended at embed time for contextual embeddings (see Section 8).

### Impact Analysis via Closure Table

Pre-computed closure enables O(1) "what breaks if I change X?" queries:

```typescript
// Agent tool call: analyzeImpact({ target: "auth/tokens.ts:verifyJwt", maxDepth: 3 })
// SQL:
// SELECT descendant_id, depth, path, total_weight
// FROM graph_closure
// WHERE ancestor_id = ? AND depth <= 3
// ORDER BY depth, total_weight DESC
```

### Staleness Model (Glean-Inspired)

When a source file changes, immediately mark all edges from it as stale (`stale_at = NOW()`). Re-index asynchronously. Agents always query `WHERE stale_at IS NULL`.

```typescript
// IncrementalIndexer: chokidar file watcher with 500ms debounce
// On change: markFileEdgesStale(filePath) → rebuildEdges(filePath) → updateClosure()
```

### Kuzu Migration Threshold

Migrate from SQLite closure tables to Kuzu graph database when:
- 50,000+ graph nodes, OR
- 500MB SQLite size, OR
- P99 graph query latency > 100ms

---

## 7. Complete Retrieval Pipeline

V5 builds the complete pipeline from day one. No phased introduction of retrieval tiers.

### Pipeline Overview

```
Stage 1: CANDIDATE GENERATION (parallel, ~10-50ms)
├── Path A: Dense vector search via sqlite-vec
│   └── 256-dim MRL query → top 30 (cosine similarity, fast)
├── Path B: FTS5 BM25 keyword search
│   └── Exact technical terms → top 20
└── Path C: Knowledge graph traversal
    └── Files in recently accessed module → 1-hop neighbors → top 15

De-duplicate across paths.
Total: ~50-70 candidates.

Stage 2a: RRF FUSION + PHASE FILTERING (~2ms)
└── Weighted Reciprocal Rank Fusion (identifier queries: FTS5 0.5 / graph 0.3 / dense 0.2)
                                      (semantic queries: dense 0.5 / FTS5 0.25 / graph 0.25)
                                      (structural queries: graph 0.6 / FTS5 0.25 / dense 0.15)

Stage 2b: GRAPH NEIGHBORHOOD BOOST (~5ms) ← FREE LUNCH, UNIQUE ADVANTAGE
└── For each top-10 result, query closure table for 1-hop neighbors
    Boost candidates in positions 11-50 that neighbor top results:
    boosted_score = rrf_score + 0.3 × (neighbor_count / 10)

Stage 3: CROSS-ENCODER RERANKING (~85-380ms, local Electron only)
├── Qwen3-Reranker-0.6B via Ollama
├── Top 20 candidates → final top 8
└── In cloud/web mode, use Cohere Rerank API (~$1/1K queries)

Stage 4: CONTEXT PACKING (~1ms)
├── Deduplicate overlapping chunks
├── Cluster by file locality
├── Pack into token budget per phase
└── Append citation chip format to each memory
```

### Query Type Detection

```typescript
function detectQueryType(query: string, recentToolCalls: string[]): 'identifier' | 'semantic' | 'structural' {
  // Identifier: query contains camelCase, snake_case, or known file paths
  if (/[a-z][A-Z]|_[a-z]/.test(query) || query.includes('/')) return 'identifier';

  // Structural: recent tool calls include analyzeImpact or graph queries
  if (recentToolCalls.some(t => t === 'analyzeImpact' || t === 'getDependencies')) return 'structural';

  return 'semantic';
}
```

### BM25 via SQLite FTS5

**Note:** FTS5 is used in ALL modes (local and cloud). Turso's Tantivy is cloud-only and inconsistent. FTS5 is simpler and identical everywhere.

```sql
-- BM25 search
SELECT m.id, bm25(memories_fts) AS bm25_score
FROM memories_fts
JOIN memories m ON memories_fts.memory_id = m.id
WHERE memories_fts MATCH ?
  AND m.project_id = ?
  AND m.deprecated = 0
ORDER BY bm25_score   -- lower is better in SQLite FTS5
LIMIT 100;
```

### Reciprocal Rank Fusion

```typescript
function weightedRRF(
  paths: Array<{ results: Array<{ memoryId: string }>; weight: number }>,
  k: number = 60,
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const { results, weight } of paths) {
    results.forEach((r, rank) => {
      const contribution = weight / (k + rank + 1);
      scores.set(r.memoryId, (scores.get(r.memoryId) ?? 0) + contribution);
    });
  }

  return scores;
}
```

**IMPORTANT — libSQL FULL OUTER JOIN workaround**: libSQL doesn't support `FULL OUTER JOIN`. Use UNION pattern for RRF merging:

```sql
-- Merge dense and BM25 results without FULL OUTER JOIN
SELECT id FROM (
  SELECT memory_id AS id FROM dense_results
  UNION
  SELECT memory_id AS id FROM bm25_results
)
```

RRF scoring is done application-side after fetching both result sets.

### Graph Neighborhood Boost (The Unique Advantage)

This is Auto Claude's primary competitive differentiator in retrieval. Zero competitor does this.

```typescript
async function applyGraphNeighborhoodBoost(
  rankedCandidates: RankedMemory[],
  topK: number = 10,
): Promise<RankedMemory[]> {
  // Step 1: Get the file paths of the top-K results
  const topFiles = rankedCandidates.slice(0, topK).flatMap(m => m.relatedFiles);

  // Step 2: Query closure table for 1-hop neighbors of those files
  const neighborNodeIds = await db.execute(`
    SELECT DISTINCT gc.descendant_id
    FROM graph_closure gc
    JOIN graph_nodes gn ON gc.ancestor_id = gn.id
    WHERE gn.file_path IN (${topFiles.map(() => '?').join(',')})
      AND gc.depth = 1
  `, topFiles);

  const neighborFileIds = new Set(neighborNodeIds.rows.map(r => r.descendant_id as string));

  // Step 3: Boost candidates in positions 11-50 that share files with neighbors
  return rankedCandidates.map((candidate, rank) => {
    if (rank < topK) return candidate;

    const neighborCount = candidate.relatedFiles.filter(f =>
      neighborFileIds.has(f)
    ).length;

    if (neighborCount === 0) return candidate;

    return {
      ...candidate,
      score: candidate.score + 0.3 * (neighborCount / Math.max(topFiles.length, 1)),
      boostReason: 'graph_neighborhood',
    };
  }).sort((a, b) => b.score - a.score);
}
```

Expected improvement: +7 percentage points on retrieval quality with ~5ms additional latency.

### Phase-Aware Scoring

```typescript
const PHASE_WEIGHTS: Record<UniversalPhase, Partial<Record<MemoryType, number>>> = {
  define: {
    workflow_recipe: 1.4, dead_end: 1.2, requirement: 1.2,
    decision: 1.1, task_calibration: 1.1,
    gotcha: 0.8, error_pattern: 0.8,
  },
  implement: {
    gotcha: 1.4, error_pattern: 1.3, causal_dependency: 1.2,
    pattern: 1.1, dead_end: 1.2, prefetch_pattern: 1.1,
  },
  validate: {
    error_pattern: 1.4, e2e_observation: 1.4, requirement: 1.2,
    work_unit_outcome: 1.1,
  },
  refine: {
    error_pattern: 1.3, gotcha: 1.2, dead_end: 1.2, pattern: 1.0,
  },
  explore: {
    module_insight: 1.4, decision: 1.2, pattern: 1.1, causal_dependency: 1.0,
  },
  reflect: {
    work_unit_outcome: 1.4, task_calibration: 1.3, dead_end: 1.1,
  },
};

const SOURCE_TRUST_MULTIPLIERS: Record<MemorySource, number> = {
  user_taught: 1.4,
  agent_explicit: 1.2,
  qa_auto: 1.1,
  mcp_auto: 1.0,
  commit_auto: 1.0,
  observer_inferred: 0.85,
};

function computeFinalScore(memory: Memory, queryEmbedding: number[], phase: UniversalPhase): number {
  const cosine = cosineSimilarity(memory.embedding, queryEmbedding);
  const recency = Math.exp(-daysSince(memory.lastAccessedAt) * volatilityDecayRate(memory.relatedFiles));
  const frequency = Math.log1p(memory.accessCount) / Math.log1p(100);

  const base = 0.6 * cosine + 0.25 * recency + 0.15 * frequency;
  const phaseWeight = PHASE_WEIGHTS[phase][memory.type] ?? 1.0;
  const trustWeight = SOURCE_TRUST_MULTIPLIERS[memory.source];

  return base * phaseWeight * trustWeight * memory.confidence;
}
```

### Context Packing (Token Budgets per Phase)

```typescript
const DEFAULT_PACKING_CONFIG: Record<UniversalPhase, ContextPackingConfig> = {
  define:    { totalBudget: 2500, allocation: { workflow_recipe: 0.30, requirement: 0.20, decision: 0.20, dead_end: 0.15, task_calibration: 0.10, other: 0.05 } },
  implement: { totalBudget: 3000, allocation: { gotcha: 0.30, error_pattern: 0.25, causal_dependency: 0.15, pattern: 0.15, dead_end: 0.10, other: 0.05 } },
  validate:  { totalBudget: 2500, allocation: { error_pattern: 0.30, requirement: 0.25, e2e_observation: 0.25, work_unit_outcome: 0.15, other: 0.05 } },
  refine:    { totalBudget: 2000, allocation: { error_pattern: 0.35, gotcha: 0.25, dead_end: 0.20, pattern: 0.15, other: 0.05 } },
  explore:   { totalBudget: 2000, allocation: { module_insight: 0.40, decision: 0.25, pattern: 0.20, causal_dependency: 0.15 } },
  reflect:   { totalBudget: 1500, allocation: { work_unit_outcome: 0.40, task_calibration: 0.35, dead_end: 0.15, other: 0.10 } },
};
```

### HyDE Fallback

When fewer than 3 results score above 0.5 after all pipeline stages, generate a hypothetical ideal memory and use that for a secondary dense search:

```typescript
// Applied only for search_memory tool calls (T3), never for proactive injection
if (topResults.filter(r => r.score > 0.5).length < 3) {
  const hypoMemory = await generateText({
    model: fastModel,
    prompt: `Write a 2-sentence memory that would perfectly answer: "${query}"`,
    maxTokens: 100,
  });
  return denseSearch(embed(hypoMemory.text), filters);
}
```

### File Staleness Detection (4 Layers)

```
1. `memory.staleAt` explicitly set (manual deprecation or file deletion)
2. `memory.lastAccessedAt` older than `memory.decayHalfLifeDays` — confidence penalty applied
3. `relatedFiles` changed in git log since `memory.commitSha` — confidence reduced proportionally
4. File modification time newer than `memory.createdAt` by more than 30 days — trigger review flag
```

---

## 8. Embedding Strategy

### V5 Changes From V4

1. **OpenAI replaces Voyage** as API fallback — `text-embedding-3-small` at 1024-dim
2. **Contextual embeddings built in from day one** — prepend file/module context before every embed
3. **1024-dim everywhere** — OpenAI requests 1024-dim to match Qwen3 storage format

### Three-Tier Fallback

| Priority | Model | When Available | Dims | Notes |
|---|---|---|---|---|
| 1 | `qwen3-embedding:8b` via Ollama | >32GB RAM available | 1024 (MRL) | SOTA local, auto-selected by RAM check |
| 2 | `qwen3-embedding:4b` via Ollama | Ollama running (recommended) | 1024 (MRL) | Default recommendation |
| 3 | `qwen3-embedding:0.6b` via Ollama | Low-memory machines | 1024 | For Stage 1 candidate generation |
| 4 | OpenAI `text-embedding-3-small` | API key configured | 1024 | Request `dimensions: 1024` explicitly |
| 5 | ONNX bundled `bge-small-en-v1.5` | Always | 384 | Zero-config fallback, ~100MB |

**Dimension consistency note**: OpenAI `text-embedding-3-small` natively produces 1536-dim but supports truncation. Always request `dimensions: 1024` to match Qwen3 storage. Track `model_id` per embedding to prevent cross-model similarity comparisons.

```typescript
// OpenAI embedding with dimension matching
const response = await openai.embeddings.create({
  model: 'text-embedding-3-small',
  input: text,
  dimensions: 1024,   // Match Qwen3's MRL dimension
});
```

### Contextual Embeddings (V5 New — Built In From Day One)

Before embedding any memory, prepend its file/module context. This is Anthropic's contextual embedding technique adapted for code.

```typescript
function buildContextualText(chunk: ASTChunk): string {
  const prefix = [
    `File: ${chunk.filePath}`,
    chunk.chunkType !== 'module' ? `${chunk.chunkType}: ${chunk.name ?? 'unknown'}` : null,
    `Lines: ${chunk.startLine}-${chunk.endLine}`,
  ].filter(Boolean).join(' | ');

  return `${prefix}\n\n${chunk.content}`;
}

// For memories (not just code chunks):
function buildMemoryContextualText(memory: Memory): string {
  const parts = [
    memory.relatedFiles.length > 0 ? `Files: ${memory.relatedFiles.join(', ')}` : null,
    memory.relatedModules.length > 0 ? `Module: ${memory.relatedModules[0]}` : null,
    `Type: ${memory.type}`,
  ].filter(Boolean).join(' | ');

  return parts ? `${parts}\n\n${memory.content}` : memory.content;
}

async function embedMemory(memory: Memory, embeddingService: EmbeddingService): Promise<number[]> {
  const contextualText = buildMemoryContextualText(memory);
  return embeddingService.embed(contextualText);
}
```

### Matryoshka Dimension Strategy

Both Qwen3-embedding models support MRL. Use tiered dimensions:

- **Stage 1 candidate generation**: 256-dim — 14x faster, ~90% accuracy retained
- **Stage 3 precision reranking**: 1024-dim — full quality
- **Storage**: 1024-dim stored permanently per memory record

### Embedding Cache

```typescript
class EmbeddingCache {
  async get(text: string, modelId: string, dims: number): Promise<number[] | null> {
    const key = sha256(`${text}:${modelId}:${dims}`);
    const row = await db.execute(
      'SELECT embedding FROM embedding_cache WHERE key = ? AND expires_at > ?',
      [key, Date.now()]
    );
    return row.rows[0] ? deserializeEmbedding(row.rows[0].embedding as ArrayBuffer) : null;
  }

  async set(text: string, modelId: string, dims: number, embedding: number[]): Promise<void> {
    const key = sha256(`${text}:${modelId}:${dims}`);
    await db.execute(
      'INSERT OR REPLACE INTO embedding_cache (key, embedding, model_id, dims, expires_at) VALUES (?,?,?,?,?)',
      [key, serializeEmbedding(embedding), modelId, dims, Date.now() + 7 * 86400 * 1000]
    );
  }
}
```

---

## 9. Agent Loop Integration

### Three-Tier Injection Points

```
INJECTION POINT 1: System prompt (before streamText())
   Content: global memories, module memories, workflow recipes
   Latency budget: up to 500ms

INJECTION POINT 2: Initial user message (before streamText())
   Content: prefetched file contents, work state (if resuming)
   Latency budget: up to 2s

INJECTION POINT 3: Tool result augmentation (during streamText())
   Content: gotchas, dead_ends for file just read
   Latency budget: < 100ms per augmentation
   Mechanism: tool execute() appends to result string

INJECTION POINT 4: prepareStep callback (between each step)
   Content: step-specific memory based on current agent state
   Latency budget: < 50ms
   Mechanism: prepareStep returns updated messages array
```

### prepareStep Active Injection

```typescript
const result = streamText({
  model: config.model,
  system: config.systemPrompt,
  messages: config.initialMessages,
  tools: tools ?? {},
  stopWhen: stepCountIs(adjustedMaxSteps),
  abortSignal: config.abortSignal,

  prepareStep: async ({ stepNumber, messages }) => {
    // Skip first 5 steps — agent processing initial context
    if (stepNumber < 5 || !memoryContext) {
      workerObserverProxy.onStepComplete(stepNumber);
      return {};
    }

    const injection = await workerObserverProxy.requestStepInjection(
      stepNumber,
      stepMemoryState.getRecentContext(5),
    );

    workerObserverProxy.onStepComplete(stepNumber);
    if (!injection) return {};

    return {
      messages: [
        ...messages,
        { role: 'system' as const, content: injection.content },
      ],
    };
  },

  onStepFinish: (stepResult) => {
    progressTracker.processStepResult(stepResult);
  },
});
```

### StepInjectionDecider (Three Triggers)

```typescript
export class StepInjectionDecider {
  async decide(stepNumber: number, recentContext: RecentToolCallContext): Promise<StepInjection | null> {
    // Trigger 1: Agent read a file with unseen gotchas
    const recentReads = recentContext.toolCalls
      .filter(t => t.toolName === 'Read' || t.toolName === 'Edit')
      .map(t => t.args.file_path as string).filter(Boolean);

    if (recentReads.length > 0) {
      const freshGotchas = await this.memoryService.search({
        types: ['gotcha', 'error_pattern', 'dead_end'],
        relatedFiles: recentReads,
        limit: 4,
        minConfidence: 0.65,
        filter: (m) => !recentContext.injectedMemoryIds.has(m.id),
      });
      if (freshGotchas.length > 0) {
        return { content: this.formatGotchas(freshGotchas), type: 'gotcha_injection' };
      }
    }

    // Trigger 2: New scratchpad entry from agent's record_memory call
    const newEntries = this.scratchpad.getNewSince(stepNumber - 1);
    if (newEntries.length > 0) {
      return { content: this.formatScratchpadEntries(newEntries), type: 'scratchpad_reflection' };
    }

    // Trigger 3: Agent is searching for something already in memory
    const recentSearches = recentContext.toolCalls
      .filter(t => t.toolName === 'Grep' || t.toolName === 'Glob').slice(-3);

    for (const search of recentSearches) {
      const pattern = (search.args.pattern ?? search.args.glob ?? '') as string;
      const known = await this.memoryService.searchByPattern(pattern);
      if (known && !recentContext.injectedMemoryIds.has(known.id)) {
        return { content: `MEMORY CONTEXT: ${known.content}`, type: 'search_short_circuit' };
      }
    }

    return null;
  }
}
```

### Memory-Aware Step Limits

```typescript
export function buildMemoryAwareStopCondition(
  baseMaxSteps: number,
  calibrationFactor: number | undefined,
): StopCondition {
  const factor = Math.min(calibrationFactor ?? 1.0, 2.0);  // Cap at 2x
  const adjusted = Math.min(Math.ceil(baseMaxSteps * factor), MAX_ABSOLUTE_STEPS);
  return stepCountIs(adjusted);
}
```

---

## 10. Build Pipeline Integration

### Planner: Memory-Guided Planning

```typescript
async function buildPlannerMemoryContext(
  taskDescription: string,
  relevantModules: string[],
  memoryService: MemoryService,
): Promise<string> {
  const [calibrations, deadEnds, causalDeps, outcomes, recipes] = await Promise.all([
    memoryService.search({ types: ['task_calibration'], relatedModules: relevantModules, limit: 5 }),
    memoryService.search({ types: ['dead_end'], relatedModules: relevantModules, limit: 8 }),
    memoryService.search({ types: ['causal_dependency'], relatedModules: relevantModules, limit: 10 }),
    memoryService.search({ types: ['work_unit_outcome'], relatedModules: relevantModules, limit: 5, sort: 'recency' }),
    memoryService.searchWorkflowRecipe(taskDescription, { limit: 2 }),
  ]);

  return formatPlannerSections({ calibrations, deadEnds, causalDeps, outcomes, recipes });
}
```

Planning transformations:
1. **Calibration** → multiply subtask count estimates by empirical ratio
2. **Dead ends** → write constraints directly into the plan
3. **Causal deps** → expand scope to include coupled files pre-emptively

### Coder: Predictive Pre-Loading

Budget: max 32K tokens (~25% of context), max 12 files. Files accessed in >80% of past sessions load first; >50% load second.

### QA: Targeted Validation

QA sessions start with `e2e_observation`, `error_pattern`, and `requirement` memories injected before the first MCP call.

### E2E Validation Memory Pipeline

```typescript
async function processMcpToolResult(
  toolName: string,
  result: string,
  sessionId: string,
  workUnitRef: WorkUnitRef,
): Promise<void> {
  const MCP_OBS_TOOLS = ['take_screenshot', 'click_by_text', 'fill_input', 'get_page_structure', 'eval'];
  if (!MCP_OBS_TOOLS.includes(toolName)) return;

  const classification = await generateText({
    model: fastModel,
    prompt: `Classify this MCP observation. Is this: A=precondition, B=timing, C=ui_behavior, D=test_sequence, E=mcp_gotcha, F=not_worth_remembering
Tool=${toolName}, Result=${result.slice(0, 400)}
Reply: letter + one sentence`,
    maxTokens: 100,
  });

  const match = classification.text.match(/^([ABCDE])[:\s]*(.+)/s);
  if (!match) return;

  await memoryService.store({
    type: 'e2e_observation',
    observationType: { A: 'precondition', B: 'timing', C: 'ui_behavior', D: 'test_sequence', E: 'mcp_gotcha' }[match[1]],
    content: match[2].trim(),
    confidence: 0.75,
    source: 'mcp_auto',
    needsReview: true,
    scope: 'global',
    sessionId, workUnitRef,
  });
}
```

---

## 11. Worker Thread Architecture and Concurrency

### Thread Topology

```
MAIN THREAD (Electron)
├── WorkerBridge (per task)
│   ├── MemoryObserver (observes all worker messages)
│   ├── MemoryService (reads/writes via libSQL — WAL mode)
│   ├── ScratchpadStore (in-memory, checkpointed to disk)
│   └── Worker (worker_threads.Worker)
│       │ postMessage() IPC
│       WORKER THREAD
│       ├── runAgentSession() → streamText()
│       ├── Tool executors (Read, Write, Edit, Bash, Grep, Glob)
│       └── Memory tools (IPC to main thread):
│           ├── search_memory → MemoryService
│           ├── record_memory → ScratchpadStore
│           └── get_session_context → local scratchpad state

For parallel subagents:
MAIN THREAD
├── WorkerBridge-A (subtask 1) → ScratchpadStore-A (isolated)
├── WorkerBridge-B (subtask 2) → ScratchpadStore-B (isolated)
└── WorkerBridge-C (subtask 3) → ScratchpadStore-C (isolated)

After completion: ParallelScratchpadMerger.merge([A, B, C]) → observer.finalize()
```

**Note on libSQL in worker threads**: `@libsql/client` uses HTTP for cloud mode and is inherently async-safe. For local mode, the client is pure JS — safe in worker_threads. All writes are proxied through main thread MemoryService to avoid WAL conflicts.

### IPC Message Types

```typescript
export type MemoryIpcRequest =
  | { type: 'memory:search'; requestId: string; query: string; filters: MemorySearchFilters }
  | { type: 'memory:record'; requestId: string; entry: MemoryRecordEntry }
  | { type: 'memory:tool-call'; toolName: string; args: Record<string, unknown>; stepIndex: number }
  | { type: 'memory:tool-result'; toolName: string; result: string; isError: boolean; stepIndex: number }
  | { type: 'memory:reasoning'; text: string; stepIndex: number }
  | { type: 'memory:step-complete'; stepNumber: number }
  | { type: 'memory:session-complete'; outcome: SessionOutcome; stepsExecuted: number };
```

All IPC uses async request-response with UUID correlation. 3-second timeout: on timeout, agent proceeds without memory context (graceful degradation).

### Parallel Subagent Scratchpad Merger

```typescript
export class ParallelScratchpadMerger {
  merge(scratchpads: ScratchpadStore[]): MergedScratchpad {
    const allEntries = scratchpads.flatMap((s, idx) =>
      s.getAll().map(e => ({ ...e, sourceAgentIndex: idx }))
    );

    const deduplicated = this.deduplicateByContent(allEntries);

    // Quorum boost: entries observed by 2+ agents get confidence boost
    return {
      entries: deduplicated.map(entry => ({
        ...entry,
        quorumCount: allEntries.filter(e =>
          e.sourceAgentIndex !== entry.sourceAgentIndex &&
          this.contentSimilarity(e.content, entry.content) > 0.85
        ).length + 1,
        effectiveFrequencyThreshold: entry.confirmedBy >= 1 ? 1 : DEFAULT_FREQUENCY_THRESHOLD,
      })),
    };
  }
}
```

---

## 12. Cross-Session Pattern Synthesis

### Three Synthesis Modes

**Mode 1: Incremental (after every session, no LLM)** — Update rolling file statistics, co-access edge weights, error fingerprint registry. O(n) over new session's signals.

**Mode 2: Threshold-triggered (sessions 5, 10, 20, 50, 100 — one LLM call per trigger per module)** — Synthesize cross-session patterns. Output: 0-5 novel memories per call.

**Mode 3: Scheduled (weekly — one LLM call per cross-module cluster)** — Find module pairs with high co-access not yet captured as `causal_dependency`.

### Threshold Synthesis

```typescript
const SYNTHESIS_THRESHOLDS = [5, 10, 20, 50, 100];

async function triggerModuleSynthesis(module: string, sessionCount: number): Promise<void> {
  const stats = buildModuleStatsSummary(module);

  const synthesis = await generateText({
    model: fastModel,
    prompt: `You are analyzing ${sessionCount} agent sessions on the "${module}" module.

File access patterns:
${stats.topFiles.map(f => `- ${f.path}: ${f.sessions} sessions`).join('\n')}

Co-accessed pairs:
${stats.strongCoAccess.map(e => `- ${e.fileA} + ${e.fileB}: ${e.sessions} sessions`).join('\n')}

Recurring errors:
${stats.errors.map(e => `- "${e.errorType}": ${e.sessions} sessions, resolved: ${e.resolvedHow}`).join('\n')}

Identify (max 5 memories, omit obvious things):
1. Files to prefetch (prefetch_pattern)
2. Non-obvious file coupling (causal_dependency or gotcha)
3. Recurring errors (error_pattern)
4. Non-obvious module purpose (module_insight)

Format: JSON [{ "type": "...", "content": "...", "relatedFiles": [...], "confidence": 0.0-1.0 }]`,
    maxTokens: 400,
  });

  const memories = parseSynthesisOutput(synthesis.text);
  for (const memory of memories) {
    if (await isNovel(memory)) {
      await memoryService.store({ ...memory, source: 'observer_inferred', needsReview: true });
    }
  }
}
```

---

## 13. UX and Developer Trust

### Memory Panel Navigation

```
Memory (Cmd+Shift+M)
├── Health Dashboard (default)
│   ├── Stats: total | active (used 30d) | needs-review | tokens-saved-this-session
│   ├── Health score 0-100
│   ├── Module coverage progress bars
│   └── Needs Attention: stale memories, pending reviews
├── Module Map (collapsible per-module cards)
├── Memory Browser (search + filters, full provenance)
├── Ask Memory (chat with citations)
└── [Cloud only] Team Memory
```

### Citation Chips

Memory citation format in agent output: `[^ Memory: JWT 24h expiry decision]`

The renderer detects `[Memory #ID: brief text]` and replaces with `MemoryCitationChip` — amber-tinted pill with a flag button. Dead-end citations use red tint. More than 5 citations collapse to "Used N memories [view all]".

### Session-End Summary

```
Session Complete: Auth Bug Fix
Memory saved ~6,200 tokens of discovery this session

What the agent remembered:
  - JWT decision → used when planning approach  [ok]
  - Redis gotcha → avoided concurrent validation bug  [ok]

What the agent learned (4 new memories):
  1/4  GOTCHA  middleware/auth.ts  [ok] [edit] [x]
       Token refresh fails silently when Redis is unreachable
  2/4  ERROR PATTERN  tests/auth/  [ok] [edit] [x]
       Auth tests require REDIS_URL env var — hang without it
  ...

[Save all confirmed]    [Review later]
```

### Trust Progression System

**Level 1 — Cautious (Sessions 1-3):** inject confidence > 0.80 only; all new memories require confirmation; advance: 3 sessions + 50% confirmed.

**Level 2 — Standard (Sessions 4-15):** inject confidence > 0.65; "Confirm all" is default; advance: 10+ sessions, <5% correction rate.

**Level 3 — Confident (Sessions 16+):** inject confidence > 0.55; session summary condensed to `needsReview` only.

**Level 4 — Autonomous (Opt-in only):** inject confidence > 0.45; session summary suppressed by default.

Trust regression: if user flags 3+ memories wrong in one session, offer (not force) moving to more conservative level.

### Teach the AI Entry Points

| Method | Location | Action |
|---|---|---|
| `/remember [text]` | Agent terminal | Creates `user_taught` memory immediately |
| `Cmd+Shift+M` | Global | Opens Teach panel |
| Right-click file | File tree | Opens Teach panel pre-filled with file path |
| Import CLAUDE.md / .cursorrules | Settings | Parse rules into typed memories |

---

## 14. Cloud Sync, Multi-Device, and Web App

### The Login-Gated Architecture

The Electron app is open source and free. Cloud features are gated behind Convex Better Auth login:

```
Electron App (all users)
├── Free tier: libSQL in-process → memory.db (offline, full features)
└── Logged-in tier: libSQL embedded replica + Turso Cloud sync
    ├── Same SQL queries, same tables
    ├── Reads from local replica (fast, offline-tolerant)
    ├── Syncs to Turso Cloud every 60s
    └── Convex for: auth state, team features, billing UI, real-time memory panel

Web App (Next.js SaaS, same repo/OSS)
├── Self-hosted: users run their own stack (no cloud features)
└── Cloud hosted (auto-claude.app): Turso Cloud + Convex
    ├── Pure cloud libSQL (no local file)
    ├── OpenAI embeddings (no Ollama)
    └── Cohere Rerank API
```

### Cloud Sync Flow

```
Electron write → libSQL local (immediate)
             → Turso embedded replica sync (within 60s)

Other device read → Turso Cloud fetch → embedded replica

Conflict (same memory edited on two devices before sync):
├── Non-conflicting fields (access_count, tags): auto-merge
└── Content field: present both versions, require user decision
```

### Web App Architecture Differences

| Feature | Electron (local) | Web App (cloud) |
|---------|-----------------|-----------------|
| Database | libSQL in-process file | libSQL → Turso Cloud |
| Embeddings | Qwen3 via Ollama | OpenAI text-embedding-3-small |
| Reranking | Qwen3-Reranker-0.6B via Ollama | Cohere Rerank API |
| Graph indexing | tree-sitter WASM | tree-sitter WASM (in Node.js worker) |
| Auth | Convex Better Auth | Convex Better Auth |
| Agent execution | Worker threads | Next.js API routes + queue |

The same retrieval SQL queries work in both modes. Only the client connection differs.

### Database-Per-Tenant (Turso)

```typescript
// Create a dedicated Turso database per user+project
async function getOrCreateProjectDb(
  userId: string,
  projectId: string,
  convexToken: string,
): Promise<Client> {
  const dbName = `user-${userId}-proj-${projectId}`;
  const tursoClient = createTursoClient(tursoApiToken);

  const existing = await tursoClient.databases.get(dbName);
  if (!existing) {
    await tursoClient.databases.create({ name: dbName, group: 'memory' });
  }

  const dbToken = await tursoClient.databases.createToken(dbName);

  return createClient({
    url: `libsql://${dbName}.turso.io`,
    authToken: dbToken.jwt,
  });
}
```

---

## 15. Team and Organization Memories

### Four Scope Levels

| Scope | Visible To | Use Cases |
|---|---|---|
| Personal | Only you | Workflow preferences, personal aliases |
| Project | All project members | Gotchas, error patterns, decisions |
| Team | All team members | Organization conventions, architecture |
| Organization | All org members | Security policies, compliance requirements |

### Team Onboarding

When a new developer joins, surface the 5 most important team memories immediately. Sort by `confidence × pinned_weight × access_count`. New developer sees months of accumulated tribal knowledge in 60 seconds.

### Team Memory Dispute Resolution

1. Team member clicks "Dispute"
2. Threaded comment opens on the memory
3. Steward notified
4. Memory gets "disputed" badge — agents still use it but with `confidence × 0.8`
5. Resolution: steward updates or team admin escalates

---

## 16. Privacy and Compliance

### What Stays Local by Default

- Personal-scope memories
- Any memory flagged by the secret scanner
- Embedding vectors when "vectors-only" mode selected

### Secret Scanner

Runs before any cloud upload and before storing `user_taught` memories:

```typescript
const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{48}/,
  /sk-ant-[a-zA-Z0-9-]{95}/,
  /ghp_[a-zA-Z0-9]{36}/,
  /-----BEGIN (RSA|EC) PRIVATE KEY-----/,
  /password\s*[:=]\s*["']?\S+/i,
];
```

### GDPR Controls

- Export all memories as JSON (machine-readable)
- Export as Markdown (human-readable, importable)
- Export as CLAUDE.md format (portable)
- Delete all memories (hard delete for explicit account deletion)
- Request data archive (SQLite + embeddings)

---

## 17. Database Schema

The V5 schema uses `@libsql/client` compatible SQL. No `better-sqlite3`. All queries are async.

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- CORE MEMORY TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS memories (
  id                    TEXT PRIMARY KEY,
  type                  TEXT NOT NULL,
  content               TEXT NOT NULL,
  confidence            REAL NOT NULL DEFAULT 0.8,
  tags                  TEXT NOT NULL DEFAULT '[]',          -- JSON array
  related_files         TEXT NOT NULL DEFAULT '[]',          -- JSON array
  related_modules       TEXT NOT NULL DEFAULT '[]',          -- JSON array
  created_at            TEXT NOT NULL,
  last_accessed_at      TEXT NOT NULL,
  access_count          INTEGER NOT NULL DEFAULT 0,
  session_id            TEXT,
  commit_sha            TEXT,
  scope                 TEXT NOT NULL DEFAULT 'global',
  work_unit_ref         TEXT,                               -- JSON WorkUnitRef
  methodology           TEXT,
  source                TEXT NOT NULL DEFAULT 'agent_explicit',
  target_node_id        TEXT,
  impacted_node_ids     TEXT DEFAULT '[]',
  relations             TEXT NOT NULL DEFAULT '[]',
  decay_half_life_days  REAL,
  provenance_session_ids TEXT DEFAULT '[]',
  needs_review          INTEGER NOT NULL DEFAULT 0,
  user_verified         INTEGER NOT NULL DEFAULT 0,
  citation_text         TEXT,
  pinned                INTEGER NOT NULL DEFAULT 0,
  deprecated            INTEGER NOT NULL DEFAULT 0,
  deprecated_at         TEXT,
  stale_at              TEXT,
  project_id            TEXT NOT NULL,
  trust_level_scope     TEXT DEFAULT 'personal',

  -- V5 new: AST chunking metadata
  chunk_type            TEXT,
  chunk_start_line      INTEGER,
  chunk_end_line        INTEGER,
  context_prefix        TEXT,
  embedding_model_id    TEXT                               -- track which model produced this embedding
);

CREATE TABLE IF NOT EXISTS memory_embeddings (
  memory_id   TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  embedding   BLOB NOT NULL,     -- float32 vector, 1024-dim
  model_id    TEXT NOT NULL,
  dims        INTEGER NOT NULL DEFAULT 1024,
  created_at  TEXT NOT NULL
);

-- FTS5 for BM25 keyword search (same syntax in Turso local and cloud)
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  memory_id UNINDEXED,
  content,
  tags,
  related_files,
  tokenize='porter unicode61'
);

-- Embedding cache
CREATE TABLE IF NOT EXISTS embedding_cache (
  key        TEXT PRIMARY KEY,   -- sha256(contextualText:modelId:dims)
  embedding  BLOB NOT NULL,
  model_id   TEXT NOT NULL,
  dims       INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embedding_cache_expires ON embedding_cache(expires_at);

-- ============================================================
-- OBSERVER TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS observer_file_nodes (
  file_path         TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL,
  access_count      INTEGER NOT NULL DEFAULT 0,
  last_accessed_at  TEXT NOT NULL,
  session_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS observer_co_access_edges (
  file_a              TEXT NOT NULL,
  file_b              TEXT NOT NULL,
  project_id          TEXT NOT NULL,
  weight              REAL NOT NULL DEFAULT 0.0,
  raw_count           INTEGER NOT NULL DEFAULT 0,
  session_count       INTEGER NOT NULL DEFAULT 0,
  avg_time_delta_ms   REAL,
  directional         INTEGER NOT NULL DEFAULT 0,
  task_type_breakdown TEXT DEFAULT '{}',
  last_observed_at    TEXT NOT NULL,
  promoted_at         TEXT,
  PRIMARY KEY (file_a, file_b, project_id)
);

CREATE TABLE IF NOT EXISTS observer_error_patterns (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  tool_name        TEXT NOT NULL,
  error_fingerprint TEXT NOT NULL,
  error_message    TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at     TEXT NOT NULL,
  resolved_how     TEXT,
  sessions         TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS observer_module_session_counts (
  module      TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (module, project_id)
);

CREATE TABLE IF NOT EXISTS observer_synthesis_log (
  module          TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  trigger_count   INTEGER NOT NULL,
  synthesized_at  INTEGER NOT NULL,
  memories_generated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (module, project_id, trigger_count)
);

-- ============================================================
-- KNOWLEDGE GRAPH TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS graph_nodes (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  type            TEXT NOT NULL,
  label           TEXT NOT NULL,
  file_path       TEXT,
  language        TEXT,
  start_line      INTEGER,
  end_line        INTEGER,
  layer           INTEGER NOT NULL DEFAULT 1,
  source          TEXT NOT NULL,     -- 'ast' | 'scip' | 'llm' | 'agent'
  confidence      TEXT DEFAULT 'inferred',
  metadata        TEXT DEFAULT '{}',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  stale_at        INTEGER,
  associated_memory_ids TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_gn_project_type  ON graph_nodes(project_id, type);
CREATE INDEX IF NOT EXISTS idx_gn_project_label ON graph_nodes(project_id, label);
CREATE INDEX IF NOT EXISTS idx_gn_file_path     ON graph_nodes(project_id, file_path) WHERE file_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gn_stale         ON graph_nodes(stale_at) WHERE stale_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS graph_edges (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  from_id     TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 1,
  weight      REAL DEFAULT 1.0,
  source      TEXT NOT NULL,
  confidence  REAL DEFAULT 1.0,
  metadata    TEXT DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  stale_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ge_from_type ON graph_edges(from_id, type) WHERE stale_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ge_to_type   ON graph_edges(to_id, type)   WHERE stale_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ge_stale     ON graph_edges(stale_at) WHERE stale_at IS NOT NULL;

-- Pre-computed closure for O(1) impact analysis
CREATE TABLE IF NOT EXISTS graph_closure (
  ancestor_id   TEXT NOT NULL,
  descendant_id TEXT NOT NULL,
  depth         INTEGER NOT NULL,
  path          TEXT NOT NULL,         -- JSON array of node IDs
  edge_types    TEXT NOT NULL,         -- JSON array of edge types along path
  total_weight  REAL NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id),
  FOREIGN KEY (ancestor_id)   REFERENCES graph_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (descendant_id) REFERENCES graph_nodes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gc_ancestor   ON graph_closure(ancestor_id, depth);
CREATE INDEX IF NOT EXISTS idx_gc_descendant ON graph_closure(descendant_id, depth);

CREATE TABLE IF NOT EXISTS graph_index_state (
  project_id       TEXT PRIMARY KEY,
  last_indexed_at  INTEGER NOT NULL,
  last_commit_sha  TEXT,
  node_count       INTEGER DEFAULT 0,
  edge_count       INTEGER DEFAULT 0,
  stale_edge_count INTEGER DEFAULT 0,
  index_version    INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS scip_symbols (
  symbol_id  TEXT PRIMARY KEY,
  node_id    TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scip_node ON scip_symbols(node_id);

-- ============================================================
-- PERFORMANCE INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_memories_project_type     ON memories(project_id, type);
CREATE INDEX IF NOT EXISTS idx_memories_project_scope    ON memories(project_id, scope);
CREATE INDEX IF NOT EXISTS idx_memories_source           ON memories(source);
CREATE INDEX IF NOT EXISTS idx_memories_needs_review     ON memories(needs_review) WHERE needs_review = 1;
CREATE INDEX IF NOT EXISTS idx_memories_confidence       ON memories(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_memories_last_accessed    ON memories(last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_type_conf        ON memories(project_id, type, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_memories_not_deprecated   ON memories(project_id, deprecated) WHERE deprecated = 0;
CREATE INDEX IF NOT EXISTS idx_co_access_weight         ON observer_co_access_edges(weight DESC);
```

---

## 18. Memory Pruning and Lifecycle

### Decay Model

```typescript
const DEFAULT_HALF_LIVES: Partial<Record<MemoryType, number>> = {
  work_state: 7,
  e2e_observation: 30,
  error_pattern: 60,
  gotcha: 60,
  module_insight: 90,
  dead_end: 90,
  causal_dependency: 120,
  decision: Infinity,      // Decisions never decay
  workflow_recipe: 120,
  task_calibration: 180,
};

function currentConfidence(memory: Memory): number {
  if (!memory.decayHalfLifeDays || memory.pinned) return memory.confidence;
  const daysSince = (Date.now() - Date.parse(memory.lastAccessedAt)) / 86400000;
  const decayFactor = Math.pow(0.5, daysSince / memory.decayHalfLifeDays);
  return memory.confidence * decayFactor;
}
```

### Pruning Job

Runs daily via Electron `powerMonitor` idle event:

```typescript
async function runPruningJob(db: Client, projectId: string): Promise<void> {
  const now = new Date().toISOString();

  // Soft-delete expired memories
  await db.execute(`
    UPDATE memories SET deprecated = 1, deprecated_at = ?
    WHERE project_id = ? AND deprecated = 0
      AND decay_half_life_days IS NOT NULL
      AND pinned = 0
      AND (julianday(?) - julianday(last_accessed_at)) > decay_half_life_days * 3
  `, [now, projectId, now]);

  // Hard-delete after 30-day grace (except user-verified)
  await db.execute(`
    DELETE FROM memories
    WHERE project_id = ? AND deprecated = 1
      AND user_verified = 0
      AND (julianday(?) - julianday(deprecated_at)) > 30
  `, [projectId, now]);

  // Evict expired embedding cache
  await db.execute('DELETE FROM embedding_cache WHERE expires_at < ?', [Date.now()]);
}
```

### Access Count as Trust Signal

Every time a memory is injected, increment `access_count`. After 5 accesses with no correction, auto-increment `confidence` by 0.05 (capped at 0.95). After 10 accesses, remove `needsReview` flag.

---

## 19. A/B Testing and Metrics

### Control Group Design

5% of new sessions assigned to control group (no memory injection). Control sessions still generate observer signals — they just receive no injections.

```typescript
enum MemoryABGroup {
  CONTROL = 'control',         // No injection (5%)
  PASSIVE_ONLY = 'passive',    // T1 + T2 only (10%)
  FULL = 'full',               // All 4 tiers (85%)
}

function assignABGroup(sessionId: string, projectId: string): MemoryABGroup {
  const hash = murmurhash(`${sessionId}:${projectId}`) % 100;
  if (hash < 5)  return MemoryABGroup.CONTROL;
  if (hash < 15) return MemoryABGroup.PASSIVE_ONLY;
  return MemoryABGroup.FULL;
}
```

### Key Metrics

| Metric | Definition | Target |
|---|---|---|
| Tool calls per task | Total tool calls in session | <20% reduction vs control |
| File re-reads | Read calls on files previously read in prior session | <50% reduction vs control |
| QA first-pass rate | QA passes without fix cycle | >15% improvement vs control |
| Dead-end re-entry rate | Agent tries a previously-failed approach | <5% |
| User correction rate | Memories flagged / memories used | <5% |
| Graph boost rate | Fraction of retrievals where neighborhood boost changed top-8 | Track for value validation |

### Phase Weight Learning

After 30+ sessions, run background weight optimization: which memory types most strongly correlate with QA first-pass success per phase? Human review required before applying new weights.

---

## 20. Implementation Checklist

V5 is built complete, not phased. The retrieval pipeline, AST chunking, contextual embeddings, and graph neighborhood boost are all implemented from the start. Implementation order follows dependency order.

### Step 1: libSQL Foundation (1-2 days)

```bash
cd apps/desktop
npm install @libsql/client
# Remove better-sqlite3 if present for memory module (keep for other uses if needed)
```

Create `apps/desktop/src/main/ai/memory/db.ts`:

```typescript
import { createClient, type Client } from '@libsql/client';
import { app } from 'electron';
import { join } from 'path';
import { MEMORY_SCHEMA_SQL } from './schema';

let _client: Client | null = null;

export async function getMemoryClient(
  tursoSyncUrl?: string,
  authToken?: string,
): Promise<Client> {
  if (_client) return _client;

  const localPath = join(app.getPath('userData'), 'memory.db');

  _client = createClient({
    url: `file:${localPath}`,
    ...(tursoSyncUrl && authToken ? { syncUrl: tursoSyncUrl, authToken, syncInterval: 60 } : {}),
  });

  // Initialize schema (idempotent)
  await _client.executeMultiple(MEMORY_SCHEMA_SQL);

  // Load sqlite-vec extension for local mode only
  // Cloud Turso has built-in vector support (DiskANN) — no extension needed
  if (!tursoSyncUrl) {
    const vecExtPath = app.isPackaged
      ? join(process.resourcesPath, 'extensions', 'vec0')
      : join(__dirname, '..', '..', 'node_modules', 'sqlite-vec', 'vec0');
    await _client.execute(`SELECT load_extension('${vecExtPath}')`);
  }

  return _client;
}

export async function closeMemoryClient(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
  }
}
```

**sqlite-vec with libSQL**: Use `@libsql/client` with the `vec0` extension. For cloud Turso databases, vector functions are built in. For local, bundle the vec0 extension binary.

### Step 2: MemoryService Core (2-3 days)

Implement `MemoryService` with:
- `store(entry)` → inserts memory, generates contextual embedding, updates FTS5 trigger
- `search(query, filters)` → full 4-stage pipeline (candidates → RRF → neighborhood boost → pack)
- `searchByPattern(pattern)` → BM25-only for quick pattern matching in StepInjectionDecider
- `insertUserTaught(content, projectId, tags)` → immediate insert for `/remember` command

### Step 3: EmbeddingService (1-2 days)

Implement with provider auto-detection:

```typescript
export class EmbeddingService {
  private provider: 'ollama-8b' | 'ollama-4b' | 'ollama-0.6b' | 'openai' | 'onnx' = 'onnx';

  async initialize(): Promise<void> {
    // Check Ollama availability and RAM
    const ollamaAvailable = await checkOllama();
    if (ollamaAvailable) {
      const ram = await getAvailableRAM();
      this.provider = ram > 32 ? 'ollama-8b' : 'ollama-4b';
    } else if (process.env.OPENAI_API_KEY) {
      this.provider = 'openai';
    }
    // else: onnx bundled fallback
  }

  async embed(text: string, dims: 256 | 1024 = 1024): Promise<number[]> {
    const cached = await this.cache.get(text, this.provider, dims);
    if (cached) return cached;

    const embedding = await this.callProvider(text, dims);
    await this.cache.set(text, this.provider, dims, embedding);
    return embedding;
  }

  private async callProvider(text: string, dims: number): Promise<number[]> {
    switch (this.provider) {
      case 'openai':
        const res = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: text,
          dimensions: dims,   // Always 1024 for storage
        });
        return res.data[0].embedding;
      // ... ollama and onnx implementations
    }
  }
}
```

### Step 4: Knowledge Graph Layer 1 (5-7 days)

- `TreeSitterLoader` with TypeScript + JavaScript + Python + Rust
- `TreeSitterExtractor`: import edges, function definitions, call edges, class hierarchy
- `ASTChunker`: split files at function/class boundaries
- `GraphDatabase`: node/edge CRUD with closure table maintenance
- `IncrementalIndexer`: chokidar file watcher, 500ms debounce, Glean staleness model

### Step 5: Complete Retrieval Pipeline (3-4 days)

- FTS5 BM25 path
- Dense vector path (256-dim candidates, 1024-dim precision)
- Graph traversal path (co-access edges + closure table neighbors)
- Weighted RRF fusion (with UNION workaround — no FULL OUTER JOIN)
- Graph neighborhood boost (the unique advantage)
- Phase-aware scoring and context packing
- Reranking via Qwen3-Reranker-0.6B (Ollama, local only)
- HyDE fallback

### Step 6: Memory Observer + Scratchpad (3-5 days)

- `MemoryObserver` on main thread tapping WorkerBridge events
- `Scratchpad` with O(1) analytics data structures
- Top-5 signals: self_correction, co_access, error_retry, parallel_conflict, read_abandon
- Trust defense layer (SpAIware protection)
- Session-type-aware promotion gates
- `observer.finalize()` with LLM synthesis call

### Step 7: Active Injection + Agent Loop (3-4 days)

- `StepInjectionDecider` (3 triggers)
- `prepareStep` callback in `runAgentSession()`
- Planner memory context builder
- Prefetch plan builder (T2 pre-loading)
- E2E observation pipeline for MCP tool results
- Memory-aware `stopWhen` (calibration-adjusted max steps)

### Step 8: Memory Panel UX (5-7 days)

- Health Dashboard + Module Map + Memory Browser
- Session-end summary panel
- `MemoryCitationChip` in agent terminal
- Correction modal
- Teach panel with all entry points
- Trust progression system (4 levels, per-project)
- First-run experience
- i18n keys in en.json and fr.json

### Step 9: Cloud Sync + Team Features (7-10 days)

- Turso Cloud integration (per-tenant database provisioning)
- Convex integration (auth token → Turso sync URL)
- Login-gated feature detection in Electron
- Team memory scoping (project/team/org)
- Dispute resolution UI
- Secret scanner
- GDPR export/delete controls

### Step 10: Cross-Session Synthesis + A/B Testing (5-7 days)

- Incremental synthesis (Mode 1, every session)
- Threshold-triggered synthesis (Mode 2, LLM calls)
- Weekly scheduled synthesis (Mode 3)
- A/B group assignment and metric tracking
- Phase weight optimization framework

---

## 21. Open Questions

1. **sqlite-vec with @libsql/client**: The `sqlite-vec` extension works with `better-sqlite3`. With `@libsql/client`, the extension loading mechanism differs. Turso Cloud has built-in vector support (`vector_distance_cos()`). Local libSQL may need `libsql-vector` package or bundled vec0 binary. Verify before Step 1.

2. **Embedding model cross-compatibility**: Memories embedded with Qwen3-4b have the same 1024-dim format as memories embedded with OpenAI text-embedding-3-small. However, embeddings from different models are NOT directly comparable (different embedding spaces). When a user switches from Ollama to OpenAI fallback or vice versa, existing memories need re-embedding. Background re-embedding job needed; track `embedding_model_id` per memory.

3. **Web app agent execution**: In Next.js, agents cannot run in `worker_threads` the same way as Electron. Server-side agent execution needs a job queue (BullMQ, Inngest, or Trigger.dev). The memory system architecture is the same, but the IPC mechanism differs. Define the web app execution model before Step 9.

4. **Scratchpad granularity for large pipelines**: For a 40-subtask build, promote after each validated subtask, not just at pipeline end. The exact promotion gate per subtask: does it require subtask-level QA, or is the subtask returning success sufficient? Recommendation: subtask returning success is sufficient gate; pipeline-level QA is the gate for high-confidence observer-inferred memories.

5. **Tree-sitter vs. ts-morph for TypeScript**: tree-sitter extracts syntactic call sites but cannot resolve cross-module which function is being called. ts-morph has full TypeScript compiler resolution but is much slower. Use tree-sitter for Phases 1-5 (speed), add SCIP integration for precision in later phases. Mark edges with `source: 'ast'` vs `source: 'scip'`.

6. **Reranking in cloud/web mode**: Qwen3-Reranker-0.6B is not available without Ollama. In cloud/web mode, Cohere Rerank API (~$1/1K queries) is used from the start as the cross-encoder reranking tier. Monitor Cohere costs and evaluate alternatives (e.g., self-hosted reranker on VPS) if costs become significant at scale.

7. **Graph neighborhood boost in cloud mode**: The boost queries the `graph_closure` table which lives in libSQL/Turso. This works in all modes (local and cloud) with the same SQL. Confirm there's no cold-start state where graph_closure is empty but memories exist — if so, fall back gracefully to 2-path retrieval.

8. **Turso rate limits**: The Scaler plan allows 500 databases. With database-per-tenant, this limits to 500 active project databases before upgrading to Enterprise. Plan the upgrade path before hitting this ceiling.

9. **Cold-start graph indexing UX**: First project open triggers tree-sitter cold-start (30 seconds to 20 minutes). Agents should start with `source: "ast"` edges unavailable and progressively get better impact analysis. Prepend `[Knowledge Graph: indexing in progress — impact analysis may be incomplete]` to the first 3 agent sessions after project open.

10. **Personal memory vs. team memory conflict**: If a team decision says "use PostgreSQL" and a developer's personal memory says "this client project uses SQLite," personal memories override project memories in retrieval scoring when the personal memory has higher confidence and is more recent. Never silently suppress team memories — surface both with attribution.

---

*Document version: V5.0 — 2026-02-22*
*Built on: V4 Draft + Hackathon Teams 1-5 + Infrastructure Research*
*Key V4→V5 changes: Turso/libSQL replaces better-sqlite3, Convex for auth/team/UI only, OpenAI text-embedding-3-small replaces Voyage, Graphiti Python sidecar removed (replaced by TS Knowledge Graph), AST chunking + contextual embeddings + graph neighborhood boost built in from day one, complete retrieval pipeline from day one (no phases), FTS5 everywhere (not Tantivy), Cohere Rerank API for cloud reranking*
