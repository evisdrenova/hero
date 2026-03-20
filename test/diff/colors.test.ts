import assert from "node:assert/strict";
import test from "node:test";

import { getDiffLineTextColor } from "../../src/features/diff/colors.ts";

test("added lines use the dedicated add text token", () => {
  assert.equal(getDiffLineTextColor("add"), "var(--color-diff-add-text)");
});

test("deleted lines use the dedicated delete text token", () => {
  assert.equal(getDiffLineTextColor("delete"), "var(--color-diff-delete-text)");
});

test("context lines keep the muted foreground token", () => {
  assert.equal(getDiffLineTextColor("context"), "var(--color-fg-muted)");
});
