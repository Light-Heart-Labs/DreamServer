# Agent Diff and File Editing

Best practices for generating diffs, applying partial edits, handling pathological inputs, and tracking change attribution in autonomous AI agent systems. Derived from production analysis of agentic systems applying millions of file edits with accurate cost attribution and display.

*Last updated: 2026-03-31*

---

## Why This Matters

File editing is the agent's primary output. A diff that hangs on pathological input freezes the session. A patch that displays incorrectly confuses the user. An edit that applies to the wrong location corrupts the file. And without change tracking, you can't attribute cost, measure productivity, or audit what the agent modified.

---

## 1. Diff Algorithm

### Library Choice

Use an established diff library (e.g., `diff` npm package, Python's `difflib`, or equivalent). Don't write your own — diff algorithms have subtle edge cases that take years to get right.

### Structured Patch Generation

Generate structured patches, not raw text diffs:

```
generatePatch(filePath, oldContent, newContent, options):
  patch = structuredPatch(
    filePath, filePath,    // old and new file names (same for edits)
    oldContent, newContent,
    undefined, undefined,  // old/new headers (optional)
    {
      context: options.contextLines or 3,  // lines of context around changes
      timeout: options.timeout or 5000     // ms, abort if too slow
    }
  )

  return patch  // { hunks: [...], oldFileName, newFileName }
```

### Hunk Structure

Each hunk represents a contiguous region of changes:

```
Hunk:
  oldStart: number    // 1-indexed line number in original file
  oldLines: number    // count of lines from original
  newStart: number    // 1-indexed line number in new file
  newLines: number    // count of lines in new version
  lines: string[]     // unified diff lines:
                      //   " " prefix = context (unchanged)
                      //   "+" prefix = added
                      //   "-" prefix = removed
```

### Timeout Protection

Diff algorithms can be O(n*m) in worst case. Pathological inputs (large files with many small changes scattered throughout) can hang for minutes.

**Always set a timeout:**

```
generatePatchSafe(filePath, old, new):
  try:
    return generatePatch(filePath, old, new, { timeout: 5000 })
  catch TimeoutError:
    log.warn("Diff timed out for {filePath}")
    return null  // callers treat null as "no displayable diff"
```

**What counts as pathological:**
- Two large files (~10K+ lines) with changes on every other line
- Files with many repeated sections (diff can't find stable anchors)
- Binary files accidentally treated as text

### Character Escaping

Some diff libraries mishandle certain characters in input. Pre-process:

```
escapeDiffInput(text):
  // Escape characters that confuse the diff engine
  return text
    .replace(/&/g, AMPERSAND_TOKEN)   // & can break some formatters
    .replace(/\$/g, DOLLAR_TOKEN)      // $ can be interpolated

unescapeDiffOutput(patch):
  for hunk in patch.hunks:
    for i, line in hunk.lines:
      hunk.lines[i] = line
        .replace(AMPERSAND_TOKEN, '&')
        .replace(DOLLAR_TOKEN, '$')
  return patch
```

---

## 2. Edit Application

### String Replacement Model

The simplest and most predictable edit model: find a string, replace it.

```
applyEdit(fileContent, oldString, newString, replaceAll):
  if replaceAll:
    return fileContent.replaceAll(oldString, newString)
  else:
    return fileContent.replace(oldString, newString)  // first occurrence
```

### Uniqueness Requirement

For single-occurrence edits, the `oldString` must be unique in the file. If it appears multiple times, the edit is ambiguous — which occurrence should change?

**Handling non-unique matches:**
1. Return an error: "The text to replace appears N times. Provide more context to make it unique."
2. The agent retries with a larger `oldString` that includes surrounding context

### Trailing Newline Handling

When removing content (newString is empty), handle trailing newlines:

```
applyRemoval(fileContent, oldString):
  // First try: remove oldString + trailing newline
  if fileContent.contains(oldString + "\n"):
    return fileContent.replace(oldString + "\n", "")

  // Fallback: remove just oldString
  return fileContent.replace(oldString, "")
```

**Why:** Removing a line without its newline leaves a blank line. Users expect line removal to actually remove the line.

### Quote Normalization

LLMs sometimes output curly quotes (`"` `"` `'` `'`) when the file contains straight quotes (`"` `'`). Normalize before matching:

```
findActualString(fileContent, searchString):
  // Direct match
  if fileContent.contains(searchString):
    return searchString

  // Try normalizing quotes
  normalized = searchString
    .replace(/\u201C|\u201D/g, '"')   // curly double quotes -> straight
    .replace(/\u2018|\u2019/g, "'")   // curly single quotes -> straight

  if fileContent.contains(normalized):
    return normalized

  return null  // not found
```

---

## 3. Multi-Edit Application

When applying multiple edits to the same file:

### Sequential Application

```
applyEdits(fileContent, edits):
  result = fileContent

  for edit in edits:
    result = applyEdit(result, edit.oldString, edit.newString, edit.replaceAll)

  return result
```

**Order matters:** Each edit applies to the result of the previous edit. If edit B depends on a string that edit A introduced, B must come after A.

### Patch Generation for Display

After applying all edits, generate a single diff for display:

```
getDisplayPatch(filePath, originalContent, edits):
  // Apply all edits
  updatedContent = applyEdits(originalContent, edits)

  // Generate unified diff for display
  patch = generatePatch(filePath, originalContent, updatedContent)

  // Normalize tabs for display
  for hunk in patch.hunks:
    for i, line in hunk.lines:
      hunk.lines[i] = convertLeadingTabsToSpaces(line)

  return { patch, updatedContent }
```

### Tab Normalization for Display

Tabs render at inconsistent widths across terminals. Convert leading tabs to spaces for diff display:

```
convertLeadingTabsToSpaces(line, tabWidth = 4):
  leadingTabs = countLeadingTabs(line)
  spaces = " ".repeat(leadingTabs * tabWidth)
  return spaces + line.slice(leadingTabs)
```

**Important:** Only convert for display. The actual file content keeps its original tabs.

---

## 4. File Validation Before Edit

### Pre-Edit Checks

| Check | Why | Action on Failure |
|-------|-----|-------------------|
| File exists | Can't edit a nonexistent file | Error: "File not found" |
| File size < 1 GiB | Prevent memory exhaustion | Error: "File too large" |
| Read permissions | Can't read current content | Error: "Permission denied" |
| Write permissions | Can't save changes | Error: "Permission denied" |
| Text encoding | Binary files can't be string-edited | Error: "Binary file detected" |
| Not a directory | Agent might pass a dir path | Error: "Path is a directory" |

### Encoding Detection

Support common text encodings:

| Encoding | Detection Method |
|----------|-----------------|
| UTF-8 | Default, validate with BOM or content analysis |
| UTF-16LE | BOM: `FF FE` at start of file |
| UTF-16BE | BOM: `FE FF` at start of file |
| Binary | Contains null bytes outside BOM area |

```
readTextContent(filePath):
  buffer = readFileAsBytes(filePath)

  if buffer starts with FF FE:
    return decode(buffer, 'utf-16le'), encoding: 'utf-16le'

  if buffer starts with FE FF:
    return decode(buffer, 'utf-16be'), encoding: 'utf-16be'

  // Check for binary content
  if containsNullBytes(buffer.slice(0, 8192)):
    throw BinaryFileError(filePath)

  return decode(buffer, 'utf-8'), encoding: 'utf-8'
```

### Preserve Encoding on Write

When writing back, use the same encoding the file was read with:

```
writeTextContent(filePath, content, encoding):
  encoded = encode(content, encoding)
  writeFile(filePath, encoded)
```

---

## 5. Change Attribution and Cost Tracking

### Line Change Counting

After generating a patch, count added and removed lines:

```
countLinesChanged(patch):
  additions = 0
  removals = 0

  if patch == null:  // new file
    additions = content.split("\n").length
  else:
    for hunk in patch.hunks:
      for line in hunk.lines:
        if line.startsWith("+"):
          additions++
        elif line.startsWith("-"):
          removals++

  return { additions, removals }
```

### Character-Level Attribution

For fine-grained attribution (how much did the agent vs human write?):

```
FileAttribution:
  filePath: string
  agentCharsAdded: number
  humanCharsAdded: number
  contentHash: string       // SHA-256 of current content
  lastModifiedTime: number  // file mtime

  recordAgentEdit(oldContent, newContent):
    // Characters the agent added
    addedChars = max(0, newContent.length - oldContent.length)
    agentCharsAdded += addedChars
    contentHash = sha256(newContent)
    lastModifiedTime = now()

  recordHumanEdit(oldContent, newContent):
    // Same logic but attributed to human
    addedChars = max(0, newContent.length - oldContent.length)
    humanCharsAdded += addedChars
```

### Session-Level Tracking

```
SessionChangeTracker:
  filesModified: Map<filePath, FileAttribution>
  totalLinesAdded: number
  totalLinesRemoved: number

  record(filePath, patch, attribution):
    changes = countLinesChanged(patch)
    totalLinesAdded += changes.additions
    totalLinesRemoved += changes.removals
    filesModified.set(filePath, attribution)

  summary():
    return {
      filesChanged: filesModified.size,
      linesAdded: totalLinesAdded,
      linesRemoved: totalLinesRemoved,
      agentContribution: calculateAgentPercentage()
    }
```

---

## 6. Notebook (ipynb) Editing

### Notebook Structure

Jupyter notebooks are JSON files with a specific structure:

```json
{
  "cells": [
    {
      "cell_type": "code",
      "source": ["line 1\n", "line 2\n"],
      "outputs": [...]
    },
    {
      "cell_type": "markdown",
      "source": ["# Title\n", "Description"]
    }
  ],
  "metadata": { "language_info": { "name": "python" } }
}
```

### Cell Operations

| Operation | Method |
|-----------|--------|
| Replace cell | Overwrite `source` array for target cell |
| Insert cell | Add new cell object at specified index |
| Delete cell | Remove cell object at index |
| Read cell | Extract `source` and `outputs` |

### Output Handling

| Output Type | Contains | Handling |
|-------------|----------|---------|
| `stream` | stdout/stderr text | Extract text, show as-is |
| `execute_result` | Execution output | Extract text/plain or text/html |
| `display_data` | Rich output (images, plots) | Extract image data (base64 PNG/JPEG) |
| `error` | Exception info | Extract traceback |

### Large Output Detection

```
isLargeOutput(output):
  text = extractText(output)
  return text.length > 10_000  // 10KB threshold

handleLargeOutput(output):
  text = extractText(output)
  truncated = text.slice(0, 5_000) + "\n... (truncated, {text.length} chars total)"
  return truncated
```

---

## 7. Implementation Checklist

### Minimum Viable File Editing

- [ ] String replacement edit model (find old, replace with new)
- [ ] Uniqueness check for oldString
- [ ] Structured patch generation with diff library
- [ ] Diff timeout protection (5s)
- [ ] File existence and permission checks
- [ ] Line change counting (additions/removals)
- [ ] UTF-8 encoding support

### Production-Grade File Editing

- [ ] All of the above, plus:
- [ ] Character escaping for diff library (&, $)
- [ ] replaceAll mode for bulk replacements
- [ ] Quote normalization (curly → straight)
- [ ] Trailing newline handling on removal
- [ ] Multi-edit sequential application
- [ ] Tab-to-space conversion for diff display
- [ ] UTF-16LE/BE encoding detection and preservation
- [ ] Binary file detection (null byte check)
- [ ] File size limit (1 GiB)
- [ ] Character-level attribution (agent vs human)
- [ ] Session-level change tracking
- [ ] Jupyter notebook cell operations (replace, insert, delete)
- [ ] Notebook output handling (stream, execute_result, display_data, error)
- [ ] Large output truncation (10KB threshold)
- [ ] Image extraction from notebook outputs (base64)

---

## Related Documents

- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — Edit tool as part of the unified tool system
- [AGENT-IDE-AND-LSP-INTEGRATION.md](AGENT-IDE-AND-LSP-INTEGRATION.md) — LSP diagnostics triggered by file edits
- [AGENT-PERMISSION-SYSTEM-DESIGN.md](AGENT-PERMISSION-SYSTEM-DESIGN.md) — Write permissions checked before edits
- [AGENT-TERMINAL-UI-ARCHITECTURE.md](AGENT-TERMINAL-UI-ARCHITECTURE.md) — Diff display in the terminal
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — Cost tracking fed by line change counts
