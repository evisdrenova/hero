# Terminal Multi-Tab and Split-Pane Design

**Date:** 2026-03-18

**Goal:** Add terminal-internal tabs and a single split-pane mode inside each branch/app tab's terminal area, with independent sessions per pane and workspace state preserved while the app stays open.

## Scope

This design adds a terminal workspace inside each existing branch/app tab. That workspace is separate from the app-level branch tabs already shown in the main UI.

V1 includes:

- Multiple terminal sub-tabs inside each branch/app tab
- Up to two panes per terminal sub-tab
- Independent Ghostty session per pane
- Horizontal or vertical single split
- Preserving terminal workspace state when the terminal panel is hidden and shown again during the same app run

V1 does not include:

- Restoring live sessions after a full app restart
- Arbitrary nested split layouts
- More than two panes per terminal sub-tab
- Pane drag-resize
- Rename or reorder controls for terminal sub-tabs

## User Model

Each branch/app tab owns its own terminal workspace.

Inside that workspace:

- The user can create multiple terminal sub-tabs
- Each terminal sub-tab starts with one pane
- The active pane can be split once, creating a second pane
- Each pane hosts its own Ghostty surface and shell session
- Closing one pane in a split destroys that pane session and collapses the layout back to one pane
- Closing a terminal sub-tab destroys every pane session inside that terminal sub-tab
- Closing the branch/app tab destroys the entire terminal workspace for that branch/app tab

Agent launches target the active pane when it is empty. If the active pane already has a live session, the app creates a new terminal sub-tab for the agent launch so the existing shell is not replaced.

## Architecture

The frontend remains the source of truth for terminal workspace layout. Rust/Tauri continues to own only Ghostty surface creation, destruction, focus, visibility, and text injection.

This keeps layout decisions in React, where the UI already lives, and avoids introducing a Tauri-side workspace model for what is primarily a frontend interaction problem.

### State Ownership

`App.tsx` stores a terminal workspace per existing app tab id. The terminal feature owns the workspace schema and action logic through a reducer or hook in `src/features/terminal`.

Recommended state shape:

```ts
interface TerminalWorkspace {
  terminalTabs: TerminalTabState[];
  activeTerminalTabId: string | null;
}

interface TerminalTabState {
  id: string;
  title: string;
  activePaneId: string;
  splitDirection: "horizontal" | "vertical" | null;
  panes: TerminalPaneState[];
}

interface TerminalPaneState {
  id: string;
  session: TermSession | null;
}
```

Recommended reducer actions:

- `createTerminalTab`
- `closeTerminalTab`
- `setActiveTerminalTab`
- `setActivePane`
- `splitActivePane`
- `closePane`
- `setPaneSession`

## Component Changes

### `src/App.tsx`

Responsibilities:

- Replace the current `sessionMap` with a workspace map keyed by app tab id
- Pass the active app tab's workspace into `TerminalPanel`
- Preserve workspace state while the terminal panel is closed
- Destroy all Ghostty surfaces in the workspace when an app tab closes
- Route agent launches into the active workspace using the approved behavior

### `src/features/terminal/TerminalPanel.tsx`

Responsibilities:

- Render terminal sub-tab headers and `+ Tab`
- Render pane controls for split direction and pane close
- Render one or two `GhosttyTerminal` containers based on the active terminal sub-tab layout
- Launch sessions into the active pane
- Update pane-level session state instead of assuming one session for the whole app tab

### `src/features/terminal/GhosttyTerminal.tsx`

No major architectural change is required. The component already manages one Ghostty surface per rendered container. V1 will render multiple instances at once when the active terminal sub-tab is split.

## Lifecycle Rules

- Creating a pane session calls `ghostty_create_surface`
- Closing a pane or terminal sub-tab calls `ghostty_destroy_surface` for all sessions being removed
- Switching terminal sub-tabs hides inactive pane overlays because their containers unmount
- Hiding the terminal panel hides overlays but does not destroy sessions
- Reopening the terminal panel re-renders the stored workspace and shows the same live sessions again
- Focusing a pane calls `ghostty_focus_overlay` for that pane surface

## UX

Header layout:

- Terminal sub-tab strip
- `+ Tab` button
- Split controls for the active pane
- Pane close control when the active terminal sub-tab is split
- Existing terminal toggle control

Pane behavior:

- Empty panes show the existing `+ Terminal` affordance
- Split panes use a fixed 50/50 layout in v1
- Clicking a pane marks it active and focuses that Ghostty surface
- Active pane should have a visible selection treatment in the web UI so the split target is obvious

## Testing

Frontend tests should cover:

- Reducer or hook transitions for tab creation, split, collapse, pane focus, and close
- Agent launch routing into the active pane or a new terminal sub-tab
- App-tab close cleanup collecting every session id in the workspace

Manual verification should cover:

- Creating multiple terminal sub-tabs inside one branch/app tab
- Creating distinct layouts in two different branch/app tabs and confirming they stay independent
- Splitting a terminal sub-tab horizontally and vertically
- Running commands in both panes to confirm independent sessions
- Closing and reopening the terminal panel without losing live sessions
- Closing panes, terminal sub-tabs, and branch/app tabs and confirming Ghostty surfaces are cleaned up

## Recommended Implementation Direction

Use a feature-local reducer or hook for terminal workspace state in the terminal feature, but keep the top-level workspace map in `App.tsx`.

This is the best v1 trade-off:

- Cleaner than pushing more session/layout logic directly into `App.tsx`
- Much simpler than moving workspace state into Rust
- Compatible with the existing Ghostty overlay model
- Leaves room for future terminal UX without rewriting ownership boundaries
