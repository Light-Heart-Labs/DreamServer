# Agent Build and Dependencies

Everything needed to set up a production agentic coding tool project from zero — technology stack, dependency list, project structure, build configuration, packaging strategy, test pyramid, and release process. This is the shopping list and assembly guide for the entire system described in the other 30 documents.

*Last updated: 2026-03-31*

---

## 1. Technology Stack

### Runtime and Language

| Component | Choice | Why |
|-----------|--------|-----|
| **Runtime** | Bun | Fast startup (~300ms), native TypeScript, built-in bundler with DCE, NAPI support |
| **Language** | TypeScript (strict mode) | Type safety for 70K+ line codebase, Zod integration, IDE support |
| **Alternative runtimes** | Node.js works but slower startup; Deno possible with adapter layer | Bun's bundler feature flags are critical for DCE |

### UI and Rendering

| Component | Package | Purpose |
|-----------|---------|---------|
| **React** | `react` | Component model, state management, hooks |
| **Ink** | `ink` | React renderer for terminals (custom reconciler) |
| **Yoga** | `yoga-layout` (or `yoga-wasm-web`) | Flexbox layout engine for terminal UI |

### CLI Framework

| Component | Package | Purpose |
|-----------|---------|---------|
| **Commander.js** | `@commander-js/extra-typings` | CLI argument parsing with TypeScript types |

### Schema and Validation

| Component | Package | Purpose |
|-----------|---------|---------|
| **Zod** | `zod` (v4) | Tool input validation, config schema, API response validation |

### LLM Integration

| Component | Package | Purpose |
|-----------|---------|---------|
| **LLM Provider SDK** | Your LLM provider's official SDK | Model API calls, streaming, token counting |
| **MCP SDK** | `@modelcontextprotocol/sdk` | Connect to external tool servers via MCP protocol |

### Shell Parsing and Security

| Component | Package | Purpose |
|-----------|---------|---------|
| **Tree-sitter** | `tree-sitter` + `tree-sitter-bash` | AST-based shell command parsing for injection prevention |
| **Shell quote** | `shell-quote` or custom | Shell argument quoting and escaping |

### File Operations

| Component | Package | Purpose |
|-----------|---------|---------|
| **Diff** | `diff` (npm) | Structured patch generation with timeout protection |
| **Sharp** | `sharp` | Image resizing, format conversion, validation |
| **PDF tools** | `poppler-utils` (system dependency) | PDF page extraction via `pdftoppm` |

### IDE Integration

| Component | Package | Purpose |
|-----------|---------|---------|
| **JSON-RPC** | `vscode-jsonrpc` | LSP transport layer |
| **LSP Protocol** | `vscode-languageserver-protocol` | LSP message types and capabilities |

### Network and Transport

| Component | Package | Purpose |
|-----------|---------|---------|
| **WebSocket** | `ws` | MCP server connections, remote sessions, bridge transport |
| **HTTP** | Node.js built-in `http`/`https` | API calls, health checks, webhook hooks |

### Telemetry and Analytics

| Component | Package | Purpose |
|-----------|---------|---------|
| **OpenTelemetry** | `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-logs`, `@opentelemetry/sdk-metrics` | Distributed tracing, structured logging, metrics |
| **Feature Flags** | GrowthBook (`@growthbook/growthbook`) or LaunchDarkly or equivalent | Feature gating, A/B testing, progressive rollout |

### Utilities

| Component | Package | Purpose |
|-----------|---------|---------|
| **lodash-es** | `lodash-es` | Utility functions (mapValues, pickBy, uniqBy, etc.) |
| **chalk** | `chalk` | Terminal color output |
| **wrap-ansi** | `wrap-ansi` | ANSI-aware text wrapping |

---

## 2. Project Structure

```
project-root/
├── src/
│   ├── main.tsx                 # Entry point: CLI parsing, bootstrap, render
│   ├── query.ts                 # Query loop generator (the main engine)
│   ├── QueryEngine.ts           # LLM streaming client
│   ├── Tool.ts                  # Tool type definitions and interfaces
│   ├── commands.ts              # Command registry and dispatch
│   │
│   ├── commands/                # Slash command implementations (~50 commands)
│   │   ├── commit/
│   │   ├── review/
│   │   ├── config/
│   │   └── ...
│   │
│   ├── tools/                   # Tool implementations (~40 tools)
│   │   ├── BashTool/
│   │   ├── FileReadTool/
│   │   ├── FileWriteTool/
│   │   ├── FileEditTool/
│   │   ├── GrepTool/
│   │   ├── GlobTool/
│   │   ├── WebSearchTool/
│   │   ├── AgentTool/
│   │   └── ...
│   │
│   ├── services/                # External integrations
│   │   ├── api/                 # LLM API client
│   │   ├── tools/               # Tool orchestration, streaming executor
│   │   ├── mcp/                 # MCP server management
│   │   ├── lsp/                 # Language Server Protocol
│   │   ├── analytics/           # Telemetry and feature flags
│   │   ├── compact/             # Context compaction pipeline
│   │   ├── oauth/               # OAuth flows
│   │   ├── plugins/             # Plugin system
│   │   ├── autoDream/           # Background memory consolidation
│   │   ├── extractMemories/     # Automatic memory extraction
│   │   ├── SessionMemory/       # Session memory management
│   │   ├── teamMemorySync/      # Team memory synchronization
│   │   ├── policyLimits/        # Enterprise policy enforcement
│   │   ├── remoteManagedSettings/ # Enterprise config distribution
│   │   ├── settingsSync/        # Cross-device settings sync
│   │   ├── PromptSuggestion/    # Prompt suggestions and speculation
│   │   └── tips/                # Contextual tips
│   │
│   ├── components/              # React/Ink UI components (~140 files)
│   ├── screens/                 # Full-screen UIs (REPL, Doctor, Resume)
│   ├── hooks/                   # React hooks (permissions, tools, UI state)
│   ├── ink/                     # Custom Ink renderer, keyboard, mouse
│   │
│   ├── bridge/                  # SDK bridge (local ↔ remote translation)
│   ├── remote/                  # Remote session management
│   ├── coordinator/             # Multi-agent coordination
│   ├── server/                  # Direct connect server mode
│   │
│   ├── utils/                   # Utility modules (~200+ files)
│   │   ├── auth.ts              # Authentication
│   │   ├── bash/                # Bash parsing and security
│   │   ├── permissions/         # Permission system
│   │   ├── hooks/               # Hook execution (SSRF guard, etc.)
│   │   ├── secureStorage/       # Keychain integration
│   │   ├── settings/            # Settings management
│   │   ├── plugins/             # Plugin utilities
│   │   ├── diff.ts              # Diff generation
│   │   ├── errors.ts            # Error type hierarchy
│   │   ├── messages.ts          # Message handling (largest util)
│   │   ├── sanitization.ts      # Unicode sanitization
│   │   ├── worktree.ts          # Git worktree management
│   │   ├── gracefulShutdown.ts  # Shutdown handling
│   │   └── ...
│   │
│   ├── memdir/                  # Persistent memory directory
│   ├── tasks/                   # Background task types
│   ├── skills/                  # Skill system
│   ├── plugins/                 # Plugin registry
│   ├── state/                   # Application state store
│   ├── types/                   # TypeScript type definitions
│   ├── schemas/                 # Zod schemas for config
│   ├── constants/               # Constants, system prompt sections
│   ├── migrations/              # Config version migrations
│   ├── entrypoints/             # Init logic, SDK entry
│   ├── bootstrap/               # Boot-time state
│   ├── keybindings/             # Keyboard shortcut config
│   ├── native-ts/               # Native module bindings
│   └── outputStyles/            # Output styling system
│
├── package.json
├── tsconfig.json                # TypeScript config (strict mode)
├── bunfig.toml                  # Bun configuration
└── .npmignore                   # CRITICAL: exclude .map files!
```

### Scale Reference

| Metric | Value |
|--------|-------|
| TypeScript/TSX files | ~1,900 |
| Lines of code | ~70,000 |
| Tool implementations | 40+ |
| Slash commands | 50+ |
| Service subsystems | 20+ |
| Utility modules | 200+ |
| React components | 140+ |

---

## 3. Build Configuration

### Bundler: Bun

```toml
# bunfig.toml
[build]
  entrypoints = ["src/main.tsx"]
  outdir = "dist"
  target = "bun"
  sourcemap = "external"  # IMPORTANT: don't ship in package!
```

### Feature Flag Dead Code Elimination

Bun's bundler supports build-time feature flags that enable dead code elimination:

```typescript
// At build time, feature() evaluates to true or false
// If false, the entire branch is removed from the bundle
if (feature('COORDINATOR_MODE')) {
  const coordinator = require('./coordinator/coordinatorMode')
  // This entire block is stripped if COORDINATOR_MODE is disabled
}
```

**Common feature gates:**
- `COORDINATOR_MODE` — Multi-agent coordination
- `VOICE_MODE` — Voice input/output
- `EXPERIMENTAL_SKILL_SEARCH` — Skill discovery
- `KAIROS` — Extended assistant mode

### Output

| Artifact | Format | Notes |
|----------|--------|-------|
| Main bundle | Single `.js` file | All TypeScript compiled and bundled |
| Source map | `.js.map` file | **MUST be excluded from npm package** |
| Type definitions | `.d.ts` files | For SDK consumers |

### Critical: Source Map Exclusion

```
# .npmignore
*.map
*.map.js
src/
```

**If you ship source maps in your npm package, your entire source code is publicly readable.** This is how production tools have been accidentally open-sourced.

---

## 4. Packaging Strategy

### npm Package (Primary)

```json
{
  "name": "your-agent-tool",
  "version": "1.0.0",
  "bin": {
    "agent": "./dist/main.js"
  },
  "files": [
    "dist/main.js",
    "dist/*.d.ts"
  ],
  "engines": {
    "node": ">=18",
    "bun": ">=1.0"
  }
}
```

### Native Installer (Optional)

For standalone binary distribution without requiring Bun/Node:

| Platform | Format | Distribution |
|----------|--------|-------------|
| macOS | `.pkg` or Homebrew formula | `brew install your-agent` |
| Windows | `.msi` or winget manifest | `winget install your-agent` |
| Linux | `.deb`, `.rpm`, or direct binary | `apt install your-agent` or `curl \| sh` |

### Update Channels

| Channel | npm Tag | Purpose |
|---------|---------|---------|
| `latest` | `@latest` | Current development |
| `stable` | `@stable` | Frozen releases for production |
| `beta` | `@beta` | Pre-release testing |

---

## 5. Test Pyramid

### Unit Tests

| What to Test | Example |
|-------------|---------|
| Tool input validation | Zod schema rejects invalid inputs |
| Permission rule matching | Wildcard patterns match correctly |
| Path normalization | Null bytes rejected, traversal blocked |
| Diff generation | Correct hunks for known input/output pairs |
| Unicode sanitization | Invisible characters stripped |
| Command classification | Read vs write command detection |
| Token counting | Character heuristic matches tokenizer |
| Shell security | Injection patterns detected |

### Integration Tests

| What to Test | Example |
|-------------|---------|
| Query loop with mock API | Full turn cycle with mocked model responses |
| Tool execution chain | File read → edit → verify flow |
| Permission flow | Allow/deny/ask rules apply correctly |
| Compaction | Context reduces without losing key info |
| Memory extraction | Memories saved after conversation |
| Config merging | Multi-source config resolves correctly |

### End-to-End Tests

| What to Test | Example |
|-------------|---------|
| Full session with real API | User asks to fix a bug, agent succeeds |
| Multi-turn conversation | Context grows, compacts, continues |
| Crash recovery | Kill process mid-turn, resume works |
| Remote session | Bridge connects, permissions route correctly |

### Security Tests

| What to Test | Example |
|-------------|---------|
| Shell injection vectors | All patterns from AGENT-SECURITY-COMMAND-EXECUTION.md |
| SSRF attempts | Private IP ranges, DNS rebinding, IPv4-mapped IPv6 |
| Unicode injection | Tag characters, zero-width, directional overrides |
| Path traversal | `../`, null bytes, symlinks |
| Permission bypass | Wildcard edge cases, cross-segment analysis |

---

## 6. Release Process

### Version Management

Follow semantic versioning:
- **Major:** Breaking behavior changes (new safety rules, tool renames)
- **Minor:** New features, behavioral refinements
- **Patch:** Bug fixes, cosmetic improvements

### Release Checklist

```
1. Run full test suite (unit + integration + security)
2. Run E2E tests against staging API
3. Update version in package.json
4. Run config migration tests (old config → new config)
5. Build bundle (bun build)
6. Verify .map files are NOT in package (check with `npm pack --dry-run`)
7. Publish to npm (appropriate channel tag)
8. Update max version config if needed (kill switch)
9. Monitor telemetry for error rate spike
10. If errors spike: publish new max version to cap at previous release
```

### Kill Switch

Remote configuration that caps the maximum installable version:

```json
{
  "maxVersion": "2.3.1",
  "message": "Version 2.4.0 has a critical bug. Capped at 2.3.1."
}
```

Agent auto-update respects this cap. Users can't update past the max version.

### Config Migrations

When a release changes config format:

```
migrations/
  001_rename_model_field.ts       // v1.0 → v1.1
  002_add_permission_defaults.ts  // v1.1 → v1.2
  003_migrate_tool_names.ts       // v1.2 → v2.0
```

Each migration has `up()` and `down()` functions. Runner applies pending migrations on startup.

---

## 7. Development Environment

### Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Bun | ≥1.0 | Runtime and bundler |
| Git | ≥2.30 | Worktree support |
| Node.js | ≥18 (optional) | Fallback runtime |
| poppler-utils | Any | PDF page extraction |

### Getting Started

```bash
# Install dependencies
bun install

# Run in development mode
bun run src/main.tsx

# Build for production
bun build src/main.tsx --outdir dist --target bun

# Run tests
bun test

# Lint
bun run lint

# Type check
bun run typecheck
```

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `AGENT_API_KEY` | LLM API key | None (required) |
| `AGENT_MODEL` | Default model | Provider's default |
| `AGENT_CONFIG_DIR` | Config directory | `~/.agent/` |
| `AGENT_LOG_LEVEL` | Logging verbosity | `info` |
| `DISABLE_FAST_MODE` | Disable fast mode optimization | `false` |
| `DISABLE_AUTO_COMPACT` | Disable auto-compaction | `false` |
| `EXIT_AFTER_STOP_DELAY` | Idle timeout (ms) | None (no timeout) |

---

## 8. Implementation Checklist

### Minimum Viable Project Setup

- [ ] Initialize Bun project with TypeScript strict mode
- [ ] Install core dependencies (React, Ink, Zod, Commander, LLM SDK)
- [ ] Create project structure (src/ with tools/, services/, utils/, commands/)
- [ ] Configure bundler with entry point
- [ ] Create basic CLI with Commander.js
- [ ] Verify React/Ink renders in terminal
- [ ] Verify LLM API connection works

### Production-Grade Build

- [ ] All of the above, plus:
- [ ] Feature flag DCE in bundler config
- [ ] Source map generation (external only, NOT shipped)
- [ ] .npmignore excludes src/ and *.map
- [ ] npm package with bin entry
- [ ] Multiple update channels (latest, stable, beta)
- [ ] Config migration system
- [ ] Max version kill switch
- [ ] Unit test suite for all security patterns
- [ ] Integration test suite for query loop
- [ ] E2E test suite with real API
- [ ] Security test suite (injection, SSRF, Unicode, traversal)
- [ ] CI/CD pipeline (lint, typecheck, test, build, publish)
- [ ] Startup profiling with checkpoint timing
- [ ] Bundle size monitoring
- [ ] Telemetry for error rates and performance

---

## Related Documents

- [AGENT-ARCHITECTURE-OVERVIEW.md](AGENT-ARCHITECTURE-OVERVIEW.md) — The master blueprint this build guide supports
- [AGENT-BOOTSTRAP-AND-CONFIGURATION.md](AGENT-BOOTSTRAP-AND-CONFIGURATION.md) — Configuration system initialized during startup
- [AGENT-FEATURE-DELIVERY.md](AGENT-FEATURE-DELIVERY.md) — Auto-update and release management
- [AGENT-LIFECYCLE-AND-PROCESS.md](AGENT-LIFECYCLE-AND-PROCESS.md) — Process management and graceful shutdown
- [AGENT-INITIALIZATION-AND-WIRING.md](AGENT-INITIALIZATION-AND-WIRING.md) — How the bootstrap sequence works
