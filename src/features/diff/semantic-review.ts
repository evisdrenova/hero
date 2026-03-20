import type { SemanticReviewAnnotation } from "../../lib/ipc";
import type { DiffComment } from "./comments";

export function toSemanticReviewDiffComments(
  annotations: SemanticReviewAnnotation[],
  reviewRunId: string
): DiffComment[] {
  return annotations.map((annotation) => ({
    id: crypto.randomUUID(),
    filePath: annotation.file_path,
    lineKey: annotation.line_key,
    lineKind: annotation.line_kind,
    lineContent: annotation.line_content,
    lineNumber: annotation.line_number,
    comment: formatSemanticReviewComment(annotation),
    createdAt: Date.now(),
    source: "semantic_review",
    readonly: true,
    reviewRunId,
  }));
}

function formatSemanticReviewComment(annotation: SemanticReviewAnnotation): string {
  const parts = [annotation.summary.trim()];
  if (annotation.rationale?.trim()) {
    parts.push(annotation.rationale.trim());
  }
  return parts.join("\n\n");
}
