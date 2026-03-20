export type DiffCommentSource = "manual" | "semantic_review";

export interface DiffComment {
  id: string;
  filePath: string;
  lineKey: string;
  lineKind: "add" | "delete" | "context";
  lineContent: string;
  lineNumber: number;
  comment: string;
  createdAt: number;
  source: DiffCommentSource;
  readonly: boolean;
  reviewRunId?: string;
}

interface CreateDiffCommentInput {
  filePath: string;
  lineKey: string;
  lineKind: "add" | "delete" | "context";
  lineContent: string;
  lineNumber: number;
  comment: string;
}

export function createManualDiffComment(
  input: CreateDiffCommentInput
): DiffComment {
  return {
    id: crypto.randomUUID(),
    ...input,
    createdAt: Date.now(),
    source: "manual",
    readonly: false,
  };
}

export function applySemanticReviewComments(
  comments: DiffComment[],
  nextComments: DiffComment[]
): DiffComment[] {
  return [
    ...comments.filter((comment) => comment.source !== "semantic_review"),
    ...nextComments,
  ];
}

export function getVisibleDiffComments(
  comments: DiffComment[],
  semanticReviewOnly: boolean
): DiffComment[] {
  if (!semanticReviewOnly) return comments;
  return comments.filter((comment) => comment.source === "semantic_review");
}

export function canWriteDiffComments(semanticReviewOnly: boolean): boolean {
  return !semanticReviewOnly;
}
