import test from "node:test";
import assert from "node:assert/strict";
import { clearNoteContent, noteActionContract } from "../src/secondary/note-actions.js";

test("clear preserves a valid leading frontmatter block byte-for-byte", () => {
  const prefix = "---\ntitle: Example\nstatus: live\n---\n";
  assert.equal(clearNoteContent(`${prefix}\n# Body\ntext\n`), `${prefix}- [ ]\n`);
  assert.equal(noteActionContract.checklistBody, "- [ ]\n");
});

test("clear supports CRLF frontmatter without normalizing its bytes", () => {
  const prefix = "---\r\ntitle: Example\r\nstatus: live\r\n---\r\n";
  assert.equal(clearNoteContent(`${prefix}body\r\n`), `${prefix}- [ ]\n`);
});

test("clear resets the whole document when leading frontmatter is absent or invalid", () => {
  for (const markdown of [
    "# Note\nbody\n",
    "---\n---\nbody\n",
    "---\ntitle: ok\nnot a property\n---\nbody\n",
    "text\n---\ntitle: later\n---\n",
  ]) {
    assert.equal(clearNoteContent(markdown), "- [ ]\n");
  }
});
