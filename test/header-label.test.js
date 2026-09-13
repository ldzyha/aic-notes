import test from "node:test";
import assert from "node:assert/strict";
import { createNoteHeaderLabel } from "../src/notes/header-label.js";

test("header shows the readonly saved updated date and does not invent one for a placeholder", () => {
  const label = createNoteHeaderLabel();
  const doc = '---\nfile: sample.note.md\nupdated: "2026-09-13T14:30:00.000Z"\n---\nBody';
  const expected = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date("2026-09-13T14:30:00.000Z"));
  assert.equal(label(doc), expected);
  assert.equal(label(doc + " changed"), expected);
  assert.equal(label("# Placeholder"), "");
  assert.equal(label("---\nfile: sample.note.md\nupdated: not-a-date\n---\nBody"), "");
});

test("header never surfaces custom secret values, nested metadata, or malformed YAML", () => {
  const label = createNoteHeaderLabel();
  for (const body of [
    "updated*: SYNTHETIC-SECRET",
    "account:\n  updated: 2026-09-13T14:30:00Z",
    "updated: 2026-09-13T14:30:00Z\nupdated: secret",
    'updated: "unclosed',
  ]) assert.equal(label("---\n" + body + "\n---\nBody"), "");
});
