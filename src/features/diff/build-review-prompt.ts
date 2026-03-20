import type { DiffComment } from "../../hooks/use-diff-comments";

const KIND_LABEL: Record<string, string> = {
  add: "addition",
  delete: "deletion",
  context: "context",
};

export function buildReviewPrompt(
  comments: DiffComment[],
  context: { commitSha?: string; branch?: string }
): string {
  if (comments.length === 0) return "";

  const lines: string[] = [];
  lines.push("Please make the following changes based on my code review:");
  lines.push("");

  if (context.commitSha) {
    lines.push(`> Reviewing commit ${context.commitSha.slice(0, 7)}`);
    lines.push("");
  } else if (context.branch) {
    lines.push(`> Reviewing branch "${context.branch}"`);
    lines.push("");
  }

  // Group by file
  const byFile = new Map<string, DiffComment[]>();
  for (const c of comments) {
    const existing = byFile.get(c.filePath);
    if (existing) {
      existing.push(c);
    } else {
      byFile.set(c.filePath, [c]);
    }
  }

  for (const [filePath, fileComments] of byFile) {
    lines.push(`## ${filePath}`);
    lines.push("");

    // Sort by line number
    const sorted = [...fileComments].sort((a, b) => a.lineNumber - b.lineNumber);

    for (const c of sorted) {
      const kindLabel = KIND_LABEL[c.lineKind] || c.lineKind;
      const contentPreview = c.lineContent.trim();
      lines.push(
        `### Line ${c.lineNumber} (${kindLabel}): \`${contentPreview}\``
      );
      lines.push(c.comment);
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd();
}
