import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_NOTE_BODY_TEMPLATE,
  NOTE_PROMPTS,
} from "../vendor/aic-editor-core/note-template.js";
import {
  fillTemplate,
  loadTemplate,
  TEMPLATE_PATHS,
} from "../src/notes/templates.js";

test("fillTemplate fills {{name}} and drops unfilled token lines", () => {
  const out = fillTemplate(
    "# {{name}}\n\n## Essence\n{{essence}}\n\n## TODO\n",
    "app.js",
  );
  assert.equal(out, "# app.js\n\n## Essence\n\n## TODO\n");
});

test("fillTemplate collapses blank runs left by dropped lines", () => {
  const out = fillTemplate("# {{name}}\n{{a}}\n{{b}}\n\n\nEnd\n", "x");
  assert.ok(!out.includes("\n\n\n"));
});

test("custom template text remains authored source without automatic migration", async () => {
  const template =
    "---\r\ntitle: old\r\nlevel: file-note\r\nscope: \r\nstatus: live\r\nupdated: old\r\ncreated: old\r\nagent: true\r\n---\r\n# {{name}}\r\n";
  assert.equal(await loadTemplate("file-note", async () => template), template);
});

test("loadTemplate: override wins only when it contains a token", () => {
  const withToken = async () => "# {{name}} custom\n";
  const noToken = async () => "static text\n";
  const missing = async () => {
    throw new Error("nope");
  };
  return Promise.all([
    loadTemplate("file-note", withToken).then((t) =>
      assert.equal(t, "# {{name}} custom\n"),
    ),
    loadTemplate("file-note", noToken).then((t) =>
      assert.equal(t, DEFAULT_NOTE_BODY_TEMPLATE),
    ),
    loadTemplate("file-note", missing).then((t) =>
      assert.equal(t, DEFAULT_NOTE_BODY_TEMPLATE),
    ),
    loadTemplate("project-note", missing).then((t) =>
      assert.equal(t, DEFAULT_NOTE_BODY_TEMPLATE),
    ),
  ]);
});

test("new file, folder and project notes use shared noise-to-wave guidance without metadata", async () => {
  for (const level of Object.keys(TEMPLATE_PATHS)) {
    const body = fillTemplate(
      await loadTemplate(level, async () => null),
      "Subject",
    );
    assert.match(body, /^# Subject\n/u);
    assert.match(body, /## Noise/u);
    assert.ok(body.includes(NOTE_PROMPTS.noiseQuestion));
    assert.ok(body.includes(NOTE_PROMPTS.noiseContext));
    assert.match(body, /\/wave in this same note/u);
    assert.doesNotMatch(body, /^---|## Purpose|## Todo|\{\{/mu);
  }
});

test("template paths cover the three levels", () => {
  assert.deepEqual(Object.keys(TEMPLATE_PATHS), [
    "file-note",
    "folder-note",
    "project-note",
  ]);
});
