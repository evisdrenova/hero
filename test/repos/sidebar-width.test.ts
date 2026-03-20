import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampSidebarWidth,
} from "../../src/features/repos/sidebar-width.ts";

test("clamps widths below the minimum", () => {
  assert.equal(clampSidebarWidth(MIN_SIDEBAR_WIDTH - 80), MIN_SIDEBAR_WIDTH);
});

test("clamps widths above the maximum", () => {
  assert.equal(clampSidebarWidth(MAX_SIDEBAR_WIDTH + 120), MAX_SIDEBAR_WIDTH);
});

test("preserves widths inside the allowed range", () => {
  assert.equal(clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH + 48), DEFAULT_SIDEBAR_WIDTH + 48);
});
