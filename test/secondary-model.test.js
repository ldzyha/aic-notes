import test from "node:test";
import assert from "node:assert/strict";
import {
  isNotePath,
  linkedNotePath,
  managedTags,
  reconcileTagNames,
  applyTextChanges,
  threeWayDecision,
} from "../src/secondary/model.js";

test("note paths are Secondary-only candidates without note-of-note recursion", () => {
  assert.equal(isNotePath("src/app.note.md"), true);
  assert.equal(isNotePath("src/app.md"), false);
  assert.equal(linkedNotePath("src/app.ts"), "src/app.note.md");
  assert.equal(linkedNotePath("src/README.md"), "src/README.note.md");
  assert.equal(linkedNotePath("src/app.note.md"), "src/app.note.md");
});

test("managed tags are exact and root-aware", () => {
  assert.deepEqual(managedTags("demo", "src/lib"), ["demo.src.lib"]);
  assert.deepEqual(managedTags("demo", "."), ["demo"]);
  assert.deepEqual(managedTags(" demo ", "src\\feature / child"), ["demo.src.feature.child"]);
});

test("tag reconciliation replaces only AIC-managed names", () => {
  assert.deepEqual(
    reconcileTagNames(
      ["personal", "aic", "project:old", "path:old", "demo.old", "topic:aic"],
      ["demo.src"],
      ["demo.old"],
    ),
    ["personal", "topic:aic", "demo.src"],
  );
});

test("placeholder changes apply atomically against one source generation", () => {
  assert.equal(
    applyTextChanges("abcdef", [
      { from: 1, to: 3, insert: "X" },
      { from: 5, to: 6, insert: "Y" },
    ]),
    "aXdeY",
  );
  assert.throws(
    () => applyTextChanges("abc", [{ from: 1, to: 3, insert: "x" }, { from: 2, to: 2, insert: "y" }]),
    /non-overlapping/u,
  );
});

test("three-way sync never resolves divergent content silently", () => {
  assert.equal(threeWayDecision("local", "", ""), "push");
  assert.equal(threeWayDecision("local", "remote", ""), "conflict");
  assert.equal(threeWayDecision("local2", "base", "base"), "push");
  assert.equal(threeWayDecision("base", "remote2", "base"), "pull");
  assert.equal(threeWayDecision("local2", "remote2", "base"), "conflict");
  assert.equal(threeWayDecision("local2", "remote2", "base", "local"), "push");
  assert.equal(threeWayDecision("local2", "remote2", "base", "remote"), "pull");
});
