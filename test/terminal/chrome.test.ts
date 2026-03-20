import assert from "node:assert/strict";
import test from "node:test";

import {
  getPaneActionButtonClassName,
  getPaneChrome,
} from "../../src/features/terminal/chrome.ts";

test("active panes use the highlighted terminal chrome treatment", () => {
  const chrome = getPaneChrome(true);

  assert.match(chrome.rowClassName, /bg-accent/);
  assert.match(chrome.buttonClassName, /text-fg/);
  assert.match(chrome.closeClassName, /hover:text-red/);
});

test("inactive panes stay muted until hover", () => {
  const chrome = getPaneChrome(false);

  assert.match(chrome.rowClassName, /bg-black/);
  assert.match(chrome.buttonClassName, /text-fg-subtle/);
  assert.match(chrome.buttonClassName, /hover:text-fg/);
});

test("destructive action buttons keep a neutral base and gain red on hover", () => {
  const className = getPaneActionButtonClassName({
    tone: "danger",
    disabled: false,
  });

  assert.match(className, /text-fg-muted/);
  assert.match(className, /hover:text-red/);
});
