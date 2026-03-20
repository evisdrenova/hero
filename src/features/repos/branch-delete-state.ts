interface BranchDeleteState {
  branchName: string;
  branchIsHead: boolean;
  hasWorktree: boolean;
  activeTabBranch: string;
  activeTabRepoPath: string;
  repoPath: string;
}

export function canDeletePlainBranch(state: BranchDeleteState): boolean {
  if (state.hasWorktree || state.branchIsHead) {
    return false;
  }

  return !(
    state.activeTabBranch === state.branchName &&
    state.activeTabRepoPath === state.repoPath
  );
}
