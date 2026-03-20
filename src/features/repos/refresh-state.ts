export function isRepoRefreshing(
  refreshingRepoPath: string | null,
  repoPath: string
): boolean {
  return refreshingRepoPath === repoPath;
}
