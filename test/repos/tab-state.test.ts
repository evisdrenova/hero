import assert from "node:assert/strict";
import test from "node:test";

import { createBranchTab, createWorktreeTab } from "../../src/features/repos/tab-state.ts";

test("creates a branch tab that stays on the selected repo path", () => {
  const tab = createBranchTab(
    {
      name: "feature/test",
      is_head: false,
      checkpoint_count: 0,
    },
    "/repos/main"
  );

  assert.equal(tab.repoPath, "/repos/main");
  assert.equal(tab.worktree, null);
});

test("creates a worktree tab that uses the worktree checkout path", () => {
  const tab = createWorktreeTab({
    path: "/repos/main-worktrees/feature-test",
    branch: "feature/test",
    is_main: false,
  });

  assert.equal(tab.repoPath, "/repos/main-worktrees/feature-test");
  assert.equal(tab.worktree?.path, "/repos/main-worktrees/feature-test");
});
