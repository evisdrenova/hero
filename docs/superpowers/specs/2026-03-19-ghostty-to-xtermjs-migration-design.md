# Ghostty to xterm.js + PTY Migration

## Context

The app currently embeds libghostty as a native Metal renderer via NSView overlays positioned on top of the Tauri webview. This causes:

1. **Keyboard focus stealing** — native NSView captures keyboard input, preventing webview hotkeys (Cmd+J) from working when the terminal is focused
2. **Manual coordinate sync** — `getBoundingClientRect()` + `ResizeObserver` + IPC to keep the native overlay aligned with the DOM
3. **No output capture** — cannot programmatically read what the terminal prints (needed for agent output streaming, error detection, chat integration)
4. **Large binary dependency** — 50MB+ `libghostty.a` plus 7 macOS frameworks

## Decision

Replace Ghostty with **xterm.js** (frontend renderer) + **portable-pty** (Rust PTY backend). macOS only for now.

## Architecture

```
Frontend (React + xterm.js)
  │
  ├── pty_create(working_dir, command?) → session_id
  ├── pty_write(session_id, data)        → write to PTY stdin
  ├── pty_resize(session_id, cols, rows) → resize PTY
  ├── pty_destroy(session_id)            → kill + cleanup
  │
  └── listen("pty-output", {session_id, data})  ← async read loop
```

### Rust Backend: PTY Manager

**State:**

```rust
struct PtySession {
    writer: Box<dyn Write + Send>,
    pair: PtyPair,       // from portable-pty
    child: Box<dyn Child + Send>,
}

struct PtyState {
    sessions: HashMap<String, PtySession>,
}
```

**Commands:**

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `pty_create` | `working_dir: String, command: Option<String>, initial_input: Option<String>` | `String` (session_id) | Spawn PTY, start read loop, return ID |
| `pty_write` | `session_id: String, data: String` | `()` | Write bytes to PTY stdin |
| `pty_resize` | `session_id: String, cols: u32, rows: u32` | `()` | Resize the PTY |
| `pty_destroy` | `session_id: String` | `()` | Kill child process, clean up |

**Read loop:** Each session spawns a thread that reads from the PTY master fd in a loop. On each read, it emits a Tauri event:

```rust
app_handle.emit("pty-output", PtyOutputPayload {
    session_id: id.clone(),
    data: base64_encode(&bytes),
});
```

We use base64 encoding because PTY output is raw bytes (may include binary escape sequences) and Tauri events are JSON.

### Frontend: XtermTerminal Component

Replaces `GhosttyTerminal.tsx`. A standard React component that:

1. Creates an xterm.js `Terminal` instance with `WebglAddon` for GPU-accelerated rendering and `FitAddon` for auto-sizing
2. On mount: attaches to a div, calls `pty_create`, listens for `pty-output` events filtered by session_id
3. `terminal.onData(data => invoke("pty_write", {sessionId, data}))` — forward user input
4. `terminal.onResize(({cols, rows}) => invoke("pty_resize", {sessionId, cols, rows}))` — sync size
5. On unmount: calls `pty_destroy`, disposes terminal

No native overlays. No coordinate sync. No focus stealing. It's just a DOM element.

### Command Resolution

Same as current:

| Agent | Shell command |
|-------|-------------|
| `terminal` | User's default shell (no command arg) |
| `claude-code` | `claude` |
| `codex` | `codex` |
| Other | Pass through as-is |

## What Gets Removed

- `src-tauri/src/ghostty/` — entire module (mod.rs, commands.rs, overlay.rs)
- `src-tauri/vendor/ghostty/` — libghostty.a binary + headers
- `build.rs` — remove libghostty linking + framework linking
- `Cargo.toml` — remove `objc2-quartz-core` (CALayer/CAMetalLayer no longer needed)
- `src/features/terminal/GhosttyTerminal.tsx` — replaced by XtermTerminal
- `src-tauri/src/pty/mod.rs` — replaced by new PTY manager (no more external ghostty CLI launch)
- 7 Tauri commands (`ghostty_*`) — replaced by 4 simpler commands (`pty_*`)
- 60fps NSTimer tick loop in `lib.rs` setup
- `Mutex<GhosttyState>` managed state

## What Gets Added

- `portable-pty` crate dependency
- `base64` crate dependency
- `src-tauri/src/pty/mod.rs` — new PTY manager (~150 lines)
- `src/features/terminal/XtermTerminal.tsx` — new component (~100 lines)
- `xterm`, `@xterm/addon-webgl`, `@xterm/addon-fit` npm packages

## What Stays the Same

- `TerminalPanel.tsx` — workspace/tab/pane management (just swap `GhosttyTerminal` → `XtermTerminal`)
- `workspace.ts` — terminal tab state management
- `TermSession` type and session lifecycle in TerminalPanel
- All non-terminal Tauri commands
- Window corner rounding code (stays, but we can remove objc2-quartz-core since it was only for CAMetalLayer)

## Risk Mitigation

1. **Performance**: xterm.js WebGL addon provides GPU-accelerated rendering. VS Code uses this exact stack for millions of users.
2. **Escape sequence compatibility**: xterm.js handles all standard VT escape sequences. Agent CLIs (claude, codex) work fine with it.
3. **Clipboard**: xterm.js has built-in clipboard support via browser APIs — no custom NSPasteboard code needed.
