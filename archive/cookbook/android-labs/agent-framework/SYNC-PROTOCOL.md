# Sync Protocol

How the Android collective stays in sync.

---

## The Build-Review-Merge Pipeline

All code changes flow through branches, not directly to main.

### The Flow

```
16 or Todd creates feature branch → builds → pushes branch
                                                    ↓
                                          17 reviews branch
                                           ↓              ↓
                                      Approved         Needs changes
                                         ↓                  ↓
                                  17 merges to main    Author fixes, re-pushes
                                         ↓                  ↓
                                  Todd validates       17 re-reviews
                                  (integration test)
```

### Branch Naming

| Agent | Format | Example |
|-------|--------|---------|
| Android-16 | `16/short-description` | `16/token-spy-auth-middleware` |
| Todd | `todd/short-description` | `todd/docker-compose-validation` |
| Android-17 | `17/short-description` | `17/api-gateway-redesign` (rare — 17 mostly reviews) |

### What Goes Through Branches (Requires Review)

- All code changes (`.py`, `.js`, `.ts`, `.sh`, `.yaml` for Docker/configs, etc.)
- New tools or scripts in `tools/`
- Product code in `products/`, `dream-server/`, `token-spy/`
- Infrastructure configs in `infrastructure/`

### What Goes Direct to Main (No Review Needed)

- `STATUS.md`, `PROJECTS.md` updates
- `research/*.md` — research documents
- `docs/*.md` — documentation
- `comms/` — messages between agents
- `memory/` — collective lessons, session summaries
- Test results and benchmark outputs

### How to Create a Branch and Work

```bash
# 1. Pull latest main
cd ~/.openclaw/workspace/Android-Labs && git pull origin main

# 2. Create feature branch
git checkout -b 16/my-feature-name

# 3. Do your work, commit as you go
git add specific-files-changed
git commit -m '[16] Description of what this commit does'

# 4. Push the branch
git push origin 16/my-feature-name

# 5. Notify in Discord #builds that the branch is ready for review
```

### How to Review and Merge (17 or backup reviewer)

```bash
# 1. Fetch the branch
git fetch origin
git checkout origin/16/my-feature-name

# 2. Review the changes
git diff main...origin/16/my-feature-name

# 3a. If approved — merge to main
git checkout main
git pull origin main
git merge origin/16/my-feature-name --no-ff -m '[17] Merge 16/my-feature-name: description'
git push origin main

# 3b. Clean up the branch
git push origin --delete 16/my-feature-name

# 3c. If changes needed — post feedback in Discord, tag the author
```

---

## On Every Heartbeat

Each instance should:

1. **Pull latest**
   ```bash
   cd ~/.openclaw/workspace/Android-Labs && git pull origin main
   ```

2. **Check for review work** (17 especially)
   - `git fetch origin && git branch -r | grep -E 'origin/(16|todd)/'`
   - Pending reviews are highest priority

3. **Check sibling comms**
   - Look in comms/17/, comms/18/, comms/windows/
   - Read any new messages

4. **Before ideating, check:**
   - What are siblings working on?
   - Any branches waiting for review?
   - Any handoffs waiting for me?
   - Anything I should build on?

---

## When You Complete Work

### Code changes (branch pipeline):
1. Push to your feature branch
2. Post in Discord #builds that it's ready for review
3. Wait for review before starting dependent work (you can start independent work)

### Non-code changes (direct to main):
1. **Commit and push**
   ```bash
   git add specific-files
   git commit -m '[16|17|todd] Description of work'
   git push origin main
   ```

2. **Notify siblings** (optional for major work)
   - Write a message in your comms folder
   - Summarize what you did and what they might want to know

---

## Folder Purposes

| Folder | What Goes Here |
|--------|----------------|
| research/ | Completed research outputs, punch lists |
| tools/ | Code, scripts, utilities |
| experiments/ | Test results, benchmarks |
| decisions/ | Important choices with reasoning |
| comms/ | Messages between siblings |
| products/ | Product code (Token Spy, Privacy Shield) |
| dream-server/ | Dream Server product code |

---

## Git Identities

| Instance | Email | Name |
|----------|-------|------|
| 16 | android16@lightheartlabs.com | Android-16 |
| 17 (.122) | android17@lightheartlabs.com | Android-17 |
| Todd (.122) | windowstodd@lightheartlabs.com | Windows-Todd |
| 18 | android18@lightheartlabs.com | Android-18 |

---

## Role Summary

| Agent | Primary Role | Secondary Role |
|-------|-------------|----------------|
| **Android-16** | Heavy Executor — all coding, testing, experiments | Sub-agent swarm orchestrator |
| **Android-17** | Architect — design decisions, code review | Complex debugging, emergency fixes |
| **Todd** | Integration Tester — e2e validation, Docker testing | Second builder on parallel workstreams |
| **Android-18** | Ops Controller — situation reports every 15 min | Deep auditor — Opus 4.6 punch lists 2x/day |

---

*Build on branches. Review before merge. Test after merge. Keep the pipeline flowing.*
