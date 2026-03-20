const IMAGE_PATH_RE = /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/i;

export function filterDroppedImagePaths(paths: string[]): string[] {
  return paths.filter((path) => IMAGE_PATH_RE.test(path));
}

export function shellQuotePath(path: string): string {
  return `'${path.replace(/'/g, `'\"'\"'`)}'`;
}

export function formatDroppedImagePaths(paths: string[]): string {
  return filterDroppedImagePaths(paths).map(shellQuotePath).join(" ");
}
