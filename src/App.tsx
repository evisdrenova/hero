import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./features/repos/Sidebar";
import { useReposQuery } from "./hooks/use-tauri-query";
import { TitleBar } from "./components/TitleBar";
import { TabBar } from "./components/TabBar";
import { CheckpointList } from "./features/checkpoints/CheckpointList";
import { TranscriptView } from "./features/transcripts/TranscriptView";
import { DiffView, BranchDiffView } from "./features/diff/DiffView";
import { CheckpointInsightsContainer } from "./features/insights/CheckpointInsightsContainer";
import { BranchInsightsContainer } from "./features/insights/BranchInsightsContainer";
import { BranchDebugContainer } from "./features/debug/BranchDebugContainer";
import { CheckpointDebugContainer } from "./features/debug/CheckpointDebugContainer";
import { TerminalPanel } from "./features/terminal/TerminalPanel";
import { PromptBar } from "./features/terminal/PromptBar";
import type { TerminalPanelHandle } from "./features/terminal/TerminalPanel";
import { ChatView } from "./features/chat/ChatView";
import {
  createChatSession,
  appendOutput,
  addUserMessage,
  type ChatSession,
} from "./features/chat/chat-session";
import { createStreamJsonParser, type StreamJsonParser } from "./features/chat/stream-json";
import { createBranchTab, createWorktreeTab } from "./features/repos/tab-state";
import { DEFAULT_SIDEBAR_WIDTH, clampSidebarWidth } from "./features/repos/sidebar-width.ts";
import { planWorktreeDeletionCleanup } from "./features/repos/worktree-delete-state.ts";
import {
  collectWorkspaceSurfaceIds,
  createTerminalWorkspace,
  type TerminalWorkspace,
  type WorkspaceUpdate,
} from "./features/terminal/workspace";
import {
  createTerminalPanelVisibility,
  isTerminalPanelOpen,
  setTerminalPanelOpen,
  syncTerminalPanelVisibility,
} from "./features/terminal/panel-visibility";
import {
  DEFAULT_TERMINAL_HEIGHT,
  clampTerminalHeight,
} from "./features/terminal/resize.ts";
import { useLiveUpdates } from "./hooks/use-live-updates";
import type { BranchInfo, CheckpointSummary, WorktreeInfo } from "./lib/ipc";
import { ArrowLeft, GitCommit } from "lucide-react";

export interface Tab {
  id: string;
  branch: string;
  repoPath: string;
  worktree: WorktreeInfo | null;
  kind: "branch" | "agent";
  agent: string | null;
  hasActiveSession: boolean;
}

function resolveAgent(agent: string) {
  if (agent === "codex") return "codex";
  if (agent === "gemini") return "gemini";
  if (agent === "cursor") return "cursor";
  return "claude-code";
}

export default function App() {
  const [tabs, setTabs] = useState<Tab[]>([
    {
      id: "main",
      branch: "main",
      repoPath: "",
      worktree: null,
      kind: "branch",
      agent: null,
      hasActiveSession: false,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState("main");
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [terminalHeight, setTerminalHeight] = useState(() => {
    const storedHeight = Number(localStorage.getItem("entire:terminal-height"));
    const initialHeight = Number.isFinite(storedHeight) && storedHeight > 0
      ? storedHeight
      : DEFAULT_TERMINAL_HEIGHT;

    return clampTerminalHeight(initialHeight, window.innerHeight);
  });
  const [terminalPanelVisibility, setTerminalPanelVisibility] = useState(
    () => createTerminalPanelVisibility(["main"])
  );
  const [innerTab, setInnerTab] = useState<
    "chat" | "checkpoints" | "diff" | "insights" | "debug"
  >("chat");
  const [selectedCheckpoint, setSelectedCheckpoint] =
    useState<CheckpointSummary | null>(null);
  const [checkpointInnerTab, setCheckpointInnerTab] = useState<
    "transcript" | "diff" | "insights" | "debug"
  >("transcript");

  const [workspaceMap, setWorkspaceMap] = useState<Map<string, TerminalWorkspace>>(
    () => new Map([["main", createTerminalWorkspace()]])
  );
  const [chatSessions, setChatSessions] = useState<Map<string, ChatSession>>(
    () => new Map()
  );

  const terminalRef = useRef<TerminalPanelHandle>(null);
  const chatParsersRef = useRef<Map<string, StreamJsonParser>>(new Map());

  // Load repos so we can auto-populate the initial tab
  const { data: repos } = useReposQuery();

  // Auto-populate the initial tab's repoPath from the first discovered repo
  useEffect(() => {
    invoke("debug_log", {
      message: `useEffect[repos]: repos=${repos ? repos.length : "null"}, first repo path=${repos?.[0]?.path ?? "none"}`,
    }).catch(() => { });

    if (!repos || repos.length === 0) return;
    setTabs((prev) => {
      const updated = prev.map((tab) => {
        if (tab.id === "main" && !tab.repoPath) {
          const repo = repos[0];
          const headBranch = repo.branches.find((b: { is_head: boolean }) => b.is_head);
          const newPath = repo.path;
          const newBranch = headBranch?.name ?? repo.branches[0]?.name ?? "main";
          invoke("debug_log", {
            message: `Auto-populating initial tab: repoPath=${newPath}, branch=${newBranch}`,
          }).catch(() => { });
          return {
            ...tab,
            repoPath: newPath,
            branch: newBranch,
          };
        }
        return tab;
      });
      return updated;
    });
  }, [repos]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const activeWorkspace =
    workspaceMap.get(activeTabId) ?? createTerminalWorkspace();
  const isTerminalOpen = isTerminalPanelOpen(terminalPanelVisibility, activeTabId);
  const tabsWithSessions = tabs.map((tab) => ({
    ...tab,
    hasActiveSession: collectWorkspaceSurfaceIds(workspaceMap.get(tab.id)).length > 0,
  }));

  // Live updates — watch active repo for checkpoint/session changes
  useLiveUpdates(activeTab.repoPath);

  useEffect(() => {
    setWorkspaceMap((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const tab of tabs) {
        if (!next.has(tab.id)) {
          next.set(tab.id, createTerminalWorkspace());
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tabs]);

  useEffect(() => {
    setTerminalPanelVisibility((prev) =>
      syncTerminalPanelVisibility(
        prev,
        tabs.map((tab) => tab.id)
      )
    );
  }, [tabs]);

  const handleWorkspaceChange = useCallback(
    (tabId: string, update: WorkspaceUpdate) => {
      setWorkspaceMap((prev) => {
        const next = new Map(prev);
        const current = next.get(tabId) ?? createTerminalWorkspace();
        next.set(
          tabId,
          typeof update === "function" ? update(current) : update
        );
        return next;
      });
    },
    []
  );

  const handleSetTerminalOpen = useCallback((tabId: string, isOpen: boolean) => {
    setTerminalPanelVisibility((prev) => setTerminalPanelOpen(prev, tabId, isOpen));
  }, []);

  // Agent dispatch — create a PTY for the agent and show in Chat view only
  const handleSendToAgent = useCallback(
    (agent: string, prompt: string) => {
      if (!activeTab.repoPath) return;

      // If current tab already has a chat session, send follow-up
      const existingChat = chatSessions.get(activeTabId);
      if (existingChat && prompt) {
        invoke("agent_write", {
          sessionId: existingChat.id,
          data: prompt + "\n",
        }).catch(console.error);
        setChatSessions((prev) => {
          const next = new Map(prev);
          next.set(activeTabId, addUserMessage(existingChat, prompt));
          return next;
        });
        setInnerTab("chat");
        return;
      }

      const resolvedAgent = resolveAgent(agent);
      const tabId = `agent:${resolvedAgent}:${Date.now()}`;
      const agentTab: Tab = {
        id: tabId,
        branch: activeTab.branch,
        repoPath: activeTab.repoPath,
        worktree: activeTab.worktree,
        kind: "agent",
        agent: resolvedAgent,
        hasActiveSession: false,
      };

      setTabs((prev) => [...prev, agentTab]);
      setActiveTabId(tabId);
      setInnerTab("chat");

      // Spawn agent as a piped process (not PTY) so --output-format works
      invoke<string>("agent_create", {
        workingDir: activeTab.repoPath,
        command: resolvedAgent,
        args: ["--output-format", "stream-json"],
      })
        .then((sessionId) => {
          chatParsersRef.current.set(sessionId, createStreamJsonParser());
          setChatSessions((prev) => {
            const next = new Map(prev);
            next.set(tabId, createChatSession(sessionId, prompt));
            return next;
          });
          if (prompt) {
            invoke("agent_write", {
              sessionId,
              data: prompt + "\n",
            }).catch(console.error);
          }
        })
        .catch((err) => {
          console.error("Failed to create agent:", err);
        });
    },
    [activeTab, activeTabId, chatSessions]
  );

  // Persist UI state to localStorage
  useEffect(() => {
    localStorage.setItem("entire:terminal-height", String(terminalHeight));
  }, [terminalHeight]);
  useEffect(() => {
    function handleWindowResize() {
      setTerminalHeight((currentHeight) =>
        clampTerminalHeight(currentHeight, window.innerHeight)
      );
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

  // Listen for agent output (line-delimited JSON) and route to chat sessions
  useEffect(() => {
    const unlisten = listen<{ session_id: string; data: string }>(
      "agent-output",
      (event) => {
        const { session_id, data } = event.payload;
        const parser = chatParsersRef.current.get(session_id);
        if (!parser) return;

        // Each event is one line of JSON — feed it with a newline so the parser processes it
        const text = parser.feed(data + "\n");
        if (!text) return;

        setChatSessions((prev) => {
          for (const [tabId, session] of prev) {
            if (session.id === session_id) {
              const next = new Map(prev);
              next.set(tabId, appendOutput(session, text));
              return next;
            }
          }
          return prev;
        });
      }
    );

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Clear selected checkpoint when switching branch tabs
  useEffect(() => {
    setSelectedCheckpoint(null);
    setCheckpointInnerTab("transcript");
  }, [activeTabId]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+K = focus search
      if (meta && e.key === "k") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[placeholder*="Search"]')?.focus();
      }
      // Ctrl+` or Cmd+J = toggle terminal
      if ((e.ctrlKey && e.key === "`") || (meta && e.key === "j")) {
        e.preventDefault();
        handleSetTerminalOpen(activeTabId, !isTerminalOpen);
      }
      // Cmd+W = close active tab
      if (meta && e.key === "w") {
        e.preventDefault();
        handleCloseTab(activeTabId);
      }
      // Cmd+1-9 = switch to tab by index
      if (meta && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) {
          setActiveTabId(tabs[idx].id);
        }
      }
      // Cmd+[ / Cmd+] = prev/next tab
      if (meta && e.key === "[") {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (idx > 0) setActiveTabId(tabs[idx - 1].id);
      }
      if (meta && e.key === "]") {
        e.preventDefault();
        const idx = tabs.findIndex((t) => t.id === activeTabId);
        if (idx < tabs.length - 1) setActiveTabId(tabs[idx + 1].id);
      }
      // Escape = deselect checkpoint
      if (e.key === "Escape" && selectedCheckpoint) {
        setSelectedCheckpoint(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTabId, handleSetTerminalOpen, isTerminalOpen, tabs, selectedCheckpoint]);

  function handleBranchSelect(branch: BranchInfo, repoPath: string) {
    const newTab = createBranchTab(branch, repoPath);
    const existing = tabs.find(
      (t) =>
        t.kind === "branch" &&
        t.branch === newTab.branch &&
        t.repoPath === newTab.repoPath
    );
    if (existing) {
      setActiveTabId(existing.id);
    } else {
      setTabs([...tabs, newTab]);
      setActiveTabId(newTab.id);
    }
  }

  function handleWorktreeSelect(wt: WorktreeInfo) {
    const newTab = createWorktreeTab(wt);
    const existing = tabs.find(
      (t) =>
        t.kind === "branch" &&
        t.branch === newTab.branch &&
        t.repoPath === newTab.repoPath
    );
    if (existing) {
      setActiveTabId(existing.id);
    } else {
      setTabs([...tabs, newTab]);
      setActiveTabId(newTab.id);
    }
  }

  function handleCloseTab(tabId: string) {
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex((t) => t.id === tabId);
    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);
    if (activeTabId === tabId) {
      setActiveTabId(newTabs[Math.max(0, idx - 1)].id);
    }
    const closedWorkspace = workspaceMap.get(tabId);
    for (const surfaceId of collectWorkspaceSurfaceIds(closedWorkspace)) {
      invoke("pty_destroy", { sessionId: surfaceId }).catch(console.error);
    }
    setWorkspaceMap((prev) => {
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
    const chatSession = chatSessions.get(tabId);
    if (chatSession) {
      invoke("agent_destroy", { sessionId: chatSession.id }).catch(console.error);
      chatParsersRef.current.delete(chatSession.id);
    }
    setChatSessions((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
  }

  function handleBranchDeleted(branchName: string, repoPath: string) {
    const tabsToRemove = tabs.filter(
      (tab) =>
        tab.kind === "branch" &&
        tab.worktree === null &&
        tab.branch === branchName &&
        tab.repoPath === repoPath
    );

    if (tabsToRemove.length === 0) {
      return;
    }

    const nextTabs = tabs.filter((tab) => !tabsToRemove.some((candidate) => candidate.id === tab.id));
    setTabs(nextTabs);

    if (tabsToRemove.some((tab) => tab.id === activeTabId) && nextTabs.length > 0) {
      setActiveTabId(nextTabs[0].id);
    }

    setWorkspaceMap((prev) => {
      const next = new Map(prev);
      for (const tab of tabsToRemove) {
        const closedWorkspace = next.get(tab.id);
        for (const surfaceId of collectWorkspaceSurfaceIds(closedWorkspace)) {
          invoke("pty_destroy", { sessionId: surfaceId }).catch(console.error);
        }
        next.delete(tab.id);
      }
      return next;
    });
  }

  function handleWorktreeDeleted(worktreePath: string) {
    const cleanup = planWorktreeDeletionCleanup({
      tabs,
      activeTabId,
      worktreePath,
    });

    if (cleanup.removedTabIds.length === 0) {
      return;
    }

    setTabs(cleanup.remainingTabs);

    if (cleanup.nextActiveTabId && cleanup.nextActiveTabId !== activeTabId) {
      setActiveTabId(cleanup.nextActiveTabId);
    }

    setWorkspaceMap((prev) => {
      const next = new Map(prev);
      for (const tabId of cleanup.removedTabIds) {
        const closedWorkspace = next.get(tabId);
        for (const surfaceId of collectWorkspaceSurfaceIds(closedWorkspace)) {
          invoke("pty_destroy", { sessionId: surfaceId }).catch(console.error);
        }
        next.delete(tabId);
      }
      return next;
    });
  }

  function handleResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = terminalHeight;

    function onMouseMove(ev: MouseEvent) {
      const delta = startY - ev.clientY;
      setTerminalHeight(
        clampTerminalHeight(startHeight + delta, window.innerHeight)
      );
    }
    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function handleSidebarResizeStart(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    function onMouseMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      setSidebarWidth(clampSidebarWidth(startWidth + delta));
    }

    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  const repoName = activeTab.repoPath
    ? activeTab.repoPath.split("/").pop()
    : "";

  return (
    <div className="flex h-screen flex-col">
      <TitleBar
        title={`Entire — ${repoName ? `${repoName}/` : ""}${activeTab?.branch ?? ""}`}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          activeTab={activeTab}
          width={sidebarWidth}
          onBranchSelect={handleBranchSelect}
          onBranchDeleted={handleBranchDeleted}
          onWorktreeDeleted={handleWorktreeDeleted}
          onWorktreeSelect={handleWorktreeSelect}
          onResizeStart={handleSidebarResizeStart}
        />

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TabBar
            tabs={tabsWithSessions}
            activeTabId={activeTabId}
            onSelectTab={setActiveTabId}
            onCloseTab={handleCloseTab}
            onAddAgentTab={(agent) => handleSendToAgent(agent, "")}
          />

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Inner tabs */}
            <div className="flex gap-0 border-b border-border-subtle bg-bg px-5 pt-3">
              {(["chat", "checkpoints", "diff", "insights", "debug"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setInnerTab(tab)}
                  className={`border-b-2 px-4 pb-2 text-xs font-medium capitalize transition-colors ${innerTab === tab
                    ? "border-accent text-fg"
                    : "border-transparent text-fg-subtle hover:text-fg-muted"
                    }`}
                >
                  {tab === "chat"
                    ? "Chat"
                    : tab === "checkpoints"
                      ? "Checkpoints"
                      : tab === "diff"
                        ? "Diff"
                        : tab === "insights"
                          ? "Insights"
                          : "Debug"}
                </button>
              ))}
            </div>

            {/* Main view */}
            <div className="flex flex-1 overflow-hidden bg-bg">
              {innerTab === "chat" && (
                <div className="flex flex-1 overflow-hidden">
                  <ChatView session={chatSessions.get(activeTabId) ?? null} />
                </div>
              )}
              {innerTab === "checkpoints" && (
                <>
                  {/* Checkpoint list — always visible when on checkpoints tab */}
                  <div
                    className={`min-w-0 overflow-y-auto overflow-x-hidden ${selectedCheckpoint
                      ? "w-[320px] shrink-0 border-r border-border-subtle"
                      : "flex-1"
                      }`}
                  >
                    <CheckpointList
                      repoPath={activeTab.repoPath}
                      branch={activeTab.branch}
                      onSelectCheckpoint={(cp) => {
                        setSelectedCheckpoint(cp);
                        setCheckpointInnerTab("transcript");
                      }}
                    />
                  </div>

                  {/* Checkpoint detail panel */}
                  {selectedCheckpoint && (
                    <div className="flex flex-1 flex-col overflow-hidden">
                      {/* Detail header */}
                      <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5">
                        <button
                          onClick={() => setSelectedCheckpoint(null)}
                          className="flex items-center gap-1.5 text-xs text-fg-subtle transition-colors hover:text-fg"
                        >
                          <ArrowLeft size={14} />
                        </button>
                        <GitCommit size={14} className="text-fg-subtle" />
                        <span className="font-mono text-xs text-accent-fg">
                          {selectedCheckpoint.commit_sha
                            ? selectedCheckpoint.commit_sha.slice(0, 7)
                            : selectedCheckpoint.checkpoint_id.slice(0, 7)}
                        </span>
                        <span className="truncate text-xs text-fg-muted">
                          {selectedCheckpoint.commit_message || "Untitled"}
                        </span>
                      </div>

                      {/* Checkpoint sub-tabs */}
                      <div className="flex gap-0 border-b border-border-subtle bg-bg px-4 pt-2">
                        {(["transcript", "diff", "insights", "debug"] as const).map(
                          (tab) => (
                            <button
                              key={tab}
                              onClick={() => setCheckpointInnerTab(tab)}
                              className={`border-b-2 px-3 pb-1.5 text-[11px] font-medium capitalize transition-colors ${checkpointInnerTab === tab
                                ? "border-accent text-fg"
                                : "border-transparent text-fg-subtle hover:text-fg-muted"
                                }`}
                            >
                              {tab === "transcript"
                                ? "Transcript"
                                : tab === "diff"
                                  ? "Diff"
                                  : tab === "insights"
                                    ? "Insights"
                                    : "Debug"}
                            </button>
                          )
                        )}
                      </div>

                      {/* Checkpoint detail content */}
                      <div className="flex-1 overflow-y-auto">
                        {checkpointInnerTab === "transcript" && (
                          <TranscriptView
                            repoPath={activeTab.repoPath}
                            checkpoint={selectedCheckpoint}
                          />
                        )}
                        {checkpointInnerTab === "diff" && (
                          <DiffView
                            repoPath={activeTab.repoPath}
                            checkpoint={selectedCheckpoint}
                            onSendToAgent={handleSendToAgent}
                          />
                        )}
                        {checkpointInnerTab === "insights" && (
                          <CheckpointInsightsContainer
                            repoPath={activeTab.repoPath}
                            checkpoint={selectedCheckpoint}
                          />
                        )}
                        {checkpointInnerTab === "debug" && (
                          <CheckpointDebugContainer
                            repoPath={activeTab.repoPath}
                            checkpoint={selectedCheckpoint}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
              {innerTab === "diff" && (
                <div className="flex flex-1 overflow-hidden">
                  <BranchDiffView
                    repoPath={activeTab.repoPath}
                    branch={activeTab.branch}
                    onSendToAgent={handleSendToAgent}
                  />
                </div>
              )}
              {innerTab === "insights" && (
                <div className="flex flex-1 overflow-y-auto">
                  <BranchInsightsContainer
                    repoPath={activeTab.repoPath}
                    branch={activeTab.branch}
                  />
                </div>
              )}
              {innerTab === "debug" && (
                <div className="flex flex-1 overflow-y-auto">
                  <BranchDebugContainer
                    repoPath={activeTab.repoPath}
                    branch={activeTab.branch}
                  />
                </div>
              )}
            </div>

            {/* Prompt bar — always visible above terminal */}
            <PromptBar onSubmit={handleSendToAgent} />

            {/* Terminal panel */}
            {isTerminalOpen && (
              <TerminalPanel
                ref={terminalRef}
                height={terminalHeight}
                tab={activeTab}
                workspace={activeWorkspace}
                onWorkspaceChange={(update) =>
                  handleWorkspaceChange(activeTab.id, update)
                }
                handleResizeStart={handleResizeStart}
                onToggle={() => handleSetTerminalOpen(activeTab.id, false)}
              />
            )}

            {!isTerminalOpen && (
              <button
                onClick={() => handleSetTerminalOpen(activeTab.id, true)}
                className="flex h-7 shrink-0 items-center gap-2 border-t border-border bg-bg-raised px-4 text-[11px] text-fg-subtle hover:text-fg-muted"
              >
                <span>▲ Terminal</span>
                <span className="text-fg-faint">⌘J</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
