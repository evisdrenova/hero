# Repo Worktree Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a per-repo refresh button in the sidebar that reloads worktree data and shows loading state only for the clicked repo row.

**Architecture:** Keep the backend unchanged and use the existing `useReposQuery()` refetch path. Add a small pure helper for per-row refresh state so the behavior is covered by the existing Node test setup, then wire that helper into the sidebar button rendering and async refetch flow.

**Tech Stack:** React 19, TypeScript, TanStack Query, Node built-in test runner

---

### Task 1: Add failing coverage for per-row refresh state

**Files:**
- Create: `src/features/repos/refresh-state.ts`
- Create: `test/repos/refresh-state.test.ts`

**Step 1: Write the failing test**

```ts
test("marks only the clicked repo row as refreshing", () => {
  assert.equal(isRepoRefreshing("/repos/app", "/repos/app"), true);
  assert.equal(isRepoRefreshing("/repos/app", "/repos/other"), false);
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test:ts -- test/repos/refresh-state.test.ts`
Expected: FAIL because the helper module does not exist yet.

**Step 3: Write minimal implementation**

```ts
export function isRepoRefreshing(
  refreshingRepoPath: string | null,
  repoPath: string
): boolean {
  return refreshingRepoPath === repoPath;
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:ts -- test/repos/refresh-state.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/features/repos/refresh-state.ts test/repos/refresh-state.test.ts
git commit -m "test: cover repo refresh row state"
```

### Task 2: Wire the refresh button into the sidebar

**Files:**
- Modify: `src/features/repos/Sidebar.tsx`
- Modify: `src/features/repos/refresh-state.ts`
- Test: `test/repos/refresh-state.test.ts`

**Step 1: Read the repos query refetch API from the sidebar**

```ts
const { data: realRepos, isLoading, error, refetch } = useReposQuery();
```

**Step 2: Track which repo path initiated the refresh**

```ts
const [refreshingRepoPath, setRefreshingRepoPath] = useState<string | null>(null);
```

**Step 3: Add the per-repo refresh handler**

```ts
async function handleRefreshRepo(repoPath: string) {
  setRefreshingRepoPath(repoPath);
  const result = await refetch();
  if (result.error) setSidebarError(result.error.message);
  setRefreshingRepoPath(null);
}
```

**Step 4: Render the refresh button on each repo row**

```tsx
<button
  disabled={isRepoRefreshing(refreshingRepoPath, repo.path)}
  onClick={() => void handleRefreshRepo(repo.path)}
>
```

**Step 5: Run verification**

Run: `npm run test:ts -- test/repos/refresh-state.test.ts`
Expected: PASS

Run: `npm run test:ts`
Expected: PASS

Run: `npm run build`
Expected: PASS
