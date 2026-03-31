# Agent Terminal UI Architecture

Best practices for building terminal-based user interfaces for autonomous AI agents using React reconcilers, frame buffering, keyboard input, and layout engines. Derived from production analysis of agentic systems rendering complex TUIs at 60fps with mouse support, hyperlinks, and responsive layout.

*Last updated: 2026-03-31*

---

## Why This Matters

A terminal UI is the primary interface between the agent and the user. It must render streaming output flicker-free, handle keyboard shortcuts responsively, display progress for long operations, and adapt to terminal resizing — all while the agent is actively executing tools and generating responses. A bad TUI makes a good agent feel broken.

Production systems use React with a custom terminal reconciler, double-buffered rendering, and layout engines to achieve browser-quality UX in the terminal.

---

## 1. React Reconciler for Terminal

### Why React in a Terminal

React's component model, state management, and reconciliation algorithm work in any rendering target — not just browsers. By writing a custom reconciler, you get:

- **Declarative UI:** Describe what the screen should look like, not how to update it
- **Efficient updates:** React diffs the component tree and only re-renders what changed
- **Component reuse:** Build a library of terminal components (Box, Text, Input, Progress)
- **Hooks:** useState, useEffect, useRef work identically in terminal context

### Custom Host Config

The reconciler implements React's host config interface with terminal-specific types:

| Host Concept | Terminal Implementation |
|-------------|----------------------|
| **Instance** | DOMElement — a node in the terminal DOM tree with styles, children, event handlers |
| **Text Instance** | TextNode — raw text content (leaf node) |
| **Container** | Root element representing the full terminal viewport |
| **Context** | `isInsideText` flag — tracks whether we're inside a Text component (affects whitespace handling) |

### Key Lifecycle Methods

| Method | What It Does |
|--------|-------------|
| `createInstance` | Creates a DOMElement with tag name, props, and style |
| `createTextInstance` | Creates a TextNode with string content |
| `appendChildNode` | Adds a child to the DOM tree |
| `insertBeforeNode` | Inserts a child at a specific position |
| `setAttribute` / `setStyle` | Updates properties on an existing node |
| `resetAfterCommit` | Triggers layout computation and screen rendering after React commits |

### Prop Diffing

Shallow object comparison across commits. Only changed props trigger re-renders. Event handlers are tracked separately — handler identity changes (common with inline arrow functions) don't mark the element as dirty.

---

## 2. Built-in Component Model

### Core Elements

| Element | Purpose | Key Props |
|---------|---------|-----------|
| **Box** | Container with flexbox layout | width, height, flexDirection, padding, margin, border, gap |
| **Text** | Text content with styling | color, bold, italic, underline, wrap mode |
| **VirtualText** | Optimized for large scrollable text | Same as Text, but virtualized |
| **RawAnsi** | Pass-through ANSI content (no reflow) | Raw terminal escape sequences |
| **Link** | Clickable hyperlink | href (uses OSC 8 terminal protocol) |
| **Progress** | Progress bar | percent, width |

### Style Properties

Styles are TypeScript types, not CSS. Applied directly to layout engine nodes:

**Layout styles:**
- Dimensions: `width`, `height` (number or percentage)
- Position: `position` (absolute/relative), `top`, `bottom`, `left`, `right`
- Flexbox: `flexDirection`, `flexGrow`, `flexShrink`, `alignItems`, `justifyContent`
- Spacing: `margin*`, `padding*`, `border*`, `gap`
- Display: `display` (flex/none), `overflow` (visible/hidden)

**Text styles:**
- Color: `color`, `backgroundColor` (RGB hex, ansi256, named ANSI colors)
- Decoration: `bold`, `italic`, `underline`, `strikethrough`, `dim`, `inverse`
- Wrapping: `wrap`, `truncate`, `truncate-start`, `truncate-middle`, `truncate-end`

### Text Wrapping

Text content is segmented and wrapped using word-break algorithms:

| Mode | Behavior |
|------|----------|
| `wrap` | Break at word boundaries, respect terminal width |
| `wrap-trim` | Wrap and trim trailing whitespace |
| `truncate` | Cut at width, append ellipsis at end |
| `truncate-start` | Prepend ellipsis, show end of text |
| `truncate-middle` | Show start...end |

---

## 3. Layout Engine

### Yoga Integration

Use a flexbox layout engine (Yoga or equivalent) to compute element positions:

| Feature | Implementation |
|---------|---------------|
| **Tree construction** | Each DOMElement creates a corresponding layout node |
| **Style mapping** | Terminal styles → Yoga properties (width → setWidth, flexDirection → setFlexDirection, etc.) |
| **Measurement** | Text components provide a measure function so the layout engine knows text dimensions |
| **Computation** | `calculateLayout(terminalWidth)` computes positions for the entire tree |
| **Direction** | LTR hardcoded (terminals are always left-to-right) |

### Layout Flow

```
React commit completes
  -> resetAfterCommit fires
  -> Walk DOM tree, sync styles to Yoga nodes
  -> Call Yoga calculateLayout(terminal_columns)
  -> Each node now has computed: x, y, width, height
  -> Pass to renderer
```

### Memory Management

Layout nodes (especially WASM-backed ones like Yoga) must be explicitly freed:

```
freeLayoutTree(node):
  for child in node.children (reverse order):
    freeLayoutTree(child)
  node.unsetMeasureFunc()  // prevent dangling callback
  node.free()              // release WASM memory
```

Free children before parents. Reverse post-order traversal prevents use-after-free.

---

## 4. Double-Buffered Rendering

### Why Double Buffer

Without double buffering, incremental terminal updates cause visible flicker — the user sees partial renders as individual characters are written.

### Screen Buffer

A 2D grid of cells, where each cell stores:

| Field | Purpose |
|-------|---------|
| Character | The displayed character (interned via CharPool for memory) |
| Style | Color, bold, etc. (interned via StylePool) |
| Width | Character display width (1 for ASCII, 2 for CJK) |
| Hyperlink | Optional hyperlink ID (interned via HyperlinkPool) |

**Interning:** Characters, styles, and hyperlinks are deduplicated into pools. Each cell stores IDs (small integers) rather than full objects. This dramatically reduces memory for large screens with repeated styles.

### Frame Structure

```
Frame:
  screen: CellGrid        // the 2D buffer
  viewport: { width, height }
  cursor: { x, y, visible }
  scrollHint: optional     // DECSTBM optimization for scrolling content
```

### Render Pipeline

```
DOM tree + Yoga layout
  -> render-node-to-output: walk tree, generate Operations (write, blit, clear, clip)
  -> Operations written to Screen buffer (cell-by-cell)
  -> Frame created from Screen + viewport + cursor

Previous Frame vs Current Frame
  -> Cell-by-cell diff (packed data equality check)
  -> Generate Patches: terminal commands (cursor move, style change, character write)
  -> Write Patches to stdout (single write, minimal flicker)

Current Frame becomes Previous Frame for next render
```

### Clear Detection

Full screen clear needed when:
- Terminal resized (width or height changed)
- Screen content overflows terminal height
- Explicit clear requested (Ctrl+L)

Otherwise, patch-based updates only.

### Frame Rate

Target 60fps (16ms frame interval). If rendering takes longer than 16ms, the next frame is deferred — never queue multiple frames.

---

## 5. Keyboard Input

### Input Parsing Pipeline

```
stdin bytes
  -> Tokenizer: split into discrete escape sequences
  -> Parser: interpret sequences into structured key events
  -> Dispatcher: route to focused component
```

### Escape Sequence Recognition

| Sequence Type | Format | Example |
|--------------|--------|---------|
| Simple character | Single byte | `a`, `1`, Space |
| Meta + key | ESC + byte | `ESC a` → Alt+A |
| Function key | ESC [ ... ~ | `ESC[15~` → F5 |
| CSI u (Kitty) | ESC[codepoint;modifier u | `ESC[97;5u` → Ctrl+A |
| xterm modifyOtherKeys | ESC[27;modifier;keycode~ | `ESC[27;5;97~` → Ctrl+A |
| Mouse (SGR) | ESC[<button;col;row M/m | `ESC[<0;15;3M` → left click at col 15, row 3 |
| Paste start | ESC[200~ | Bracketed paste begin |
| Paste end | ESC[201~ | Bracketed paste end |
| Terminal response | ESC[?...c / ESC[...R | Device attributes, cursor position |

### Parsed Key Structure

```
ParsedKey:
  kind: "character" | "function" | "mouse" | "paste" | "terminal_response"
  name: string          // "a", "F5", "Return", "Backspace", "Tab"
  ctrl: boolean
  shift: boolean
  meta: boolean         // Alt/Option
  fn: boolean           // Function key modifier
  isPasted: boolean     // Inside bracketed paste
  sequence: string      // Raw escape sequence (for debugging)
```

### Bracketed Paste

Terminals with bracketed paste mode send special delimiters around pasted content:

```
ESC[200~ <pasted content> ESC[201~
```

Everything between delimiters is treated as a single "pasted" input — not interpreted as keyboard shortcuts. This prevents paste injection attacks (pasting text containing ESC sequences).

### Event Dispatch

```
Key event received
  -> Check global shortcuts (Ctrl+C for abort, etc.)
  -> Route to focused component's onKeyPress handler
  -> If not handled: bubble up through parent chain
  -> If still not handled: ignored
```

---

## 6. Mouse Support

### Enabling Mouse Tracking

Send these escape sequences to the terminal on startup:

```
ESC[?1000h    // Enable basic mouse tracking
ESC[?1002h    // Enable button-event tracking (drag)
ESC[?1003h    // Enable all-event tracking (hover)
ESC[?1006h    // Enable SGR extended mouse format (supports >223 columns)
```

Disable on exit (or terminal will stay in mouse mode):

```
ESC[?1000l
ESC[?1002l
ESC[?1003l
ESC[?1006l
```

### Hit Testing

When a mouse click arrives with coordinates (col, row):

```
hitTest(col, row, rootNode):
  // Walk DOM tree depth-first, children in reverse (topmost painted wins)
  for child in rootNode.children.reverse():
    result = hitTest(col, row, child)
    if result:
      return result

  // Check if click is within this node's rendered bounds
  bounds = nodeCache.get(rootNode)  // populated during render
  if bounds and col >= bounds.x and col < bounds.x + bounds.width
     and row >= bounds.y and row < bounds.y + bounds.height:
    return rootNode

  return null
```

### Click Event Propagation

```
ClickEvent:
  col: number           // screen column (0-indexed)
  row: number           // screen row (0-indexed)
  localCol: number      // relative to handler's node
  localRow: number      // relative to handler's node
  cellIsBlank: boolean  // whether the cell has content
  stopPropagation()     // prevent bubbling

Dispatch:
  target = hitTest(col, row)
  walk up from target to root:
    if node has onClick handler:
      recompute localCol/localRow relative to this node
      call handler(event)
      if stopPropagation called: break
```

### Hover State

Track which nodes are currently hovered. On mouse move:

```
onMouseMove(col, row):
  currentHovered = hitTest(col, row)  // and all ancestors
  previousHovered = lastHoverState

  // Fire onMouseLeave for nodes no longer hovered
  for node in previousHovered - currentHovered:
    node.onMouseLeave()

  // Fire onMouseEnter for newly hovered nodes
  for node in currentHovered - previousHovered:
    node.onMouseEnter()

  lastHoverState = currentHovered
```

---

## 7. Responsive Layout

### Terminal Resize Detection

Listen for the `SIGWINCH` signal (Unix) or equivalent (Windows):

```
process.on('SIGWINCH', () => {
  newSize = getTerminalSize()  // process.stdout.columns, process.stdout.rows
  triggerReLayout(newSize.columns, newSize.height)
})
```

### Responsive Patterns

| Pattern | Implementation |
|---------|---------------|
| Percentage widths | `width: "50%"` → Yoga computes based on parent width |
| Min/max constraints | `minWidth: 40, maxWidth: 120` → Yoga enforces bounds |
| Conditional rendering | Check terminal width, render compact or full layout |
| Scroll containers | When content exceeds viewport, enable scroll with scroll position state |

### Alt-Screen Mode

For full-terminal UIs (not inline in scrollback):

```
Enter alt-screen:  ESC[?1049h
Exit alt-screen:   ESC[?1049l
```

Alt-screen provides a clean canvas that doesn't pollute scrollback. Exit restores the previous terminal content.

---

## 8. Performance

### Rendering Optimization

| Technique | Impact |
|-----------|--------|
| Cell-by-cell diff | Only write changed cells to stdout |
| Style interning | Same style object reused across thousands of cells |
| Character interning | Deduplicate repeated characters in the pool |
| Packed cell data | Single integer comparison for cell equality (not deep object comparison) |
| Batch stdout writes | Collect all patches, write once (single write syscall) |
| Frame coalescing | If rendering takes >16ms, skip to latest state |

### Memory Management

| Concern | Solution |
|---------|----------|
| Style objects per cell | Style pool with ID-based references |
| Large screen buffers | Allocate once, reuse across frames |
| Yoga node leaks | Explicit free in reverse post-order |
| Event handler closures | Separate handler tracking to avoid unnecessary re-renders |

---

## 9. Implementation Checklist

### Minimum Viable Terminal UI

- [ ] React reconciler with custom host config (DOMElement, TextNode)
- [ ] Box and Text components with basic styles (color, bold)
- [ ] Yoga layout engine integration (flexbox)
- [ ] Single-buffered rendering (write full screen each frame)
- [ ] Keyboard input parsing (basic keys, Ctrl+C)
- [ ] Terminal resize handling (SIGWINCH)
- [ ] Streaming text display (append characters as they arrive)

### Production-Grade Terminal UI

- [ ] All of the above, plus:
- [ ] Double-buffered rendering with cell-by-cell diff
- [ ] Style/character/hyperlink interning pools
- [ ] 60fps frame rate targeting with coalescing
- [ ] Full escape sequence parsing (CSI u, xterm, function keys)
- [ ] Bracketed paste mode (paste injection prevention)
- [ ] Mouse support (click, hover, drag via SGR extended format)
- [ ] Hit testing with depth-first traversal
- [ ] Click event propagation with stopPropagation
- [ ] Hover state tracking (mouseEnter/mouseLeave)
- [ ] Alt-screen mode for full-terminal UIs
- [ ] Scroll containers with scroll position state
- [ ] Hyperlink support (OSC 8 protocol)
- [ ] Text wrapping modes (wrap, truncate, truncate-middle)
- [ ] WASM layout node memory management (explicit free)
- [ ] Progress bar component
- [ ] Focus management (tabIndex, keyboard navigation)

---

## Related Documents

- [AGENT-BOOTSTRAP-AND-CONFIGURATION.md](AGENT-BOOTSTRAP-AND-CONFIGURATION.md) — Terminal capabilities detected during bootstrap
- [AGENT-CONTEXT-AND-CONVERSATION.md](AGENT-CONTEXT-AND-CONVERSATION.md) — Streaming output display management
- [AGENT-DIFF-AND-FILE-EDITING.md](AGENT-DIFF-AND-FILE-EDITING.md) — Diff display in the terminal
- [AGENT-LLM-API-INTEGRATION.md](AGENT-LLM-API-INTEGRATION.md) — Streaming API responses displayed incrementally
