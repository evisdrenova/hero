# Diff Default Open Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every file start expanded in all diff views, including checkpoint diffs and branch diffs.

**Architecture:** Keep the existing per-file expand/collapse state in the React diff UI, but change the initial expansion decision to include every file instead of only small diffs. Add a small pure helper in the diff feature so the behavior can be covered by the existing Node test setup without introducing a browser test harness.

**Tech Stack:** React 19, TypeScript, Node built-in test runner

---

### Task 1: Add failing coverage for initial diff expansion

**Files:**
- Create: `test/diff/file-expansion.test.ts`
- Create: `src/features/diff/file-expansion.ts`

**Step 1: Write the failing test**

```ts
test("all diff files start expanded regardless of diff size", () => {
  const expandedPaths = getInitiallyExpandedFilePaths([
    { path: "a.ts" },
    { path: "b.ts" },
    { path: "c.ts" },
    { path: "d.ts" },
    { path: "e.ts" },
    { path: "f.ts" },
  ]);

  assert.deepEqual([...expandedPaths], ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"]);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:ts -- test/diff/file-expansion.test.ts`
Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

```ts
export function getInitiallyExpandedFilePaths(
  files: Array<{ path: string }>
): Set<string> {
  return new Set(files.map((file) => file.path));
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:ts -- test/diff/file-expansion.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add test/diff/file-expansion.test.ts src/features/diff/file-expansion.ts
git commit -m "test: cover diff file default expansion"
```

### Task 2: Use the helper in the diff UI

**Files:**
- Modify: `src/features/diff/DiffView.tsx`
- Test: `test/diff/file-expansion.test.ts`

**Step 1: Update the diff file list to use the helper**

```ts
const initiallyExpandedFiles = getInitiallyExpandedFilePaths(files);
```

**Step 2: Pass the computed default into each file entry**

```tsx
defaultExpanded={initiallyExpandedFiles.has(file.path)}
```

**Step 3: Run targeted tests**

Run: `npm run test:ts -- test/diff/file-expansion.test.ts`
Expected: PASS

**Step 4: Run the full TypeScript test suite**

Run: `npm run test:ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/features/diff/DiffView.tsx
git commit -m "feat: expand diff files by default"
```
