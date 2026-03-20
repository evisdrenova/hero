import assert from "node:assert/strict";
import test from "node:test";

import {
  applySemanticReviewComments,
  canWriteDiffComments,
  createManualDiffComment,
  getVisibleDiffComments,
  type DiffComment,
} from "../../src/features/diff/comments.ts";

function aiComment(id: string, filePath: string, lineKey: string, reviewRunId: string): DiffComment {
  return {
    id,
    filePath,
    lineKey,
    lineKind: "add",
    lineContent: "new value",
    lineNumber: 12,
    comment: "This changes behavior.",
    createdAt: 1,
    source: "semantic_review",
    readonly: true,
    reviewRunId,
  };
}

test("semantic review replacement keeps manual comments and swaps prior AI comments", () => {
  const manual = createManualDiffComment({
    filePath: "src/a.ts",
    lineKey: "src/a.ts::12",
    lineKind: "add",
    lineContent: "const value = 1;",
    lineNumber: 12,
    comment: "Please rename this constant.",
  });

  const comments = applySemanticReviewComments(
    [
      manual,
      aiComment("old-ai", "src/a.ts", "src/a.ts::12", "run-1"),
      aiComment("other-ai", "src/b.ts", "src/b.ts::5", "run-1"),
    ],
    [
      aiComment("new-ai", "src/a.ts", "src/a.ts::12", "run-2"),
      aiComment("new-ai-2", "src/c.ts", "src/c.ts::3", "run-2"),
    ]
  );

  assert.deepEqual(
    comments.map((comment) => ({
      id: comment.id,
      source: comment.source,
      reviewRunId: comment.reviewRunId ?? null,
      filePath: comment.filePath,
    })),
    [
      {
        id: manual.id,
        source: "manual",
        reviewRunId: null,
        filePath: "src/a.ts",
      },
      {
        id: "new-ai",
        source: "semantic_review",
        reviewRunId: "run-2",
        filePath: "src/a.ts",
      },
      {
        id: "new-ai-2",
        source: "semantic_review",
        reviewRunId: "run-2",
        filePath: "src/c.ts",
      },
    ]
  );
});

test("manual comments default to editable manual source metadata", () => {
  const comment = createManualDiffComment({
    filePath: "src/a.ts",
    lineKey: "src/a.ts::7",
    lineKind: "delete",
    lineContent: "old guard",
    lineNumber: 7,
    comment: "This guard still matters.",
  });

  assert.equal(comment.source, "manual");
  assert.equal(comment.readonly, false);
  assert.equal(comment.reviewRunId, undefined);
});

test("semantic review mode only shows semantic review comments and disables writing", () => {
  const manual = createManualDiffComment({
    filePath: "src/a.ts",
    lineKey: "src/a.ts::7",
    lineKind: "delete",
    lineContent: "old guard",
    lineNumber: 7,
    comment: "This guard still matters.",
  });
  const semantic = aiComment("ai", "src/a.ts", "src/a.ts::7", "run-1");

  const visible = getVisibleDiffComments([manual, semantic], true);

  assert.deepEqual(
    visible.map((comment) => comment.source),
    ["semantic_review"]
  );
  assert.equal(canWriteDiffComments(true), false);
});

test("standard diff mode keeps manual comments visible and writable", () => {
  const manual = createManualDiffComment({
    filePath: "src/a.ts",
    lineKey: "src/a.ts::7",
    lineKind: "delete",
    lineContent: "old guard",
    lineNumber: 7,
    comment: "This guard still matters.",
  });
  const semantic = aiComment("ai", "src/a.ts", "src/a.ts::7", "run-1");

  const visible = getVisibleDiffComments([manual, semantic], false);

  assert.deepEqual(
    visible.map((comment) => comment.source),
    ["manual", "semantic_review"]
  );
  assert.equal(canWriteDiffComments(false), true);
});
