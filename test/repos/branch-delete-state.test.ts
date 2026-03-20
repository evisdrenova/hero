import assert from "node:assert/strict";
import test from "node:test";

import { canDeletePlainBranch } from "../../src/features/repos/branch-delete-state.ts";

test("allows deleting a plain branch that is not active and not HEAD", () => {
  assert.equal(
    canDeletePlainBranch({
      branchName: "feature/cleanup",
      branchIsHead: false,
      hasWorktree: false,
      activeTabBranch: "main",
      activeTabRepoPath: "/repos/entire-app",
      repoPath: "/repos/entire-app",
    }),
    true
  );
});

test("blocks deleting branches that have a worktree", () => {
  assert.equal(
    canDeletePlainBranch({
      branchName: "feature/cleanup",
      branchIsHead: false,
      hasWorktree: true,
      activeTabBranch: "main",
      activeTabRepoPath: "/repos/entire-app",
      repoPath: "/repos/entire-app",
    }),
    false
  );
});

test("blocks deleting the repo HEAD branch", () => {
  assert.equal(
    canDeletePlainBranch({
      branchName: "main",
      branchIsHead: true,
      hasWorktree: false,
      activeTabBranch: "feature/cleanup",
      activeTabRepoPath: "/repos/entire-app",
      repoPath: "/repos/entire-app",
    }),
    false
  );
});

test("blocks deleting the plain branch shown in the active main-checkout tab", () => {
  assert.equal(
    canDeletePlainBranch({
      branchName: "feature/cleanup",
      branchIsHead: false,
      hasWorktree: false,
      activeTabBranch: "feature/cleanup",
      activeTabRepoPath: "/repos/entire-app",
      repoPath: "/repos/entire-app",
    }),
    false
  );
});

test("does not block when the active tab is on a worktree path for the same branch", () => {
  assert.equal(
    canDeletePlainBranch({
      branchName: "feature/cleanup",
      branchIsHead: false,
      hasWorktree: false,
      activeTabBranch: "feature/cleanup",
      activeTabRepoPath: "/repos/entire-app-feature-cleanup",
      repoPath: "/repos/entire-app",
    }),
    true
  );
});
