import { test } from "node:test";
import assert from "node:assert/strict";
import { notePathFor, folderNotePathFor, noteTargetStem } from "../src/notes/paths.js";

test("notePathFor strips only the final extension", () => {
  assert.equal(notePathFor("src/app.js"), "src/app.note.md");
  assert.equal(notePathFor("file.test.js"), "file.test.note.md");
  assert.equal(notePathFor("README.md"), "README.note.md");
});

test("notePathFor appends for dotfiles and extension-less names", () => {
  assert.equal(notePathFor(".env"), ".env.note.md");
  assert.equal(notePathFor("Makefile"), "Makefile.note.md");
  assert.equal(notePathFor("src/.gitignore"), "src/.gitignore.note.md");
});

test("notePathFor refuses a note of a note", () => {
  assert.equal(notePathFor("src/app.note.md"), null);
});

test("folderNotePathFor appends, never strips dots, root has no note", () => {
  assert.equal(folderNotePathFor("src/components"), "src/components.note.md");
  assert.equal(folderNotePathFor("app.v2"), "app.v2.note.md");
  assert.equal(folderNotePathFor(""), null);
  assert.equal(folderNotePathFor("x.note.md"), null);
});

test("noteTargetStem inverts the naming", () => {
  assert.deepEqual(noteTargetStem("src/app.note.md"), { stem: "src/app", dir: "src" });
  assert.deepEqual(noteTargetStem("lib.note.md"), { stem: "lib", dir: "" });
  assert.equal(noteTargetStem("src/app.md"), null);
});
