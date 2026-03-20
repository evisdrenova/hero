interface TabLike {
  id: string;
  repoPath: string;
}

interface WorktreeDeleteCleanupState<T extends TabLike> {
  tabs: T[];
  activeTabId: string;
  worktreePath: string;
}

interface WorktreeDeleteCleanupResult<T extends TabLike> {
  remainingTabs: T[];
  removedTabIds: string[];
  nextActiveTabId: string | null;
}

export function planWorktreeDeletionCleanup<T extends TabLike>(
  state: WorktreeDeleteCleanupState<T>
): WorktreeDeleteCleanupResult<T> {
  const removedTabs = state.tabs.filter((tab) => tab.repoPath === state.worktreePath);
  const remainingTabs = state.tabs.filter((tab) => tab.repoPath !== state.worktreePath);
  const activeTabRemoved = removedTabs.some((tab) => tab.id === state.activeTabId);

  return {
    remainingTabs,
    removedTabIds: removedTabs.map((tab) => tab.id),
    nextActiveTabId: activeTabRemoved ? remainingTabs[0]?.id ?? null : state.activeTabId,
  };
}
