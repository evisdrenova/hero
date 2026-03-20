import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_MAIN_CONTENT_HEIGHT,
  MIN_TERMINAL_HEIGHT,
  clampTerminalHeight,
  getMaxTerminalHeight,
} from "../../src/features/terminal/resize.ts";

test("clamps heights below the minimum terminal height", () => {
  assert.equal(
    clampTerminalHeight(MIN_TERMINAL_HEIGHT - 32, 900),
    MIN_TERMINAL_HEIGHT
  );
});

test("allows the terminal to grow beyond the old fixed cap on tall windows", () => {
  assert.equal(clampTerminalHeight(720, 1080), 720);
});

test("caps the terminal at a viewport-based maximum", () => {
  const viewportHeight = 900;

  assert.equal(
    clampTerminalHeight(900, viewportHeight),
    viewportHeight - MIN_MAIN_CONTENT_HEIGHT
  );
});

test("never returns less than the minimum terminal height on short windows", () => {
  assert.equal(getMaxTerminalHeight(80), MIN_TERMINAL_HEIGHT);
});

test("larger windows allow larger maximum terminal heights", () => {
  assert.ok(getMaxTerminalHeight(1200) > getMaxTerminalHeight(700));
});
