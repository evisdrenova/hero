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
