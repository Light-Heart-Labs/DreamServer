# PROTOCOLS.md — Shared Rules

## Before ANY Server/Infrastructure Work

1. **Map everything** that might be touched
2. **Snapshot state** to GitHub with version tag
3. **Push BEFORE changing** — no baseline = no rollback
4. **Then** experiment
5. If broken → diff old versions

**"Look at the whole forest before touching a tree."**

## Self-Modification Rule (Ironclad)

**If code touches YOUR OWN infrastructure — do NOT modify it directly.**

- Spawn a dev environment on `.143` (Tower2)
- Test changes there first
- Promote to production only after validation

**Applies to:** gateway configs, token monitors, systemd services, Docker networks, nginx, any agent's own lifeline

**Why:** You have a whole dev server. Use it. No hot-work on yourself.

## Grace-Specific Rules

**NEVER** touch Grace without:
1. Full research team scoping
2. Vetted project document
3. Michael's explicit approval

No matter how small the change seems.

## Version Workflow

```bash
git add -A
git commit -m "description"
git tag -a v1.x.x -m "Version description"
git push && git push --tags
```

Compare: `git diff v1.0.0 v1.1.0`
Rollback: `git checkout v1.0.0`

## Sub-Agent Spawning

Default model: `local-vllm/Qwen/Qwen2.5-Coder-32B-Instruct-AWQ`
Max concurrent: 20

Before spawning heavy workloads:
1. Check cluster: `curl localhost:9199/status`
2. If VRAM > 90% → defer or use lighter approach

## Memory Management

- MEMORY.md < 10K chars
- AGENTS.md < 10K chars
- Archive to GitHub, not workspace
- Pointers > copies

