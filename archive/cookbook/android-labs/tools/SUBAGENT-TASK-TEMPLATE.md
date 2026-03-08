# Sub-Agent Task Template

*Optimized for local Qwen 32B models via vLLM — addresses ~30% direct success rate*

## Learnings from This Session

### What Works
- Clear, atomic tasks with single file output
- Explicit file paths (no globs like `M1-*.md`)
- Research tasks that end in "Write to [path]"
- Tasks under 100 words

### What Fails
- Complex multi-step workflows
- Tasks requiring multiple file reads first
- Vague instructions ("figure out...")
- Tasks that need context from previous conversations

## Recommended Template

```
[TASK]: {One sentence describing the goal}

[CONTEXT]: Read {specific file path} for background.

[RESEARCH]: 
1. {Specific question 1}
2. {Specific question 2}
3. {Specific question 3}

[OUTPUT]: Write findings to {exact file path}

[FORMAT]: 
- Use markdown headers
- Include code examples where relevant
- Keep under 3000 words
```

## Example Tasks That Succeeded

### ✅ Good Task
```
Research M4: Deterministic Voice Agents. Explore how to reduce LLM 
dependence in voice agents using traditional code. Research: 
1) State machine libraries for Python, 2) Rule-based intent matching, 
3) Template-based responses, 4) When LLM is truly needed. 
Write findings to /home/node/.openclaw/workspace/research/M4-DETERMINISTIC-VOICE-AGENTS.md
```

### ❌ Bad Task (Too Vague)
```
Look into how we can make voice agents better and write up what you find.
```

## Loop Bug Mitigation

The ~67% failure rate is due to the model outputting JSON tool calls as text instead of executing them.

### Symptoms
- Model prints `{"name": "write", "arguments": {...}}`
- Sometimes loops, printing same JSON repeatedly
- File ends up empty or not created

### Workaround: Manual Salvage
1. Check sub-agent session output via `sessions_list`
2. Extract the intended content from the JSON
3. Write file manually
4. Commit and note as "salvaged"

### Potential Fixes (M9 Investigation)
- [ ] Adjust stop tokens in vLLM config
- [ ] Lower temperature for tool-calling tasks
- [ ] Try Hermes chat template for Qwen 2.5
- [ ] Fine-tune on tool-calling examples
- [ ] Post-process output to detect and execute JSON

## Success Rate Tracking

| Date | Spawned | Direct Success | Salvaged | Rate |
|------|---------|----------------|----------|------|
| 2026-02-10 | 16 | 5 | 11 | 31% |
| 2026-02-10 (with stop prompts) | 3 | 3 | 0 | **100%** |
| 2026-02-10 (complex + stop) | 1 | 0 | 1 | 0% (but no loop!) |

## 🎯 BREAKTHROUGH: Stop Instruction Prompts

Adding explicit stop instructions dramatically improves success rate!

### Magic Phrases That Work
Add one of these to EVERY sub-agent task:

```
"Do not output JSON. Do not loop."
"Stop after confirming."
"Reply 'Done' after writing."
"Execute the tool, then confirm in plain English."
```

### Updated Template
```
[TASK]: {goal}
[OUTPUT]: Write to {path}
[STOP]: After writing, reply only "Done". Do not output JSON. Do not loop.
```

---

## 📁 Path Resolution Issue (2026-02-10)

Sub-agents often write to **sandbox relative paths** instead of absolute paths.

### Symptom
- Task says "write to /home/node/.openclaw/workspace/research/FILE.md"
- Sub-agent writes to relative path in sandbox instead
- File doesn't appear in expected location

### Solution: Always Salvage
1. Check `sessions_history` for sub-agent output
2. Extract the file content from tool call or text
3. Write to correct absolute path manually
4. Commit with note "(salvaged from sub-agent)"

### Success Rate with This Pattern
- Stop prompts prevent loops: ✅ 100%
- Path resolution: Requires salvage but 100% recoverable

**Net result: 100% usable output, just needs extra extraction step**

---

*Part of M9: Making local models work better*
