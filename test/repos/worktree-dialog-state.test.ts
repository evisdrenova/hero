import assert from "node:assert/strict";
import test from "node:test";

import { buildCreateWorktreeDraft } from "../../src/features/repos/worktree-dialog-state.ts";

test("prefers the first branch without an existing worktree", () => {
  const draft = buildCreateWorktreeDraft({
    path: "/repos/entire-app",
    branches: [
      { name: "main", is_head: true },
      { name: "feature/existing", is_head: false },
      { name: "feature/new", is_head: false },
    ],
    worktrees: [{ branch: "feature/existing" }],
  });

  assert.equal(draft.mode, "existing");
  assert.equal(draft.branchName, "feature/new");
  assert.equal(draft.targetPath, "/repos/entire-app-feature-new");
});

test("falls back to new-branch mode when every branch already has a worktree", () => {
  const draft = buildCreateWorktreeDraft({
    path: "/repos/entire-app",
    branches: [{ name: "main", is_head: true }],
    worktrees: [{ branch: "main" }],
  });

  assert.equal(draft.mode, "new");
  assert.equal(draft.branchName, "");
  assert.equal(draft.targetPath, "/repos/entire-app-worktree");
});
