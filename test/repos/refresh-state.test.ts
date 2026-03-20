import assert from "node:assert/strict";
import test from "node:test";

import { isRepoRefreshing } from "../../src/features/repos/refresh-state.ts";

test("marks only the clicked repo row as refreshing", () => {
  assert.equal(isRepoRefreshing("/repos/app", "/repos/app"), true);
  assert.equal(isRepoRefreshing("/repos/app", "/repos/other"), false);
  assert.equal(isRepoRefreshing(null, "/repos/app"), false);
});
