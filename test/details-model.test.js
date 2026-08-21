import test from "node:test";
import assert from "node:assert/strict";

import { parseDetailsBlocks, toggleDetailsMarker } from "../src/webview/details-model.js";

test("AIC details parse the exact open and closed markers", () => {
  const source =
    ">>>|open| - [ ] [app.js · L2](app.js#L2)\ncode\n<<<\n\n" +
    ">>> Closed title\nhidden\n<<<\n";
  const blocks = parseDetailsBlocks(source);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].open, true);
  assert.deepEqual(blocks[0].summary, {
    title: "- [ ] [app.js · L2](app.js#L2)",
    checked: false,
    label: "app.js · L2",
    href: "app.js#L2",
    taskOffset: 3,
  });
  assert.equal(blocks[1].open, false);
  assert.equal(blocks[1].title, "Closed title");
});

test("details marker toggle changes only the current marker", () => {
  assert.equal(toggleDetailsMarker(">>> Title"), ">>>|open| Title");
  assert.equal(toggleDetailsMarker(">>>|open| Title"), ">>> Title");
  assert.equal(toggleDetailsMarker(">>>|OPEN| Title"), null);
  assert.equal(toggleDetailsMarker(">>>Title"), null);
});

test("standalone terminators inside fenced code do not close details", () => {
  const source = ">>>|open| Example\n```text\n<<<\n```\nafter\n<<<\n";
  const [block] = parseDetailsBlocks(source);
  assert.equal(block.contentTo, source.lastIndexOf("<<<"));
  assert.match(source.slice(block.contentFrom, block.contentTo), /after/u);
});

test("nested, unmatched, and inline marker-like text stay ordinary Markdown", () => {
  assert.deepEqual(parseDetailsBlocks(">>> Outer\n>>> Inner\n<<<\n<<<\n"), []);
  assert.deepEqual(parseDetailsBlocks(">>> Missing close\nbody\n"), []);
  assert.deepEqual(parseDetailsBlocks("prefix >>> Title\nbody\n<<<\n"), []);
});
