import test from "node:test";
import assert from "node:assert/strict";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { listKeymap } from "../vendor/markdown/handlers/list.js";

function hasTaskMarker(markdown) {
  const cursor = markdownLanguage.parser.parse(markdown).cursor();
  do {
    if (cursor.name === "TaskMarker") return true;
  } while (cursor.next());
  return false;
}

test("raw Space is not intercepted by the list keymap", () => {
  assert.deepEqual(listKeymap.map(({ key }) => key), ["Enter"]);
});

test("a trailing Space completes Markdown task syntax", () => {
  assert.equal(hasTaskMarker("- [ ]"), false);
  assert.equal(hasTaskMarker("- [ ] "), true);
  assert.equal(hasTaskMarker("- [ ] task"), true);
});
