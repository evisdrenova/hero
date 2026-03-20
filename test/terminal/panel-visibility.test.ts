import assert from "node:assert/strict";
import test from "node:test";

import {
  createTerminalPanelVisibility,
  isTerminalPanelOpen,
  setTerminalPanelOpen,
  syncTerminalPanelVisibility,
} from "../../src/features/terminal/panel-visibility.ts";

test("new tabs default to an open terminal panel", () => {
  const visibility = createTerminalPanelVisibility(["main", "feature"]);

  assert.equal(isTerminalPanelOpen(visibility, "main"), true);
  assert.equal(isTerminalPanelOpen(visibility, "feature"), true);
});

test("toggling one top-level tab does not affect another", () => {
  const visibility = setTerminalPanelOpen(
    createTerminalPanelVisibility(["main", "feature"]),
    "feature",
    false
  );

  assert.equal(isTerminalPanelOpen(visibility, "main"), true);
  assert.equal(isTerminalPanelOpen(visibility, "feature"), false);
});

test("syncing tab ids preserves existing state, opens new tabs, and drops removed tabs", () => {
  const visibility = syncTerminalPanelVisibility(
    setTerminalPanelOpen(createTerminalPanelVisibility(["main"]), "main", false),
    ["main", "agent:1"]
  );

  assert.deepEqual(visibility, {
    "main": false,
    "agent:1": true,
  });

  const trimmed = syncTerminalPanelVisibility(visibility, ["agent:1"]);
  assert.deepEqual(trimmed, {
    "agent:1": true,
  });
});
