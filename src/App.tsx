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
import { createStreamJsonParser } from "./features/chat/stream-json";
import type { PermissionRequest, AgentActivity } from "./features/chat/stream-json";
import type { PlanningMessage } from "./features/delta/PlanningChat";

interface PlanningSession {
  agentSessionId: string | null;
  messages: PlanningMessage[];
  pendingText: string;
  isStreaming: boolean;
  pendingPermission: PermissionRequest | null;
  agentActivity: string | null;
  streamingStartedAt: number | null;
}

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

  // Planning agent sessions per delta
  const [planSessions, setPlanSessions] = useState<Map<string, PlanningSession>>(() => new Map());
  const planSessionsRef = useRef(planSessions);
  planSessionsRef.current = planSessions;
  // Synchronous mapping: agentSessionId → deltaId (updated before React re-renders)
  const agentToDeltaRef = useRef<Map<string, string>>(new Map());
  // Keep a stream-json parser per active agent session
  const planParsersRef = useRef<Map<string, ReturnType<typeof createStreamJsonParser>>>(new Map());
  // Buffer for agent events that arrive before the invoke("agent_create") response
  // (race condition: Tauri emit can beat invoke response)
  const pendingAgentEventsRef = useRef<Map<string, Array<{ type: "output" | "done"; payload: unknown }>>>(new Map());

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

  // Handler for agent output events — extracted so it can be called for buffered events too
  const handleAgentOutput = useCallback((session_id: string, data: string) => {
    console.log(`[handleAgentOutput][${Date.now()}] session=${session_id}, data_len=${data.length}, data_preview=${data.slice(0, 120)}`);
    // Find which delta this agent session belongs to
    const deltaId = agentToDeltaRef.current.get(session_id);
    console.log(`[handleAgentOutput][${Date.now()}] deltaId lookup: ${deltaId ?? 'NOT FOUND'}, mapping size=${agentToDeltaRef.current.size}`);
    if (!deltaId) {
      // Buffer event — invoke("agent_create") response may not have arrived yet
      console.warn(`[agent-output][${Date.now()}] Buffering event for unmapped session ${session_id}`);
      const buf = pendingAgentEventsRef.current.get(session_id) ?? [];
      buf.push({ type: "output" as const, payload: { session_id, data } });
      pendingAgentEventsRef.current.set(session_id, buf);
      return;
    }

    // Get or create parser for this session
    let parser = planParsersRef.current.get(session_id);
    if (!parser) {
      const did = deltaId;
      parser = createStreamJsonParser(
        (req) => {
          console.log("[planning] permission request:", req);
          setPlanSessions((prev) => {
            const next = new Map(prev);
            const s = next.get(did);
            if (!s) return prev;
            next.set(did, { ...s, pendingPermission: req });
            return next;
          });
        },
        (activity: AgentActivity) => {
          console.log(`[planning] activity update: ${activity.description}`);
          setPlanSessions((prev) => {
            const next = new Map(prev);
            const s = next.get(did);
            if (!s) return prev;
            next.set(did, { ...s, agentActivity: activity.description });
            return next;
          });
        },
      );
      planParsersRef.current.set(session_id, parser);
    }

    const text = parser.feed(data + "\n");
    console.log(`[handleAgentOutput][${Date.now()}] parser.feed returned: ${text ? text.length + ' chars' : 'empty'}, text_preview=${(text || '').slice(0, 80)}`);
    if (text) {
      const did = deltaId;
      setPlanSessions((prev) => {
        const next = new Map(prev);
        const session = next.get(did);
        if (!session) return prev;
        next.set(did, {
          ...session,
          pendingText: session.pendingText + text,
        });
        return next;
      });
    }
  }, []);

  // Handler for agent done events — extracted so it can be called for buffered events too
  const handleAgentDone = useCallback((session_id: string, exit_code: number | null) => {
    console.log(`[handleAgentDone][${Date.now()}] session=${session_id}, exit_code=${exit_code}`);

    const deltaId = agentToDeltaRef.current.get(session_id);
    console.log(`[handleAgentDone][${Date.now()}] deltaId lookup: ${deltaId ?? 'NOT FOUND'}, mapping size=${agentToDeltaRef.current.size}`);
    if (!deltaId) {
      // Buffer — invoke("agent_create") response may not have arrived yet
      console.warn(`[agent-done][${Date.now()}] Buffering done event for unmapped session ${session_id}`);
      const buf = pendingAgentEventsRef.current.get(session_id) ?? [];
      buf.push({ type: "done" as const, payload: { session_id, exit_code } });
      pendingAgentEventsRef.current.set(session_id, buf);
      return;
    }

    // Clean up the mapping
    agentToDeltaRef.current.delete(session_id);

    // Clean up parser
    planParsersRef.current.delete(session_id);

    // Flush pending text as assistant message, or show error if no output
    const did = deltaId;
    setPlanSessions((prev) => {
      const next = new Map(prev);
      const session = next.get(did);
      if (!session) return prev;

      const content = session.pendingText.trim();
      const finalMessages = [...session.messages];

      if (content) {
        finalMessages.push({
          role: "assistant" as const,
          content,
          timestamp: Date.now(),
        });
      } else {
        // Agent exited with no output — show error
        finalMessages.push({
          role: "assistant" as const,
          content: "**Error:** The planning agent exited without producing output. This usually means Claude CLI failed to start. Check that `claude` is installed and your API key is set.",
          timestamp: Date.now(),
        });
      }

      next.set(did, {
        ...session,
        messages: finalMessages,
        pendingText: "",
        isStreaming: false,
        pendingPermission: null,
        agentSessionId: null,
        agentActivity: null,
        streamingStartedAt: null,
      });
      return next;
    });
  }, []);

  // Listen for planning agent output (agent-output / agent-done events)
  useEffect(() => {
    const unlistenOutput = listen<{ session_id: string; data: string }>(
      "agent-output",
      (event) => {
        const { session_id, data } = event.payload;

        // Log every event for debugging
        try {
          const parsed = JSON.parse(data);
          const type = parsed.type ?? "?";
          const subtype = parsed.subtype ?? "";
          console.log(`[agent-output] session=${session_id} type=${type}${subtype ? "/" + subtype : ""} len=${data.length}`);
        } catch {
          console.log(`[agent-output] session=${session_id} non-json len=${data.length}`);
        }

        handleAgentOutput(session_id, data);
      }
    );

    const unlistenDone = listen<{ session_id: string; exit_code: number | null }>(
      "agent-done",
      (event) => {
        const { session_id, exit_code } = event.payload;
        handleAgentDone(session_id, exit_code);
      }
    );

    return () => {
      unlistenOutput.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  }, [handleAgentOutput, handleAgentDone]);

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

  // Send a message to the planning agent for a delta
  const sendPlanningMessage = useCallback(
    async (deltaId: string, deltaName: string, repoPath: string, msg: string) => {
      console.log(`[planning][${Date.now()}] sendPlanningMessage called: deltaId=${deltaId}, deltaName=${deltaName}, repoPath=${repoPath}, msg=${msg.slice(0, 80)}`);

      if (!repoPath) {
        console.error("[planning] No repo path for delta:", deltaId);
        setPlanSessions((prev) => {
          const next = new Map(prev);
          next.set(deltaId, {
            agentSessionId: null,
            messages: [
              { role: "user" as const, content: msg, timestamp: Date.now() },
              { role: "assistant" as const, content: "**Error:** No repository path configured for this delta.", timestamp: Date.now() },
            ],
            pendingText: "",
            isStreaming: false,
            pendingPermission: null,
            agentActivity: null,
            streamingStartedAt: null,
          });
          return next;
        });
        return;
      }

      const session = planSessionsRef.current.get(deltaId) ?? {
        agentSessionId: null,
        messages: [],
        pendingText: "",
        isStreaming: false,
        pendingPermission: null,
        agentActivity: null,
        streamingStartedAt: null,
      };

      console.log(`[planning][${Date.now()}] existing session: isStreaming=${session.isStreaming}, agentSessionId=${session.agentSessionId}, messageCount=${session.messages.length}`);

      if (session.isStreaming) {
        console.warn(`[planning][${Date.now()}] Bailing — session is already streaming`);
        return;
      }

      const newMessages: PlanningMessage[] = [
        ...session.messages,
        { role: "user" as const, content: msg, timestamp: Date.now() },
      ];

      console.log(`[planning][${Date.now()}] Calling delta_workspace_path...`);
      const workspacePath = await invoke<string>("delta_workspace_path", { deltaId });
      console.log(`[planning][${Date.now()}] workspacePath=${workspacePath}`);
      const workingDir = repoPath;

      const isFirstMessage = session.messages.filter((m) => m.role === "user").length === 0;
      let prompt: string;
      if (isFirstMessage) {
        prompt = [
          "You are a planning agent helping design a software feature.",
          "Have a conversation with the user to understand what they want to build.",
          "Ask clarifying questions, propose approaches, and help refine the plan.",
          "",
          `IMPORTANT: As the plan takes shape, write it to: ${workspacePath}/plan.md`,
          "Update this file whenever decisions are made or the plan evolves.",
          "The plan should be a structured markdown document that other agents can use to implement the feature.",
          "",
          `Feature: ${deltaName}`,
          "",
          `User says: ${msg}`,
        ].join("\n");
      } else {
        prompt = msg;
      }

      const args = [
        "--verbose",
        "--output-format", "stream-json",
        "--model", "sonnet",
      ];
      if (!isFirstMessage) {
        args.push("--continue");
      }

      console.log(`[planning][${Date.now()}] About to invoke agent_create: workingDir=${workingDir}, command=claude-code, args=${JSON.stringify(args)}, isFirstMessage=${isFirstMessage}`);
      console.log(`[planning][${Date.now()}] prompt (first 200 chars): ${prompt.slice(0, 200)}`);

      try {
        const agentSessionId = await invoke<string>("agent_create", {
          workingDir,
          command: "claude-code",
          prompt,
          args,
          envVars: { DELTA_WORKSPACE: workspacePath },
        });

        console.log(`[planning][${Date.now()}] agent_create returned: agentSessionId=${agentSessionId}, delta=${deltaId}`);
        console.log(`[planning][${Date.now()}] Setting agentToDeltaRef mapping: ${agentSessionId} → ${deltaId}`);
        // Register mapping so event listeners can route events to this delta
        agentToDeltaRef.current.set(agentSessionId, deltaId);
        setPlanSessions((prev) => {
          const next = new Map(prev);
          next.set(deltaId, {
            agentSessionId,
            messages: newMessages,
            pendingText: "",
            isStreaming: true,
            pendingPermission: null,
            agentActivity: null,
            streamingStartedAt: Date.now(),
          });
          return next;
        });

        // Replay any events that arrived before the invoke response (race condition fix)
        const buffered = pendingAgentEventsRef.current.get(agentSessionId);
        console.log(`[planning][${Date.now()}] Checking buffer for ${agentSessionId}: ${buffered ? buffered.length + ' events' : 'none'}`);
        if (buffered && buffered.length > 0) {
          console.log(`[planning][${Date.now()}] Replaying ${buffered.length} buffered events for ${agentSessionId}`);
          pendingAgentEventsRef.current.delete(agentSessionId);
          for (const evt of buffered) {
            if (evt.type === "output") {
              const { session_id, data } = evt.payload as { session_id: string; data: string };
              handleAgentOutput(session_id, data);
            } else if (evt.type === "done") {
              const { session_id, exit_code } = evt.payload as { session_id: string; exit_code: number | null };
              handleAgentDone(session_id, exit_code);
            }
          }
        }
      } catch (err) {
        console.error(`[planning][${Date.now()}] agent_create FAILED:`, err);
        setPlanSessions((prev) => {
          const next = new Map(prev);
          next.set(deltaId, {
            agentSessionId: null,
            messages: [
              ...newMessages,
              {
                role: "assistant" as const,
                content: `**Error:** Failed to start planning agent: ${err}`,
                timestamp: Date.now(),
              },
            ],
            pendingText: "",
            isStreaming: false,
            pendingPermission: null,
            agentActivity: null,
            streamingStartedAt: null,
          });
          return next;
        });
      }
    },
    []
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
        <div className="flex h-full shrink-0 flex-col border-r border-border" style={{ width: sidebarWidth }}>
          {/* Sidebar mode toggle */}
          <div className="flex h-9 shrink-0 items-center border-b border-border bg-bg-raised">
            <button
              onClick={() => setSidebarMode("deltas")}
              className={`flex-1 flex items-center justify-center text-[10px] font-medium transition-colors rounded-md mx-1 my-1 ${sidebarMode === "deltas" ? "text-fg bg-bg-hover" : "text-fg-subtle hover:text-fg-muted"}`}
            >
              Deltas
            </button>
            <button
              onClick={() => setSidebarMode("repos")}
              className={`flex-1 flex items-center justify-center text-[10px] font-medium transition-colors rounded-md mx-1 my-1 ${sidebarMode === "repos" ? "text-fg bg-bg-hover" : "text-fg-subtle hover:text-fg-muted"}`}
            >
              Repos
            </button>
          </div>

          <div className={`flex flex-1 min-h-0 flex-col ${sidebarMode === "deltas" ? "" : "hidden"}`}>
            <DeltaSidebar
              activeDeltaId={activeDeltaId}
              onSelectDelta={setActiveDeltaId}
              onNewDelta={() => setShowCreateDelta(true)}
              width={sidebarWidth}
              onResizeStart={handleSidebarResizeStart}
              streamingDeltaIds={
                new Set(
                  Array.from(planSessions.entries())
                    .filter(([, s]) => s.isStreaming)
                    .map(([id]) => id)
                )
              }
            />
          </div>
          <div className={`flex flex-1 min-h-0 flex-col ${sidebarMode === "repos" ? "" : "hidden"}`}>
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
          </div>
        </div>

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Delta mode: show DeltaSplitView directly, no TabBar/inner tabs */}
          {activeDelta && sidebarMode === "deltas" ? (
            <div className="flex flex-1 overflow-hidden bg-bg">
              <DeltaSplitView
                  delta={activeDelta}
                  events={[
                    ...(deltaEvents ?? []),
                    ...(deltaLocalMessages.get(activeDeltaId ?? "") ?? []),
                  ].sort((a, b) => a.timestamp - b.timestamp)}
                  tasks={deltaTasks ?? []}
                  dag={deltaDag ?? null}
                  plan={deltaPlan ?? ""}
                  planningMessages={planSessions.get(activeDeltaId ?? "")?.messages ?? []}
                  planningPendingText={planSessions.get(activeDeltaId ?? "")?.pendingText ?? ""}
                  planningIsStreaming={planSessions.get(activeDeltaId ?? "")?.isStreaming ?? false}
                  agentActivity={planSessions.get(activeDeltaId ?? "")?.agentActivity ?? null}
                  streamingStartedAt={planSessions.get(activeDeltaId ?? "")?.streamingStartedAt ?? null}
                  pendingPermission={planSessions.get(activeDeltaId ?? "")?.pendingPermission ?? null}
                  onPermissionResponse={(requestId, allow) => {
                    if (!activeDeltaId) return;
                    const session = planSessionsRef.current.get(activeDeltaId);
                    if (!session?.agentSessionId) return;
                    const response = allow
                      ? JSON.stringify({
                          type: "control_response",
                          request_id: requestId,
                          response: {
                            subtype: "success",
                            response: {
                              behavior: "allow",
                              updatedInput: session.pendingPermission?.input ?? {},
                            },
                          },
                        })
                      : JSON.stringify({
                          type: "control_response",
                          request_id: requestId,
                          response: {
                            subtype: "success",
                            response: {
                              behavior: "deny",
                              message: "User denied this action",
                            },
                          },
                        });
                    invoke("agent_write", {
                      sessionId: session.agentSessionId,
                      data: response,
                    }).catch(console.error);
                    // Clear the pending permission
                    setPlanSessions((prev) => {
                      const next = new Map(prev);
                      const s = next.get(activeDeltaId);
                      if (!s) return prev;
                      next.set(activeDeltaId, { ...s, pendingPermission: null });
                      return next;
                    });
                  }}
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
                  onSendMessage={async (msg) => {
                    console.log(`[onSendMessage][${Date.now()}] msg=${msg.slice(0, 80)}, activeDeltaId=${activeDeltaId}, status=${activeDelta?.status}, repoPath=${activeDelta?.repos[0]?.path}`);
                    if (!activeDeltaId || !activeDelta) return;

                    if (activeDelta.status === "planning") {
                      console.log(`[onSendMessage][${Date.now()}] Calling sendPlanningMessage...`);
                      sendPlanningMessage(
                        activeDeltaId,
                        activeDelta.name,
                        activeDelta.repos[0]?.path ?? "",
                        msg
                      );
                    } else {
                      // Non-planning mode: add to local messages
                      const userMsg = {
                        type: "user_message" as const,
                        message: msg,
                        timestamp: Date.now(),
                      };
                      setDeltaLocalMessages((prev) => {
                        const next = new Map(prev);
                        const existing = next.get(activeDeltaId) ?? [];
                        next.set(activeDeltaId, [...existing, userMsg]);
                        return next;
                      });
                    }
                  }}
                  onStopAgent={() => {
                    if (!activeDeltaId) return;
                    const session = planSessionsRef.current.get(activeDeltaId);
                    if (!session?.agentSessionId) return;
                    const agentId = session.agentSessionId;
                    invoke("agent_destroy", { sessionId: agentId }).catch(console.error);
                    // Clean up refs
                    agentToDeltaRef.current.delete(agentId);
                    planParsersRef.current.delete(agentId);
                    // Flush pending text as message and stop streaming
                    setPlanSessions((prev) => {
                      const next = new Map(prev);
                      const s = next.get(activeDeltaId);
                      if (!s) return prev;
                      const finalMessages = [...s.messages];
                      const content = s.pendingText.trim();
                      if (content) {
                        finalMessages.push({
                          role: "assistant" as const,
                          content,
                          timestamp: Date.now(),
                        });
                      }
                      next.set(activeDeltaId, {
                        ...s,
                        agentSessionId: null,
                        messages: finalMessages,
                        pendingText: "",
                        isStreaming: false,
                        pendingPermission: null,
                        agentActivity: null,
                        streamingStartedAt: null,
                      });
                      return next;
                    });
                  }}
                />
            </div>
          ) : (
            <>
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
                <div className="flex gap-1 border-b border-border-subtle bg-bg px-4 py-2">
                  {(["chat", "checkpoints", "diff", "insights", "debug"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setInnerTab(tab)}
                      className={`px-3 py-1 text-xs font-medium capitalize transition-colors rounded-md ${innerTab === tab
                        ? "bg-bg-hover text-fg"
                        : "text-fg-subtle hover:text-fg-muted"
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
                    <>
                      {/* Render one terminal per tab with a PTY — keep mounted, show/hide via CSS */}
                      {Array.from(chatPtySessions.entries()).map(([tabId, ptySessionId]) => (
                        <div
                          key={tabId}
                          className="flex flex-1 overflow-hidden"
                          style={{
                            display: tabId === activeTabId ? "flex" : "none",
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
                                  className={`px-3 py-1 text-[11px] font-medium capitalize transition-colors rounded-md ${checkpointInnerTab === tab
                                    ? "bg-bg-hover text-fg"
                                    : "text-fg-subtle hover:text-fg-muted"
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
            </>
          )}
        </div>
      </div>
      <DeltaCreationModal
        open={showCreateDelta}
        onClose={() => setShowCreateDelta(false)}
        onCreated={async (id, description) => {
          setActiveDeltaId(id);
          setSidebarMode("deltas");
          setInnerTab("chat");
          // Auto-send the description as the first planning message
          if (description) {
            const delta = await invoke<{ name: string; repos: Array<{ path: string }> }>(
              "delta_get",
              { deltaId: id }
            );
            const repoPath = delta.repos[0]?.path ?? "";
            sendPlanningMessage(id, delta.name, repoPath, description);
          }
        }}
      />
    </div>
  );
}
