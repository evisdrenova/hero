function sanitizeBranchSegment(branchName: string): string {
  const sanitized = branchName
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "worktree";
}

export function deriveSuggestedWorktreePath(
  repoPath: string,
  branchName: string
): string {
  return `${repoPath}-${sanitizeBranchSegment(branchName)}`;
}
