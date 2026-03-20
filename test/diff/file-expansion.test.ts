import assert from "node:assert/strict";
import test from "node:test";

import { getInitiallyExpandedFilePaths } from "../../src/features/diff/file-expansion.ts";

test("all diff files start expanded regardless of diff size", () => {
  const expandedPaths = getInitiallyExpandedFilePaths([
    { path: "a.ts" },
    { path: "b.ts" },
    { path: "c.ts" },
    { path: "d.ts" },
    { path: "e.ts" },
    { path: "f.ts" },
  ]);

  assert.deepEqual([...expandedPaths], [
    "a.ts",
    "b.ts",
    "c.ts",
    "d.ts",
    "e.ts",
    "f.ts",
  ]);
});
