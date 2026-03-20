import assert from "node:assert/strict";
import test from "node:test";

import { toSemanticReviewDiffComments } from "../../src/features/diff/semantic-review.ts";

test("semantic review annotations become readonly diff comments", () => {
  const comments = toSemanticReviewDiffComments(
    [
      {
        file_path: "src/cache.ts",
        line_key: "src/cache.ts:12:12",
        line_kind: "add",
        line_number: 12,
        line_content: "cache.set(key, result);",
        summary: "This adds a process-local cache for repeated requests.",
        rationale: "The transcript shows the author chose the fetch layer so callers do not need to opt in.",
        importance: "high",
      },
    ],
    "review-123"
  );

  assert.equal(comments.length, 1);
  assert.equal(comments[0].source, "semantic_review");
  assert.equal(comments[0].readonly, true);
  assert.equal(comments[0].reviewRunId, "review-123");
  assert.match(
    comments[0].comment,
    /This adds a process-local cache for repeated requests\./
  );
  assert.match(
    comments[0].comment,
    /The transcript shows the author chose the fetch layer/
  );
});
