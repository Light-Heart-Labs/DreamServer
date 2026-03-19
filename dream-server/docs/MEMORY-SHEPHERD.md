# Memory Shepherd

Dream Server agents can remember things across sessions — past conversations,
facts they discovered, decisions they made, documents they processed.
This guide explains where those memories live, how long they are kept, and
how to inspect, export, or flush them.

---

## Table of Contents

1. [Memory layers](#1-memory-layers)
2. [Retention policy](#2-retention-policy)
3. [Inspecting memory](#3-inspecting-memory)
4. [Flushing memory](#4-flushing-memory)
5. [Exporting memory](#5-exporting-memory)
6. [OpenClaw integration](#6-openclaw-integration)
7. [Configuration reference](#7-configuration-reference)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Memory layers

Dream Server has four distinct memory layers.  Each serves a different
purpose and has a different lifecycle.

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1 — In-context window  (ephemeral, per-request)       │
│  Layer 2 — Session memory     (ephemeral, per-session)       │
│  Layer 3 — Agent memory       (persistent, per-agent)        │
│  Layer 4 — Semantic memory    (persistent, corpus-wide)      │
└──────────────────────────────────────────────────────────────┘
```

### Layer 1 — In-context window

The active conversation tokens that `llama-server` holds while generating
a response.  Lives entirely in GPU VRAM.  Evicted the moment the request
finishes.  Size is bounded by `CTX_SIZE` in `.env` (default 4096–32768
depending on tier).

This layer is not managed by the Memory Shepherd — it is self-cleaning.

### Layer 2 — Session memory

OpenClaw writes a JSON record for every session it runs.  The record
includes the session ID, start/end timestamps, the goal the agent was
given, a list of tool calls made, and a short summary the agent writes
before closing the session.

**Location:** `data/openclaw/sessions/`  
**Format:** one JSON file per session — `<session-id>.json`  
**Default retention:** 30 days

```
data/openclaw/
  sessions/
    3f9a1b2c-0001.json
    3f9a1b2c-0002.json
    ...
```

### Layer 3 — Agent memory

Long-lived facts and context that OpenClaw explicitly decides to remember
between sessions.  When an agent writes a memory it creates a Markdown
snippet in `data/openclaw/memory/`.  On the next session, OpenClaw reads
relevant entries from this directory and injects them into the context
window before the model sees the user's message.

**Location:** `data/openclaw/memory/`  
**Format:** Markdown files with YAML frontmatter  
**Default retention:** indefinite (no automatic pruning unless configured)

```yaml
---
id: mem-20260301-142301
created: 2026-03-01T14:23:01Z
tags: [user-preference, format]
importance: 0.8          # 0.0–1.0; lower-importance entries pruned first
---
User prefers bullet-point summaries over prose.
Keep responses under 200 words unless explicitly asked for more.
```

### Layer 4 — Semantic memory (Qdrant)

When you index documents through Open WebUI's RAG pipeline or via
`dream-cli`, the text is chunked, embedded, and stored in Qdrant.
Agents can query Qdrant at retrieval time to surface relevant passages
from your document corpus.

**Location:** `data/qdrant/`  
**Queried via:** `http://qdrant:6333` (internal Docker DNS)  
**Default retention:** indefinite; collections must be deleted explicitly

Unlike the other layers, semantic memory is keyed to *collections*
(document sets) rather than to individual sessions or agents.

---

## 2. Retention policy

### Defaults

| Layer | Default retention | Pruning trigger |
|-------|------------------|-----------------|
| In-context | Request lifetime | Automatic |
| Session memory | 30 days | Nightly background task |
| Agent memory | Indefinite | Manual or `importance` threshold |
| Semantic memory | Indefinite | Manual collection delete |

### Configuring session retention

Set `MEMORY_SESSION_TTL_DAYS` in `.env`:

```bash
# Keep session records for 14 days (0 = keep forever)
MEMORY_SESSION_TTL_DAYS=14
```

### Configuring agent-memory pruning

OpenClaw prunes low-importance memories when the total memory store
exceeds `MEMORY_MAX_ENTRIES`.  Entries are ranked by `importance` score;
ties broken by age (oldest first).

```bash
# Maximum number of memory entries to keep per agent
MEMORY_MAX_ENTRIES=500

# Entries with importance below this threshold are eligible for pruning
MEMORY_PRUNE_THRESHOLD=0.3
```

These settings live in `.env` and are passed to the `openclaw` container
as environment variables.  Reload with:

```bash
dream restart openclaw
```

### Configuring Qdrant collection limits

Qdrant enforces no built-in TTL.  You set collection-level limits through
the API or the Qdrant dashboard (port `6333`):

```bash
# List all collections and their sizes
curl http://localhost:6333/collections | jq '.result.collections[] | {name, vectors_count}'
```

---

## 3. Inspecting memory

### Session records

```bash
# List recent sessions (newest first)
ls -lt data/openclaw/sessions/ | head -20

# Read a specific session
cat data/openclaw/sessions/<session-id>.json | jq .

# Count sessions per day
ls data/openclaw/sessions/*.json \
  | xargs -I{} basename {} .json \
  | cut -d- -f1-3 \
  | sort | uniq -c
```

### Agent memory entries

```bash
# List all memory entries
ls data/openclaw/memory/

# Show entry IDs and importance scores
grep -h '^importance:' data/openclaw/memory/*.md \
  | sort -t: -k2 -n

# Find memories tagged with a topic
grep -rl 'tags:.*user-preference' data/openclaw/memory/
```

### Qdrant collections

```bash
# List collections
curl -s http://localhost:6333/collections | jq '.result.collections[].name'

# Collection size and config
curl -s http://localhost:6333/collections/<collection-name> | jq .result.config
```

### From the dashboard

Open the Dream Server dashboard (`http://localhost:3001`) and navigate to
**Agents → Memory**.  The panel shows:

- Active session count
- Total agent memory entries and disk usage
- Qdrant collection list with vector counts

---

## 4. Flushing memory

> **Warning:** Flushing is permanent.  Export first if you need a backup
> (see [Section 5](#5-exporting-memory)).

### Flush session records

```bash
# Remove session records older than N days
find data/openclaw/sessions/ -name '*.json' -mtime +30 -delete

# Remove all session records
rm -f data/openclaw/sessions/*.json
```

### Flush agent memory

```bash
# Remove a single memory entry
rm data/openclaw/memory/<entry-id>.md

# Remove all low-importance entries (importance < 0.3)
for f in data/openclaw/memory/*.md; do
  score=$(grep -m1 '^importance:' "$f" | awk '{print $2}')
  if awk "BEGIN {exit !($score < 0.3)}"; then
    echo "Removing: $f (importance=$score)"
    rm "$f"
  fi
done

# Remove all agent memory
rm -f data/openclaw/memory/*.md
```

### Flush a Qdrant collection

```bash
# Delete a specific collection (all vectors)
curl -X DELETE http://localhost:6333/collections/<collection-name>

# Delete all collections
curl -s http://localhost:6333/collections \
  | jq -r '.result.collections[].name' \
  | while read -r name; do
      curl -X DELETE "http://localhost:6333/collections/${name}"
      echo "Deleted: ${name}"
    done
```

### Flush everything (full reset)

```bash
dream stop openclaw

rm -rf data/openclaw/sessions/*
rm -rf data/openclaw/memory/*

# Optionally reset Qdrant (removes all indexed documents)
rm -rf data/qdrant/

dream start openclaw
```

---

## 5. Exporting memory

### Export session records

```bash
mkdir -p exports/sessions-$(date +%Y%m%d)
cp data/openclaw/sessions/*.json exports/sessions-$(date +%Y%m%d)/
echo "Exported $(ls exports/sessions-$(date +%Y%m%d)/*.json | wc -l) session records."
```

### Export agent memory

```bash
mkdir -p exports/memory-$(date +%Y%m%d)
cp data/openclaw/memory/*.md exports/memory-$(date +%Y%m%d)/

# Also produce a combined JSON export
python3 - <<'EOF'
import os, json, re
from pathlib import Path

entries = []
for f in sorted(Path("data/openclaw/memory").glob("*.md")):
    text = f.read_text()
    # Extract YAML frontmatter
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if m:
        import yaml
        meta = yaml.safe_load(m.group(1))
        meta["body"] = m.group(2).strip()
        entries.append(meta)

out = f"exports/memory-{__import__('datetime').date.today().isoformat()}.json"
with open(out, "w") as fh:
    json.dump(entries, fh, indent=2, default=str)
print(f"Exported {len(entries)} memory entries → {out}")
EOF
```

### Export Qdrant collection as vectors + payloads

```bash
COLLECTION="my-documents"
curl -s -X POST "http://localhost:6333/collections/${COLLECTION}/points/scroll" \
  -H 'Content-Type: application/json' \
  -d '{"limit": 10000, "with_vector": true, "with_payload": true}' \
  | jq '.result.points' \
  > "exports/${COLLECTION}-vectors-$(date +%Y%m%d).json"
```

> **Qdrant snapshots** — for a portable binary backup of a collection,
> use the snapshot API (no vector re-embedding required on restore):
>
> ```bash
> # Create snapshot
> curl -X POST "http://localhost:6333/collections/${COLLECTION}/snapshots"
>
> # List snapshots
> curl http://localhost:6333/collections/${COLLECTION}/snapshots
>
> # Download snapshot (replace <name> with the returned snapshot name)
> curl -O "http://localhost:6333/collections/${COLLECTION}/snapshots/<name>"
> ```

---

## 6. OpenClaw integration

OpenClaw is the autonomous agent that actually reads and writes agent
memory (Layer 3).  Understanding how it interacts with the memory store
helps you tune behaviour and debug surprises.

### How memory is read

At the start of every session, OpenClaw's memory retriever scores all
entries in `data/openclaw/memory/` by semantic similarity to the current
goal.  The top-N entries (default: 20) are prepended to the system prompt
as a `<memory>` block before the model sees the user's first message.

```
[system prompt]
<memory>
• User prefers bullet-point summaries. (importance=0.8)
• Project uses Python 3.12 and FastAPI. (importance=0.7)
</memory>
[user message]
```

Control how many entries are injected:

```json
// config/openclaw/openclaw.json
{
  "memory": {
    "maxInjectEntries": 20,
    "minImportanceToInject": 0.4
  }
}
```

### How memory is written

During a session the agent can call the built-in `remember` tool:

```json
{
  "tool": "remember",
  "args": {
    "content": "Client prefers weekly status emails on Fridays.",
    "tags": ["client", "communication"],
    "importance": 0.9
  }
}
```

Dream Server's APE (Agent Policy Engine) always permits `remember` calls —
it is classified as `WriteFile` scoped to the memory directory, which is
in the `allowed_paths` list.

### How memory is forgotten

The agent can call `forget` with a memory ID:

```json
{
  "tool": "forget",
  "args": { "id": "mem-20260301-142301" }
}
```

This deletes the Markdown file.  The deletion is logged in the APE audit
trail (`data/ape/audit.jsonl`).

### Memory isolation between agents

Each named agent in `openclaw.json` has its own memory namespace.  If you
run multiple agent personas, their memories are stored in sub-directories:

```
data/openclaw/memory/
  default/          ← unnamed / default agent
  research-agent/   ← memories for the research-agent persona
  coding-agent/     ← memories for the coding-agent persona
```

Configure named agents in `openclaw.json`:

```json
{
  "agents": {
    "research-agent": {
      "systemPrompt": "You are a careful research assistant.",
      "memory": { "namespace": "research-agent" }
    },
    "coding-agent": {
      "systemPrompt": "You are a precise software engineer.",
      "memory": { "namespace": "coding-agent" }
    }
  }
}
```

### Memory + Qdrant (semantic retrieval)

When `memory.useVectorSearch` is enabled, OpenClaw routes retrieval
through Qdrant instead of the local file scorer.  Memory entries are
embedded at write time and stored in the `openclaw-memory` Qdrant
collection alongside your document corpus.

```json
{
  "memory": {
    "useVectorSearch": true,
    "qdrantUrl": "http://qdrant:6333",
    "qdrantCollection": "openclaw-memory"
  }
}
```

With vector search enabled, the `flush memory` and `export memory`
operations described in Sections 4 and 5 must also target the Qdrant
collection — the Markdown files become secondary (audit trail only).

---

## 7. Configuration reference

### `.env` keys

| Key | Default | Purpose |
|-----|---------|---------|
| `MEMORY_SESSION_TTL_DAYS` | `30` | Days before session records are pruned (0 = never) |
| `MEMORY_MAX_ENTRIES` | `500` | Maximum agent memory entries per agent namespace |
| `MEMORY_PRUNE_THRESHOLD` | `0.3` | Entries below this importance score are pruned first |
| `CTX_SIZE` | tier-dependent | Token context window for `llama-server` |
| `OPENCLAW_MEMORY_DIR` | `./data/openclaw/memory` | Override memory directory path |
| `OPENCLAW_SESSION_DIR` | `./data/openclaw/sessions` | Override session directory path |

### `config/openclaw/openclaw.json` keys

| Key | Default | Purpose |
|-----|---------|---------|
| `memory.maxInjectEntries` | `20` | Maximum memory entries injected per session |
| `memory.minImportanceToInject` | `0.4` | Importance threshold for injection |
| `memory.useVectorSearch` | `false` | Route retrieval through Qdrant |
| `memory.qdrantUrl` | `http://qdrant:6333` | Qdrant endpoint |
| `memory.qdrantCollection` | `openclaw-memory` | Collection name for agent memories |

### APE policy for memory operations

The APE policy (`config/ape/policy.yaml`) controls which memory paths
agents can write to.  The default grants write access only within the
configured memory directory:

```yaml
intents:
  WriteFile:
    mode: path_guard
    allowed_paths:
      - /home/node/.openclaw/workspace
      - /data/openclaw/memory     # agent memory writes allowed
```

To restrict a specific agent from writing new memories, add a
session-scoped deny rule:

```yaml
intents:
  WriteFile:
    mode: path_guard
    allowed_paths:
      - /home/node/.openclaw/workspace
    # Remove the memory path to prevent memory writes
```

---

## 8. Troubleshooting

### Agent keeps repeating things it already knows

The context window is probably receiving duplicate injections.  Check:

```bash
# See what was injected in the last session
cat data/openclaw/sessions/<latest-session-id>.json | jq '.injected_memories'

# If duplicates exist, check for near-identical memory entries
grep -h '^id:' data/openclaw/memory/*.md
```

Lower `memory.maxInjectEntries` or raise `memory.minImportanceToInject`
if the injected block is crowding out useful context.

### Memory entries are not being injected

1. Confirm OpenClaw can read the memory directory:
   ```bash
   docker exec dream-openclaw ls /data/openclaw/memory/
   ```
2. Check that `importance` scores are above `minImportanceToInject`.
3. Verify the `OPENCLAW_MEMORY_DIR` path in `.env` matches the Docker
   volume mount.

### `data/openclaw/memory/` growing unbounded

Enable automatic pruning by setting both thresholds in `.env`:

```bash
MEMORY_MAX_ENTRIES=200
MEMORY_PRUNE_THRESHOLD=0.4
```

Then restart:
```bash
dream restart openclaw
```

To immediately prune without restarting, run the flush snippet from
[Section 4](#4-flushing-memory).

### Qdrant out of disk space

```bash
# Check collection sizes
curl -s http://localhost:6333/collections \
  | jq '.result.collections[] | {name, vectors_count: .vectors_count}'

# Delete the largest collection if it is no longer needed
curl -X DELETE http://localhost:6333/collections/<name>
```

If disk pressure is chronic, consider setting a smaller embedding model
(`EMBEDDING_MODEL` in `.env`) to reduce vector dimensionality.

### APE blocking memory writes

Check the audit log:

```bash
tail -f data/ape/audit.jsonl | jq 'select(.intent == "WriteFile" and .allowed == false)'
```

Add the memory path to `allowed_paths` in `config/ape/policy.yaml` and
reload the policy (APE hot-reloads on file change — no restart needed).

---

*Related docs:*
*[OPENCLAW-INTEGRATION.md](OPENCLAW-INTEGRATION.md) — full OpenClaw setup guide*
*[EXTENSIONS.md](EXTENSIONS.md) — adding custom services to Dream Server*
*[BACKEND-CONTRACT.md](BACKEND-CONTRACT.md) — llama-server API contract*
