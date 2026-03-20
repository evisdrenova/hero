import type { DiffLine } from "../../lib/ipc";

export function getDiffLineTextColor(kind: DiffLine["kind"]): string {
  if (kind === "add") return "var(--color-diff-add-text)";
  if (kind === "delete") return "var(--color-diff-delete-text)";
  return "var(--color-fg-muted)";
}
