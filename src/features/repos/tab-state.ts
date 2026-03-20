import type { BranchInfo, WorktreeInfo } from "../../lib/ipc";

export function createBranchTab(branch: BranchInfo, repoPath: string) {
  return {
    id: `${repoPath}:${branch.name}`,
    branch: branch.name,
    repoPath,
    worktree: null,
    kind: "branch" as const,
    agent: null,
    hasActiveSession: false,
  };
}

export function createWorktreeTab(wt: WorktreeInfo) {
  return {
    id: `${wt.path}:${wt.branch}`,
    branch: wt.branch,
    repoPath: wt.path,
    worktree: wt,
    kind: "branch" as const,
    agent: null,
    hasActiveSession: false,
  };
}
