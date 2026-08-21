import test from "node:test";
import assert from "node:assert/strict";

import {
  linkedCodeReference,
  noteTargetForSource,
  selectedLineRange,
  sourceLocationFromHref,
  upsertLinkedCodeReference,
} from "../src/notes/selection-model.js";

test("selection ranges are inclusive and exclude a trailing line boundary", () => {
  const source = "one\ntwo\nthree\n";
  assert.deepEqual(selectedLineRange(source, 1, 8), { line: 1, endLine: 2 });
  assert.deepEqual(selectedLineRange(source, 4, 8), { line: 2, endLine: 2 });
  assert.deepEqual(selectedLineRange(source, 8, 4), { line: 2, endLine: 2 });
  assert.equal(selectedLineRange(source, 4, 4), null);
});

test("source and AI artifacts route to one canonical owner sidecar", () => {
  assert.deepEqual(noteTargetForSource("src/panel.ts"), {
    sourcePath: "src/panel.ts",
    ownerPath: "src/panel.ts",
    notePath: "src/panel.note.md",
    ai: false,
  });
  assert.deepEqual(noteTargetForSource("src/panel.ts.ai.md"), {
    sourcePath: "src/panel.ts.ai.md",
    ownerPath: "src/panel.ts",
    notePath: "src/panel.note.md",
    ai: true,
  });
  assert.equal(noteTargetForSource("src/panel.note.md"), null);
  assert.equal(noteTargetForSource("untitled:7"), null);
});

test("linked code uses an encoded sibling href and project-relative label", () => {
  assert.deepEqual(linkedCodeReference("src/my file.js", 7, 11), {
    label: "src/my file.js:7-11",
    href: "my%20file.js#L7-L11",
    markdown: "[src/my file.js:7-11](my%20file.js#L7-L11)",
  });
  assert.equal(linkedCodeReference("README.md", 3).markdown, "[README.md:3](README.md#L3)");
});

test("linked-code bullets insert before the next section and deduplicate", () => {
  const reference = linkedCodeReference("src/app.js", 2, 4);
  const original = "# notes\n\n## Linked code\n\n- existing\n\n## Decisions\n\nKeep this.\n";
  const inserted = upsertLinkedCodeReference(original, reference);
  assert.equal(inserted.created, true);
  assert.match(inserted.text, /- existing\n- \[src\/app\.js:2-4\]\(app\.js#L2-L4\) — \n\n## Decisions/u);
  assert.equal(inserted.text[inserted.cursor], "\n");

  const repeated = upsertLinkedCodeReference(inserted.text, reference);
  assert.equal(repeated.created, false);
  assert.equal(repeated.text, inserted.text);
  assert.equal(repeated.text.match(/app\.js#L2-L4/gu).length, 1);
});

test("a missing Linked code section appends without disturbing frontmatter", () => {
  const reference = linkedCodeReference("src/app.js", 9);
  const result = upsertLinkedCodeReference("---\ntitle: app\n---\n\n# notes\n", reference);
  assert.equal(
    result.text,
    "---\ntitle: app\n---\n\n# notes\n\n## Linked code\n\n- [src/app.js:9](app.js#L9) — \n",
  );
  assert.equal(result.cursor, result.text.length - 1);
});

test("a matching link outside Linked code does not suppress its section entry", () => {
  const reference = linkedCodeReference("src/app.js", 9);
  const original = `# notes\n\nMentioned in prose: ${reference.markdown}.\n\n## Linked code\n`;
  const result = upsertLinkedCodeReference(original, reference);
  assert.equal(result.created, true);
  assert.equal(result.text.match(/app\.js#L9/gu).length, 2);
});

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
