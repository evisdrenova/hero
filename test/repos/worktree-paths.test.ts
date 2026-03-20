import assert from "node:assert/strict";
import test from "node:test";

import { deriveSuggestedWorktreePath } from "../../src/features/repos/worktree-paths.ts";

test("derives a repo-adjacent path from the branch name", () => {
  assert.equal(
    deriveSuggestedWorktreePath("/repos/entire-app", "feature/add-worktree-actions"),
    "/repos/entire-app-feature-add-worktree-actions"
  );
});

test("sanitizes separators and trims surrounding punctuation", () => {
  assert.equal(
    deriveSuggestedWorktreePath("/repos/entire-app", "/bugfix///cleanup./"),
    "/repos/entire-app-bugfix-cleanup"
  );
});

test("falls back to a generic suffix when the branch name becomes empty", () => {
  assert.equal(
    deriveSuggestedWorktreePath("/repos/entire-app", "///"),
    "/repos/entire-app-worktree"
  );
});
