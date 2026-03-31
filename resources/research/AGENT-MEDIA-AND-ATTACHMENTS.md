# Agent Media and Attachments

Best practices for handling images, PDFs, screenshots, clipboard content, notebook outputs, and rich media in autonomous AI agent systems. Derived from production analysis of agentic systems processing multimodal content with format validation, size optimization, platform-specific clipboard access, and graceful degradation.

*Last updated: 2026-03-31*

---

## Why This Matters

Modern agents aren't text-only. Users paste screenshots, attach PDFs, reference images in code, and work with Jupyter notebooks that produce plots. An agent that can't process these is blind to half the context. But images are expensive (tokens), PDFs can be malicious, and clipboard access is platform-specific. Production systems handle all of this with validation, optimization, and fallbacks.

---

## 1. Image Handling

### Supported Formats

| Format | MIME Type | Notes |
|--------|----------|-------|
| PNG | `image/png` | Preferred for screenshots, diagrams |
| JPEG | `image/jpeg` | Preferred for photos, smaller size |
| GIF | `image/gif` | Animations not typically processed |
| WebP | `image/webp` | Modern format, good compression |

### Size Constraints

| Constraint | Limit | Purpose |
|-----------|-------|---------|
| Max raw size | Target threshold (varies) | Trigger resize if exceeded |
| Max dimensions | Width × Height cap | Prevent memory exhaustion |
| Max base64 encoded size | API limit | After encoding, must fit in API request |

### Processing Pipeline

```
processImage(inputPath):
  // 1. Validate format
  format = detectFormat(inputPath)  // magic bytes, not extension
  if format not in SUPPORTED_FORMATS:
    return error("Unsupported image format")

  // 2. Read and check dimensions
  metadata = getImageMetadata(inputPath)
  if metadata.width * metadata.height > MAX_PIXELS:
    return error("Image exceeds pixel limit")

  // 3. Resize if needed
  if estimatedRawSize(metadata) > TARGET_RAW_SIZE:
    resized = resize(inputPath, {
      maxWidth: MAX_WIDTH,
      maxHeight: MAX_HEIGHT,
      fit: "inside"  // maintain aspect ratio
    })
  else:
    resized = readFile(inputPath)

  // 4. Encode to base64
  base64 = encodeBase64(resized)

  // 5. Check encoded size
  if base64.length > API_MAX_BASE64_SIZE:
    // Reduce quality and retry
    resized = resize(inputPath, { quality: 70 })
    base64 = encodeBase64(resized)

  return ImageBlock({
    type: "image",
    source: { type: "base64", media_type: format, data: base64 },
    dimensions: { width: resized.width, height: resized.height }
  })
```

### Error Classification

Track image processing failures by type for monitoring:

| Error Type | Code | Cause | Recovery |
|-----------|------|-------|----------|
| Module load | 1 | Image library not installed | Suggest installation |
| Processing | 2 | Corrupt or malformed image | Skip with error message |
| Pixel limit | 4 | Image too large (dimensions) | Auto-resize |
| Memory | 5 | Out of memory during processing | Reduce dimensions further |
| Timeout | 6 | Processing took too long | Skip with error message |
| Library error | 7 | Internal library error | Skip with error message |

---

## 2. PDF Handling

### Small PDFs (Direct Upload)

Files under the size threshold (~20MB) are sent directly as base64:

```
processPdf(filePath):
  // 1. Validate
  header = readBytes(filePath, 5)
  if header != "%PDF-":
    return error("Not a valid PDF (invalid header)")

  fileSize = getFileSize(filePath)
  if fileSize == 0:
    return error("Empty PDF file")

  if fileSize > MAX_DIRECT_SIZE:
    return extractPages(filePath)  // fallback to image extraction

  // 2. Encode
  base64 = encodeBase64(readFile(filePath))

  return PdfBlock({
    type: "pdf",
    source: { type: "base64", data: base64 },
    originalSize: fileSize,
    filePath: filePath
  })
```

### Large PDFs (Page Extraction)

PDFs exceeding the size limit are converted to images page by page:

```
extractPages(filePath, options):
  // Check for extraction tool (pdftoppm from poppler-utils)
  if not isToolAvailable("pdftoppm"):
    return error("PDF too large and pdftoppm not available")

  // Render pages to JPEG at 100 DPI
  outputDir = createTempDir()
  exec("pdftoppm -jpeg -r 100 {firstPage} {lastPage} {filePath} {outputDir}/page", {
    timeout: 120_000  // 2 minutes max
  })

  // Collect page images
  pages = glob(outputDir + "/page-*.jpg")
  return pages.map(p => processImage(p))
```

### PDF Validation Results

| Result | Condition | Action |
|--------|-----------|--------|
| Success | Valid PDF, within size | Return base64 block |
| Empty | File size = 0 | Error with "empty file" message |
| Too large | Exceeds size limit | Fall back to page extraction |
| Corrupted | Invalid header or damaged | Error with description |
| Password protected | Encrypted PDF detected | Suggest unprotected copy |
| Page limit exceeded | >100 pages | API-enforced limit, return error |

---

## 3. Screenshot and Clipboard

### Platform-Specific Clipboard Access

| Platform | Tool | Command Pattern |
|----------|------|----------------|
| **macOS** | osascript | AppleScript to read NSPasteboard |
| **Linux (X11)** | xclip / xsel | `xclip -selection clipboard -t image/png -o` |
| **Linux (Wayland)** | wl-paste | `wl-paste --type image/png` |
| **Windows** | PowerShell | `Get-Clipboard -Format Image` |

### Clipboard Read Flow

```
readClipboardImage():
  platform = detectPlatform()

  switch platform:
    case "macos":
      return execScript("osascript", PASTEBOARD_SCRIPT)
    case "linux":
      if isWayland():
        return exec("wl-paste --type image/png")
      return exec("xclip -selection clipboard -t image/png -o")
    case "windows":
      return execPowerShell(GET_CLIPBOARD_SCRIPT)

  return null  // unsupported platform
```

### Temporary File Storage

```
saveClipboardImage(imageData):
  tmpDir = env.AGENT_TMPDIR or platformTempDir()
  tmpPath = tmpDir / "agent_clipboard_latest.png"
  writeFile(tmpPath, imageData)
  return tmpPath
```

### Large Paste Detection

```
LARGE_PASTE_THRESHOLD = 800  // characters

classifyPaste(content):
  if content.length > LARGE_PASTE_THRESHOLD:
    return "large_paste"  // may need special handling (confirmation, truncation)
  return "normal_paste"
```

### Paste Buffer

```
PasteBuffer:
  items: Map<id, PastedContent>

  store(content):
    id = generateTimestampId()
    items.set(id, { id, content, type: detectType(content), timestamp: now() })
    return id

  get(id): PastedContent | null
  cleanup(maxAge):
    for item in items:
      if now() - item.timestamp > maxAge:
        items.delete(item.id)
```

---

## 4. Notebook Output Handling

### Cell Types

| Type | Content | Processing |
|------|---------|-----------|
| `code` | Source code + outputs | Extract source, process each output |
| `markdown` | Rendered text | Extract as-is |
| `raw` | Unprocessed content | Extract as-is |

### Output Types

| Type | Contains | Processing |
|------|----------|-----------|
| `stream` | stdout/stderr text | Concatenate text fragments |
| `execute_result` | Execution output | Extract text/plain or text/html |
| `display_data` | Rich output (plots, images) | Extract image data (base64 PNG/JPEG) |
| `error` | Exception traceback | Format as error message |

### Image Extraction from Notebooks

```
extractNotebookImages(cell):
  images = []

  for output in cell.outputs:
    if output.type in ["display_data", "execute_result"]:
      if "image/png" in output.data:
        images.push({
          format: "png",
          data: output.data["image/png"]  // already base64
        })
      elif "image/jpeg" in output.data:
        images.push({
          format: "jpeg",
          data: output.data["image/jpeg"]
        })

  return images
```

### Large Output Handling

```
LARGE_OUTPUT_THRESHOLD = 10_000  // 10KB

processOutput(output):
  text = extractText(output)

  if text.length > LARGE_OUTPUT_THRESHOLD:
    truncated = text.slice(0, 5_000)
    return truncated + "\n... (truncated, {text.length} total characters)"

  return text
```

---

## 5. ANSI Terminal Rendering

### ANSI to Image Conversion

Convert terminal output (with ANSI escape codes for colors, formatting) to shareable images:

```
renderAnsiToImage(ansiText, options):
  // 1. Parse ANSI escape sequences into styled segments
  segments = parseAnsiSequences(ansiText)

  // 2. Calculate dimensions
  width = maxLineWidth(segments) * charWidth + padding
  height = lineCount(segments) * lineHeight + padding

  // 3. Render to canvas/buffer
  canvas = createCanvas(width, height)
  ctx = canvas.getContext()

  for segment in segments:
    ctx.fillStyle = ansiColorToRgb(segment.fgColor)
    if segment.bold: ctx.font = "bold " + ctx.font
    ctx.fillText(segment.text, x, y)
    advanceCursor(segment)

  // 4. Export as PNG
  return canvas.toBuffer("image/png")
```

### SVG Alternative

For vector output (scales to any size):

```
renderAnsiToSvg(ansiText):
  segments = parseAnsiSequences(ansiText)
  svg = buildSvg(segments)  // text elements with style attributes
  return svg.toString()
```

---

## 6. Generated File Detection

### Why It Matters

Attribution tracking needs to exclude generated files (lockfiles, compiled output, etc.) from agent contribution metrics.

### Detection Heuristics

| Pattern | Example | Generated? |
|---------|---------|-----------|
| Lock files | `package-lock.json`, `yarn.lock`, `Cargo.lock` | Yes |
| Compiled output | `dist/`, `build/`, `*.min.js` | Yes |
| IDE metadata | `.idea/`, `.vscode/settings.json` | Sometimes |
| Source maps | `*.map` | Yes |
| Auto-generated headers | "// AUTO-GENERATED — DO NOT EDIT" | Yes |

---

## 7. Implementation Checklist

### Minimum Viable Media Support

- [ ] Image validation (format, dimensions)
- [ ] Image resize to fit API limits
- [ ] Base64 encoding for API transport
- [ ] PDF validation (magic bytes)
- [ ] Small PDF direct upload
- [ ] Clipboard read (at least one platform)
- [ ] Notebook cell reading (code + markdown)

### Production-Grade Media Support

- [ ] All of the above, plus:
- [ ] All 4 image formats (PNG, JPEG, GIF, WebP)
- [ ] Downsampling quality reduction for oversized images
- [ ] Image error classification (7 types) with telemetry
- [ ] Large PDF page extraction via pdftoppm
- [ ] PDF password protection detection
- [ ] PDF corruption detection (stderr regex)
- [ ] 100-page API limit enforcement
- [ ] Cross-platform clipboard (macOS, Linux X11/Wayland, Windows)
- [ ] Temporary file storage with cleanup
- [ ] Large paste detection (800-char threshold)
- [ ] Paste buffer with ID-based retrieval
- [ ] Notebook output handling (all 4 types)
- [ ] Image extraction from notebook display_data
- [ ] Large output truncation (10KB threshold)
- [ ] ANSI-to-PNG rendering
- [ ] ANSI-to-SVG rendering
- [ ] Generated file detection for attribution exclusion

---

## Related Documents

- [AGENT-TOOL-ARCHITECTURE.md](AGENT-TOOL-ARCHITECTURE.md) — File read tool that triggers media processing
- [AGENT-DIFF-AND-FILE-EDITING.md](AGENT-DIFF-AND-FILE-EDITING.md) — Notebook editing operations
- [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) — Images consume context budget
- [AGENT-MESSAGE-PIPELINE.md](AGENT-MESSAGE-PIPELINE.md) — Media blocks flow through the message system
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — API constraints on image/PDF size
- [AGENT-TERMINAL-UI-ARCHITECTURE.md](AGENT-TERMINAL-UI-ARCHITECTURE.md) — Image display in terminal
