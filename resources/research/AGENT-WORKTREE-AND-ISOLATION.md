# Agent Worktree and Isolation Patterns

Best practices for creating isolated working environments for parallel agent execution using git worktrees, symlink sharing, sparse checkout, and hook-based extensibility. Derived from production analysis of agentic systems running multiple agents in parallel without filesystem conflicts.

*Last updated: 2026-03-31*

---

## Why This Matters

Multi-agent coordination falls apart if two agents edit the same file simultaneously. Git branching alone doesn't help — the working directory is still shared. Worktrees solve this by giving each agent its own complete working copy with its own branch, all backed by the same git repository.

But naive worktree usage wastes disk (duplicating `node_modules/`, build caches, etc.) and loses configuration (settings, hooks, ignored files). Production systems optimize with symlinks, include files, settings inheritance, and sparse checkout.

---

## 1. When to Use Worktrees

| Scenario | Use Worktree? | Why |
|----------|--------------|-----|
| Parallel implementation tasks on different files | **Yes** | Each agent writes without conflict |
| Research/read-only exploration | **No** | No writes, no conflict possible |
| Bug fix while main branch is dirty | **Yes** | Clean working copy without stashing |
| PR review with local testing | **Yes** | Test the PR without switching branches |
| Single agent, single task | **No** | Overhead not justified |

---

## 2. Worktree Creation

### Name Validation

Worktree names become directory names and git branch suffixes. Validate strictly:

```
validateWorktreeName(name):
  // Max length
  if name.length > 64: reject("Name too long")

  // Split on "/" for nested names (e.g., "feature/auth")
  segments = name.split("/")

  for segment in segments:
    // Only allow safe characters
    if not matches(segment, /^[a-zA-Z0-9._-]+$/):
      reject("Invalid characters in: {segment}")

    // Prevent path traversal
    if segment == "." or segment == "..":
      reject("Path traversal not allowed")

  // Final safety: normalize and compare
  normalized = path.join(...segments)
  if normalized != segments.join("/"):
    reject("Path normalization changed the name")
```

### Branch Naming

Map worktree names to git branch names:

```
worktreeBranchName(name):
  return "worktree-" + name.replace("/", "+")
```

**Why `+` not `/`:** Git has D/F (directory/file) conflicts. A branch `worktree-user` (file) conflicts with `worktree-user/feature` (directory). Flattening `/` to `+` avoids this entirely. The mapping is injective — `+` is not in the allowed name character set, so no collisions.

### Fast Resume Path

Before creating a worktree, check if it already exists:

```
createWorktree(name):
  worktreePath = WORKTREE_DIR / name

  // Fast path: already exists, just return it
  headSha = readWorktreeHead(worktreePath)
  if headSha:
    return { path: worktreePath, existed: true, head: headSha }

  // Slow path: create new worktree
  ...
```

**Why this matters:** Re-entering an existing worktree should be instant. Don't run `git fetch` or `git worktree add` if the worktree already exists — just verify it's valid and return.

### Base Branch Resolution

When creating a fresh worktree, determine the starting point:

```
resolveBaseBranch(options):
  if options.pullRequest:
    // Fetch PR head
    git fetch origin pull/{PR_NUMBER}/head
    return FETCH_HEAD

  // Resolve default branch
  defaultBranch = getDefaultBranch()  // main, master, etc.

  // Check if already available locally (avoid fetch)
  localRef = resolveRef("origin/" + defaultBranch)
  if localRef:
    return localRef

  // Fetch default branch
  git fetch origin {defaultBranch}
  return "origin/" + defaultBranch
```

**Optimization:** Read git refs directly from `.git/refs/` and `.git/packed-refs` instead of spawning `git` subprocesses. Each subprocess costs ~14ms.

### Creation Command

```
git worktree add --detach {worktreePath} {baseBranch}
git -C {worktreePath} checkout -b {branchName}
```

Using `--detach` first, then creating the branch, avoids issues with branch creation when the base is a remote tracking branch.

---

## 3. Symlink Sharing

### The Problem

A fresh worktree duplicates the entire working copy. For JavaScript projects, `node_modules/` alone can be 500MB+. Multiple worktrees = multiple copies = disk exhaustion.

### The Solution

Symlink large, read-only directories from the main repository:

```
symlinkSharedDirectories(mainRepo, worktreePath, directories):
  for dir in directories:
    sourcePath = mainRepo / dir
    destPath = worktreePath / dir

    // Security: prevent path traversal
    if containsPathTraversal(dir):
      warn("Skipping {dir}: path traversal detected")
      continue

    try:
      symlink(sourcePath, destPath, type: "directory")
    catch ENOENT:
      skip  // source doesn't exist, fine
    catch EEXIST:
      skip  // destination already exists, fine
    catch error:
      warn("Failed to symlink {dir}: {error}")
```

### Common Shared Directories

| Directory | Why Share | Caveat |
|-----------|----------|--------|
| `node_modules/` | Largest directory, rarely agent-modified | If agent needs to install packages, needs own copy |
| `.turbo/` | Build cache | Read-only cache sharing is safe |
| `.next/cache/` | Next.js build cache | Same |
| `vendor/` | Go/PHP dependencies | Same as node_modules |
| `.venv/` | Python virtual environment | Be careful — may contain path-dependent scripts |

### Configuration

Let users specify which directories to share:

```json
{
  "worktree": {
    "symlinkDirectories": [
      "node_modules",
      ".turbo",
      ".next/cache"
    ]
  }
}
```

---

## 4. Sparse Checkout

### When to Use

For very large repositories where even a worktree checkout takes too long. Only materialize the files the agent needs:

```
createSparseWorktree(name, paths):
  // Create worktree WITHOUT checking out files
  git worktree add --no-checkout {worktreePath} {baseBranch}

  // Configure sparse checkout (cone mode for performance)
  git -C {worktreePath} sparse-checkout set --cone -- {paths}

  // Now checkout only the sparse paths
  git -C {worktreePath} checkout HEAD
```

### Cone Mode

Cone mode restricts sparse patterns to directory boundaries, enabling O(1) lookup:

```
git sparse-checkout set --cone -- src/auth src/api tests/auth
```

This checks out:
- All files in `src/auth/` and its subdirectories
- All files in `src/api/` and its subdirectories
- All files in `tests/auth/` and its subdirectories
- All files in the root directory (always included in cone mode)

### Failure Cleanup

If sparse checkout fails (bad paths, permissions):

```
try:
  createSparseWorktree(name, paths)
catch error:
  // CRITICAL: clean up immediately
  // A failed sparse checkout leaves a broken worktree
  // that would "fast resume" as valid on next attempt
  git worktree remove --force {worktreePath}
  git branch -D {branchName}
  throw error
```

---

## 5. Include Files for Gitignored Content

### The Problem

Some files are in `.gitignore` but still needed for the project to work — environment configs, local settings, generated files. A fresh worktree doesn't have these.

### The Solution: .worktreeinclude

A `.worktreeinclude` file using gitignore syntax that specifies which ignored files to copy:

```
# .worktreeinclude
.env.local
.env.development
config/local.json
generated/types.ts
```

### Implementation

```
copyIncludedFiles(mainRepo, worktreePath):
  includePatterns = readFile(mainRepo / ".worktreeinclude")
  matcher = createGitignoreMatcher(includePatterns)

  // Get all ignored files (collapsed directories)
  ignoredFiles = git ls-files --others --ignored --exclude-standard --directory

  // Match against include patterns
  for file in ignoredFiles:
    if matcher.matches(file):
      if isDirectory(file):
        // Expand directory to get individual files
        expandedFiles = git ls-files --others --ignored --exclude-standard -- {file}
        for expanded in expandedFiles:
          if matcher.matches(expanded):
            copyFile(mainRepo / expanded, worktreePath / expanded)
      else:
        copyFile(mainRepo / file, worktreePath / file)
```

**Performance optimization:** `git ls-files --directory` collapses fully-ignored directories (like `node_modules/`) into a single entry instead of listing thousands of files. Only expand directories when an include pattern specifically targets content inside them.

---

## 6. Settings Inheritance

### What to Propagate

| Setting | Copy Method | Why |
|---------|------------|-----|
| Local settings file | File copy | User's personal settings shouldn't differ across worktrees |
| Git hooks path | Git config | Hooks should still run in worktrees |
| Editor config | Symlink or copy | Consistent formatting |

### Git Hooks in Worktrees

Git hooks live in `.git/hooks/` — but worktrees share the main repo's `.git`. Hooks tools (Husky, etc.) may need special handling:

```
configureWorktreeHooks(mainRepo, worktreePath):
  // Read current hooks path from git config
  currentPath = git config core.hooksPath

  if currentPath:
    // Set the same hooks path in worktree's local config
    git -C {worktreePath} config core.hooksPath {absolutePath(currentPath)}
```

**Husky-specific issue:** Husky's install command rewrites `core.hooksPath` to a relative path, which breaks worktrees (relative to wrong directory). Install the attribution hook directly into the worktree's `.husky/` directory as a workaround.

---

## 7. Hook-Based Extensibility

### For Non-Git VCS

Not all projects use git. Support custom worktree creation/removal via hooks:

```
Settings:
  hooks:
    WorktreeCreate:
      command: "/usr/local/bin/my-worktree-create.sh"
    WorktreeRemove:
      command: "/usr/local/bin/my-worktree-remove.sh"
```

### Hook Contract

**WorktreeCreate hook:**
- Input (env vars): `WORKTREE_NAME`, `WORKTREE_SLUG`
- Expected: Create an isolated working directory
- Output (stdout, JSON): `{ "worktreePath": "/path/to/created/directory" }`
- On failure: Exit non-zero, stderr logged

**WorktreeRemove hook:**
- Input (env vars): `WORKTREE_PATH`
- Expected: Remove the working directory and clean up
- On failure: Exit non-zero, stderr logged; manual cleanup may be needed

### Hook vs Git Detection

```
createIsolatedWorkspace(name):
  if hasWorktreeCreateHook():
    result = executeWorktreeCreateHook(name)
    return { path: result.worktreePath, hookBased: true }
  elif isGitRepository():
    return createGitWorktree(name)
  else:
    error("No isolation mechanism available")
```

---

## 8. Session Persistence

Track the active worktree session so it can be resumed:

```
WorktreeSession:
  originalCwd: string          // where the user was before
  worktreePath: string         // the worktree directory
  worktreeName: string         // human-readable name
  worktreeBranch: string       // git branch name
  originalBranch: string       // branch before worktree
  originalHeadCommit: string   // commit before worktree
  sessionId: string            // agent session ID
  hookBased: boolean           // was this created by a hook?
  creationDurationMs: number   // how long creation took
```

Save to project config on creation. On resume, read from config and re-enter the worktree.

---

## 9. Cleanup

### Two Exit Modes

| Mode | Behavior | When to Use |
|------|----------|------------|
| **Keep** | Leave worktree on disk, return to original directory | User wants to come back later |
| **Remove** | Delete worktree directory and branch | Work is done or abandoned |

### Safe Removal

```
removeWorktree(session):
  // Return to original directory first
  chdir(session.originalCwd)

  if session.hookBased:
    executeWorktreeRemoveHook(session.worktreePath)
  else:
    // Wait briefly for git locks to release
    sleep(100ms)

    // Force remove (even with uncommitted changes)
    git worktree remove --force {session.worktreePath}

    // Delete the temporary branch
    git branch -D {session.worktreeBranch}

  // Clear session state
  clearWorktreeSession()
```

### Uncommitted Changes Check

Before removing, check for uncommitted work:

```
hasUncommittedWork(worktreePath):
  status = git -C {worktreePath} status --porcelain
  return status.length > 0

removeWithSafetyCheck(session):
  if hasUncommittedWork(session.worktreePath):
    if not userConfirms("Worktree has uncommitted changes. Discard?"):
      return keepWorktree(session)
  removeWorktree(session)
```

---

## 10. Implementation Checklist

### Minimum Viable Worktree Isolation

- [ ] Worktree name validation (alphanumeric + safe chars, max 64, no traversal)
- [ ] Branch name mapping (prefix + flatten slashes)
- [ ] `git worktree add` with detached head + branch creation
- [ ] Return to original directory on exit
- [ ] `git worktree remove --force` cleanup
- [ ] Session tracking (original dir, worktree path, branch)

### Production-Grade Isolation

- [ ] All of the above, plus:
- [ ] Fast resume path (detect existing worktree, skip fetch)
- [ ] Direct ref reading (avoid subprocess for ref resolution)
- [ ] Symlink sharing for large directories (configurable list)
- [ ] Path traversal prevention on symlink targets
- [ ] Sparse checkout for large repos (cone mode)
- [ ] Failed sparse checkout cleanup (prevent broken fast-resume)
- [ ] .worktreeinclude file support (copy gitignored files)
- [ ] Directory expansion optimization (don't expand `node_modules/`)
- [ ] Settings file inheritance (copy local settings to worktree)
- [ ] Git hooks path propagation
- [ ] Hook-based extensibility (non-git VCS support)
- [ ] Session persistence to project config
- [ ] Two exit modes (keep vs remove)
- [ ] Uncommitted changes safety check before removal
- [ ] PR-based worktree creation (fetch PR head)
- [ ] Branch name D/F conflict avoidance (flatten `/` to `+`)

---

## Related Documents

- [AGENT-COORDINATION-PATTERNS.md](AGENT-COORDINATION-PATTERNS.md) — Multi-agent coordination that uses worktrees for parallel execution
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Permissions apply within each worktree
- [AGENT-BOOTSTRAP-AND-CONFIGURATION.md](AGENT-BOOTSTRAP-AND-CONFIGURATION.md) — Configuration inheritance across worktrees
- [AGENT-AUTH-AND-SESSION-MANAGEMENT.md](AGENT-AUTH-AND-SESSION-MANAGEMENT.md) — Session persistence for worktree resumption
