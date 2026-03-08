# Sub-Agent Swarm Patterns

*How to effectively use multiple AI agents in parallel with OpenClaw + local Qwen*

## When to Swarm

### Good for Parallelization ✅
- Research across multiple topics
- Document processing (chunk → process → merge)
- Testing multiple scenarios
- Data transformation pipelines
- Independent API calls

### Keep Sequential ❌
- Tasks with strict dependencies
- Stateful conversations
- Tasks requiring intermediate human review
- Single complex reasoning chains

**Rule of thumb:** If subtasks don't need each other's output, parallelize.

## Spawn Patterns

### 1. Fan-Out / Fan-In

Spawn multiple agents, collect all results.

```javascript
// Fan-out: Spawn research agents for each topic
const topics = ["M1 local AI", "M2 voice agents", "M3 privacy"];
const results = [];

for (const topic of topics) {
  sessions_spawn({
    task: `Research ${topic} and summarize findings`,
    label: `research-${topic.replace(/\s/g, '-')}`
  });
}

// Fan-in: Results come back via announcements
// Aggregate in MEMORY.md or a dedicated file
```

**Real example:** Our mission research sweep spawned 9 agents in parallel.

### 2. Pipeline

Sequential stages, each feeding the next.

```javascript
// Stage 1: Extract
sessions_spawn({
  task: "Extract all code snippets from the document",
  label: "pipeline-extract"
});

// Stage 2: Transform (after Stage 1 completes)
sessions_spawn({
  task: "Convert extracted snippets to Python 3.12 syntax",
  label: "pipeline-transform"  
});

// Stage 3: Load (after Stage 2 completes)
sessions_spawn({
  task: "Save transformed code to repository with tests",
  label: "pipeline-load"
});
```

**Best for:** ETL workflows, document processing chains.

### 3. Hierarchical Delegation

Manager agent spawns worker agents.

```javascript
// Manager task
sessions_spawn({
  task: `You are a research coordinator. Break this problem into 3-5 subtasks 
         and spawn sub-agents for each. Aggregate their findings into a report.
         
         Problem: How can we optimize voice agent latency?`,
  label: "research-manager"
});
```

**Best for:** Complex problems that need decomposition.

## Task Decomposition

### Chunking Strategy

```javascript
// Bad: One agent processes everything
sessions_spawn({ task: "Process all 1000 documents" });

// Good: Chunk into parallelizable batches
const CHUNK_SIZE = 50;
for (let i = 0; i < documents.length; i += CHUNK_SIZE) {
  const chunk = documents.slice(i, i + CHUNK_SIZE);
  sessions_spawn({
    task: `Process documents ${i} to ${i + CHUNK_SIZE}`,
    label: `chunk-${i}`
  });
}
```

### Decomposition Heuristics

| Task Type | Decomposition |
|-----------|---------------|
| Research | By topic/question |
| Documents | By file or page range |
| Testing | By test case |
| Analysis | By data partition |

## Result Aggregation

### File-Based Aggregation

```javascript
// Each agent writes to a numbered file
sessions_spawn({
  task: `Research topic X. Write findings to research/topic-x.md`,
  label: "research-x"
});

// Aggregator agent combines them
sessions_spawn({
  task: `Read all files in research/*.md and create a combined summary`,
  label: "aggregator"
});
```

### Memory-Based Aggregation

```javascript
// Agents update shared MEMORY.md
sessions_spawn({
  task: `Research X. Add key findings to MEMORY.md under "## Research Results"`,
  label: "research-x"
});
```

### Structured Output

```javascript
// Request JSON for easier parsing
sessions_spawn({
  task: `Analyze the codebase. Output as JSON:
         {"files_analyzed": N, "issues": [...], "recommendations": [...]}`,
  label: "code-analysis"
});
```

## Error Handling

### Timeout Protection

```javascript
sessions_spawn({
  task: "Complex research task",
  label: "risky-task",
  runTimeoutSeconds: 300  // Kill if takes > 5 minutes
});
```

### Graceful Degradation

```javascript
// Spawn with fallback awareness
sessions_spawn({
  task: `Try to complete this analysis. If you encounter errors or 
         can't complete, output: {"status": "failed", "reason": "..."}.
         Partial results are acceptable.`,
  label: "best-effort"
});
```

### Retry Pattern

```javascript
// Main agent retries failed sub-tasks
const MAX_RETRIES = 2;
let attempt = 0;

while (attempt < MAX_RETRIES) {
  const result = await sessions_spawn({ task: "..." });
  if (result.status === "success") break;
  attempt++;
}
```

## Resource Management

### Concurrency Limits

```javascript
// OpenClaw config (openclaw.json)
{
  "ai": {
    "subAgent": {
      "maxConcurrent": 20,  // Max parallel agents
      "model": "local-vllm/Qwen/Qwen2.5-Coder-32B-Instruct-AWQ"
    }
  }
}
```

### GPU-Aware Spawning

```javascript
// Check GPU before spawning heavy tasks
const status = await fetch("http://localhost:9199/status");
const gpuUtil = status.nodes[0].gpu_utilization;

if (gpuUtil > 80) {
  console.log("GPU busy, queuing task for later");
} else {
  sessions_spawn({ task: "Heavy computation" });
}
```

### Staggered Spawning

```javascript
// Don't flood the GPU — stagger spawns
for (const task of tasks) {
  sessions_spawn({ task });
  await sleep(2000);  // 2 second gap between spawns
}
```

## Real Examples

### Research Parallelization

```javascript
// What we actually did for mission research
const missions = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"];

for (const mission of missions) {
  sessions_spawn({
    task: `Research ${mission} from MISSIONS.md. Provide practical findings.
           Output analysis as text (no file operations).`,
    label: `research-${mission}`,
    runTimeoutSeconds: 300
  });
}

// Result: 9 research docs in ~5 minutes
```

### Document Processing

```javascript
// Process PDFs in parallel
const pdfs = ["doc1.pdf", "doc2.pdf", "doc3.pdf"];

for (const pdf of pdfs) {
  sessions_spawn({
    task: `Extract key information from ${pdf}:
           - Main topics
           - Key dates
           - Action items
           Save to processed/${pdf.replace('.pdf', '.md')}`,
    label: `process-${pdf}`
  });
}
```

### Test Suite Parallelization

```javascript
// Run test scenarios in parallel
const scenarios = [
  "happy path booking",
  "cancellation flow", 
  "reschedule with conflict",
  "emergency escalation"
];

for (const scenario of scenarios) {
  sessions_spawn({
    task: `Generate test cases for: ${scenario}
           Include: inputs, expected outputs, edge cases`,
    label: `test-${scenario.replace(/\s/g, '-')}`
  });
}
```

## Patterns We've Learned

### What Works ✅
- Pure reasoning tasks complete reliably
- Short, focused prompts
- Explicit output format requests
- File-based result aggregation

### What Doesn't ❌ (Until proxy v2.1)
- Heavy tool use in sub-agents
- Multi-step file operations
- Complex git workflows
- Chained tool calls

### Optimal Task Size
- **Too small:** Overhead dominates (< 30 seconds of work)
- **Too large:** Risk of timeout or drift (> 10 minutes)
- **Sweet spot:** 1-5 minutes of focused work

---

*Pattern guide by The Collective — battle-tested on local Qwen 32B*
