# Ghostty to xterm.js + PTY Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the native Ghostty/Metal terminal renderer with xterm.js (webview) + portable-pty (Rust), eliminating native overlay sync issues and enabling programmatic output capture.

**Architecture:** Rust PTY manager spawns shell/agent processes via `portable-pty`, reads output in background threads, and streams it to the frontend via Tauri events. The frontend renders output in xterm.js Terminal instances (DOM canvas elements). User input flows back via IPC `pty_write` commands.

**Tech Stack:** portable-pty (Rust PTY), base64 (encoding), xterm.js + @xterm/addon-webgl + @xterm/addon-fit (frontend terminal)

**Spec:** `docs/superpowers/specs/2026-03-19-ghostty-to-xtermjs-migration-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src-tauri/src/pty/mod.rs` | PTY session manager: create, write, resize, destroy sessions; async output read loop emitting Tauri events |
| `src/features/terminal/XtermTerminal.tsx` | React component wrapping xterm.js Terminal instance; listens for `pty-output` events, forwards user input/resize via IPC |

### Modified Files
| File | Changes |
|------|---------|
| `src-tauri/Cargo.toml` | Add `portable-pty`, `base64`; remove `objc2-quartz-core` |
| `src-tauri/build.rs` | Remove all libghostty linking and framework linking |
| `src-tauri/src/lib.rs` | Remove ghostty module, ghostty managed state, ghostty tick timer, ghostty commands; add pty commands and state |
| `src/features/terminal/TerminalPanel.tsx` | Replace `GhosttyTerminal` with `XtermTerminal`; remove all `ghostty_*` IPC calls; update session lifecycle to use `pty_*` commands |
| `package.json` | Add `@xterm/xterm`, `@xterm/addon-webgl`, `@xterm/addon-fit` |

### Deleted Files
| File | Reason |
|------|--------|
| `src-tauri/src/ghostty/mod.rs` | Replaced by new pty module |
| `src-tauri/src/ghostty/commands.rs` | Replaced by pty commands in new pty module |
| `src-tauri/src/ghostty/overlay.rs` | No longer needed — no native overlays |
| `src/features/terminal/GhosttyTerminal.tsx` | Replaced by XtermTerminal.tsx |
| `src-tauri/vendor/ghostty/` | libghostty.a binary no longer needed |

---

## Task 1: Add Rust Dependencies and Clean Build Config

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/build.rs`

- [ ] **Step 1: Update Cargo.toml — add portable-pty and base64, remove objc2-quartz-core**

In `src-tauri/Cargo.toml`, replace:

```toml
objc2-quartz-core = { version = "0.3", features = ["CALayer", "CAMetalLayer"] }
```

With nothing (remove the line). Then add after the `block2` line:

```toml
portable-pty = "0.8"
base64 = "0.22"
```

- [ ] **Step 2: Strip build.rs of all libghostty linking**

Replace the entire contents of `src-tauri/build.rs` with:

```rust
fn main() {
    tauri_build::build();
}
```

- [ ] **Step 3: Verify deps resolve**

Run: `cd src-tauri && cargo check 2>&1 | head -30`

Expected: Compilation errors about missing `ghostty` module (expected — we haven't removed it yet). But deps should resolve.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/build.rs
git commit -m "chore: add portable-pty + base64, remove libghostty build deps"
```

---

## Task 2: Implement PTY Manager (Rust Backend)

**Files:**
- Rewrite: `src-tauri/src/pty/mod.rs`

- [ ] **Step 1: Write the new PTY manager module**

Replace the entire contents of `src-tauri/src/pty/mod.rs` with:

```rust
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;

use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter, State};

/// Payload emitted to the frontend for each chunk of PTY output.
#[derive(Clone, serde::Serialize)]
pub struct PtyOutputPayload {
    pub session_id: String,
    /// Base64-encoded raw bytes from the PTY.
    pub data: String,
}

/// A running PTY session.
struct PtySession {
    /// Writer half of the PTY master — sends bytes to the child's stdin.
    writer: Box<dyn Write + Send>,
    /// The PTY pair, kept alive so the master fd stays open.
    pair: portable_pty::PtyPair,
    /// The child process.
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

// SAFETY: PtySession fields are Send. We access them only through Mutex.
unsafe impl Send for PtySession {}
unsafe impl Sync for PtySession {}

pub struct PtyState {
    sessions: HashMap<String, PtySession>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

fn generate_session_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("pty-{}-{}", now.as_secs(), now.subsec_nanos())
}

fn resolve_command(command: Option<&str>) -> Option<&str> {
    match command {
        Some("claude-code") => Some("claude"),
        Some("codex") => Some("codex"),
        Some("terminal") | None => None,
        Some(other) => Some(other),
    }
}

/// Create a new PTY session, spawn the child process, and start
/// streaming output to the frontend via Tauri events.
#[tauri::command]
pub fn pty_create(
    app: AppHandle,
    working_dir: String,
    command: Option<String>,
    initial_input: Option<String>,
    state: State<'_, Mutex<PtyState>>,
) -> Result<String, String> {
    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    let resolved = resolve_command(command.as_deref());

    let mut cmd = if let Some(program) = resolved {
        CommandBuilder::new(program)
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l"); // login shell
        cmd
    };

    cmd.cwd(&working_dir);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn: {}", e))?;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

    let session_id = generate_session_id();

    // Start the output reader thread
    {
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let id = session_id.clone();
        let app_handle = app.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF — child exited
                    Ok(n) => {
                        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        let _ = app_handle.emit(
                            "pty-output",
                            PtyOutputPayload {
                                session_id: id.clone(),
                                data: encoded,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });
    }

    // Send initial input if provided (e.g., "git checkout branch && clear\n")
    let mut session = PtySession {
        writer,
        pair,
        child,
    };

    if let Some(input) = initial_input {
        let _ = session.writer.write_all(input.as_bytes());
    }

    let mut ps = state.lock().map_err(|_| "State lock error".to_string())?;
    ps.sessions.insert(session_id.clone(), session);

    Ok(session_id)
}

/// Write data to a PTY session's stdin.
#[tauri::command]
pub fn pty_write(
    session_id: String,
    data: String,
    state: State<'_, Mutex<PtyState>>,
) -> Result<(), String> {
    let mut ps = state.lock().map_err(|_| "State lock error".to_string())?;
    let session = ps
        .sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Write failed: {}", e))?;

    Ok(())
}

/// Resize a PTY session.
#[tauri::command]
pub fn pty_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, Mutex<PtyState>>,
) -> Result<(), String> {
    let ps = state.lock().map_err(|_| "State lock error".to_string())?;
    let session = ps
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    session
        .pair
        .master
        .resize(PtySize {
            rows: rows as u16,
            cols: cols as u16,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Resize failed: {}", e))?;

    Ok(())
}

/// Destroy a PTY session — kills the child and cleans up.
#[tauri::command]
pub fn pty_destroy(
    session_id: String,
    state: State<'_, Mutex<PtyState>>,
) -> Result<(), String> {
    let mut ps = state.lock().map_err(|_| "State lock error".to_string())?;
    if let Some(mut session) = ps.sessions.remove(&session_id) {
        let _ = session.child.kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::resolve_command;

    #[test]
    fn resolves_agent_command_names() {
        assert_eq!(resolve_command(Some("claude-code")), Some("claude"));
        assert_eq!(resolve_command(Some("codex")), Some("codex"));
        assert_eq!(resolve_command(Some("terminal")), None);
        assert_eq!(resolve_command(None), None);
        assert_eq!(resolve_command(Some("custom-agent")), Some("custom-agent"));
    }
}
```

- [ ] **Step 2: Verify module compiles in isolation**

Run: `cd src-tauri && cargo check 2>&1 | grep "pty"` (will still have ghostty errors, but pty module should parse)

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/pty/mod.rs
git commit -m "feat: implement PTY manager with portable-pty backend"
```

---

## Task 3: Remove Ghostty Module and Wire PTY into lib.rs

**Files:**
- Delete: `src-tauri/src/ghostty/mod.rs`
- Delete: `src-tauri/src/ghostty/commands.rs`
- Delete: `src-tauri/src/ghostty/overlay.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Delete the ghostty module directory**

```bash
rm -rf src-tauri/src/ghostty/
```

- [ ] **Step 2: Update lib.rs — remove ghostty, wire in PTY**

In `src-tauri/src/lib.rs`:

1. Remove `mod ghostty;` declaration
2. Remove `use std::sync::Mutex;` if it becomes unused (check — it's still needed for `AppState`)
3. Remove the ghostty tick timer block in `.setup()` (the entire block from `{ use block2::RcBlock;` through the closing `}`)
4. Remove `.manage(Mutex::new(ghostty::GhosttyState::new()))`
5. Add `.manage(Mutex::new(pty::PtyState::new()))`
6. Replace all `ghostty::commands::ghostty_*` entries in `invoke_handler` with:
   ```rust
   pty::pty_create,
   pty::pty_write,
   pty::pty_resize,
   pty::pty_destroy,
   ```
7. Remove `launch_ghostty_agent` command registration and the `launch_ghostty_agent` function
8. Remove the `block2::RcBlock` and `objc2_foundation::NSTimer` imports (no longer needed since tick loop is gone)

The `Mutex` import stays because `AppState` still uses it.

- [ ] **Step 3: Clean up Cargo.toml — remove unused objc2 deps if possible**

Check if `objc2`, `objc2-foundation`, `objc2-app-kit`, `block2` are still used after ghostty removal. They ARE still used by the window corner rounding code in `lib.rs` `.setup()`. So keep `objc2`, `objc2-foundation`, `objc2-app-kit`. Remove only:
- `objc2-quartz-core` (was only used for CAMetalLayer in ghostty overlay)
- `block2` (was only used for the NSTimer tick block — check if still needed)

Actually, `block2` is used by `objc2-foundation`'s `NSTimer` feature. Since we're removing the timer, check if anything else uses `block2`. If not, remove it and the `NSTimer` feature from `objc2-foundation`.

Update `objc2-foundation` features — remove `"NSTimer"` and `"block2"`:
```toml
objc2-foundation = { version = "0.3", features = ["NSString", "NSThread", "NSDate"] }
```

Remove:
```toml
objc2-quartz-core = { version = "0.3", features = ["CALayer", "CAMetalLayer"] }
block2 = "0.6"
```

- [ ] **Step 4: Verify Rust compiles**

Run: `cd src-tauri && cargo check`

Expected: Clean compilation (possibly warnings about unused imports, fix those).

- [ ] **Step 5: Run Rust tests**

Run: `cd src-tauri && cargo test`

Expected: All tests pass. The ghostty tests are gone; the PTY `resolve_command` test should pass.

- [ ] **Step 6: Commit**

```bash
git add -A src-tauri/src/ghostty src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "refactor: remove ghostty module, wire PTY manager into app"
```

---

## Task 4: Install xterm.js npm Packages

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install xterm.js and addons**

```bash
cd /Users/evisdrenova/code/entire-app
npm install @xterm/xterm @xterm/addon-webgl @xterm/addon-fit
```

- [ ] **Step 2: Verify install**

Run: `ls node_modules/@xterm/xterm/lib/xterm.js`

Expected: File exists.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add xterm.js and addons"
```

---

## Task 5: Create XtermTerminal React Component

**Files:**
- Create: `src/features/terminal/XtermTerminal.tsx`
- Delete: `src/features/terminal/GhosttyTerminal.tsx`

- [ ] **Step 1: Create XtermTerminal.tsx**

```tsx
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface XtermTerminalProps {
  sessionId: string | null;
  className?: string;
}

interface PtyOutputPayload {
  session_id: string;
  data: string; // base64-encoded
}

export function XtermTerminal({ sessionId, className }: XtermTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current || !sessionId) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        selectionBackground: "#3a3a5a",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    // Load WebGL renderer for GPU-accelerated rendering
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available — fall back to canvas renderer (automatic)
    }

    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Send initial resize to backend
    invoke("pty_resize", {
      sessionId,
      cols: terminal.cols,
      rows: terminal.rows,
    }).catch(console.error);

    // Forward user input to PTY
    const onDataDisposable = terminal.onData((data) => {
      invoke("pty_write", { sessionId, data }).catch(console.error);
    });

    // Forward resize to PTY
    const onResizeDisposable = terminal.onResize(({ cols, rows }) => {
      invoke("pty_resize", { sessionId, cols, rows }).catch(console.error);
    });

    // Listen for PTY output events
    let unlisten: (() => void) | undefined;
    const id = sessionId; // capture for closure

    listen<PtyOutputPayload>("pty-output", (event) => {
      if (event.payload.session_id !== id) return;
      // Decode base64 to raw bytes
      const bytes = Uint8Array.from(atob(event.payload.data), (c) =>
        c.charCodeAt(0)
      );
      terminal.write(bytes);
    }).then((fn) => {
      unlisten = fn;
    });

    // Resize on container size changes
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => fitAddon.fit());
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      resizeObserver.disconnect();
      unlisten?.();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full ${className ?? ""}`}
      style={{ background: "#0a0a0a" }}
    />
  );
}
```

- [ ] **Step 2: Delete GhosttyTerminal.tsx**

```bash
rm src/features/terminal/GhosttyTerminal.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/features/terminal/XtermTerminal.tsx
git add src/features/terminal/GhosttyTerminal.tsx
git commit -m "feat: add XtermTerminal component, remove GhosttyTerminal"
```

---

## Task 6: Update TerminalPanel to Use PTY Commands

**Files:**
- Modify: `src/features/terminal/TerminalPanel.tsx`

- [ ] **Step 1: Replace GhosttyTerminal import with XtermTerminal**

Change:
```tsx
import { GhosttyTerminal } from "./GhosttyTerminal";
```
To:
```tsx
import { XtermTerminal } from "./XtermTerminal";
```

- [ ] **Step 2: Update launchTerminal — replace ghostty_create_surface with pty_create**

In the `launchTerminal` callback, replace:
```tsx
const surfaceId: string = await invoke("ghostty_create_surface", {
  workingDir: tab.repoPath,
  command: agent === "terminal" ? undefined : agent,
  initialInput: checkoutInput,
});
```
With:
```tsx
const surfaceId: string = await invoke("pty_create", {
  workingDir: tab.repoPath,
  command: agent === "terminal" ? undefined : agent,
  initialInput: checkoutInput,
});
```

- [ ] **Step 3: Update killPaneSession — replace ghostty_destroy_surface with pty_destroy**

Replace:
```tsx
await invoke("ghostty_destroy_surface", { surfaceId: pane.session.id });
```
With:
```tsx
await invoke("pty_destroy", { sessionId: pane.session.id });
```

- [ ] **Step 4: Update closeTerminalTab — same destroy replacement**

Replace:
```tsx
await invoke("ghostty_destroy_surface", { surfaceId: pane.session.id });
```
With:
```tsx
await invoke("pty_destroy", { sessionId: pane.session.id });
```

- [ ] **Step 5: Remove all ghostty overlay IPC calls**

Remove or replace the following patterns throughout the file:

1. Remove the `focusPane` callback's overlay focus call:
   ```tsx
   // Remove this block:
   if (pane?.session) {
     invoke("ghostty_focus_overlay", { surfaceId: pane.session.id }).catch(console.error);
   }
   ```

2. Remove the `useImperativeHandle` block's `ghostty_send_text` call — replace with `pty_write`:
   ```tsx
   await invoke("pty_write", {
     sessionId: surfaceId,
     data: options.prompt + "\n",
   });
   ```

3. Remove the unmount cleanup effect that hides native overlays (the entire `useEffect` with `workspaceRef` that calls `ghostty_show_overlay`). xterm.js cleans up automatically as a DOM element.

4. In `sendDroppedImagePaths`, replace `ghostty_send_text` + `ghostty_focus_overlay` with just `pty_write`:
   ```tsx
   await invoke("pty_write", {
     sessionId: activeSurfaceId,
     data: text,
   });
   ```

- [ ] **Step 6: Replace GhosttyTerminal with XtermTerminal in JSX**

Change:
```tsx
<GhosttyTerminal surfaceId={pane.session?.id ?? null} />
```
To:
```tsx
<XtermTerminal sessionId={pane.session?.id ?? null} />
```

- [ ] **Step 7: Remove the `useImperativeHandle` delay**

The 300ms `setTimeout` was needed for the native PTY to initialize. With our own PTY, the read loop starts immediately. Remove the `setTimeout` wrapper:

```tsx
useImperativeHandle(ref, () => ({
  async launchSession(options = {}) {
    const agent = options.agent ?? "terminal";
    const surfaceId = await launchTerminal(agent);
    if (!surfaceId) return;
    if (!options.prompt) return;

    try {
      await invoke("pty_write", {
        sessionId: surfaceId,
        data: options.prompt + "\n",
      });
    } catch (err) {
      console.error("Failed to send prompt to terminal:", err);
    }
  },
}), [launchTerminal]);
```

- [ ] **Step 8: Commit**

```bash
git add src/features/terminal/TerminalPanel.tsx
git commit -m "refactor: update TerminalPanel to use pty_* commands instead of ghostty_*"
```

---

## Task 7: Delete Ghostty Vendor Binary

**Files:**
- Delete: `src-tauri/vendor/ghostty/` directory (libghostty.a, headers, scripts)

- [ ] **Step 1: Remove vendor directory**

```bash
rm -rf src-tauri/vendor/ghostty/
```

Note: If the directory is tracked by Git LFS, you may need:
```bash
git lfs untrack "src-tauri/vendor/ghostty/libghostty.a"
git rm -r src-tauri/vendor/ghostty/
```

- [ ] **Step 2: Commit**

```bash
git add -A src-tauri/vendor/
git commit -m "chore: remove libghostty vendor binary"
```

---

## Task 8: TypeScript Compile Check and Full Build

- [ ] **Step 1: TypeScript type check**

Run: `cd /Users/evisdrenova/code/entire-app && npx tsc --noEmit`

Fix any type errors (likely: leftover references to `ghostty_*` IPC calls in other files).

- [ ] **Step 2: Cargo check**

Run: `cd src-tauri && cargo check`

Fix any Rust compilation errors.

- [ ] **Step 3: Cargo test**

Run: `cd src-tauri && cargo test`

Expected: All tests pass.

- [ ] **Step 4: Full build test**

Run: `cd /Users/evisdrenova/code/entire-app && npm run tauri build -- --debug 2>&1 | tail -20`

Expected: Builds successfully. Binary is much smaller without libghostty.a.

- [ ] **Step 5: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: resolve remaining build issues from ghostty removal"
```

---

## Task 9: Manual Smoke Test

- [ ] **Step 1: Launch the app**

```bash
npm run tauri dev
```

- [ ] **Step 2: Verify terminal works**

1. Select a repo from the sidebar
2. Terminal panel should show at the bottom
3. Click in the terminal — should see a shell prompt
4. Type `ls` + Enter — should see file listing
5. Type `echo hello` — should see "hello"
6. Press Cmd+J — terminal should collapse
7. Press Cmd+J again — terminal should expand (this was broken with Ghostty!)

- [ ] **Step 3: Verify agent launch**

1. Use the PromptBar to send a task to claude-code
2. Should see a new terminal tab with `claude` running
3. Agent output should stream in real-time

- [ ] **Step 4: Verify multi-session**

1. Click "+ Tab" to create a second terminal tab
2. Switch between tabs — each should have its own session
3. Close a tab — session should be killed cleanly
