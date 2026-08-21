import test from "node:test";
import assert from "node:assert/strict";

import {
  fencedSelection,
  languageForSourcePath,
  linkedDetailsBlock,
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
    compactLabel: "my file.js · L7–L11",
    compactMarkdown: "[my file.js · L7–L11](my%20file.js#L7-L11)",
  });
  assert.equal(linkedCodeReference("README.md", 3).markdown, "[README.md:3](README.md#L3)");
});

test("linked details insert before the next section and deduplicate", () => {
  const reference = linkedCodeReference("src/app.js", 2, 4);
  const original = "# notes\n\n## Linked code\n\n- existing\n\n## Decisions\n\nKeep this.\n";
  const inserted = upsertLinkedCodeReference(original, reference, "const answer = 42;");
  assert.equal(inserted.created, true);
  assert.match(
    inserted.text,
    /- existing\n>>>\|open\| - \[ \] \[app\.js · L2–L4\]\(app\.js#L2-L4\)\n```javascript\nconst answer = 42;\n```\n\n\*\*Comment\*\*\n\n\n<<<\n\n## Decisions/u,
  );
  assert.equal(inserted.text[inserted.cursor], "\n");

  const repeated = upsertLinkedCodeReference(inserted.text, reference);
  assert.equal(repeated.created, false);
  assert.equal(repeated.text, inserted.text);
  assert.equal(repeated.text.match(/app\.js#L2-L4/gu).length, 1);
});

test("a missing Linked code section appends without disturbing frontmatter", () => {
  const reference = linkedCodeReference("src/app.js", 9);
  const result = upsertLinkedCodeReference("---\ntitle: app\n---\n\n# notes\n", reference, "run();");
  assert.equal(
    result.text,
    "---\ntitle: app\n---\n\n# notes\n\n## Linked code\n\n" +
      ">>>|open| - [ ] [app.js · L9](app.js#L9)\n```javascript\nrun();\n```\n\n" +
      "**Comment**\n\n\n<<<\n",
  );
  assert.equal(result.text.slice(result.cursor, result.cursor + 4), "\n<<<");
});

test("a matching link outside Linked code does not suppress its section entry", () => {
  const reference = linkedCodeReference("src/app.js", 9);
  const original = `# notes\n\nMentioned in prose: ${reference.markdown}.\n\n## Linked code\n`;
  const result = upsertLinkedCodeReference(original, reference);
  assert.equal(result.created, true);
  assert.equal(result.text.match(/app\.js#L9/gu).length, 2);
});

test("linked details preserve the selected fragment and choose a safe fence", () => {
  const reference = linkedCodeReference("src/script.py", 4, 5);
  assert.equal(languageForSourcePath(reference.label.split(":", 1)[0]), "python");
  assert.equal(fencedSelection("print(```)"), "````\nprint(```)\n````");
  const block = linkedDetailsBlock(reference, "print('one')\nprint('two')\n");
  assert.equal(
    `${block.prefix}${block.suffix}`,
    ">>>|open| - [ ] [script.py · L4–L5](script.py#L4-L5)\n" +
      "```python\nprint('one')\nprint('two')\n```\n\n**Comment**\n\n\n<<<",
  );
});

test("deduplication opens only the matching closed detail and preserves its body", () => {
  const reference = linkedCodeReference("src/app.js", 2, 4);
  const original =
    "## Linked code\n\n>>> - [x] [app.js · L2–L4](app.js#L2-L4)\n```javascript\nold();\n```\n\n" +
    "**Comment**\n\nKeep this.\n<<<\n";
  const result = upsertLinkedCodeReference(original, reference, "new();");
  assert.equal(result.created, false);
  assert.equal(result.opened, true);
  assert.match(result.text, /^## Linked code\n\n>>>\|open\| - \[x\]/u);
  assert.match(result.text, /old\(\);[\s\S]*Keep this\./u);
  assert.doesNotMatch(result.text, /new\(\);/u);
  assert.equal(result.text.match(/app\.js#L2-L4/gu).length, 1);
});

test("headings copied inside linked details do not end the Linked code section", () => {
  const first = linkedCodeReference("src/notes.md", 1);
  const second = linkedCodeReference("src/app.js", 3);
  const seeded = upsertLinkedCodeReference("# note\n", first, "## copied heading").text;
  const result = upsertLinkedCodeReference(`${seeded}\n## Decisions\n\nKeep.\n`, second, "run();");
  const linkedSection = result.text.slice(
    result.text.indexOf("## Linked code"),
    result.text.indexOf("## Decisions"),
  );
  assert.match(linkedSection, /notes\.md#L1/u);
  assert.match(linkedSection, /app\.js#L3/u);
  assert.match(result.text, /## Decisions\n\nKeep\./u);
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
