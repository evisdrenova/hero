export const MIN_TERMINAL_HEIGHT = 100;
export const MIN_MAIN_CONTENT_HEIGHT = 220;
export const DEFAULT_TERMINAL_HEIGHT = 220;

export function getMaxTerminalHeight(viewportHeight: number) {
  return Math.max(
    MIN_TERMINAL_HEIGHT,
    viewportHeight - MIN_MAIN_CONTENT_HEIGHT
  );
}

export function clampTerminalHeight(height: number, viewportHeight: number) {
  return Math.max(
    MIN_TERMINAL_HEIGHT,
    Math.min(getMaxTerminalHeight(viewportHeight), height)
  );
}
