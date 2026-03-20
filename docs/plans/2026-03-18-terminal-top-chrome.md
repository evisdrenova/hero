# Terminal Top Chrome Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restyle the pane title row shown in the screenshot into a compact terminal chrome without changing terminal behavior or the toolbar/body layout.

**Architecture:** Keep the behavior in `TerminalPanel.tsx` intact and isolate the pane chrome class mapping into a small helper module so the visual states are easy to test. Update only the pane title-row markup/classes while leaving the toolbar and Ghostty overlays unchanged.

**Tech Stack:** React 19, TypeScript, Tailwind utility classes, Node `node:test`

---

### Task 1: Add a testable pane-chrome state seam

**Files:**
- Create: `src/features/terminal/chrome.ts`
- Create: `test/terminal/chrome.test.ts`

**Step 1: Write the failing test**

Write tests that assert:

- active panes use the highlighted treatment
- inactive panes use the muted treatment
- destructive controls keep a neutral base style

**Step 2: Run test to verify it fails**

Run: `npm run test:ts -- test/terminal/chrome.test.ts`
Expected: FAIL because `src/features/terminal/chrome.ts` does not exist yet

**Step 3: Write minimal implementation**

Create helper functions that return the class strings for:

- pane row container/title/metadata/close affordance
- neutral and destructive pane actions

**Step 4: Run test to verify it passes**

Run: `npm run test:ts -- test/terminal/chrome.test.ts`
Expected: PASS

### Task 2: Apply the pane chrome restyle

**Files:**
- Modify: `src/features/terminal/TerminalPanel.tsx`
- Use: `src/features/terminal/chrome.ts`

**Step 1: Update the pane-row structure**

- Make the row denser and darker
- Add a small status marker and clearer title hierarchy
- Keep the kill action visually present but quiet

**Step 2: Update active/inactive styling**

- Active pane gets a subtle tinted background
- Inactive panes stay subdued with stronger hover feedback
- Close affordance stays low-emphasis until hover

**Step 3: Preserve row semantics**

- Keep the same label content
- Keep the same kill/startup behavior
- Do not change click/focus semantics

**Step 4: Preserve behavior**

- Do not change handlers or launch logic
- Do not change the toolbar or terminal body styling

### Task 3: Verify the restyle

**Files:**
- Verify: `src/features/terminal/TerminalPanel.tsx`
- Verify: `test/terminal/chrome.test.ts`

**Step 1: Run targeted tests**

Run: `npm run test:ts -- test/terminal/chrome.test.ts`
Expected: PASS

**Step 2: Run the full TypeScript test suite**

Run: `npm run test:ts`
Expected: PASS

**Step 3: Run the production build**

Run: `npm run build`
Expected: PASS
