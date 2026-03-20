import test from "node:test";
import assert from "node:assert/strict";
import { planWorktreeDeletionCleanup } from "../../src/features/repos/worktree-delete-state.ts";

test("removes every tab rooted at the deleted worktree path", () => {
  const result = planWorktreeDeletionCleanup({
    tabs: [
      { id: "main", repoPath: "/repos/entire-app" },
      { id: "wt", repoPath: "/repos/entire-app-feature" },
      { id: "agent", repoPath: "/repos/entire-app-feature" },
    ],
    activeTabId: "main",
    worktreePath: "/repos/entire-app-feature",
  });

  assert.deepEqual(result.removedTabIds, ["wt", "agent"]);
  assert.deepEqual(
    result.remainingTabs.map((tab) => tab.id),
    ["main"]
  );
  assert.equal(result.nextActiveTabId, "main");
});

test("switches to the first remaining tab when the active tab is deleted", () => {
  const result = planWorktreeDeletionCleanup({
    tabs: [
      { id: "main", repoPath: "/repos/entire-app" },
      { id: "wt", repoPath: "/repos/entire-app-feature" },
    ],
    activeTabId: "wt",
    worktreePath: "/repos/entire-app-feature",
  });

  assert.deepEqual(result.removedTabIds, ["wt"]);
  assert.deepEqual(
    result.remainingTabs.map((tab) => tab.id),
    ["main"]
  );
  assert.equal(result.nextActiveTabId, "main");
});
