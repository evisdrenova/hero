export function getInitiallyExpandedFilePaths(
  files: Array<{ path: string }>
): Set<string> {
  return new Set(files.map((file) => file.path));
}
