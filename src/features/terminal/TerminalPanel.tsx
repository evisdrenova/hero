import { useState, useCallback, useImperativeHandle, forwardRef, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { TerminalSquare, ChevronUp, Maximize2 } from "lucide-react";
import { XtermTerminal } from "./XtermTerminal";
import { formatDroppedImagePaths } from "./drop-paths";
import {
  clearPaneAutoLaunch,
  closeTerminalTabInWorkspace,
  createTerminalTabInWorkspace,
  resolveAutoLaunchTarget,
  resolveAgentLaunchTarget,
  setActivePaneInTerminalTab,
  setActiveTerminalTabInWorkspace,
  setPaneSession,
  type TerminalTabState,
  type TerminalWorkspace,
  type WorkspaceUpdate,
} from "./workspace";
import type { Tab } from "../../App";

function debugLog(msg: string) {
  invoke("debug_log", { message: msg }).catch(() => {});
}

export interface TerminalPanelHandle {
  launchSession: (options?: { agent?: string; prompt?: string }) => Promise<void>;
}

export interface TermSession {
  id: string;
  agent: string;
  label: string;
}

function buildSessionLabel(branch: string, agent: string) {
  if (agent === "claude-code") return `Claude - ${branch}`;
  if (agent === "codex") return `Codex - ${branch}`;
  return `Terminal - ${branch}`;
}

interface TerminalPanelProps {
  height: number;
  tab: Tab;
  workspace: TerminalWorkspace;
  onWorkspaceChange: (update: WorkspaceUpdate) => void;
  onToggle: () => void;
}

function getActiveTerminalTab(workspace: TerminalWorkspace): TerminalTabState | null {
  return (
    workspace.terminalTabs.find(
      (terminalTab) => terminalTab.id === workspace.activeTerminalTabId
    ) ??
    workspace.terminalTabs[0] ??
    null
  );
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
  function TerminalPanel({ height, tab, workspace, onWorkspaceChange, onToggle }, ref) {
  const [isLaunching, setIsLaunching] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const activeTerminalTab = getActiveTerminalTab(workspace);
  const activePane =
    activeTerminalTab?.panes.find((pane) => pane.id === activeTerminalTab.activePaneId) ??
    activeTerminalTab?.panes[0] ??
    null;
  const activeSurfaceId = activePane?.session?.id ?? null;

  const isPositionInsidePanel = useCallback((position: { x: number; y: number }) => {
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return false;

    return (
      position.x >= rect.left &&
      position.x <= rect.right &&
      position.y >= rect.top &&
      position.y <= rect.bottom
    );
  }, []);

  const sendDroppedImagePaths = useCallback(async (paths: string[]) => {
    if (!activeSurfaceId) return;

    const text = formatDroppedImagePaths(paths);
    if (!text) return;

    try {
      await invoke("pty_write", { sessionId: activeSurfaceId, data: text });
    } catch (err) {
      console.error("Failed to send dropped paths to terminal:", err);
      setError("Could not insert dropped image path into the terminal");
    }
  }, [activeSurfaceId]);

  const focusPane = useCallback(
    (terminalTabId: string, paneId: string) => {
      const nextWorkspace = setActivePaneInTerminalTab(
        setActiveTerminalTabInWorkspace(workspace, terminalTabId),
        terminalTabId,
        paneId
      );
      onWorkspaceChange(nextWorkspace);
    },
    [workspace, onWorkspaceChange]
  );

  const launchTerminal = useCallback(
    async (
      agent = "terminal",
      target?: { terminalTabId?: string; paneId?: string }
    ) => {
      debugLog(`launchTerminal called: tab.id=${tab.id}, tab.repoPath=${JSON.stringify(tab.repoPath)}, tab.branch=${tab.branch}, isLaunching=${isLaunching}`);

      if (!tab.repoPath) {
        debugLog("BAIL: tab.repoPath is empty/falsy");
        setError("No repository selected — pick a branch from the sidebar");
        return "";
      }
      if (isLaunching) {
        debugLog("BAIL: isLaunching=true, already in progress");
        return "";
      }

      let nextWorkspace = workspace;
      let terminalTabId = target?.terminalTabId;
      let paneId = target?.paneId;

      if (!terminalTabId || !paneId) {
        const launchTarget = resolveAgentLaunchTarget(nextWorkspace);
        if (launchTarget.mode === "create-terminal-tab") {
          nextWorkspace = createTerminalTabInWorkspace(nextWorkspace);
          const nextTarget = resolveAgentLaunchTarget(nextWorkspace);
          if (nextTarget.mode === "create-terminal-tab") {
            return "";
          }
          terminalTabId = nextTarget.terminalTabId;
          paneId = nextTarget.paneId;
        } else {
          terminalTabId = launchTarget.terminalTabId;
          paneId = launchTarget.paneId;
        }
      }

      if (!terminalTabId || !paneId) {
        return "";
      }

      nextWorkspace = setActivePaneInTerminalTab(
        setActiveTerminalTabInWorkspace(nextWorkspace, terminalTabId),
        terminalTabId,
        paneId
      );
      onWorkspaceChange(nextWorkspace);

      const targetTab = nextWorkspace.terminalTabs.find(
        (terminalTab) => terminalTab.id === terminalTabId
      );
      const targetPane = targetTab?.panes.find((pane) => pane.id === paneId);

      if (targetPane?.session) {
        debugLog(`Reusing existing session ${targetPane.session.id} for pane ${paneId}`);
        return targetPane.session.id;
      }

      setError(null);
      setIsLaunching(true);
      debugLog(`Calling pty_create with workingDir=${tab.repoPath}`);
      try {
        // Auto-checkout branch when opening a non-worktree branch tab
        const checkoutInput =
          agent === "terminal" && !tab.worktree && tab.branch
            ? `git checkout ${tab.branch} && clear\n`
            : undefined;

        const surfaceId: string = await invoke("pty_create", {
          workingDir: tab.repoPath,
          command: agent === "terminal" ? undefined : agent,
          initialInput: checkoutInput,
        });

        debugLog(`pty_create returned surfaceId=${surfaceId}`);
        const newSession: TermSession = {
          id: surfaceId,
          agent,
          label: buildSessionLabel(tab.branch, agent),
        };
        onWorkspaceChange((currentWorkspace) =>
          setPaneSession(currentWorkspace, terminalTabId, paneId, newSession)
        );
        return surfaceId;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        debugLog(`pty_create FAILED: ${message}`);
        console.error("Failed to create PTY session:", err);
        setError(`Terminal failed: ${message}`);
        return "";
      } finally {
        setIsLaunching(false);
      }
    },
    [tab.id, tab.repoPath, tab.branch, workspace, isLaunching, onWorkspaceChange]
  );

  const closeTerminalTab = useCallback(async (terminalTabId: string) => {
    const terminalTab = workspace.terminalTabs.find(
      (candidate) => candidate.id === terminalTabId
    );
    if (!terminalTab) return;

    for (const pane of terminalTab.panes) {
      if (pane.session) {
        try {
          await invoke("pty_destroy", { sessionId: pane.session.id });
        } catch (err) {
          console.error("Failed to destroy PTY session:", err);
        }
      }
    }

    onWorkspaceChange((currentWorkspace) =>
      closeTerminalTabInWorkspace(currentWorkspace, terminalTabId)
    );
  }, [workspace, onWorkspaceChange]);

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

  useEffect(() => {
    if (!tab.repoPath || isLaunching) return;

    const target = resolveAutoLaunchTarget(workspace);
    if (!target?.terminalTabId) return;

    onWorkspaceChange((currentWorkspace) =>
      clearPaneAutoLaunch(currentWorkspace, target.terminalTabId!, target.paneId)
    );
    void launchTerminal("terminal", target);
  }, [tab.repoPath, workspace, isLaunching, launchTerminal, onWorkspaceChange]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    getCurrentWindow()
      .onDragDropEvent((event) => {
        if (cancelled) return;

        if (event.payload.type === "leave") {
          setIsDropTarget(false);
          return;
        }

        const isInside = isPositionInsidePanel(event.payload.position);
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDropTarget(isInside);
          return;
        }

        setIsDropTarget(false);
        if (!isInside) return;
        void sendDroppedImagePaths(event.payload.paths);
      })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch(console.error);

    return () => {
      cancelled = true;
      setIsDropTarget(false);
      unlisten?.();
    };
  }, [isPositionInsidePanel, sendDroppedImagePaths]);

  return (
    <div
      ref={panelRef}
      className="relative flex min-w-0 shrink-0 flex-col bg-[#0a0a0a]"
      style={{ height }}
    >
      <div className="flex min-w-0 items-center gap-2 border-t border-border bg-bg-raised px-3 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {workspace.terminalTabs.map((terminalTab) => {
            const isActive = terminalTab.id === activeTerminalTab?.id;
            return (
              <button
                key={terminalTab.id}
                onClick={() =>
                  onWorkspaceChange(
                    setActiveTerminalTabInWorkspace(workspace, terminalTab.id)
                  )
                }
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] border-b-2 transition-colors ${
                  isActive
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-subtle hover:text-fg-muted"
                }`}
              >
                <TerminalSquare size={12} />
                {terminalTab.title}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    void closeTerminalTab(terminalTab.id);
                  }}
                  className="ml-1 hover:text-red"
                  title="Close terminal tab"
                >
                  ×
                </span>
              </button>
            );
          })}
          <button
            onClick={() => onWorkspaceChange(createTerminalTabInWorkspace(workspace))}
            className="rounded-md border border-border-subtle px-2.5 py-1 text-[11px] text-fg-subtle transition-colors hover:border-accent hover:text-accent-fg"
          >
            + Tab
          </button>
        </div>

        <button
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg"
          title="Collapse terminal"
        >
          <ChevronUp size={16} />
        </button>
        <button
          onClick={() => {}}
          className="flex h-7 w-7 items-center justify-center rounded text-fg-subtle hover:bg-bg-hover hover:text-fg"
          title="Maximize"
        >
          <Maximize2 size={16} />
        </button>
      </div>

      {error && (
        <div className="border-t border-border-subtle px-3 py-1 text-[11px] text-red">
          {error}
        </div>
      )}

      <div className="min-w-0 flex-1 overflow-hidden">
        {activeTerminalTab ? (
          <div
            className={`flex h-full ${
              activeTerminalTab.splitDirection === "horizontal"
                ? "flex-col"
                : "flex-row"
            }`}
          >
            {activeTerminalTab.panes.map((pane) => {
              const isActive = pane.id === activeTerminalTab.activePaneId;
              return (
                <div
                  key={pane.id}
                  onClick={() => focusPane(activeTerminalTab.id, pane.id)}
                  className={`flex min-h-0 min-w-0 flex-1 flex-col border-border-subtle ${
                    activeTerminalTab.panes.length > 1
                      ? activeTerminalTab.splitDirection === "horizontal"
                        ? "border-b last:border-b-0"
                      : "border-r last:border-r-0"
                      : ""
                  } ${isActive ? "bg-bg-selected/30" : "bg-transparent"}`}
                >
                  <div className="flex-1 overflow-hidden">
                    <XtermTerminal sessionId={pane.session?.id ?? null} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {isDropTarget && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-accent bg-accent-bg/55 px-4 text-center text-sm font-medium text-fg backdrop-blur-sm">
          Drop images to insert their file paths into the active terminal
        </div>
      )}
    </div>
  );
});
