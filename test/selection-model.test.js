import test from "node:test";
import assert from "node:assert/strict";

import { sourceLocationFromHref } from "../src/notes/selection-model.js";

test("local source hrefs expose valid ranges and decode the sibling path", () => {
  assert.deepEqual(sourceLocationFromHref("my%20file.js#L7-L11"), {
    path: "my file.js",
    line: 7,
    endLine: 11,
  });
  assert.deepEqual(sourceLocationFromHref("app.js#L7"), { path: "app.js", line: 7, endLine: 7 });
  assert.deepEqual(sourceLocationFromHref("app.js?plain=1#L2-L1"), {
    path: "app.js",
    line: null,
    endLine: null,
  });
});
