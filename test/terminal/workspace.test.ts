import assert from "node:assert/strict";
import test from "node:test";
import {
  clearPaneAutoLaunch,
  collectWorkspaceSurfaceIds,
  closePaneInTerminalTab,
  closeTerminalTabInWorkspace,
  createTerminalTabInWorkspace,
  createTerminalWorkspace,
  resolveAutoLaunchTarget,
  resolveAgentLaunchTarget,
  setActivePaneInTerminalTab,
  setActiveTerminalTabInWorkspace,
  setPaneSession,
  splitActivePaneInTerminalTab,
} from "../../src/features/terminal/workspace.ts";

test("creates an initial terminal tab with one active pane", () => {
  const workspace = createTerminalWorkspace();

  assert.equal(workspace.terminalTabs.length, 1);
  assert.equal(workspace.activeTerminalTabId, workspace.terminalTabs[0].id);
  assert.equal(workspace.terminalTabs[0].panes.length, 1);
  assert.equal(workspace.terminalTabs[0].splitDirection, null);
  assert.equal(workspace.terminalTabs[0].panes[0].shouldAutoLaunch, true);
});

test("creates a new active terminal tab", () => {
  const workspace = createTerminalWorkspace();
  const next = createTerminalTabInWorkspace(workspace);

  assert.equal(next.terminalTabs.length, 2);
  assert.equal(next.activeTerminalTabId, next.terminalTabs[1].id);
  assert.equal(next.terminalTabs[1].panes.length, 1);
  assert.equal(next.terminalTabs[1].panes[0].shouldAutoLaunch, true);
});

test("switches the active terminal tab", () => {
  const workspace = createTerminalTabInWorkspace(createTerminalWorkspace());
  const next = setActiveTerminalTabInWorkspace(
    workspace,
    workspace.terminalTabs[0].id
  );

  assert.equal(next.activeTerminalTabId, workspace.terminalTabs[0].id);
});

test("splits the active pane into two independent panes", () => {
  const workspace = createTerminalWorkspace();

  const next = splitActivePaneInTerminalTab(
    workspace,
    workspace.activeTerminalTabId!,
    "vertical"
  );

  assert.equal(next.terminalTabs[0].splitDirection, "vertical");
  assert.equal(next.terminalTabs[0].panes.length, 2);
  assert.equal(next.terminalTabs[0].activePaneId, next.terminalTabs[0].panes[1].id);
  assert.equal(next.terminalTabs[0].panes[1].shouldAutoLaunch, true);
});

test("collapses back to one pane when a split pane is closed", () => {
  const workspace = createTerminalWorkspace();
  const splitWorkspace = splitActivePaneInTerminalTab(
    workspace,
    workspace.activeTerminalTabId!,
    "horizontal"
  );
  const tab = splitWorkspace.terminalTabs[0];

  const next = closePaneInTerminalTab(splitWorkspace, tab.id, tab.panes[1].id);

  assert.equal(next.terminalTabs[0].splitDirection, null);
  assert.equal(next.terminalTabs[0].panes.length, 1);
});

test("switches the active pane within a split terminal tab", () => {
  const baseWorkspace = createTerminalWorkspace();
  const workspace = splitActivePaneInTerminalTab(
    baseWorkspace,
    baseWorkspace.activeTerminalTabId!,
    "vertical"
  );
  const tab = workspace.terminalTabs[0];
  const next = setActivePaneInTerminalTab(workspace, tab.id, tab.panes[0].id);

  assert.equal(next.terminalTabs[0].activePaneId, tab.panes[0].id);
});

test("closing the active terminal tab selects a neighbor", () => {
  const workspace = createTerminalTabInWorkspace(createTerminalWorkspace());
  const next = closeTerminalTabInWorkspace(workspace, workspace.terminalTabs[1].id);

  assert.equal(next.terminalTabs.length, 1);
  assert.equal(next.activeTerminalTabId, next.terminalTabs[0].id);
});

test("closing the last terminal tab leaves a fresh empty tab", () => {
  const workspace = createTerminalWorkspace();
  const next = closeTerminalTabInWorkspace(
    workspace,
    workspace.activeTerminalTabId!
  );

  assert.equal(next.terminalTabs.length, 1);
  assert.equal(next.terminalTabs[0].panes.length, 1);
  assert.equal(next.terminalTabs[0].panes[0].session, null);
  assert.equal(next.terminalTabs[0].panes[0].shouldAutoLaunch, true);
});

test("resolves the initial pane for auto-launch", () => {
  const workspace = createTerminalWorkspace();

  assert.deepEqual(resolveAutoLaunchTarget(workspace), {
    terminalTabId: workspace.activeTerminalTabId,
    paneId: workspace.terminalTabs[0].activePaneId,
  });
});

test("clearing auto-launch suppresses automatic startup for that pane", () => {
  const workspace = createTerminalWorkspace();
  const next = clearPaneAutoLaunch(
    workspace,
    workspace.activeTerminalTabId!,
    workspace.terminalTabs[0].activePaneId
  );

  assert.equal(resolveAutoLaunchTarget(next), null);
});

test("collects every live surface id in the workspace", () => {
  let workspace = createTerminalWorkspace();
  const tabId = workspace.activeTerminalTabId!;
  const paneId = workspace.terminalTabs[0].activePaneId;

  workspace = setPaneSession(workspace, tabId, paneId, {
    id: "surface-1",
    agent: "terminal",
    label: "Terminal - main",
  });

  workspace = splitActivePaneInTerminalTab(workspace, tabId, "vertical");
  workspace = setPaneSession(
    workspace,
    tabId,
    workspace.terminalTabs[0].activePaneId,
    {
      id: "surface-2",
      agent: "codex",
      label: "Codex - main",
    }
  );

  assert.deepEqual(collectWorkspaceSurfaceIds(workspace), ["surface-1", "surface-2"]);
});

test("routes an agent launch to a new terminal tab when the active pane is already occupied", () => {
  let workspace = createTerminalWorkspace();
  const tabId = workspace.activeTerminalTabId!;
  const paneId = workspace.terminalTabs[0].activePaneId;

  workspace = setPaneSession(workspace, tabId, paneId, {
    id: "surface-1",
    agent: "terminal",
    label: "Terminal - main",
  });

  const target = resolveAgentLaunchTarget(workspace);

  assert.deepEqual(target, { mode: "create-terminal-tab" });
});

test("reuses the active pane for an agent launch when it is empty", () => {
  const workspace = createTerminalWorkspace();

  assert.deepEqual(resolveAgentLaunchTarget(workspace), {
    mode: "reuse-active-pane",
    terminalTabId: workspace.activeTerminalTabId,
    paneId: workspace.terminalTabs[0].activePaneId,
  });
});
