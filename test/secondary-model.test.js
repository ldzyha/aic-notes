import test from "node:test";
import assert from "node:assert/strict";
import {
  isNotePath,
  linkedNotePath,
  managedTags,
  reconcileTagNames,
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
  assert.deepEqual(managedTags("demo", "src/lib"), [
    "aic",
    "project:demo",
    "path:src/lib",
  ]);
  assert.deepEqual(managedTags("demo", "."), ["aic", "project:demo", "path:."]);
});

test("tag reconciliation replaces only AIC-managed names", () => {
  assert.deepEqual(
    reconcileTagNames(
      ["personal", "aic", "project:old", "path:old", "topic:aic"],
      ["aic", "project:new", "path:src"],
    ),
    ["personal", "topic:aic", "aic", "project:new", "path:src"],
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
