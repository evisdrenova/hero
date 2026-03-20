import { deriveSuggestedWorktreePath } from "./worktree-paths.ts";

interface BranchLike {
  name: string;
  is_head?: boolean;
}

interface WorktreeLike {
  branch: string;
}

interface RepoLike {
  path: string;
  branches: BranchLike[];
  worktrees: WorktreeLike[];
}

export interface CreateWorktreeDraft {
  mode: "existing" | "new";
  branchName: string;
  targetPath: string;
}

export function buildCreateWorktreeDraft(repo: RepoLike): CreateWorktreeDraft {
  const worktreeBranches = new Set(repo.worktrees.map((worktree) => worktree.branch));
  const firstAvailableBranch = repo.branches.find(
    (branch) => !branch.is_head && !worktreeBranches.has(branch.name)
  );

  if (firstAvailableBranch) {
    return {
      mode: "existing",
      branchName: firstAvailableBranch.name,
      targetPath: deriveSuggestedWorktreePath(repo.path, firstAvailableBranch.name),
    };
  }

  return {
    mode: "new",
    branchName: "",
    targetPath: deriveSuggestedWorktreePath(repo.path, ""),
  };
}
