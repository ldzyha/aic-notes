import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate, loadTemplate, TEMPLATE_PATHS } from "../src/notes/templates.js";

test("fillTemplate fills {{name}} and drops unfilled token lines", () => {
  const out = fillTemplate("# {{name}}\n\n## Essence\n{{essence}}\n\n## TODO\n", "app.js");
  assert.equal(out, "# app.js\n\n## Essence\n\n## TODO\n");
});

test("fillTemplate collapses blank runs left by dropped lines", () => {
  const out = fillTemplate("# {{name}}\n{{a}}\n{{b}}\n\n\nEnd\n", "x");
  assert.ok(!out.includes("\n\n\n"));
});

test("loadTemplate: override wins only when it contains a token", () => {
  const withToken = async () => "# {{name}} custom\n";
  const noToken = async () => "static text\n";
  const missing = async () => {
    throw new Error("nope");
  };
  return Promise.all([
    loadTemplate("file-note", withToken).then((t) => assert.equal(t, "# {{name}} custom\n")),
    loadTemplate("file-note", noToken).then((t) => assert.equal(t, "- [ ] \n")),
    loadTemplate("file-note", missing).then((t) => assert.equal(t, "- [ ] \n")),
    loadTemplate("project-note", missing).then((t) => assert.match(t, /## Standards/)),
  ]);
});

test("template paths cover the three levels", () => {
  assert.deepEqual(Object.keys(TEMPLATE_PATHS), ["file-note", "folder-note", "project-note"]);
});
