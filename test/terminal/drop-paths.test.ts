import assert from "node:assert/strict";
import test from "node:test";

import {
  filterDroppedImagePaths,
  formatDroppedImagePaths,
  shellQuotePath,
} from "../../src/features/terminal/drop-paths.ts";

test("filters dropped paths down to common image file types", () => {
  const paths = [
    "/tmp/screenshot.png",
    "/tmp/photo.JPG",
    "/tmp/readme.md",
    "/tmp/icon.webp",
  ];

  assert.deepEqual(filterDroppedImagePaths(paths), [
    "/tmp/screenshot.png",
    "/tmp/photo.JPG",
    "/tmp/icon.webp",
  ]);
});

test("shell quotes paths with spaces and single quotes", () => {
  assert.equal(
    shellQuotePath("/tmp/it's a screenshot.png"),
    "'/tmp/it'\"'\"'s a screenshot.png'"
  );
});

test("formats multiple dropped image paths into terminal-ready text", () => {
  const text = formatDroppedImagePaths([
    "/tmp/one.png",
    "/tmp/not-an-image.txt",
    "/tmp/two words.jpeg",
  ]);

  assert.equal(text, "'/tmp/one.png' '/tmp/two words.jpeg'");
});

test("returns an empty string when no dropped files are images", () => {
  const text = formatDroppedImagePaths([
    "/tmp/notes.txt",
    "/tmp/archive.zip",
  ]);

  assert.equal(text, "");
});
