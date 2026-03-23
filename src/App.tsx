import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { Sidebar } from "./features/repos/Sidebar";
import { useReposQuery } from "./hooks/use-tauri-query";
import { TitleBar } from "./components/TitleBar";
import { TabBar } from "./components/TabBar";
import { DeltaSidebar } from "./features/delta/DeltaSidebar";
import { DeltaCreationModal } from "./features/delta/DeltaCreationModal";
import { DeltaSplitView } from "./features/delta/DeltaSplitView";
import {
  useDeltaQuery,
  useDeltaPlanQuery,
  useDeltaDAGQuery,
  useDeltaTasksQuery,
  useDeltaEventsQuery,
  useUpdateDeltaPlanMutation,
} from "./hooks/use-delta-query";
import { CheckpointList } from "./features/checkpoints/CheckpointList";
import { TranscriptView } from "./features/transcripts/TranscriptView";
import { DiffView, BranchDiffView } from "./features/diff/DiffView";
import { CheckpointInsightsContainer } from "./features/insights/CheckpointInsightsContainer";
import { BranchInsightsContainer } from "./features/insights/BranchInsightsContainer";
import { BranchDebugContainer } from "./features/debug/BranchDebugContainer";
import { CheckpointDebugContainer } from "./features/debug/CheckpointDebugContainer";
import { XtermTerminal } from "./features/terminal/XtermTerminal";
import { createBranchTab, createWorktreeTab } from "./features/repos/tab-state";
import { DEFAULT_SIDEBAR_WIDTH, clampSidebarWidth } from "./features/repos/sidebar-width.ts";
import { planWorktreeDeletionCleanup } from "./features/repos/worktree-delete-state.ts";
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
  const [innerTab, setInnerTab] = useState<
    "chat" | "checkpoints" | "diff" | "insights" | "debug"
  >("chat");
  const [selectedCheckpoint, setSelectedCheckpoint] =
    useState<CheckpointSummary | null>(null);
  const [checkpointInnerTab, setCheckpointInnerTab] = useState<
    "transcript" | "diff" | "insights" | "debug"
  >("transcript");

  // Delta state
  const [sidebarMode, setSidebarMode] = useState<"deltas" | "repos">("repos");
  const [activeDeltaId, setActiveDeltaId] = useState<string | null>(null);
  const [showCreateDelta, setShowCreateDelta] = useState(false);
  const [deltaLocalMessages, setDeltaLocalMessages] = useState<
    Map<string, Array<{ type: "user_message"; message: string; timestamp: number }>>
  >(() => new Map());

  // Maps tab ID → PTY session ID for the chat terminal
  const [chatPtySessions, setChatPtySessions] = useState<Map<string, string>>(
    () => new Map()
  );
  const chatPtySessionsRef = useRef(chatPtySessions);
  chatPtySessionsRef.current = chatPtySessions;

  // Track which tabs are actively producing PTY output ("busy")
  const [busyTabIds, setBusyTabIds] = useState<Set<string>>(() => new Set());
  const busyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Global pty-output listener to detect tab activity
  useEffect(() => {
    const unlisten = listen<{ session_id: string; data: string }>("pty-output", (event) => {
      const sessionId = event.payload.session_id;
      // Reverse-map session_id → tabId
      const sessions = chatPtySessionsRef.current;
      let tabId: string | null = null;
      for (const [tid, sid] of sessions.entries()) {
        if (sid === sessionId) { tabId = tid; break; }
      }
      if (!tabId) return;

      const tid = tabId; // capture for closures
      setBusyTabIds((prev) => {
        if (prev.has(tid)) return prev;
        const next = new Set(prev);
        next.add(tid);
        return next;
      });

      // Reset the idle timer for this tab
      const existing = busyTimersRef.current.get(tid);
      if (existing) clearTimeout(existing);
      busyTimersRef.current.set(
        tid,
        setTimeout(() => {
          setBusyTabIds((prev) => {
            if (!prev.has(tid)) return prev;
            const next = new Set(prev);
            next.delete(tid);
            return next;
          });
          busyTimersRef.current.delete(tid);
        }, 3000)
      );
    });

    return () => {
      unlisten.then((fn) => fn());
      // Clear all timers
      for (const timer of busyTimersRef.current.values()) clearTimeout(timer);
      busyTimersRef.current.clear();
    };
  }, []);

  // Load repos so we can auto-populate the initial tab
  const queryClient = useQueryClient();
  const { data: repos } = useReposQuery();

  // Auto-populate the initial tab's repoPath from the first discovered repo
  useEffect(() => {
    if (!repos || repos.length === 0) return;
    setTabs((prev) => {
      const updated = prev.map((tab) => {
        if (tab.id === "main" && !tab.repoPath) {
          const repo = repos[0];
          const headBranch = repo.branches.find((b: { is_head: boolean }) => b.is_head);
          return {
            ...tab,
            repoPath: repo.path,
            branch: headBranch?.name ?? repo.branches[0]?.name ?? "main",
          };
        }
        return tab;
      });
      return updated;
    });
  }, [repos]);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const tabsWithSessions = tabs.map((tab) => ({
    ...tab,
    hasActiveSession: chatPtySessions.has(tab.id),
  }));

  // Live updates — watch active repo for checkpoint/session changes
  useLiveUpdates(activeTab.repoPath);

  // Delta queries (conditionally fetched)
  const { data: activeDelta } = useDeltaQuery(activeDeltaId);
  const { data: deltaPlan } = useDeltaPlanQuery(activeDeltaId);
  const { data: deltaDag } = useDeltaDAGQuery(activeDeltaId);
  const { data: deltaTasks } = useDeltaTasksQuery(activeDeltaId);
  const { data: deltaEvents } = useDeltaEventsQuery(activeDeltaId);
  const updatePlanMutation = useUpdateDeltaPlanMutation();

  // Listen for delta events and refresh queries
  useEffect(() => {
    if (!activeDeltaId) return;

    const unlistenEvent = listen<{ delta_id: string }>("delta-event", (event) => {
      if (event.payload.delta_id === activeDeltaId) {
        queryClient.invalidateQueries({ queryKey: ["delta-events", activeDeltaId] });
        queryClient.invalidateQueries({ queryKey: ["delta-tasks", activeDeltaId] });
        queryClient.invalidateQueries({ queryKey: ["delta-plan", activeDeltaId] });
      }
    });

    return () => {
      unlistenEvent.then((fn) => fn());
    };
  }, [activeDeltaId, queryClient]);

  // Auto-spawn a PTY shell when the Chat tab is active and no session exists
  useEffect(() => {
    if (innerTab !== "chat") return;
    if (!activeTab.repoPath) return;
    if (chatPtySessionsRef.current.has(activeTabId)) return;

    // Spawn a shell PTY for this tab
    invoke<string>("pty_create", {
      workingDir: activeTab.repoPath,
    })
      .then((sessionId) => {
        setChatPtySessions((prev) => {
          const next = new Map(prev);
          next.set(activeTabId, sessionId);
          return next;
        });
      })
      .catch((err) => {
        console.error("[chat] pty_create FAILED:", err);
      });
  }, [innerTab, activeTabId, activeTab.repoPath]);

  // Agent dispatch — spawn Claude in a PTY for the Chat tab
  const handleSendToAgent = useCallback(
    async (agent: string, prompt: string) => {
      if (!activeTab.repoPath) return;

      const resolvedAgent = resolveAgent(agent);

      // If current tab already has a PTY, write the prompt to it
      const existingPty = chatPtySessionsRef.current.get(activeTabId);
      if (existingPty && prompt) {
        setInnerTab("chat");
        await invoke("pty_write", {
          sessionId: existingPty,
          data: prompt + "\n",
        }).catch(console.error);
        return;
      }

      // Create a new agent tab
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

      // Spawn a PTY running the agent
      try {
        const sessionId = await invoke<string>("pty_create", {
          workingDir: activeTab.repoPath,
          command: resolvedAgent,
          initialInput: prompt ? prompt + "\n" : undefined,
        });
        setChatPtySessions((prev) => {
          const next = new Map(prev);
          next.set(tabId, sessionId);
          return next;
        });
      } catch (err) {
        console.error("[chat] pty_create FAILED:", err);
      }
    },
    [activeTab, activeTabId]
  );

  // Parallel agent — creates a dedicated worktree, then spawns the agent in it
  const handleSpawnParallelAgent = useCallback(
    async (agent: string) => {
      if (!activeTab.repoPath) return;

      const resolvedAgent = resolveAgent(agent);

      // Create a worktree with auto-generated branch
      try {
        const { branch, worktree_path } = await invoke<{
          branch: string;
          worktree_path: string;
        }>("create_agent_worktree", {
          repoPath: activeTab.repoPath,
          agent: resolvedAgent,
        });

        const tabId = `agent:${resolvedAgent}:${Date.now()}`;
        const agentTab: Tab = {
          id: tabId,
          branch,
          repoPath: worktree_path,
          worktree: { path: worktree_path, branch, is_main: false },
          kind: "agent",
          agent: resolvedAgent,
          hasActiveSession: false,
        };
        setTabs((prev) => [...prev, agentTab]);
        setActiveTabId(tabId);
        setInnerTab("chat");

        // Refresh sidebar to show the new worktree
        queryClient.invalidateQueries({ queryKey: ["repos"] });

        // Spawn the agent PTY in the worktree directory
        const sessionId = await invoke<string>("pty_create", {
          workingDir: worktree_path,
          command: resolvedAgent,
        });
        setChatPtySessions((prev) => {
          const next = new Map(prev);
          next.set(tabId, sessionId);
          return next;
        });
      } catch (err) {
        console.error("[parallel-agent] Failed:", err);
      }
    },
    [activeTab]
  );

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
  }, [activeTabId, tabs, selectedCheckpoint]);

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
    // Destroy the chat PTY session for this tab
    const chatPtyId = chatPtySessionsRef.current.get(tabId);
    if (chatPtyId) {
      invoke("pty_destroy", { sessionId: chatPtyId }).catch(console.error);
    }
    setChatPtySessions((prev) => {
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

    if (tabsToRemove.length === 0) return;

    const nextTabs = tabs.filter((tab) => !tabsToRemove.some((candidate) => candidate.id === tab.id));
    setTabs(nextTabs);

    if (tabsToRemove.some((tab) => tab.id === activeTabId) && nextTabs.length > 0) {
      setActiveTabId(nextTabs[0].id);
    }

    setChatPtySessions((prev) => {
      const next = new Map(prev);
      for (const tab of tabsToRemove) {
        const ptyId = next.get(tab.id);
        if (ptyId) {
          invoke("pty_destroy", { sessionId: ptyId }).catch(console.error);
          next.delete(tab.id);
        }
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

    if (cleanup.removedTabIds.length === 0) return;

    setTabs(cleanup.remainingTabs);

    if (cleanup.nextActiveTabId && cleanup.nextActiveTabId !== activeTabId) {
      setActiveTabId(cleanup.nextActiveTabId);
    }

    setChatPtySessions((prev) => {
      const next = new Map(prev);
      for (const tabId of cleanup.removedTabIds) {
        const ptyId = next.get(tabId);
        if (ptyId) {
          invoke("pty_destroy", { sessionId: ptyId }).catch(console.error);
          next.delete(tabId);
        }
      }
      return next;
    });
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
        {/* Sidebar with toggle */}
        <div className="flex h-full shrink-0 flex-col" style={{ width: sidebarWidth }}>
          {/* Sidebar mode toggle */}
          <div className="flex border-b border-border-subtle bg-bg-raised">
            <button
              onClick={() => setSidebarMode("deltas")}
              className={`flex-1 py-1.5 text-[10px] font-medium transition-colors ${sidebarMode === "deltas" ? "text-fg border-b-2 border-accent" : "text-fg-subtle hover:text-fg-muted"}`}
            >
              Deltas
            </button>
            <button
              onClick={() => setSidebarMode("repos")}
              className={`flex-1 py-1.5 text-[10px] font-medium transition-colors ${sidebarMode === "repos" ? "text-fg border-b-2 border-accent" : "text-fg-subtle hover:text-fg-muted"}`}
            >
              Repos
            </button>
          </div>

          {sidebarMode === "deltas" ? (
            <DeltaSidebar
              activeDeltaId={activeDeltaId}
              onSelectDelta={setActiveDeltaId}
              onNewDelta={() => setShowCreateDelta(true)}
              width={sidebarWidth}
              onResizeStart={handleSidebarResizeStart}
            />
          ) : (
            <Sidebar
              activeTab={activeTab}
              width={sidebarWidth}
              busyTabIds={busyTabIds}
              tabs={tabs}
              onBranchSelect={handleBranchSelect}
              onBranchDeleted={handleBranchDeleted}
              onWorktreeDeleted={handleWorktreeDeleted}
              onWorktreeSelect={handleWorktreeSelect}
              onResizeStart={handleSidebarResizeStart}
            />
          )}
        </div>

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <TabBar
            tabs={tabsWithSessions}
            activeTabId={activeTabId}
            busyTabIds={busyTabIds}
            onSelectTab={setActiveTabId}
            onCloseTab={handleCloseTab}
            onAddAgentTab={(agent) => handleSendToAgent(agent, "")}
            onAddParallelAgent={handleSpawnParallelAgent}
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
              {/* Delta split view when in delta mode */}
              {innerTab === "chat" && activeDelta && sidebarMode === "deltas" ? (
                <DeltaSplitView
                  delta={activeDelta}
                  events={[
                    ...(deltaEvents ?? []),
                    ...(deltaLocalMessages.get(activeDeltaId ?? "") ?? []),
                  ].sort((a, b) => a.timestamp - b.timestamp)}
                  tasks={deltaTasks ?? []}
                  dag={deltaDag ?? null}
                  plan={deltaPlan ?? ""}
                  onAnswerQuestion={(qId, answer, taskId) => {
                    invoke("delta_answer_question", { deltaId: activeDeltaId, questionId: qId, answer, taskId });
                  }}
                  onApprovePlan={() => {
                    invoke("delta_approve_plan", { deltaId: activeDeltaId });
                  }}
                  onUpdatePlan={(content) => {
                    if (activeDeltaId) {
                      updatePlanMutation.mutate({ deltaId: activeDeltaId, content });
                    }
                  }}
                  onSendMessage={(msg) => {
                    if (!activeDeltaId) return;
                    // Add to local messages so it appears immediately
                    const userMsg = { type: "user_message" as const, message: msg, timestamp: Date.now() };
                    setDeltaLocalMessages((prev) => {
                      const next = new Map(prev);
                      const existing = next.get(activeDeltaId) ?? [];
                      next.set(activeDeltaId, [...existing, userMsg]);
                      return next;
                    });
                    // During planning, append to the plan content
                    if (activeDelta?.status === "planning") {
                      const current = deltaPlan ?? "";
                      const updated = current ? `${current}\n\n${msg}` : msg;
                      updatePlanMutation.mutate({ deltaId: activeDeltaId, content: updated });
                    }
                  }}
                />
              ) : (
                <>
                  {/* Render one terminal per tab with a PTY — keep mounted, show/hide via CSS */}
                  {Array.from(chatPtySessions.entries()).map(([tabId, ptySessionId]) => (
                    <div
                      key={tabId}
                      className="flex flex-1 overflow-hidden"
                      style={{
                        display: innerTab === "chat" && tabId === activeTabId ? "flex" : "none",
                      }}
                    >
                      <XtermTerminal sessionId={ptySessionId} />
                    </div>
                  ))}
                </>
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
                        <span className="truncate text-xs font-medium text-fg">
                          {selectedCheckpoint.commit_message || "Untitled"}
                        </span>
                        <span className="font-mono text-xs text-fg-subtle">
                          {selectedCheckpoint.commit_sha
                            ? selectedCheckpoint.commit_sha.slice(0, 7)
                            : selectedCheckpoint.checkpoint_id.slice(0, 7)}
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
          </div>
        </div>
      </div>
      <DeltaCreationModal
        open={showCreateDelta}
        onClose={() => setShowCreateDelta(false)}
        onCreated={(id) => {
          setActiveDeltaId(id);
          setSidebarMode("deltas");
          setInnerTab("chat");
        }}
      />
    </div>
  );
}
