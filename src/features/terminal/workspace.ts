import type { TermSession } from "./TerminalPanel";

export type SplitDirection = "horizontal" | "vertical";

export interface TerminalPaneState {
  id: string;
  session: TermSession | null;
  shouldAutoLaunch: boolean;
}

export interface TerminalTabState {
  id: string;
  title: string;
  activePaneId: string;
  splitDirection: SplitDirection | null;
  panes: TerminalPaneState[];
}

export interface TerminalWorkspace {
  terminalTabs: TerminalTabState[];
  activeTerminalTabId: string | null;
}

export type WorkspaceUpdate =
  | TerminalWorkspace
  | ((workspace: TerminalWorkspace) => TerminalWorkspace);

type AgentLaunchTarget =
  | { mode: "create-terminal-tab" }
  | { mode: "reuse-active-pane"; terminalTabId: string; paneId: string };

type AutoLaunchTarget = { terminalTabId: string; paneId: string };

let nextId = 0;

function makeId(prefix: string) {
  nextId += 1;
  return `${prefix}:${nextId}`;
}

function createEmptyPane(): TerminalPaneState {
  return { id: makeId("pane"), session: null, shouldAutoLaunch: true };
}

function createEmptyTerminalTab(index: number, branchName?: string): TerminalTabState {
  const pane = createEmptyPane();
  return {
    id: makeId("terminal-tab"),
    title: branchName ?? `Terminal ${index}`,
    activePaneId: pane.id,
    splitDirection: null,
    panes: [pane],
  };
}

function updateTerminalTab(
  workspace: TerminalWorkspace,
  terminalTabId: string,
  update: (terminalTab: TerminalTabState) => TerminalTabState
): TerminalWorkspace {
  return {
    ...workspace,
    terminalTabs: workspace.terminalTabs.map((terminalTab) =>
      terminalTab.id === terminalTabId ? update(terminalTab) : terminalTab
    ),
  };
}

export function createTerminalWorkspace(): TerminalWorkspace {
  const terminalTab = createEmptyTerminalTab(1);
  return {
    terminalTabs: [terminalTab],
    activeTerminalTabId: terminalTab.id,
  };
}

export function createTerminalTabInWorkspace(
  workspace: TerminalWorkspace
): TerminalWorkspace {
  const terminalTab = createEmptyTerminalTab(workspace.terminalTabs.length + 1);
  return {
    terminalTabs: [...workspace.terminalTabs, terminalTab],
    activeTerminalTabId: terminalTab.id,
  };
}

export function setActiveTerminalTabInWorkspace(
  workspace: TerminalWorkspace,
  terminalTabId: string
): TerminalWorkspace {
  if (!workspace.terminalTabs.some((terminalTab) => terminalTab.id === terminalTabId)) {
    return workspace;
  }

  return {
    ...workspace,
    activeTerminalTabId: terminalTabId,
  };
}

export function splitActivePaneInTerminalTab(
  workspace: TerminalWorkspace,
  terminalTabId: string,
  direction: SplitDirection
): TerminalWorkspace {
  return updateTerminalTab(workspace, terminalTabId, (terminalTab) => {
    if (terminalTab.panes.length > 1) return terminalTab;

    const pane = createEmptyPane();
    return {
      ...terminalTab,
      splitDirection: direction,
      activePaneId: pane.id,
      panes: [...terminalTab.panes, pane],
    };
  });
}

export function setActivePaneInTerminalTab(
  workspace: TerminalWorkspace,
  terminalTabId: string,
  paneId: string
): TerminalWorkspace {
  return updateTerminalTab(workspace, terminalTabId, (terminalTab) => {
    if (!terminalTab.panes.some((pane) => pane.id === paneId)) {
      return terminalTab;
    }

    return {
      ...terminalTab,
      activePaneId: paneId,
    };
  });
}

export function closePaneInTerminalTab(
  workspace: TerminalWorkspace,
  terminalTabId: string,
  paneId: string
): TerminalWorkspace {
  return updateTerminalTab(workspace, terminalTabId, (terminalTab) => {
    if (terminalTab.panes.length === 1) return terminalTab;

    const panes = terminalTab.panes.filter((pane) => pane.id !== paneId);
    return {
      ...terminalTab,
      splitDirection: null,
      activePaneId: panes[0]?.id ?? terminalTab.activePaneId,
      panes,
    };
  });
}

export function closeTerminalTabInWorkspace(
  workspace: TerminalWorkspace,
  terminalTabId: string
): TerminalWorkspace {
  const terminalTabs = workspace.terminalTabs.filter(
    (terminalTab) => terminalTab.id !== terminalTabId
  );

  if (terminalTabs.length === 0) {
    return createTerminalWorkspace();
  }

  const activeTerminalTabId =
    workspace.activeTerminalTabId === terminalTabId
      ? terminalTabs[Math.max(0, workspace.terminalTabs.findIndex(
          (terminalTab) => terminalTab.id === terminalTabId
        ) - 1)]?.id ?? terminalTabs[0].id
      : workspace.activeTerminalTabId;

  return {
    terminalTabs,
    activeTerminalTabId,
  };
}

export function setPaneSession(
  workspace: TerminalWorkspace,
  terminalTabId: string,
  paneId: string,
  session: TermSession | null
): TerminalWorkspace {
  return updateTerminalTab(workspace, terminalTabId, (terminalTab) => ({
    ...terminalTab,
    panes: terminalTab.panes.map((pane) =>
      pane.id === paneId
        ? {
            ...pane,
            session,
            shouldAutoLaunch: session ? false : pane.shouldAutoLaunch,
          }
        : pane
    ),
  }));
}

export function clearPaneAutoLaunch(
  workspace: TerminalWorkspace,
  terminalTabId: string,
  paneId: string
): TerminalWorkspace {
  return updateTerminalTab(workspace, terminalTabId, (terminalTab) => ({
    ...terminalTab,
    panes: terminalTab.panes.map((pane) =>
      pane.id === paneId ? { ...pane, shouldAutoLaunch: false } : pane
    ),
  }));
}

export function collectWorkspaceSurfaceIds(
  workspace: TerminalWorkspace | null | undefined
): string[] {
  if (!workspace) return [];

  return workspace.terminalTabs.flatMap((terminalTab) =>
    terminalTab.panes.flatMap((pane) => (pane.session ? [pane.session.id] : []))
  );
}

export function resolveAgentLaunchTarget(
  workspace: TerminalWorkspace
): AgentLaunchTarget {
  const activeTerminalTab = workspace.terminalTabs.find(
    (terminalTab) => terminalTab.id === workspace.activeTerminalTabId
  );
  const activePane = activeTerminalTab?.panes.find(
    (pane) => pane.id === activeTerminalTab.activePaneId
  );

  if (!activeTerminalTab || !activePane || activePane.session) {
    return { mode: "create-terminal-tab" };
  }

  return {
    mode: "reuse-active-pane",
    terminalTabId: activeTerminalTab.id,
    paneId: activePane.id,
  };
}

export function resolveAutoLaunchTarget(
  workspace: TerminalWorkspace
): AutoLaunchTarget | null {
  const activeTerminalTab = workspace.terminalTabs.find(
    (terminalTab) => terminalTab.id === workspace.activeTerminalTabId
  );
  const pane = activeTerminalTab?.panes.find(
    (candidate) => candidate.shouldAutoLaunch && !candidate.session
  );

  if (!activeTerminalTab || !pane) {
    return null;
  }

  return {
    terminalTabId: activeTerminalTab.id,
    paneId: pane.id,
  };
}
