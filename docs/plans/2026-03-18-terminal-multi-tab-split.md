# Terminal Multi-Tab and Split-Pane Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add terminal-internal tabs and single-split panes inside each branch/app tab's terminal area, with independent Ghostty sessions per pane and in-memory workspace persistence while the app is running.

**Architecture:** Keep terminal workspace layout state in the React frontend. Add a terminal feature state module that models terminal sub-tabs, panes, and helper actions, then wire `App.tsx` to hold one workspace per existing app tab. `TerminalPanel.tsx` becomes a renderer/controller for the active workspace, while Tauri continues to own only Ghostty surface lifecycle and focus commands.

**Tech Stack:** React 19, TypeScript, Vite, Tauri IPC, Tailwind, Vitest, Testing Library

---

### Task 1: Add Terminal Workspace State and Frontend Test Harness

**Files:**
- Create: `src/features/terminal/workspace.ts`
- Create: `src/features/terminal/workspace.test.ts`
- Create: `src/test/setup.ts`
- Modify: `package.json`
- Modify: `vite.config.ts`

**Step 1: Write the failing tests and test harness config**

Add `vitest`, `jsdom`, `@testing-library/react`, and `@testing-library/jest-dom` to `devDependencies`. Add `"test:ts": "vitest run"` to `package.json`. Extend `vite.config.ts` with a `test` block using `environment: "jsdom"` and `setupFiles: ["./src/test/setup.ts"]`.

Create `src/test/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
```

Create `src/features/terminal/workspace.test.ts` with the first failing cases:

```ts
import { describe, expect, it } from "vitest";
import {
  createTerminalWorkspace,
  createTerminalTabInWorkspace,
  splitActivePaneInTerminalTab,
  closePaneInTerminalTab,
} from "./workspace";

describe("terminal workspace", () => {
  it("creates an initial terminal tab with one active pane", () => {
    const workspace = createTerminalWorkspace();

    expect(workspace.terminalTabs).toHaveLength(1);
    expect(workspace.activeTerminalTabId).toBe(workspace.terminalTabs[0].id);
    expect(workspace.terminalTabs[0].panes).toHaveLength(1);
  });

  it("splits the active pane into two independent panes", () => {
    const workspace = createTerminalWorkspace();

    const next = splitActivePaneInTerminalTab(
      workspace,
      workspace.activeTerminalTabId!,
      "vertical"
    );

    expect(next.terminalTabs[0].splitDirection).toBe("vertical");
    expect(next.terminalTabs[0].panes).toHaveLength(2);
    expect(next.terminalTabs[0].activePaneId).toBe(next.terminalTabs[0].panes[1].id);
  });

  it("collapses back to one pane when a split pane is closed", () => {
    const workspace = splitActivePaneInTerminalTab(
      createTerminalWorkspace(),
      createTerminalWorkspace().activeTerminalTabId!,
      "horizontal"
    );
    const tab = workspace.terminalTabs[0];

    const next = closePaneInTerminalTab(workspace, tab.id, tab.panes[1].id);

    expect(next.terminalTabs[0].splitDirection).toBeNull();
    expect(next.terminalTabs[0].panes).toHaveLength(1);
  });
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npm install
npm run test:ts -- src/features/terminal/workspace.test.ts
```

Expected: FAIL because `src/features/terminal/workspace.ts` does not exist yet or required exports are missing.

**Step 3: Write the minimal implementation**

Create `src/features/terminal/workspace.ts` with the first minimal shape:

```ts
import type { TermSession } from "./TerminalPanel";

export type SplitDirection = "horizontal" | "vertical";

export interface TerminalPaneState {
  id: string;
  session: TermSession | null;
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

function makeId(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function createEmptyPane(): TerminalPaneState {
  return { id: makeId("pane"), session: null };
}

function createEmptyTerminalTab(index: number): TerminalTabState {
  const pane = createEmptyPane();
  return {
    id: makeId("terminal-tab"),
    title: `Terminal ${index}`,
    activePaneId: pane.id,
    splitDirection: null,
    panes: [pane],
  };
}

export function createTerminalWorkspace(): TerminalWorkspace {
  const tab = createEmptyTerminalTab(1);
  return {
    terminalTabs: [tab],
    activeTerminalTabId: tab.id,
  };
}

export function createTerminalTabInWorkspace(
  workspace: TerminalWorkspace
): TerminalWorkspace {
  const tab = createEmptyTerminalTab(workspace.terminalTabs.length + 1);
  return {
    terminalTabs: [...workspace.terminalTabs, tab],
    activeTerminalTabId: tab.id,
  };
}

export function splitActivePaneInTerminalTab(
  workspace: TerminalWorkspace,
  terminalTabId: string,
  direction: SplitDirection
): TerminalWorkspace {
  return {
    ...workspace,
    terminalTabs: workspace.terminalTabs.map((tab) => {
      if (tab.id !== terminalTabId || tab.panes.length > 1) return tab;
      const pane = createEmptyPane();
      return {
        ...tab,
        splitDirection: direction,
        activePaneId: pane.id,
        panes: [...tab.panes, pane],
      };
    }),
  };
}

export function closePaneInTerminalTab(
  workspace: TerminalWorkspace,
  terminalTabId: string,
  paneId: string
): TerminalWorkspace {
  return {
    ...workspace,
    terminalTabs: workspace.terminalTabs.map((tab) => {
      if (tab.id !== terminalTabId || tab.panes.length === 1) return tab;
      const panes = tab.panes.filter((pane) => pane.id !== paneId);
      return {
        ...tab,
        splitDirection: null,
        activePaneId: panes[0].id,
        panes,
      };
    }),
  };
}
```

**Step 4: Run the test to verify it passes**

Run:

```bash
npm run test:ts -- src/features/terminal/workspace.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add package.json vite.config.ts src/test/setup.ts src/features/terminal/workspace.ts src/features/terminal/workspace.test.ts
git commit -m "test: add terminal workspace state coverage"
```

### Task 2: Add Workspace Helpers for App-Level Lifecycle and Agent Routing

**Files:**
- Modify: `src/features/terminal/workspace.ts`
- Modify: `src/features/terminal/workspace.test.ts`
- Modify: `src/App.tsx`

**Step 1: Write the failing tests**

Extend `src/features/terminal/workspace.test.ts` with app-facing helper coverage:

```ts
import {
  collectWorkspaceSurfaceIds,
  setPaneSession,
  resolveAgentLaunchTarget,
} from "./workspace";

it("collects every live surface id in the workspace", () => {
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

  expect(collectWorkspaceSurfaceIds(workspace)).toEqual(["surface-1", "surface-2"]);
});

it("routes an agent launch to a new terminal tab when the active pane is already occupied", () => {
  let workspace = createTerminalWorkspace();
  const tabId = workspace.activeTerminalTabId!;
  const paneId = workspace.terminalTabs[0].activePaneId;

  workspace = setPaneSession(workspace, tabId, paneId, {
    id: "surface-1",
    agent: "terminal",
    label: "Terminal - main",
  });

  const target = resolveAgentLaunchTarget(workspace);

  expect(target.mode).toBe("create-terminal-tab");
});
```

**Step 2: Run the tests to verify they fail**

Run:

```bash
npm run test:ts -- src/features/terminal/workspace.test.ts
```

Expected: FAIL because the new helpers do not exist yet.

**Step 3: Write the minimal implementation and wire `App.tsx`**

Extend `src/features/terminal/workspace.ts` with:

```ts
export function setPaneSession(
  workspace: TerminalWorkspace,
  terminalTabId: string,
  paneId: string,
  session: TermSession | null
): TerminalWorkspace {
  return {
    ...workspace,
    terminalTabs: workspace.terminalTabs.map((tab) => {
      if (tab.id !== terminalTabId) return tab;
      return {
        ...tab,
        panes: tab.panes.map((pane) =>
          pane.id === paneId ? { ...pane, session } : pane
        ),
      };
    }),
  };
}

export function collectWorkspaceSurfaceIds(
  workspace: TerminalWorkspace | null | undefined
): string[] {
  if (!workspace) return [];
  return workspace.terminalTabs.flatMap((tab) =>
    tab.panes.flatMap((pane) => (pane.session ? [pane.session.id] : []))
  );
}

export function resolveAgentLaunchTarget(workspace: TerminalWorkspace) {
  const activeTab = workspace.terminalTabs.find(
    (tab) => tab.id === workspace.activeTerminalTabId
  );
  const activePane = activeTab?.panes.find(
    (pane) => pane.id === activeTab.activePaneId
  );

  if (!activeTab || !activePane || activePane.session) {
    return { mode: "create-terminal-tab" as const };
  }

  return {
    mode: "reuse-active-pane" as const,
    terminalTabId: activeTab.id,
    paneId: activePane.id,
  };
}
```

Refactor `src/App.tsx` to:

- Replace `sessionMap` with `workspaceMap: Map<string, TerminalWorkspace>`
- Ensure each app tab gets a workspace on first use
- Pass the active workspace and workspace updater into `TerminalPanel`
- Use `collectWorkspaceSurfaceIds` when closing an app tab
- Use `resolveAgentLaunchTarget` in `handleSendToAgent`

**Step 4: Run the tests to verify they pass**

Run:

```bash
npm run test:ts -- src/features/terminal/workspace.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/App.tsx src/features/terminal/workspace.ts src/features/terminal/workspace.test.ts
git commit -m "feat: add terminal workspace app wiring"
```

### Task 3: Render Terminal Sub-Tabs and Split Panes in the UI

**Files:**
- Create: `src/features/terminal/TerminalPanel.test.tsx`
- Modify: `src/features/terminal/TerminalPanel.tsx`
- Modify: `src/features/terminal/GhosttyTerminal.tsx`

**Step 1: Write the failing component tests**

Create `src/features/terminal/TerminalPanel.test.tsx` with mocked Tauri IPC:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalPanel } from "./TerminalPanel";
import { createTerminalWorkspace } from "./workspace";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue("surface-new"),
}));

describe("TerminalPanel", () => {
  it("renders terminal sub-tabs and an empty pane CTA", () => {
    const workspace = createTerminalWorkspace();

    render(
      <TerminalPanel
        height={240}
        tab={{
          id: "main",
          branch: "main",
          repoPath: "/tmp/repo",
          worktree: null,
          kind: "branch",
          agent: null,
          hasActiveSession: false,
        }}
        workspace={workspace}
        onWorkspaceChange={() => {}}
        onToggle={() => {}}
      />
    );

    expect(screen.getByText("Terminal 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Terminal" })).toBeInTheDocument();
  });

  it("shows two pane containers after a split", () => {
    // Build a split workspace and assert two pane regions exist.
  });
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
npm run test:ts -- src/features/terminal/TerminalPanel.test.tsx
```

Expected: FAIL because `TerminalPanel` still expects a single session and does not render terminal sub-tabs or split panes.

**Step 3: Write the minimal implementation**

Refactor `src/features/terminal/TerminalPanel.tsx` to:

- Accept `workspace` and `onWorkspaceChange` props instead of `session` and `onSessionChange`
- Render terminal sub-tab buttons from `workspace.terminalTabs`
- Render `+ Tab`, `Split Horizontal`, `Split Vertical`, and `Close Pane` controls
- Render one or two pane containers for the active terminal sub-tab
- Launch a Ghostty session into the active pane instead of a tab-level singleton
- Call `ghostty_destroy_surface` when closing a pane or terminal sub-tab with a live session

Keep `GhosttyTerminal.tsx` mostly unchanged, but allow a `className` hook for active pane styling and preserve overlay focus behavior when the pane is clicked.

**Step 4: Run the tests to verify they pass**

Run:

```bash
npm run test:ts -- src/features/terminal/TerminalPanel.test.tsx
npm run test:ts -- src/features/terminal/workspace.test.ts src/features/terminal/TerminalPanel.test.tsx
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/features/terminal/TerminalPanel.tsx src/features/terminal/GhosttyTerminal.tsx src/features/terminal/TerminalPanel.test.tsx
git commit -m "feat: add terminal tabs and split-pane UI"
```

### Task 4: Finish Agent Launch Behavior and Cleanup Paths

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/features/terminal/TerminalPanel.tsx`
- Modify: `src/features/terminal/TerminalPanel.test.tsx`
- Modify: `src/features/terminal/workspace.test.ts`

**Step 1: Write the failing tests**

Add focused coverage for the last behaviors:

```ts
it("reuses the active pane for an agent launch when it is empty", () => {
  const workspace = createTerminalWorkspace();

  expect(resolveAgentLaunchTarget(workspace)).toEqual({
    mode: "reuse-active-pane",
    terminalTabId: workspace.activeTerminalTabId,
    paneId: workspace.terminalTabs[0].activePaneId,
  });
});
```

Add a component test that closing a split pane only removes one pane control and leaves the remaining pane visible.

**Step 2: Run the tests to verify they fail**

Run:

```bash
npm run test:ts -- src/features/terminal/workspace.test.ts src/features/terminal/TerminalPanel.test.tsx
```

Expected: FAIL until the final routing and collapse logic is wired through the UI.

**Step 3: Write the minimal implementation**

Finalize `src/App.tsx` and `src/features/terminal/TerminalPanel.tsx` so that:

- Agent launches reuse the active empty pane
- Agent launches create a new terminal sub-tab when the active pane is occupied
- Closing a split pane collapses back to one pane and keeps the remaining session alive
- Closing an app tab destroys every collected surface id in that workspace

**Step 4: Run full verification**

Run:

```bash
npm run test:ts -- src/features/terminal/workspace.test.ts src/features/terminal/TerminalPanel.test.tsx
npm run build
```

Expected: PASS

Manual verification:

```text
1. Open two branch/app tabs and confirm each has an independent terminal workspace.
2. Create two terminal sub-tabs in one branch/app tab and verify switching preserves live sessions.
3. Split one terminal sub-tab vertically, start sessions in both panes, and confirm commands run independently.
4. Close and reopen the terminal panel with Ctrl+` and confirm the same live sessions reappear.
5. Send work to an agent from Diff or Transcript and confirm it reuses an empty pane or creates a new terminal sub-tab when needed.
6. Close a pane, a terminal sub-tab, and finally the branch/app tab; confirm no orphaned overlays remain.
```

**Step 5: Commit**

```bash
git add src/App.tsx src/features/terminal/TerminalPanel.tsx src/features/terminal/TerminalPanel.test.tsx src/features/terminal/workspace.test.ts
git commit -m "feat: finalize terminal workspace behavior"
```
